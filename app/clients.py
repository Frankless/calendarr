"""Connexions à Radarr, Sonarr et Jellyfin.

Chaque fonction renvoie des données « normalisées » : un même format de
fiche (dictionnaire) pour un film ou une série, quel que soit le service
d'origine. Le planificateur n'a ainsi pas à connaître les détails des API.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime

import httpx

log = logging.getLogger("calendarr")

TIMEOUT = httpx.Timeout(20.0)


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip().rstrip("/")


class Config:
    radarr_url = _env("RADARR_URL")
    radarr_key = _env("RADARR_API_KEY")
    sonarr_url = _env("SONARR_URL")
    sonarr_key = _env("SONARR_API_KEY")
    jellyfin_url = _env("JELLYFIN_URL")
    jellyfin_key = _env("JELLYFIN_API_KEY")
    jellyfin_user = _env("JELLYFIN_USER")

    @classmethod
    def radarr(cls) -> bool:
        return bool(cls.radarr_url and cls.radarr_key)

    @classmethod
    def sonarr(cls) -> bool:
        return bool(cls.sonarr_url and cls.sonarr_key)

    @classmethod
    def jellyfin(cls) -> bool:
        return bool(cls.jellyfin_url and cls.jellyfin_key)

    @classmethod
    def demo(cls) -> bool:
        return not (cls.radarr() or cls.sonarr())


# --------------------------------------------------------------------------- #
# Outils communs
# --------------------------------------------------------------------------- #

def _poster(images: list[dict] | None) -> str | None:
    for img in images or []:
        if img.get("coverType") == "poster":
            return img.get("remoteUrl") or None
    return None


def _cert(value: str | None) -> str:
    return (value or "").strip()


async def _get(client: httpx.AsyncClient, url: str, **kw):
    r = await client.get(url, timeout=TIMEOUT, **kw)
    r.raise_for_status()
    return r.json()


# --------------------------------------------------------------------------- #
# Radarr
# --------------------------------------------------------------------------- #

async def radarr_movies(client: httpx.AsyncClient) -> list[dict]:
    data = await _get(
        client, f"{Config.radarr_url}/api/v3/movie", headers={"X-Api-Key": Config.radarr_key}
    )
    items = []
    for m in data:
        if not m.get("hasFile"):
            continue
        items.append(
            {
                "uid": f"radarr-{m['id']}",
                "source": "radarr",
                "kind": "film",
                "title": m.get("title") or "Sans titre",
                "year": m.get("year"),
                "runtime": m.get("runtime") or 100,
                "genres": m.get("genres") or [],
                "cert": _cert(m.get("certification")),
                "overview": m.get("overview") or "",
                "poster": _poster(m.get("images")),
                "tmdb": str(m.get("tmdbId") or ""),
                "added": m.get("added"),
            }
        )
    return items


async def radarr_upcoming(client: httpx.AsyncClient, start: date, end: date) -> list[dict]:
    data = await _get(
        client,
        f"{Config.radarr_url}/api/v3/calendar",
        headers={"X-Api-Key": Config.radarr_key},
        params={"start": start.isoformat(), "end": end.isoformat(), "unmonitored": "false"},
    )
    out = []
    for m in data:
        for field, label in (
            ("digitalRelease", "Sortie numérique"),
            ("physicalRelease", "Sortie Blu-ray/DVD"),
            ("inCinemas", "Au cinéma"),
        ):
            when = m.get(field)
            if when and start.isoformat() <= when[:10] <= end.isoformat():
                out.append(
                    {
                        "date": when[:10],
                        "kind": "film",
                        "title": m.get("title"),
                        "detail": label,
                        "poster": _poster(m.get("images")),
                        "available": bool(m.get("hasFile")),
                    }
                )
    return out


# --------------------------------------------------------------------------- #
# Sonarr
# --------------------------------------------------------------------------- #

async def sonarr_series(client: httpx.AsyncClient) -> list[dict]:
    data = await _get(
        client, f"{Config.sonarr_url}/api/v3/series", headers={"X-Api-Key": Config.sonarr_key}
    )
    items = []
    for s in data:
        stats = s.get("statistics") or {}
        if not stats.get("episodeFileCount"):
            continue
        items.append(
            {
                "uid": f"sonarr-{s['id']}",
                "source": "sonarr",
                "sonarr_id": s["id"],
                "kind": "serie",
                "title": s.get("title") or "Sans titre",
                "year": s.get("year"),
                "runtime": s.get("runtime") or 30,
                "genres": s.get("genres") or [],
                "cert": _cert(s.get("certification")),
                "overview": s.get("overview") or "",
                "poster": _poster(s.get("images")),
                "tvdb": str(s.get("tvdbId") or ""),
                "episodes_available": stats.get("episodeFileCount", 0),
                "added": s.get("added"),
            }
        )
    return items


async def sonarr_episodes(client: httpx.AsyncClient, series_id: int) -> list[dict]:
    """Épisodes téléchargés d'une série, dans l'ordre (hors épisodes spéciaux)."""
    data = await _get(
        client,
        f"{Config.sonarr_url}/api/v3/episode",
        headers={"X-Api-Key": Config.sonarr_key},
        params={"seriesId": series_id},
    )
    eps = [
        {
            "season": e.get("seasonNumber"),
            "episode": e.get("episodeNumber"),
            "name": e.get("title") or "",
        }
        for e in data
        if e.get("hasFile") and e.get("seasonNumber", 0) > 0
    ]
    eps.sort(key=lambda e: (e["season"], e["episode"]))
    return eps


async def sonarr_upcoming(client: httpx.AsyncClient, start: date, end: date) -> list[dict]:
    data = await _get(
        client,
        f"{Config.sonarr_url}/api/v3/calendar",
        headers={"X-Api-Key": Config.sonarr_key},
        params={
            "start": start.isoformat(),
            "end": end.isoformat(),
            "includeSeries": "true",
            "unmonitored": "false",
        },
    )
    out = []
    for e in data:
        series = e.get("series") or {}
        out.append(
            {
                "date": (e.get("airDateUtc") or e.get("airDate") or "")[:10],
                "kind": "serie",
                "title": series.get("title") or "Série",
                "series_uid": f"sonarr-{e.get('seriesId')}",
                "detail": f"S{e.get('seasonNumber', 0):02d}E{e.get('episodeNumber', 0):02d}"
                + (f" · {e['title']}" if e.get("title") else ""),
                "poster": _poster(series.get("images")),
                "available": bool(e.get("hasFile")),
            }
        )
    return out


# --------------------------------------------------------------------------- #
# Jellyfin
# --------------------------------------------------------------------------- #

def _jf_headers() -> dict:
    return {
        "X-Emby-Token": Config.jellyfin_key,
        "Authorization": f'MediaBrowser Client="Calendarr", Version="1.0", Token="{Config.jellyfin_key}"',
    }


async def jellyfin_user_id(client: httpx.AsyncClient) -> str | None:
    users = await _get(client, f"{Config.jellyfin_url}/Users", headers=_jf_headers())
    if not users:
        return None
    if Config.jellyfin_user:
        for u in users:
            if (u.get("Name") or "").lower() == Config.jellyfin_user.lower():
                return u["Id"]
        log.warning("Utilisateur Jellyfin « %s » introuvable, on prend le premier.", Config.jellyfin_user)
    admins = [u for u in users if (u.get("Policy") or {}).get("IsAdministrator")]
    return (admins or users)[0]["Id"]


def _parse_dt(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")[:26]).date().isoformat()
    except ValueError:
        return value[:10]


async def jellyfin_history(client: httpx.AsyncClient) -> dict:
    """Ce qui a été vu, par identifiant TMDB (films) et TVDB (séries),
    plus l'épisode « à suivre » de chaque série commencée."""
    uid = await jellyfin_user_id(client)
    if not uid:
        return {"movies": {}, "series": {}, "next_up": {}}

    movies: dict[str, dict] = {}
    data = await _get(
        client,
        f"{Config.jellyfin_url}/Users/{uid}/Items",
        headers=_jf_headers(),
        params={
            "IncludeItemTypes": "Movie",
            "Recursive": "true",
            "Fields": "ProviderIds",
            "EnableImages": "false",
        },
    )
    for it in data.get("Items", []):
        ud = it.get("UserData") or {}
        tmdb = (it.get("ProviderIds") or {}).get("Tmdb")
        if tmdb:
            movies[str(tmdb)] = {
                "played": bool(ud.get("Played")),
                "last_played": _parse_dt(ud.get("LastPlayedDate")),
                "progress": ud.get("PlayedPercentage") or 0,
            }

    series: dict[str, dict] = {}
    data = await _get(
        client,
        f"{Config.jellyfin_url}/Users/{uid}/Items",
        headers=_jf_headers(),
        params={
            "IncludeItemTypes": "Series",
            "Recursive": "true",
            "Fields": "ProviderIds",
            "EnableImages": "false",
        },
    )
    jf_series_to_tvdb = {}
    for it in data.get("Items", []):
        ud = it.get("UserData") or {}
        tvdb = (it.get("ProviderIds") or {}).get("Tvdb")
        if tvdb:
            jf_series_to_tvdb[it["Id"]] = str(tvdb)
            series[str(tvdb)] = {
                "played": bool(ud.get("Played")),
                "last_played": _parse_dt(ud.get("LastPlayedDate")),
                "unplayed": ud.get("UnplayedItemCount"),
            }

    next_up: dict[str, dict] = {}
    data = await _get(
        client,
        f"{Config.jellyfin_url}/Shows/NextUp",
        headers=_jf_headers(),
        params={"userId": uid, "Limit": 100, "EnableImages": "false"},
    )
    for ep in data.get("Items", []):
        tvdb = jf_series_to_tvdb.get(ep.get("SeriesId"))
        if not tvdb:
            continue
        ticks = ep.get("RunTimeTicks") or 0
        next_up[tvdb] = {
            "season": ep.get("ParentIndexNumber"),
            "episode": ep.get("IndexNumber"),
            "name": ep.get("Name") or "",
            "runtime": round(ticks / 600_000_000) if ticks else None,
        }
    return {"movies": movies, "series": series, "next_up": next_up}


# --------------------------------------------------------------------------- #
# Test de connexion (page Réglages)
# --------------------------------------------------------------------------- #

async def check_connections() -> dict:
    result = {}
    async with httpx.AsyncClient() as client:
        for name, enabled, url, headers in (
            ("radarr", Config.radarr(), f"{Config.radarr_url}/api/v3/system/status", {"X-Api-Key": Config.radarr_key}),
            ("sonarr", Config.sonarr(), f"{Config.sonarr_url}/api/v3/system/status", {"X-Api-Key": Config.sonarr_key}),
            ("jellyfin", Config.jellyfin(), f"{Config.jellyfin_url}/System/Info", _jf_headers() if Config.jellyfin() else {}),
        ):
            if not enabled:
                result[name] = {"configured": False, "ok": False, "message": "Non configuré"}
                continue
            try:
                data = await _get(client, url, headers=headers)
                version = data.get("version") or data.get("Version") or ""
                result[name] = {"configured": True, "ok": True, "message": f"Connecté (v{version})"}
            except Exception as exc:  # noqa: BLE001 - on veut un message lisible
                result[name] = {"configured": True, "ok": False, "message": _explain(exc)}
    return result


def _explain(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        code = exc.response.status_code
        if code in (401, 403):
            return "Clé API refusée : vérifie-la"
        return f"Erreur {code}"
    if isinstance(exc, httpx.ConnectError):
        return "Injoignable : vérifie l'adresse"
    if isinstance(exc, httpx.TimeoutException):
        return "Trop lent à répondre"
    return str(exc)[:120]
