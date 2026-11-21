"""Suivi des séries : ce que la famille regarde, garde pour plus tard ou écarte.

Fichier /config/watchstate.json (écriture atomique). S'il manque, il est
recréé : une série déjà commencée dans Jellyfin est « On la regarde », une
série jamais commencée « Plus tard ». Une série qui apparaît ensuite dans
Sonarr arrive « À classer ». Pour revenir en arrière : supprimer ce fichier.

États :
- "watching" : on la regarde, ses épisodes peuvent être programmés ;
- "later"    : plus tard, jamais programmée (rappel facultatif) ;
- "never"    : pas pour nous, cachée partout ;
- "inbox"    : à classer (nouveau téléchargement).
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import date, datetime

from .settings import CONFIG_DIR

log = logging.getLogger("calendarr")

FILE = CONFIG_DIR / "watchstate.json"
STATES = ("watching", "later", "never", "inbox")
AUDIENCES = ("adultes", "enfants", "famille")
KIDS = {"Children", "Kids"}
_lock = threading.Lock()


def _empty() -> dict:
    return {"version": 1, "initialized": False, "series": {}}


def load() -> dict:
    if not FILE.exists():
        return _empty()
    try:
        data = json.loads(FILE.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        log.warning("watchstate.json illisible : on repart des valeurs par défaut")
        return _empty()
    data.setdefault("series", {})
    data.setdefault("initialized", bool(data["series"]))
    return data


def _save(data: dict) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(FILE)


def default_audience(item: dict) -> str:
    genres = set(item.get("genres") or [])
    cert = (item.get("cert") or "").upper()
    if genres & KIDS or cert in ("TV-Y", "TV-Y7"):
        return "enfants"
    if "Family" in genres or cert in ("TV-G", "G"):
        return "famille"
    return "adultes"


def _started(item: dict) -> bool:
    return bool(item.get("next_up") or item.get("played") or item.get("last_played"))


def sync(items: list[dict]) -> dict:
    """Ajoute les séries inconnues : préremplies au premier passage,
    « À classer » ensuite. Ne touche jamais un choix déjà fait."""
    # la bibliothèque d'exemple n'est jamais enregistrée (voir state_of)
    series = [it for it in items if it.get("kind") == "serie" and it.get("source") != "demo"]
    with _lock:
        data = load()
        first = not data["initialized"]
        changed = False
        now = datetime.now().isoformat(timespec="seconds")
        if series:  # la vraie bibliothèque est branchée : on oublie les exemples
            for uid in [u for u in data["series"] if u.startswith("demo-")]:
                del data["series"][uid]
                changed = True
        for it in series:
            if it["uid"] in data["series"]:
                continue
            if first:
                state = "watching" if _started(it) else "later"
            else:
                state = "inbox"
            data["series"][it["uid"]] = {"state": state, "audience": default_audience(it), "remind": None,
                                         "title": it.get("title"), "at": now}
            changed = True
        if series and first:
            data["initialized"] = True
            changed = True
        if changed:
            _save(data)
        return data


def state_of(data: dict, uid: str, item: dict | None = None) -> str:
    rec = data.get("series", {}).get(uid)
    if rec:
        return rec.get("state", "later")
    if item and item.get("source") == "demo":
        return "watching" if _started(item) else "later"  # exemples : jamais enregistrés
    return "later"


def audience_of(data: dict, uid: str, item: dict | None = None) -> str:
    rec = data.get("series", {}).get(uid)
    if rec and rec.get("audience") in AUDIENCES:
        return rec["audience"]
    return default_audience(item or {})


def update(uid: str, title: str, *, state: str | None = None, audience: str | None = None,
           remind: str | None | bool = False) -> dict:
    """Change l'état, le public ou le rappel d'une série (remind=False : inchangé)."""
    if state is not None and state not in STATES:
        raise ValueError("État inconnu")
    if audience is not None and audience not in AUDIENCES:
        raise ValueError("Public inconnu")
    if remind not in (False, None):
        date.fromisoformat(str(remind))  # lève ValueError si la date est invalide
    with _lock:
        data = load()
        rec = data["series"].setdefault(uid, {"state": "later", "audience": "adultes", "remind": None, "title": title})
        if state is not None:
            rec["state"] = state
            if state != "later":
                rec["remind"] = None
        if audience is not None:
            rec["audience"] = audience
        if remind is not False:
            rec["remind"] = remind
        rec["title"] = title or rec.get("title")
        rec["at"] = datetime.now().isoformat(timespec="seconds")
        _save(data)
        return rec


def due_reminders(data: dict, today: date) -> list[str]:
    """Séries « Plus tard » dont le rappel est arrivé."""
    out = []
    for uid, rec in data.get("series", {}).items():
        if rec.get("state") == "later" and rec.get("remind"):
            try:
                if date.fromisoformat(rec["remind"]) <= today:
                    out.append(uid)
            except ValueError:
                continue
    return out
