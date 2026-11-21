"""Connexions à Radarr, Sonarr et Jellyfin.

Chaque fonction renvoie des données « normalisées » : un même format de
fiche (dictionnaire) pour un film ou une série, quel que soit le service
d'origine. Le planificateur n'a ainsi pas à connaître les détails des API.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import date, datetime
from pathlib import Path

import httpx

log = logging.getLogger("calendarr")

TIMEOUT = httpx.Timeout(20.0)


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip().rstrip("/")


CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config"))
CONNECTIONS_FILE = CONFIG_DIR / "connections.json"

# champ -> variable d'environnement (facultative, utilisée si rien n'est saisi dans l'app)
FIELDS = {
    "radarr_url": "RADARR_URL",
    "radarr_key": "RADARR_API_KEY",
    "sonarr_url": "SONARR_URL",
    "sonarr_key": "SONARR_API_KEY",
    "jellyfin_url": "JELLYFIN_URL",
    "jellyfin_key": "JELLYFIN_API_KEY",
    "jellyfin_user": "JELLYFIN_USER",
    "jellyfin_web_url": "JELLYFIN_PUBLIC_URL",
}


def _clean(field: str, value) -> str:
    value = str(value or "").strip()
    if field.endswith("_url"):
        value = value.rstrip("/")
        if value and "://" not in value:
            value = "http://" + value
    return value


class Config:
    """Adresses et clés API. Elles se saisissent dans l'app (Réglages →
    Connexions) et sont enregistrées dans /config/connections.json.
    Les variables d'environnement restent possibles en secours."""

    radarr_url = radarr_key = sonarr_url = sonarr_key = ""
    jellyfin_url = jellyfin_key = jellyfin_user = jellyfin_web_url = ""

    @classmethod
    def reload(cls) -> None:
        saved = {}
        if CONNECTIONS_FILE.exists():
            try:
                saved = json.loads(CONNECTIONS_FILE.read_text("utf-8"))
            except (OSError, json.JSONDecodeError):
                log.warning("connections.json illisible, ignoré")
        for field, env in FIELDS.items():
            setattr(cls, field, _clean(field, saved.get(field)) or _clean(field, _env(env)))

    @classmethod
    def save(cls, data: dict) -> None:
        """Enregistre les connexions. Une clé laissée vide garde l'ancienne."""
        current = {f: getattr(cls, f) for f in FIELDS}
        before = dict(current)
        for field in FIELDS:
            if field not in data or data[field] is None:
                continue
            value = _clean(field, data[field])
            if field.endswith("_key") and not value:
                continue  # champ laissé vide : on garde la clé déjà enregistrée
            current[field] = value
        # Sécurité : si l'adresse d'un service change, l'ancienne clé n'est pas
        # envoyée au nouveau serveur ; il faut la saisir à nouveau.
        for svc in ("radarr", "sonarr", "jellyfin"):
            url_changed = current[f"{svc}_url"] != before[f"{svc}_url"] and before[f"{svc}_url"]
            new_key = _clean(f"{svc}_key", data.get(f"{svc}_key"))
            if url_changed and not new_key:
                current[f"{svc}_key"] = ""
        # sans adresse, la clé ne sert à rien : on l'efface
        for svc in ("radarr", "sonarr", "jellyfin"):
            if not current[f"{svc}_url"]:
                current[f"{svc}_key"] = ""
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CONNECTIONS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(current, indent=2), "utf-8")
        os.chmod(tmp, 0o600)
        tmp.replace(CONNECTIONS_FILE)
        cls.reload()

    @classmethod
    def public(cls) -> dict:
        """Ce qu'on renvoie au navigateur : jamais la clé complète."""
        def hint(key: str) -> str:
            return f"••••{key[-4:]}" if len(key) > 8 else ("••••" if key else "")
        return {
            svc: {
                "url": getattr(cls, f"{svc}_url"),
                "has_key": bool(getattr(cls, f"{svc}_key")),
                "key_hint": hint(getattr(cls, f"{svc}_key")),
            }
            for svc in ("radarr", "sonarr", "jellyfin")
        } | {"jellyfin_user": cls.jellyfin_user, "jellyfin_web_url": cls.jellyfin_web_url}

    @classmethod
    def watch_url(cls, jf_id: str | None) -> str | None:
        """Lien qui ouvre le titre dans Jellyfin, depuis le téléphone ou l'iPad."""
        base = cls.jellyfin_web_url or cls.jellyfin_url
        if not (jf_id and base and cls.jellyfin_key):
            return None
        return f"{base}/web/#/details?id={jf_id}"

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


Config.reload()


# --------------------------------------------------------------------------- #
# Outils communs
# --------------------------------------------------------------------------- #

def _poster(images: list[dict] | None) -> str | None:
    for img in images or []:
        if img.get("coverType") == "poster":
            url = img.get("remoteUrl") or ""
            if url.startswith(("https://", "http://")) and not any(c in url for c in "'\"()<> \\"):
                return url
            return None
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
                "tmdb": str(s.get("tmdbId") or ""),
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


async def jellyfin_users() -> list[str]:
    if not Config.jellyfin():
        return []
    async with httpx.AsyncClient() as client:
        users = await _get(client, f"{Config.jellyfin_url}/Users", headers=_jf_headers())
    return [u.get("Name") for u in users if u.get("Name")]


async def jellyfin_set_played(jf_id: str, played: bool = True) -> bool:
    """Marque un titre vu (ou non vu) pour l'utilisateur Jellyfin choisi."""
    if not (Config.jellyfin() and jf_id):
        return False
    async with httpx.AsyncClient() as client:
        uid = await jellyfin_user_id(client)
        url = f"{Config.jellyfin_url}/Users/{uid}/PlayedItems/{jf_id}"
        r = await (client.post if played else client.delete)(url, headers=_jf_headers(), timeout=TIMEOUT)
        r.raise_for_status()
    return True


COLLECTION_PREFIX = "Calendarr · "
MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
             "septembre", "octobre", "novembre", "décembre"]


def collection_name(week_start: date) -> str:
    """« Calendarr · Semaine du 23 novembre »"""
    return f"{COLLECTION_PREFIX}Semaine du {week_start.day} {MONTHS_FR[week_start.month - 1]}"


async def jellyfin_sync_collection(name: str, item_ids: list[str]) -> str:
    """Tient à jour la collection Jellyfin de la semaine et supprime celles des
    semaines précédentes (seule la collection est supprimée, jamais les films)."""
    if not Config.jellyfin():
        return "Jellyfin non branché"
    wanted = [i for i in dict.fromkeys(item_ids) if i]
    plural = lambda n: f"{n} titre{'s' if n > 1 else ''}"  # noqa: E731
    async with httpx.AsyncClient() as client:
        uid = await jellyfin_user_id(client)
        found = await _get(
            client, f"{Config.jellyfin_url}/Users/{uid}/Items", headers=_jf_headers(),
            params={"IncludeItemTypes": "BoxSet", "Recursive": "true", "SearchTerm": "Calendarr"},
        )
        ours = [c for c in found.get("Items", []) if (c.get("Name") or "").startswith(COLLECTION_PREFIX)]
        for old in ours:
            if old.get("Name") != name:
                r = await client.delete(f"{Config.jellyfin_url}/Items/{old['Id']}", headers=_jf_headers(), timeout=TIMEOUT)
                if r.status_code >= 400:
                    log.warning("Ancienne collection « %s » non supprimée (%s)", old.get("Name"), r.status_code)
        coll = next((c for c in ours if c.get("Name") == name), None)
        if not coll:
            if not wanted:
                return "rien à voir pour le reste de la semaine"
            r = await client.post(
                f"{Config.jellyfin_url}/Collections", headers=_jf_headers(), timeout=TIMEOUT,
                params={"Name": name, "Ids": ",".join(wanted)},
            )
            r.raise_for_status()
            return f"« {name} » créée ({plural(len(wanted))})"
        children = await _get(
            client, f"{Config.jellyfin_url}/Users/{uid}/Items", headers=_jf_headers(),
            params={"ParentId": coll["Id"], "EnableImages": "false"},
        )
        current = {c["Id"] for c in children.get("Items", [])}
        to_add = [i for i in wanted if i not in current]
        to_remove = [i for i in current if i not in set(wanted)]
        if to_add:
            r = await client.post(f"{Config.jellyfin_url}/Collections/{coll['Id']}/Items",
                                  headers=_jf_headers(), params={"Ids": ",".join(to_add)}, timeout=TIMEOUT)
            r.raise_for_status()
        if to_remove:
            r = await client.delete(f"{Config.jellyfin_url}/Collections/{coll['Id']}/Items",
                                    headers=_jf_headers(), params={"Ids": ",".join(to_remove)}, timeout=TIMEOUT)
            r.raise_for_status()
        return f"« {name} » à jour ({plural(len(wanted))})"


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
                "jf_id": it.get("Id"),
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
                "jf_id": it.get("Id"),
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
            "jf_id": ep.get("Id"),
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
