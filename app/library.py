"""Rassemble la bibliothèque (Radarr + Sonarr) et l'historique (Jellyfin)."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta

import httpx

from . import clients, demo, watchstate
from .clients import Config

log = logging.getLogger("calendarr")

CACHE_SECONDS = 600
_cache: dict = {"at": 0.0, "items": [], "warnings": []}
_lock = asyncio.Lock()


async def get(force: bool = False) -> tuple[list[dict], list[str]]:
    async with _lock:
        if not force and _cache["items"] and time.time() - _cache["at"] < CACHE_SECONDS:
            return _cache["items"], _cache["warnings"]
        items, warnings = await _load()
        try:
            watchstate.sync(items)
        except Exception as exc:  # noqa: BLE001 - le suivi ne doit jamais bloquer l'app
            log.warning("Suivi des séries indisponible : %s", exc)
        _cache.update(at=time.time(), items=items, warnings=warnings)
        if force:
            clear_caches()
        return items, warnings


async def _load() -> tuple[list[dict], list[str]]:
    if Config.demo():
        return demo.library(), []

    warnings: list[str] = []
    items: list[dict] = []
    history = {"movies": {}, "series": {}, "next_up": {}}
    extra: dict[str, dict] = {}
    async with httpx.AsyncClient() as client:
        tasks = {}
        if Config.radarr():
            tasks["radarr"] = clients.radarr_movies(client)
        if Config.sonarr():
            tasks["sonarr"] = clients.sonarr_series(client)
        profiles = {}
        if Config.jellyfin():
            tasks["jellyfin"] = clients.jellyfin_history(client)
            # historiques séparés (enfants, famille) si un autre utilisateur est choisi
            for aud in ("enfants", "famille"):
                name = Config.profile(aud)
                if name and name.lower() != (Config.jellyfin_user or "").lower():
                    profiles[aud] = name
            for name in sorted(set(profiles.values())):
                tasks[f"jellyfin:{name}"] = clients.jellyfin_history(client, name)
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for name, res in zip(tasks, results):
            if isinstance(res, Exception):
                log.warning("%s injoignable : %s", name.capitalize(), clients._explain(res))
                warnings.append(f"{name.capitalize()} : {clients._explain(res)}")
            elif name == "jellyfin":
                history = res
            elif name.startswith("jellyfin:"):
                extra[name.split(":", 1)[1]] = res
            else:
                items.extend(res)

    for it in items:
        if it["kind"] == "film":
            h = history["movies"].get(it.get("tmdb", ""), {})
            it["played"] = h.get("played", False)
            it["last_played"] = h.get("last_played")
            it["jf_id"] = h.get("jf_id")
        else:
            h = history["series"].get(it.get("tvdb", ""), {})
            it["played"] = h.get("played", False)
            it["last_played"] = h.get("last_played")
            it["next_up"] = history["next_up"].get(it.get("tvdb", ""))
            it["jf_id"] = h.get("jf_id")
        # ce qu'a vu chaque public qui a son propre utilisateur Jellyfin
        it["hist"] = {}
        for aud, name in profiles.items():
            hx = extra.get(name)
            if not hx:
                continue
            if it["kind"] == "film":
                h = hx["movies"].get(it.get("tmdb", ""), {})
                it["hist"][aud] = {"played": h.get("played", False), "last_played": h.get("last_played")}
            else:
                h = hx["series"].get(it.get("tvdb", ""), {})
                it["hist"][aud] = {"played": h.get("played", False), "last_played": h.get("last_played"),
                                   "next_up": hx["next_up"].get(it.get("tvdb", ""))}
    return items, warnings


def view(item: dict, audience: str) -> dict:
    """La fiche telle que la voit ce public (son propre « déjà vu »)."""
    h = (item.get("hist") or {}).get(audience)
    return item | h if h else item


async def upcoming(start: date, days: int = 14) -> list[dict]:
    key = (start, days)
    hit = _upcoming_cache.get(key)
    if hit and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    out = await _upcoming(start, days)
    _upcoming_cache[key] = (time.time(), out)
    return out


async def _upcoming(start: date, days: int) -> list[dict]:
    end = start + timedelta(days=days)
    if Config.demo():
        return demo.upcoming(start)
    out: list[dict] = []
    async with httpx.AsyncClient() as client:
        tasks = []
        if Config.radarr():
            tasks.append(clients.radarr_upcoming(client, start, end))
        if Config.sonarr():
            tasks.append(clients.sonarr_upcoming(client, start, end))
        for res in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(res, Exception):
                log.warning("Calendrier indisponible : %s", res)
            else:
                out.extend(res)
    out.sort(key=lambda e: (e["date"], e["title"]))
    return out


_episodes_cache: dict[int, tuple[float, list[dict]]] = {}
_upcoming_cache: dict[tuple, tuple[float, list[dict]]] = {}


def clear_caches() -> None:
    _episodes_cache.clear()
    _upcoming_cache.clear()


async def episodes_for(item: dict) -> list[dict]:
    """Liste ordonnée des épisodes disponibles d'une série (gardée 10 minutes)."""
    if item.get("source") == "sonarr" and Config.sonarr():
        hit = _episodes_cache.get(item["sonarr_id"])
        if hit and time.time() - hit[0] < CACHE_SECONDS:
            return hit[1]
        try:
            async with httpx.AsyncClient() as client:
                eps = await clients.sonarr_episodes(client, item["sonarr_id"])
            _episodes_cache[item["sonarr_id"]] = (time.time(), eps)
            return eps
        except Exception as exc:  # noqa: BLE001
            log.warning("Épisodes indisponibles pour %s : %s", item["title"], exc)
            return []
    # Démo : 3 saisons de 20 épisodes
    return [{"season": s, "episode": e, "name": ""} for s in (1, 2, 3) for e in range(1, 21)]
