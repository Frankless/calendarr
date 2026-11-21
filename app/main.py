"""Calendarr : le programme télé de la famille, construit à partir de
Radarr, Sonarr et Jellyfin."""

from __future__ import annotations

import logging
import os
import secrets
from datetime import date, timedelta
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import ics, library, planner, settings
from .clients import Config, check_connections, jellyfin_users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Calendarr", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")


def _calendar_token() -> str:
    """Jeton secret qui protège le lien du calendrier."""
    env = os.environ.get("CALENDAR_TOKEN", "").strip()
    if env:
        return env
    path = settings.CONFIG_DIR / "calendar_token"
    if path.exists():
        return path.read_text().strip()
    token = secrets.token_urlsafe(16)
    settings.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    return token


def _week(value: str | None) -> date:
    if not value:
        return planner.week_start(ics.today_local())
    try:
        return planner.week_start(date.fromisoformat(value))
    except ValueError as exc:
        raise HTTPException(400, "Date invalide") from exc


@app.get("/")
async def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/status")
async def status(request: Request):
    base = os.environ.get("PUBLIC_URL", "").rstrip("/") or str(request.base_url).rstrip("/")
    token = _calendar_token()
    ics_url = f"{base}/calendar.ics?token={token}"
    return {
        "demo": Config.demo(),
        "services": await check_connections(),
        "calendar_url": ics_url,
        "webcal_url": ics_url.replace("https://", "webcal://").replace("http://", "webcal://"),
        "today": ics.today_local().isoformat(),
    }


@app.get("/api/connections")
async def get_connections():
    return {"connections": Config.public(), "services": await check_connections()}


@app.put("/api/connections")
async def put_connections(data: dict = Body(...)):
    before = Config.public() | {"keys": (Config.radarr_key, Config.sonarr_key, Config.jellyfin_key)}
    flat = {}
    for svc in ("radarr", "sonarr", "jellyfin"):
        part = data.get(svc) or {}
        if "url" in part:
            flat[f"{svc}_url"] = part["url"]
        if part.get("key"):
            flat[f"{svc}_key"] = part["key"]
    if "jellyfin_user" in data:
        flat["jellyfin_user"] = data["jellyfin_user"]
    Config.save(flat)
    await library.get(force=True)
    after = Config.public() | {"keys": (Config.radarr_key, Config.sonarr_key, Config.jellyfin_key)}
    if before != after:
        # la bibliothèque ou l'historique ont changé : on refait les programmes
        # à partir de cette semaine (les semaines passées sont gardées)
        planner.clear_plans(planner.week_start(ics.today_local()))
    return {"connections": Config.public(), "services": await check_connections(), "demo": Config.demo()}


@app.get("/api/jellyfin/users")
async def get_jellyfin_users():
    try:
        return await jellyfin_users()
    except Exception:  # noqa: BLE001
        return []


@app.get("/api/settings")
async def get_settings():
    items, _ = await library.get()
    genres = sorted({g for it in items for g in it.get("genres") or []})
    return {
        "settings": settings.load(),
        "days": settings.DAYS,
        "audiences": settings.AUDIENCES,
        "kinds": settings.KINDS,
        "genres": genres,
    }


@app.put("/api/settings")
async def put_settings(data: dict = Body(...)):
    return {"settings": settings.save(data)}


@app.get("/api/plan")
async def get_plan(week: str | None = None):
    plan = await planner.get_plan(_week(week), settings.load())
    _, warnings = await library.get()
    return plan | {"warnings": warnings}  # l'état des connexions d'aujourd'hui, pas celui du jour de création


@app.post("/api/plan/regenerate")
async def regenerate(week: str | None = None, refresh: bool = False):
    if refresh:
        await library.get(force=True)
    return await planner.regenerate(_week(week), settings.load())


@app.post("/api/plan/swap")
async def swap(week: str, entry: str):
    return await planner.swap(_week(week), entry, settings.load())


@app.delete("/api/plan/entry")
async def delete_entry(week: str, entry: str):
    plan = planner.remove_entry(_week(week), entry)
    if plan is None:
        raise HTTPException(404, "Programme introuvable")
    return plan


@app.post("/api/plan/add")
async def add(data: dict = Body(...)):
    try:
        day = date.fromisoformat(data["date"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, "Date invalide") from exc
    return await planner.add_entry(
        day, str(data.get("start") or "21:00")[:5], str(data["uid"]),
        data.get("audience") or "adultes", settings.load(),
    )


@app.get("/api/surprise")
async def surprise():
    return await planner.shelves(settings.load())


@app.get("/api/upcoming")
async def upcoming():
    return await library.upcoming(ics.today_local() - timedelta(days=1), days=21)


@app.get("/calendar.ics")
async def calendar(token: str = ""):
    if not secrets.compare_digest(token, _calendar_token()):
        raise HTTPException(403, "Lien de calendrier invalide")
    cfg = settings.load()
    this_week = planner.week_start(ics.today_local())
    plans = []
    # semaine passée (si elle existe), cette semaine et la suivante
    past = planner.load_plan(this_week - timedelta(days=7))
    if past:
        plans.append(past)
    for offset in (0, 7):
        plans.append(await planner.get_plan(this_week + timedelta(days=offset), cfg))
    body = ics.build(plans, cfg.get("reminder_minutes", 15))
    return Response(
        body,
        media_type="text/calendar; charset=utf-8",
        headers={"Content-Disposition": 'inline; filename="calendarr.ics"'},
    )


@app.get("/health")
async def health():
    return {"ok": True}
