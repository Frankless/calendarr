"""Mémoire des choix : ce que chaque membre de la famille a dit d'un titre.

Décisions possibles (venant du swipe de « Surprends-moi ») :
- "yes"   : envie de le voir ;
- "no"    : pas pour nous, ne plus le proposer ;
- "seen"  : déjà vu (même hors Jellyfin) ;
- "later" : pas maintenant, le reproposer dans quelque temps.

Le planificateur en tient compte pour toute la famille : un « non » d'un
membre suffit à écarter le titre, un « oui » le favorise.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import date, datetime, timedelta

from .settings import CONFIG_DIR

FILE = CONFIG_DIR / "feedback.json"
DECISIONS = ("yes", "no", "seen", "later")
LATER_DAYS = 14
_lock = threading.Lock()


def _load() -> list[dict]:
    if not FILE.exists():
        return []
    try:
        return json.loads(FILE.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _save(rows: list[dict]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=1), "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(FILE)


def record(user_id: str, uid: str, decision: str, deck: str, placed: dict | None = None) -> dict:
    """Enregistre une décision (remplace la précédente de ce membre sur ce titre)."""
    if decision not in DECISIONS:
        raise ValueError("Décision inconnue")
    row = {
        "id": uuid.uuid4().hex[:10],
        "user": user_id,
        "uid": uid,
        "decision": decision,
        "deck": deck,
        "at": datetime.now().isoformat(timespec="seconds"),
        "placed": placed,
    }
    with _lock:
        rows = [r for r in _load() if not (r["user"] == user_id and r["uid"] == uid)]
        rows.append(row)
        _save(rows)
    return row


def set_placed(row_id: str, placed: dict) -> None:
    with _lock:
        rows = _load()
        for r in rows:
            if r["id"] == row_id:
                r["placed"] = placed
        _save(rows)


def undo_last(user_id: str) -> dict | None:
    """Retire la dernière décision de ce membre et la renvoie."""
    with _lock:
        rows = _load()
        mine = [r for r in rows if r["user"] == user_id]
        if not mine:
            return None
        last = max(mine, key=lambda r: r["at"] + r["id"])
        _save([r for r in rows if r["id"] != last["id"]])
        return last


def forget(user_id: str, uid: str) -> None:
    with _lock:
        _save([r for r in _load() if not (r["user"] == user_id and r["uid"] == uid)])


def summary() -> dict:
    """Vue d'ensemble pour le planificateur et les piles de cartes."""
    today = date.today()
    out = {"no": set(), "seen": set(), "yes": {}, "later": set(), "by_user": {}}
    for r in _load():
        out["by_user"].setdefault(r["user"], {})[r["uid"]] = r["decision"]
        d = r["decision"]
        if d == "no":
            out["no"].add(r["uid"])
        elif d == "seen":
            out["seen"].add(r["uid"])
        elif d == "yes":
            out["yes"].setdefault(r["uid"], set()).add(r["user"])
        elif d == "later":
            when = date.fromisoformat(r["at"][:10])
            if today - when < timedelta(days=LATER_DAYS):
                out["later"].add(r["uid"])
    return out


def matches(deck: str = "nous") -> list[str]:
    """Titres aimés par au moins deux membres dans la pile « Pour nous deux »."""
    likes: dict[str, set] = {}
    for r in _load():
        if r["deck"] == deck and r["decision"] == "yes":
            likes.setdefault(r["uid"], set()).add(r["user"])
    return [uid for uid, users in likes.items() if len(users) >= 2]


def clear_user(user_id: str) -> None:
    with _lock:
        _save([r for r in _load() if r["user"] != user_id])

