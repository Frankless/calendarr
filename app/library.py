"""Rassemble la bibliothèque (Radarr + Sonarr) et l'historique (Jellyfin)."""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, timedelta

import httpx

from . import clients, demo
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
        _cache.update(at=time.time(), items=items, warnings=warnings)
        return items, warnings


async def _load() -> tuple[list[dict], list[str]]:
    if Config.demo():
        return demo.library(), []

    warnings: list[str] = []
    items: list[dict] = []
    history = {"movies": {}, "series": {}, "next_up": {}}
    async with httpx.AsyncClient() as client:
        tasks = {}
        if Config.radarr():
            tasks["radarr"] = clients.radarr_movies(client)
        if Config.sonarr():
            tasks["sonarr"] = clients.sonarr_series(client)
        if Config.jellyfin():
            tasks["jellyfin"] = clients.jellyfin_history(client)
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for name, res in zip(tasks, results):
            if isinstance(res, Exception):
                log.warning("%s injoignable : %s", name.capitalize(), clients._explain(res))
                warnings.append(f"{name.capitalize()} : {clients._explain(res)}")
            elif name == "jellyfin":
                history = res
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
    return items, warnings


async def upcoming(start: date, days: int = 14) -> list[dict]:
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


async def episodes_for(item: dict) -> list[dict]:
    """Liste ordonnée des épisodes disponibles d'une série."""
    if item.get("source") == "sonarr" and Config.sonarr():
        try:
            async with httpx.AsyncClient() as client:
                return await clients.sonarr_episodes(client, item["sonarr_id"])
        except Exception as exc:  # noqa: BLE001
            log.warning("Épisodes indisponibles pour %s : %s", item["title"], exc)
            return []
    # Démo : 3 saisons de 20 épisodes
    return [{"season": s, "episode": e, "name": ""} for s in (1, 2, 3) for e in range(1, 21)]
