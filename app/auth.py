"""Comptes, mots de passe et sessions.

- Les comptes sont dans /config/users.json (droits 600).
- Les mots de passe sont hachés avec scrypt (jamais stockés en clair).
- La session est un cookie signé (HMAC) valable 30 jours. Changer un mot de
  passe déconnecte les autres appareils de ce compte.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import uuid
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config"))
USERS_FILE = CONFIG_DIR / "users.json"
SECRET_FILE = CONFIG_DIR / "secret_key"

COOKIE = "calendarr_session"
SESSION_DAYS = 30
ROLES = {"admin": "Administrateur", "famille": "Famille"}
MIN_PASSWORD = 6

_lock = threading.Lock()


# --------------------------------------------------------------------------- #
# Stockage
# --------------------------------------------------------------------------- #

def _write_private(path: Path, text: str) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, "utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def _secret() -> bytes:
    if SECRET_FILE.exists():
        return SECRET_FILE.read_bytes().strip()
    key = secrets.token_hex(32).encode()
    _write_private(SECRET_FILE, key.decode())
    return key


def _load() -> list[dict]:
    if not USERS_FILE.exists():
        return []
    try:
        return json.loads(USERS_FILE.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return []


def _save(users: list[dict]) -> None:
    _write_private(USERS_FILE, json.dumps(users, ensure_ascii=False, indent=2))


def has_users() -> bool:
    return bool(_load())


def public(u: dict) -> dict:
    return {"id": u["id"], "username": u["username"], "role": u["role"], "role_label": ROLES[u["role"]]}


def list_users() -> list[dict]:
    return [public(u) for u in _load()]


def get_user(user_id: str) -> dict | None:
    return next((u for u in _load() if u["id"] == user_id), None)


# --------------------------------------------------------------------------- #
# Mots de passe
# --------------------------------------------------------------------------- #

def _hash(password: str, salt: bytes) -> str:
    dk = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return base64.b64encode(dk).decode()


def _check_password(password: str) -> None:
    if len(password or "") < MIN_PASSWORD:
        raise ValueError(f"Le mot de passe doit faire au moins {MIN_PASSWORD} caractères.")


def _clean_username(username: str) -> str:
    username = (username or "").strip()
    if not 1 <= len(username) <= 40:
        raise ValueError("Le nom d'utilisateur doit faire entre 1 et 40 caractères.")
    return username


def create_user(username: str, password: str, role: str) -> dict:
    username = _clean_username(username)
    _check_password(password)
    if role not in ROLES:
        raise ValueError("Rôle inconnu.")
    with _lock:
        users = _load()
        if any(u["username"].lower() == username.lower() for u in users):
            raise ValueError("Ce nom d'utilisateur existe déjà.")
        salt = secrets.token_bytes(16)
        user = {
            "id": uuid.uuid4().hex[:12],
            "username": username,
            "role": role,
            "salt": base64.b64encode(salt).decode(),
            "hash": _hash(password, salt),
            "ver": 1,
        }
        users.append(user)
        _save(users)
    return public(user)


def verify(username: str, password: str) -> dict | None:
    for u in _load():
        if u["username"].lower() == (username or "").strip().lower():
            salt = base64.b64decode(u["salt"])
            if hmac.compare_digest(_hash(password or "", salt), u["hash"]):
                return u
            return None
    _hash(password or "", b"0" * 16)  # même durée qu'un vrai essai
    return None


def set_password(user_id: str, password: str) -> dict:
    _check_password(password)
    with _lock:
        users = _load()
        u = next((x for x in users if x["id"] == user_id), None)
        if not u:
            raise ValueError("Compte introuvable.")
        salt = secrets.token_bytes(16)
        u["salt"] = base64.b64encode(salt).decode()
        u["hash"] = _hash(password, salt)
        u["ver"] = u.get("ver", 1) + 1  # déconnecte les autres appareils
        _save(users)
    return u


def _admins(users) -> int:
    return sum(1 for u in users if u["role"] == "admin")


def set_role(user_id: str, role: str) -> None:
    if role not in ROLES:
        raise ValueError("Rôle inconnu.")
    with _lock:
        users = _load()
        u = next((x for x in users if x["id"] == user_id), None)
        if not u:
            raise ValueError("Compte introuvable.")
        if u["role"] == "admin" and role != "admin" and _admins(users) <= 1:
            raise ValueError("Il faut garder au moins un administrateur.")
        u["role"] = role
        u["ver"] = u.get("ver", 1) + 1
        _save(users)


def delete_user(user_id: str) -> None:
    with _lock:
        users = _load()
        u = next((x for x in users if x["id"] == user_id), None)
        if not u:
            raise ValueError("Compte introuvable.")
        if u["role"] == "admin" and _admins(users) <= 1:
            raise ValueError("Impossible de supprimer le dernier administrateur.")
        _save([x for x in users if x["id"] != user_id])


# --------------------------------------------------------------------------- #
# Sessions (cookie signé)
# --------------------------------------------------------------------------- #

def _sign(payload: str) -> str:
    return hmac.new(_secret(), payload.encode(), hashlib.sha256).hexdigest()


def make_session(user: dict) -> str:
    expires = int(time.time()) + SESSION_DAYS * 86400
    payload = f"{user['id']}.{user.get('ver', 1)}.{expires}"
    return f"{payload}.{_sign(payload)}"


def read_session(token: str | None) -> dict | None:
    if not token or token.count(".") != 3:
        return None
    payload, sig = token.rsplit(".", 1)
    if not hmac.compare_digest(_sign(payload), sig):
        return None
    user_id, ver, expires = payload.split(".")
    if int(expires) < time.time():
        return None
    u = get_user(user_id)
    if not u or str(u.get("ver", 1)) != ver:
        return None
    return u


# --------------------------------------------------------------------------- #
# Protection contre les essais de mot de passe à répétition
# --------------------------------------------------------------------------- #

_failures: dict[str, list[float]] = {}


def too_many_attempts(ip: str) -> int:
    """Renvoie le nombre de secondes à attendre (0 si on peut essayer)."""
    now = time.time()
    recent = [t for t in _failures.get(ip, []) if now - t < 300]
    _failures[ip] = recent
    if len(recent) >= 5:
        return int(300 - (now - recent[0])) + 1
    return 0


def record_failure(ip: str) -> None:
    _failures.setdefault(ip, []).append(time.time())


def clear_failures(ip: str) -> None:
    _failures.pop(ip, None)
