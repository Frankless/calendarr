"""Réglages de la famille, enregistrés dans /config/settings.json."""

from __future__ import annotations

import json
import os
from pathlib import Path

CONFIG_DIR = Path(os.environ.get("CONFIG_DIR", "/config"))
SETTINGS_FILE = CONFIG_DIR / "settings.json"

DAYS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]

# Publics possibles pour un créneau
AUDIENCES = {
    "enfants": "Les enfants",
    "famille": "Toute la famille",
    "adultes": "Les parents",
}
PLAYERS = {
    "jellyfin": "Jellyfin (navigateur ou app Jellyfin)",
    "infuse": "Infuse sur le téléphone ou l'iPad",
    "appletv": "Infuse sur l'Apple TV",
}

# Types de programmes
KINDS = {
    "any": "Peu importe",
    "film": "Film",
    "serie": "Série",
    "doc": "Documentaire",
}


def _slot(start, minutes, audience, kind, label):
    return {"start": start, "max_minutes": minutes, "audience": audience, "kind": kind, "label": label}


# Une semaine type pour deux parents et deux enfants de 8 et 4 ans :
# les soirées des parents commencent après le coucher, le mercredi
# après-midi est pour les enfants, le vendredi c'est film en famille.
DEFAULT_SETTINGS = {
    "children_ages": [8, 4],
    "max_age_family": 8,
    "max_age_kids": 6,
    "series_max_episodes": 2,
    "rewatch_after_days": 730,
    "reminder_minutes": 15,
    "liked_genres": [],
    "avoided_genres": ["Horror"],
    # Comment la famille regarde : "jellyfin", "infuse" (sur ce téléphone/iPad) ou "appletv" (Infuse sur l'Apple TV)
    "player": "jellyfin",
    # Tenir à jour une collection « Calendarr · Cette semaine » dans Jellyfin (visible dans Infuse)
    "sync_collection": False,
    "week": [
        {"slots": [_slot("21:00", 60, "adultes", "serie", "Série du lundi")]},
        {"slots": []},
        {"slots": [_slot("15:30", 90, "enfants", "film", "Mercredi des enfants")]},
        {"slots": [_slot("21:00", 135, "adultes", "film", "La grande première")]},
        {"slots": [_slot("18:30", 105, "famille", "film", "Le film familial")]},
        {
            "slots": [
                _slot("17:00", 30, "enfants", "serie", "Dessin animé"),
                _slot("21:00", 150, "adultes", "film", "Soirée ciné"),
            ]
        },
        {"slots": [_slot("20:45", 60, "adultes", "doc", "Docu du dimanche")]},
    ],
}


def load() -> dict:
    data = json.loads(json.dumps(DEFAULT_SETTINGS))
    if SETTINGS_FILE.exists():
        try:
            saved = json.loads(SETTINGS_FILE.read_text("utf-8"))
            data.update(saved)
        except (OSError, json.JSONDecodeError):
            pass
    if len(data.get("week", [])) != 7:
        data["week"] = DEFAULT_SETTINGS["week"]
    return data


def save(data: dict) -> dict:
    clean = load()
    for key in DEFAULT_SETTINGS:
        if key in data:
            clean[key] = data[key]
    clean["children_ages"] = [int(a) for a in clean.get("children_ages", []) if str(a).strip() != ""]
    for key in ("max_age_family", "max_age_kids", "series_max_episodes", "rewatch_after_days", "reminder_minutes"):
        clean[key] = max(0, int(clean[key]))
    clean["series_max_episodes"] = max(1, clean["series_max_episodes"])
    if clean.get("player") not in PLAYERS:
        clean["player"] = "jellyfin"
    clean["sync_collection"] = bool(clean.get("sync_collection"))
    week = []
    for day in clean["week"][:7]:
        slots = []
        for s in day.get("slots", []):
            slots.append(
                {
                    "start": str(s.get("start") or "21:00")[:5],
                    "max_minutes": max(10, int(s.get("max_minutes") or 60)),
                    "audience": s.get("audience") if s.get("audience") in AUDIENCES else "adultes",
                    "kind": s.get("kind") if s.get("kind") in KINDS else "any",
                    "label": str(s.get("label") or "").strip()[:60],
                }
            )
        slots.sort(key=lambda s: s["start"])
        week.append({"slots": slots})
    clean["week"] = week
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(clean, ensure_ascii=False, indent=2), "utf-8")
    return clean
