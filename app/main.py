"""Calendarr : le programme télé de la famille, construit à partir de
Radarr, Sonarr et Jellyfin."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
from datetime import date, timedelta
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from . import auth, feedback, ics, library, planner, settings
from .clients import Config, collection_name, jellyfin_set_episodes_played, jellyfin_set_played, check_connections, jellyfin_sync_collection, jellyfin_users

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


class _RedactTokens(logging.Filter):
    """Masque ?token=… (calendrier, écran de cuisine) dans les journaux."""
    PATTERN = re.compile(r"(token=)[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            record.args = tuple(self.PATTERN.sub(r"\1***", a) if isinstance(a, str) else a for a in record.args)
        record.msg = self.PATTERN.sub(r"\1***", str(record.msg))
        return True


for _name in ("uvicorn.access", "uvicorn.error", "httpx"):
    logging.getLogger(_name).addFilter(_RedactTokens())

STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Calendarr", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

# Routes accessibles sans être connecté
PUBLIC_PATHS = {"/", "/health", "/calendar.ics", "/sw.js", "/manifest.webmanifest", "/mur", "/api/wall", "/api/auth/state", "/api/auth/login", "/api/auth/setup", "/api/auth/logout"}
# Routes réservées aux administrateurs
ADMIN_ROUTES = {
    ("GET", "/api/connections"), ("PUT", "/api/connections"),
    ("GET", "/api/jellyfin/users"),
    ("GET", "/api/settings"), ("PUT", "/api/settings"),
    ("GET", "/api/wall-link"), ("POST", "/api/wall-link/reset"),
    ("POST", "/api/collection/sync"),
}


@app.middleware("http")
async def require_login(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith("/static/"):
        return await call_next(request)
    # protection CSRF : les modifications doivent venir de l'app elle-même
    if request.method not in ("GET", "HEAD") and request.headers.get("x-calendarr") != "1":
        return JSONResponse({"detail": "Requête refusée"}, status_code=403)
    user = auth.read_session(request.cookies.get(auth.COOKIE))
    if not user:
        return JSONResponse({"detail": "Connexion requise"}, status_code=401)
    is_admin_route = (request.method, path) in ADMIN_ROUTES or path.startswith("/api/users")
    if is_admin_route and user["role"] != "admin":
        return JSONResponse({"detail": "Réservé aux administrateurs"}, status_code=403)
    request.state.user = user
    return await call_next(request)


# ajouté après require_login : il l'englobe, donc s'applique aussi aux refus (401, 403)
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    # L'écran de cuisine peut être affiché dans un tableau de bord (Home Assistant…), pas le reste
    if request.url.path != "/mur":
        response.headers.setdefault("X-Frame-Options", "DENY")
    return response


def _set_cookie(request: Request, response: Response, user: dict) -> None:
    response.set_cookie(
        auth.COOKIE, auth.make_session(user),
        max_age=auth.SESSION_DAYS * 86400, httponly=True, samesite="lax",
        secure=request.url.scheme == "https", path="/",
    )


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "?"


def _fail(message: str, code: int = 400):
    raise HTTPException(code, message)


@app.get("/api/auth/state")
async def auth_state(request: Request):
    user = auth.read_session(request.cookies.get(auth.COOKIE))
    return {"setup_needed": not auth.has_users(), "user": auth.public(user) if user else None}


@app.post("/api/auth/setup")
async def auth_setup(request: Request, data: dict = Body(...)):
    """Création du premier compte (administrateur). Possible une seule fois."""
    if request.headers.get("x-calendarr") != "1":
        _fail("Requête refusée", 403)
    if auth.has_users():
        _fail("Un compte existe déjà.", 403)
    try:
        auth.create_user(data.get("username", ""), data.get("password", ""), "admin")
    except ValueError as exc:
        _fail(str(exc))
    user = auth.verify(data["username"], data["password"])
    response = JSONResponse({"user": auth.public(user)})
    _set_cookie(request, response, user)
    return response


@app.post("/api/auth/login")
async def auth_login(request: Request, data: dict = Body(...)):
    if request.headers.get("x-calendarr") != "1":
        _fail("Requête refusée", 403)
    ip = _client_ip(request)
    name = str(data.get("username", ""))
    wait = auth.too_many_attempts(ip, name)
    if wait:
        _fail(f"Trop d'essais. Réessayez dans {wait} secondes.", 429)
    user = auth.verify(name, data.get("password", ""))
    if not user:
        auth.record_failure(ip, name)
        _fail("Nom d'utilisateur ou mot de passe incorrect.", 401)
    auth.clear_failures(ip, name)
    response = JSONResponse({"user": auth.public(user)})
    _set_cookie(request, response, user)
    return response


@app.post("/api/auth/logout")
async def auth_logout():
    response = JSONResponse({"ok": True})
    response.delete_cookie(auth.COOKIE, path="/")
    return response


@app.post("/api/auth/password")
async def auth_password(request: Request, data: dict = Body(...)):
    """Changer son propre mot de passe (l'ancien est demandé)."""
    me = request.state.user
    if not auth.verify(me["username"], data.get("current", "")):
        _fail("Le mot de passe actuel est incorrect.")
    try:
        user = auth.set_password(me["id"], data.get("password", ""))
    except ValueError as exc:
        _fail(str(exc))
    response = JSONResponse({"ok": True})
    _set_cookie(request, response, user)  # cet appareil reste connecté
    return response


@app.get("/api/users")
async def users_list():
    return {"users": auth.list_users(), "roles": auth.ROLES}


@app.post("/api/users")
async def users_create(data: dict = Body(...)):
    try:
        auth.create_user(data.get("username", ""), data.get("password", ""), data.get("role", "famille"))
    except ValueError as exc:
        _fail(str(exc))
    return {"users": auth.list_users()}


@app.put("/api/users/{user_id}")
async def users_update(user_id: str, request: Request, data: dict = Body(...)):
    try:
        if data.get("role"):
            if user_id == request.state.user["id"] and data["role"] != "admin":
                _fail("Vous ne pouvez pas retirer vos propres droits d'administrateur.")
            auth.set_role(user_id, data["role"])
        if data.get("password"):
            auth.set_password(user_id, data["password"])
    except ValueError as exc:
        _fail(str(exc))
    return {"users": auth.list_users()}


@app.delete("/api/users/{user_id}")
async def users_delete(user_id: str, request: Request):
    if user_id == request.state.user["id"]:
        _fail("Vous ne pouvez pas supprimer votre propre compte.")
    try:
        auth.delete_user(user_id)
    except ValueError as exc:
        _fail(str(exc))
    return {"users": auth.list_users()}


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
    os.chmod(path, 0o600)
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
        "version": os.environ.get("APP_VERSION", "dev"),
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
    if "jellyfin_web_url" in data:
        flat["jellyfin_web_url"] = data["jellyfin_web_url"]
    for key in ("jellyfin_user_kids", "jellyfin_user_family"):
        if key in data:
            flat[key] = data[key]
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
        "players": settings.PLAYERS,
        "collection_name": collection_name(planner.week_start(ics.today_local())),
        "genres": genres,
    }


@app.put("/api/settings")
async def put_settings(data: dict = Body(...)):
    return {"settings": settings.save(data)}


@app.get("/api/plan")
async def get_plan(week: str | None = None):
    plan = await planner.get_plan(_week(week), settings.load())
    return await _decorate(plan)


async def _decorate(plan: dict) -> dict:
    """Ajoute ce qui change d'un jour à l'autre : le lien pour regarder,
    l'âge conseillé et l'état des connexions (pas enregistrés dans le plan)."""
    items, warnings = await library.get()
    by_uid = {it["uid"]: it for it in items}
    cfg = settings.load()
    player = cfg.get("player", "jellyfin")
    sync = cfg.get("sync_collection") and Config.jellyfin()
    entries = []
    for e in plan["entries"]:
        e = dict(e)
        it = e.get("item")
        full = by_uid.get(it["uid"]) if it else None
        if it and full:
            full = library.view(full, e.get("audience", "adultes"))
            e["item"] = it | {"age": planner.min_age(full)}
            jf_id = full.get("jf_id")
            nxt = full.get("next_up")
            if nxt and e.get("episodes") and e["episodes"][0]["code"] == f"S{nxt['season']:02d}E{nxt['episode']:02d}":
                jf_id = nxt.get("jf_id") or jf_id  # ouvrir directement le bon épisode
            e |= _watch(full, e, jf_id, player)
        entries.append(e)
    if sync:
        _schedule_sync()
    return plan | {"entries": entries, "warnings": warnings, "player": player}


def _watch(full: dict, e: dict, jf_id: str | None, player: str) -> dict:
    """Comment lancer ce programme, selon la façon dont la famille regarde."""
    if player == "appletv":
        ep = e["episodes"][0]["code"] if e.get("episodes") else ""
        coll = collection_name(planner.week_start(date.fromisoformat(e["date"])))
        where = f"Infuse → collection « {coll} »" if settings.load().get("sync_collection") else "Infuse → Films" if full["kind"] == "film" else "Infuse → Séries"
        return {"appletv": {"where": where, "title": full["title"], "episode": ep}}
    if player == "infuse":
        tmdb = full.get("tmdb")
        if not tmdb or str(tmdb).startswith("demo"):
            return {}
        if full["kind"] == "film":
            return {"watch_url": f"infuse://movie/{tmdb}"}
        if e.get("episodes"):
            code = e["episodes"][0]["code"]  # S02E03
            season, episode = int(code[1:3]), int(code[4:6])
            return {"watch_url": f"infuse://series/{tmdb}-{season}-{episode}"}
        return {"watch_url": f"infuse://series/{tmdb}"}
    return {"watch_url": Config.watch_url(jf_id)}


# --------------------------------------------------------------------------- #
# Collection Jellyfin « Calendarr · Cette semaine » (pour Infuse sur l'Apple TV)
# --------------------------------------------------------------------------- #

_sync_state = {"last": None, "task": None, "message": ""}


async def _week_remaining() -> tuple[str, list[str]]:
    """Nom de la collection de la semaine et identifiants Jellyfin de ce qui
    reste à voir (d'aujourd'hui à dimanche ; les jours passés en sortent)."""
    cfg = settings.load()
    today = ics.today_local()
    start = planner.week_start(today)
    entries = (await planner.get_plan(start, cfg))["entries"]
    items, _ = await library.get()
    by_uid = {it["uid"]: it for it in items}
    first, last = today.isoformat(), (start + timedelta(days=6)).isoformat()
    ids = []
    for e in sorted(entries, key=lambda x: (x["date"], x["start"])):
        if e.get("item") and first <= e["date"] <= last and not e.get("watched"):
            full = by_uid.get(e["item"]["uid"])
            if full and full.get("jf_id"):
                ids.append(full["jf_id"])
    return collection_name(start), ids


def _schedule_sync() -> None:
    """Met la collection à jour en arrière-plan, seulement si la liste a changé."""
    async def run():
        try:
            name, ids = await _week_remaining()
            if (name, ids) == _sync_state["last"]:
                return
            _sync_state["message"] = await jellyfin_sync_collection(name, ids)
            _sync_state["last"] = (name, ids)
            logging.info("Collection Jellyfin : %s", _sync_state["message"])
        except Exception as exc:  # noqa: BLE001
            _sync_state["message"] = f"échec : {exc}"
            logging.warning("Collection Jellyfin : %s", exc)

    task = _sync_state.get("task")
    if task and not task.done():
        return
    _sync_state["task"] = asyncio.create_task(run())


@app.post("/api/collection/sync")
async def collection_sync():
    name, ids = await _week_remaining()
    try:
        message = await jellyfin_sync_collection(name, ids)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"Jellyfin a refusé : {exc}") from exc
    _sync_state["last"] = (name, ids)
    return {"message": message}


# --------------------------------------------------------------------------- #
# Écran de cuisine : page en lecture seule, ouverte par un lien secret
# --------------------------------------------------------------------------- #

def _wall_token(reset: bool = False) -> str:
    path = settings.CONFIG_DIR / "wall_token"
    if path.exists() and not reset:
        return path.read_text().strip()
    token = secrets.token_urlsafe(18)
    settings.CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(token)
    os.chmod(path, 0o600)
    return token


def _base_url(request: Request) -> str:
    return os.environ.get("PUBLIC_URL", "").rstrip("/") or str(request.base_url).rstrip("/")


@app.get("/api/wall-link")
async def wall_link(request: Request):
    return {"url": f"{_base_url(request)}/mur?token={_wall_token()}"}


@app.post("/api/wall-link/reset")
async def wall_link_reset(request: Request):
    return {"url": f"{_base_url(request)}/mur?token={_wall_token(reset=True)}"}


@app.get("/mur")
async def wall_page():
    return FileResponse(STATIC / "wall.html")


@app.get("/api/wall")
async def wall_data(token: str = ""):
    if not token or not secrets.compare_digest(token, _wall_token()):
        raise HTTPException(403, "Lien d'écran invalide")
    cfg = settings.load()
    today = ics.today_local()
    start = planner.week_start(today)
    entries = []
    for offset in (0, 7):
        plan = await _decorate(await planner.get_plan(start + timedelta(days=offset), cfg))
        entries += plan["entries"]
    keep = ("id", "date", "weekday", "start", "end", "duration", "label", "audience", "item", "episodes", "reason", "appletv")
    entries = [{k: e.get(k) for k in keep} for e in entries if e.get("item") and e["date"] >= today.isoformat()]
    entries.sort(key=lambda e: (e["date"], e["start"]))
    return {"today": today.isoformat(), "entries": entries[:12], "demo": Config.demo()}  # l'état des connexions d'aujourd'hui, pas celui du jour de création


@app.post("/api/plan/regenerate")
async def regenerate(week: str | None = None, refresh: bool = False):
    if refresh:
        await library.get(force=True)
    return await _decorate(await planner.regenerate(_week(week), settings.load()))


@app.post("/api/plan/watched")
async def plan_watched(request: Request, week: str, entry: str):
    """« On l'a vu » (programme d'aujourd'hui ou passé) : coché dans Jellyfin
    pour le bon public, et marqué vu dans le programme ; un second appui annule.
    « Déjà vu » (programme à venir) : écarté, et remplacé par une autre idée."""
    cfg = settings.load()
    ws = _week(week)
    plan = await planner.get_plan(ws, cfg)
    e = next((x for x in plan["entries"] if x["id"] == entry), None)
    if not e or not e.get("item"):
        _fail("Programme introuvable", 404)
    items, _ = await library.get()
    full = next((it for it in items if it["uid"] == e["item"]["uid"]), None)
    if not full:
        _fail("Titre introuvable", 404)
    user = Config.profile(e["audience"])
    today = ics.today_local().isoformat()
    message, jf = "", False

    if e["date"] <= today:
        watched = not e.get("watched")
        try:
            if full["kind"] == "film":
                jf = await jellyfin_set_played(full.get("jf_id"), watched, user)
            else:
                codes = [ep["code"] for ep in e.get("episodes") or []]
                jf = bool(await jellyfin_set_episodes_played(full.get("jf_id"), codes, watched, user))
        except Exception as exc:  # noqa: BLE001
            logging.warning("Jellyfin (vu) : %s", exc)
        e["watched"] = watched
        if full["kind"] == "film":
            if watched:
                feedback.record(request.state.user["id"], full["uid"], "seen", _deck_for(e["audience"]))
            else:
                feedback.forget(request.state.user["id"], full["uid"])
        planner.save_plan(plan)
        if jf:
            await library.get(force=True)
        message = ("Bien vu ! C'est coché" + (" dans Jellyfin." if jf else ".")) if watched else "D'accord, ce n'est plus marqué vu."
        out = plan
    elif full["kind"] == "serie":
        # série à venir : ces épisodes-là sont déjà vus, on passe aux suivants
        codes = [ep["code"] for ep in e.get("episodes") or []]
        try:
            jf = bool(await jellyfin_set_episodes_played(full.get("jf_id"), codes, True, user))
        except Exception as exc:  # noqa: BLE001
            logging.warning("Jellyfin (épisodes déjà vus) : %s", exc)
        if jf:
            items, _ = await library.get(force=True)
            await planner.fill_episodes(plan, items, cfg)
            planner.save_plan(plan)
        new = next((x for x in plan["entries"] if x["id"] == entry), {})
        nxt = (new.get("episodes") or [{}])[0].get("code")
        message = (f"Épisodes cochés dans Jellyfin : on passe à la suite ({nxt})." if nxt else "Épisodes cochés dans Jellyfin.") if jf \
            else "Impossible de cocher ces épisodes dans Jellyfin."
        out = plan
    else:
        feedback.record(request.state.user["id"], full["uid"], "seen", _deck_for(e["audience"]))
        if full["kind"] == "film" and full.get("jf_id"):
            try:
                jf = await jellyfin_set_played(full["jf_id"], True, user)
            except Exception as exc:  # noqa: BLE001
                logging.warning("Jellyfin (déjà vu) : %s", exc)
            if jf:
                await library.get(force=True)
        out = await planner.swap(ws, entry, cfg)
        new = next((x for x in out["entries"] if x["id"] == entry), {})
        title = (new.get("item") or {}).get("title")
        message = (f"Déjà vu : on propose « {title} » à la place." if title and title != full["title"]
                   else "Déjà vu : rien d'autre ne convient pour ce créneau.")
    return (await _decorate(out)) | {"message": message, "film": full["kind"] == "film", "entry": entry}


def _deck_for(audience: str) -> str:
    return {"enfants": "famille", "famille": "famille"}.get(audience, "nous")


@app.get("/api/plan/alternatives")
async def plan_alternatives(week: str, entry: str):
    return await planner.alternatives(_week(week), entry, settings.load())


@app.post("/api/plan/replace")
async def plan_replace(data: dict = Body(...)):
    plan = await planner.replace(_week(str(data.get("week", ""))), str(data.get("entry", "")), str(data.get("uid", "")), settings.load())
    return await _decorate(plan)


@app.post("/api/plan/swap")
async def swap(week: str, entry: str):
    return await _decorate(await planner.swap(_week(week), entry, settings.load()))


@app.delete("/api/plan/entry")
async def delete_entry(week: str, entry: str):
    plan = planner.remove_entry(_week(week), entry)
    if plan is None:
        raise HTTPException(404, "Programme introuvable")
    return await _decorate(plan)


@app.post("/api/plan/add")
async def add(data: dict = Body(...)):
    try:
        day = date.fromisoformat(data["date"])
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, "Date invalide") from exc
    return await _decorate_add(
        day, str(data.get("start") or "21:00")[:5], str(data["uid"]),
        data.get("audience") or "adultes", settings.load(),
    )


async def _decorate_add(*args):
    return await _decorate(await planner.add_entry(*args))


# --------------------------------------------------------------------------- #
# Swipe (« Surprends-moi ») et mémoire des choix
# --------------------------------------------------------------------------- #

def _fmt_when(placed: dict) -> str:
    d = date.fromisoformat(placed["date"])
    days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
    return f"{days[d.weekday()]} à {placed['start'].replace(':', ' h ')}"


@app.get("/api/deck")
async def get_deck(request: Request, key: str = "nous"):
    if key not in planner.DECKS:
        _fail("Pile inconnue")
    cards = await planner.deck(key, request.state.user["id"], settings.load())
    return {"key": key, "cards": cards, "matches": await _matches() if key == "nous" else []}


async def _matches() -> list[dict]:
    items, _ = await library.get()
    by_uid = {it["uid"]: it for it in items}
    return [planner._snapshot(by_uid[u]) for u in feedback.matches("nous") if u in by_uid]


@app.post("/api/swipe")
async def swipe(request: Request, data: dict = Body(...)):
    user = request.state.user
    uid, decision, key = str(data.get("uid", "")), data.get("decision"), data.get("deck", "nous")
    if key not in planner.DECKS or decision not in feedback.DECISIONS:
        _fail("Choix invalide")
    items, _ = await library.get()
    item = next((it for it in items if it["uid"] == uid), None)
    if not item:
        _fail("Titre introuvable", 404)
    cfg = settings.load()
    row = feedback.record(user["id"], uid, decision, key)
    out = {"decision": decision, "title": item["title"], "match": False, "placed": None, "jellyfin": False}

    if decision == "yes":
        audience = planner.DECKS[key]["audience"]
        if key == "nous":
            if uid in feedback.matches("nous"):
                out["match"] = True
                placed = await planner.place(uid, audience, cfg, "Un match ♥ : vous l'avez choisi à deux")
            else:
                placed = None  # on attend que l'autre dise oui aussi
        else:
            placed = await planner.place(uid, audience, cfg, "Vous en aviez envie ♥")
        if placed:
            feedback.set_placed(row["id"], placed)
            out["placed"] = {"date": placed["date"], "start": placed["start"], "when": _fmt_when(placed)}
    elif decision == "seen":
        planner.mark_seen_locally(uid)
        if item["kind"] == "film" and item.get("jf_id"):
            try:
                out["jellyfin"] = await jellyfin_set_played(item["jf_id"], True, Config.profile(planner.DECKS[key]["audience"]))
            except Exception as exc:  # noqa: BLE001
                logging.warning("Jellyfin (marquer vu) : %s", exc)
            if out["jellyfin"]:
                await library.get(force=True)
    return out


@app.post("/api/swipe/undo")
async def swipe_undo(request: Request):
    last = feedback.undo_last(request.state.user["id"])
    if not last:
        _fail("Rien à annuler")
    cfg = settings.load()
    if last.get("placed"):
        await planner.unplace(last["placed"], cfg)
    items, _ = await library.get()
    item = next((it for it in items if it["uid"] == last["uid"]), None)
    if last["decision"] == "seen" and item and item["kind"] == "film" and item.get("jf_id"):
        try:
            await jellyfin_set_played(item["jf_id"], False, Config.profile(planner.DECKS[last["deck"]]["audience"]))
            await library.get(force=True)
        except Exception as exc:  # noqa: BLE001
            logging.warning("Jellyfin (annuler vu) : %s", exc)
    return {"uid": last["uid"], "deck": last["deck"], "card": planner._snapshot(item) if item else None}


@app.get("/api/surprise")
async def surprise():
    return await planner.shelves(settings.load())


@app.get("/api/upcoming")
async def upcoming():
    today = ics.today_local()
    items = await library.upcoming(today, days=21)
    return [u for u in items if u.get("date", "") >= today.isoformat()]


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


@app.get("/manifest.webmanifest")
async def manifest():
    return FileResponse(STATIC / "manifest.webmanifest", media_type="application/manifest+json")


@app.get("/sw.js")
async def service_worker():
    return FileResponse(STATIC / "sw.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/health")
async def health():
    return {"ok": True, "version": os.environ.get("APP_VERSION", "dev")}
