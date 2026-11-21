"""Le cœur de Calendarr : choisir quoi regarder dans chaque créneau.

Règles principales :
- ça doit tenir dans le créneau (durée du film, ou 1 à 2 épisodes) ;
- ça doit convenir au public (âge conseillé pour les enfants) ;
- on privilégie ce qui n'a jamais été vu, les séries en cours et les
  nouveaux épisodes ; on évite ce qui a été vu récemment ;
- pas deux fois le même film dans la semaine.
"""

from __future__ import annotations

import hashlib
import json
import random
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from . import library
from .settings import CONFIG_DIR, DAYS

PLANS_DIR = CONFIG_DIR / "plans"

KIDS_GENRES = {"Animation", "Family", "Children", "Kids"}
DOC_GENRES = {"Documentary"}

# Âge minimum conseillé selon la classification (USA, France, Belgique…)
CERT_AGES = {
    "G": 0, "TV-Y": 0, "TV-G": 0, "U": 0, "AL": 0, "KT": 0, "TP": 0, "0": 0, "ALL": 0,
    "TV-Y7": 7, "PG": 7, "6": 6, "7": 7,
    "TV-PG": 10, "10": 10,
    "PG-13": 13, "12": 12, "TV-14": 14, "13": 13, "14": 14,
    "R": 16, "16": 16, "TV-MA": 17, "17": 17,
    "NC-17": 18, "18": 18,
}


def min_age(item: dict) -> int:
    cert = (item.get("cert") or "").upper().replace("+", "").strip()
    cert = cert.removeprefix("FR-").removeprefix("BE-")
    if cert in CERT_AGES:
        return CERT_AGES[cert]
    genres = set(item.get("genres") or [])
    if genres & {"Children", "Kids"}:
        return 0
    if "Family" in genres:
        return 6
    if "Animation" in genres:
        return 10
    return 16  # inconnu : on considère que c'est pour les grands


def is_doc(item: dict) -> bool:
    return bool(set(item.get("genres") or []) & DOC_GENRES)


def week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _add_minutes(hhmm: str, minutes: int) -> str:
    h, m = (int(x) for x in hhmm.split(":"))
    t = datetime(2000, 1, 1, h, m) + timedelta(minutes=minutes)
    return t.strftime("%H:%M")


def episodes_count(item: dict, slot: dict, settings: dict) -> int:
    rt = max(1, int(item.get("runtime") or 30))
    cap = settings["series_max_episodes"] if rt >= 20 else 6
    return max(1, min(cap, slot["max_minutes"] // rt))


def fits(item: dict, slot: dict, settings: dict) -> bool:
    genres = set(item.get("genres") or [])
    if genres & set(settings.get("avoided_genres") or []):
        return False

    kind = slot["kind"]
    if kind == "doc" and not is_doc(item):
        return False
    if kind == "film" and (item["kind"] != "film" or is_doc(item)):
        return False
    if kind == "serie" and item["kind"] != "serie":
        return False
    if kind == "serie" and is_doc(item) and slot["audience"] == "adultes":
        return False

    runtime = int(item.get("runtime") or 0)
    if runtime > slot["max_minutes"] + 5:
        return False

    age = min_age(item)
    aud = slot["audience"]
    if aud == "enfants":
        return age <= settings["max_age_kids"] and bool(genres & KIDS_GENRES or age == 0)
    if aud == "famille":
        return age <= settings["max_age_family"]
    # Parents : on évite les programmes conçus pour les tout-petits
    return not ({"Children", "Kids"} & genres)


def _days_since(iso: str | None, today: date) -> int | None:
    if not iso:
        return None
    try:
        return (today - date.fromisoformat(iso[:10])).days
    except ValueError:
        return None


def score(item, slot, settings, ctx) -> tuple[float, str] | None:
    """Renvoie (score, raison) ou None si l'élément est à écarter."""
    today = ctx["today"]
    rng = ctx["rng"]
    used = ctx["used"]
    s = rng.random() * 2.0
    reason = ""
    since = _days_since(item.get("last_played"), today)
    kids_slot = slot["audience"] != "adultes"

    if item["kind"] == "film":
        if item["uid"] in used:
            return None
        if item.get("played"):
            if since is not None and since < settings["rewatch_after_days"] and not kids_slot:
                return None
            if since is not None and since < 60:
                return None
            s -= 1.0
            if since is not None:
                reason = f"Pas revu depuis {date.fromisoformat(item['last_played'][:10]).year}"
            else:
                reason = "Déjà vu, ça fait un moment"
        else:
            s += 3.0
            reason = "Jamais vu"
    else:
        nxt = item.get("next_up")
        if item["uid"] in used:
            s -= 2.5  # une série peut revenir, mais on préfère varier
        if nxt:
            s += 3.5
            reason = f"Vous en êtes à S{nxt['season']:02d}E{nxt['episode']:02d}"
        elif item.get("played"):
            if not kids_slot:
                return None
            s -= 1.0
            reason = "Une valeur sûre"
        else:
            s += 1.5
            reason = "Une série à commencer"
        if item["uid"] in ctx["new_episodes"]:
            s += 1.5
            if not nxt:
                reason = "Nouvel épisode cette semaine"

    genres = set(item.get("genres") or [])
    liked = set(settings.get("liked_genres") or [])
    s += 1.2 * len(genres & liked)
    if not kids_slot and genres & KIDS_GENRES:
        s -= 2.0  # la soirée des parents, c'est pour les grands
    if kids_slot and genres & KIDS_GENRES:
        s += 1.0
        if not reason or reason == "Jamais vu":
            reason = (reason + " · " if reason else "") + "Parfait pour les enfants"
    if slot["kind"] == "any" and slot["audience"] == "adultes" and item["kind"] == "film":
        # un « peu importe » de 60 minutes favorise les séries
        s += 0.5 if item.get("runtime", 0) > 80 else 0
    # remplir le créneau sans trop de vide
    rt = int(item.get("runtime") or 0)
    if item["kind"] == "film" and rt:
        s += 0.8 * min(1.0, rt / slot["max_minutes"])
    return s, reason or "Au hasard de la bibliothèque"


def _pick(items, slot, settings, ctx):
    best = None
    for it in items:
        if not fits(it, slot, settings):
            continue
        res = score(it, slot, settings, ctx)
        if res is None:
            continue
        if best is None or res[0] > best[0]:
            best = (res[0], it, res[1])
    return best


def _snapshot(item: dict) -> dict:
    keys = ("uid", "title", "year", "kind", "runtime", "genres", "cert", "poster", "overview", "source")
    return {k: item.get(k) for k in keys} | {"age": min_age(item)}


def _entry(day: date, slot: dict, item: dict | None, reason: str, settings: dict) -> dict:
    duration = slot["max_minutes"]
    if item:
        if item["kind"] == "film":
            duration = int(item.get("runtime") or duration)
        else:
            duration = int(item.get("runtime") or 30) * episodes_count(item, slot, settings)
    return {
        "id": uuid.uuid4().hex[:10],
        "date": day.isoformat(),
        "weekday": DAYS[day.weekday()],
        "start": slot["start"],
        "end": _add_minutes(slot["start"], duration),
        "duration": duration,
        "label": slot["label"],
        "audience": slot["audience"],
        "slot_kind": slot["kind"],
        "max_minutes": slot["max_minutes"],
        "item": _snapshot(item) if item else None,
        "episodes": [],
        "reason": reason if item else "Rien ne correspond dans la bibliothèque : soirée libre !",
    }


def _rng(seed_text: str) -> random.Random:
    return random.Random(int(hashlib.sha256(seed_text.encode()).hexdigest()[:12], 16))


async def build_week(start: date, settings: dict, salt: str = "") -> dict:
    items, warnings = await library.get()
    upcoming = await library.upcoming(start, days=7)
    ctx = {
        "today": date.today(),
        "rng": _rng(f"{start.isoformat()}-{salt}"),
        "used": set(),
        "new_episodes": {u.get("series_uid") for u in upcoming if u.get("kind") == "serie"},
    }
    # Les créneaux les plus exigeants (enfants, puis famille) choisissent en
    # premier, pour que la soirée des parents ne prenne pas le seul dessin animé.
    order = {"enfants": 0, "famille": 1, "adultes": 2}
    slots = [
        (start + timedelta(days=offset), slot)
        for offset, day_cfg in enumerate(settings["week"])
        for slot in day_cfg.get("slots", [])
    ]
    entries = []
    for day, slot in sorted(slots, key=lambda x: (order.get(x[1]["audience"], 3), x[0], x[1]["start"])):
        best = _pick(items, slot, settings, ctx)
        item, reason = (best[1], best[2]) if best else (None, "")
        if item:
            ctx["used"].add(item["uid"])
        entries.append(_entry(day, slot, item, reason, settings))
    entries.sort(key=lambda e: (e["date"], e["start"]))
    plan = {"week": start.isoformat(), "salt": salt, "entries": entries, "warnings": warnings}
    await fill_episodes(plan, items, settings)
    return plan


async def fill_episodes(plan: dict, items: list[dict], settings: dict) -> None:
    """Numérote les épisodes à regarder, dans l'ordre chronologique, en
    reprenant là où la famille s'est arrêtée (Jellyfin)."""
    by_uid = {it["uid"]: it for it in items}
    cursors: dict[str, int] = {}
    cache: dict[str, list[dict]] = {}
    for e in sorted(plan["entries"], key=lambda e: (e["date"], e["start"])):
        e["episodes"] = []
        it = e.get("item")
        if not it or it["kind"] != "serie":
            continue
        full = by_uid.get(it["uid"])
        if not full:
            continue
        if it["uid"] not in cache:
            cache[it["uid"]] = await library.episodes_for(full)
            eps = cache[it["uid"]]
            nxt = full.get("next_up")
            idx = 0
            if nxt:
                for i, ep in enumerate(eps):
                    if (ep["season"], ep["episode"]) >= (nxt["season"], nxt["episode"]):
                        idx = i
                        break
            cursors[it["uid"]] = idx
        eps = cache[it["uid"]]
        slot = {"max_minutes": e["max_minutes"]}
        n = episodes_count(full, slot, settings)
        idx = cursors[it["uid"]]
        chosen = eps[idx : idx + n]
        if not chosen and eps:  # fin de la série : on recommence
            chosen = eps[:n]
            idx = 0
        cursors[it["uid"]] = idx + len(chosen)
        nxt = full.get("next_up")
        e["episodes"] = [
            {
                "code": f"S{ep['season']:02d}E{ep['episode']:02d}",
                "name": ep["name"] or (nxt["name"] if nxt and (ep["season"], ep["episode"]) == (nxt["season"], nxt["episode"]) else ""),
            }
            for ep in chosen
        ]
        if chosen:
            e["duration"] = int(full.get("runtime") or 30) * len(chosen)
            e["end"] = _add_minutes(e["start"], e["duration"])


# --------------------------------------------------------------------------- #
# Enregistrement des programmes
# --------------------------------------------------------------------------- #

def _path(start: date) -> Path:
    return PLANS_DIR / f"{start.isoformat()}.json"


def load_plan(start: date) -> dict | None:
    p = _path(start)
    if p.exists():
        try:
            return json.loads(p.read_text("utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def clear_plans(from_week: date) -> None:
    """Efface les programmes à partir de cette semaine (ils seront refaits)."""
    if not PLANS_DIR.exists():
        return
    for p in PLANS_DIR.glob("*.json"):
        try:
            if date.fromisoformat(p.stem) >= from_week:
                p.unlink()
        except ValueError:
            continue


def save_plan(plan: dict) -> None:
    PLANS_DIR.mkdir(parents=True, exist_ok=True)
    _path(date.fromisoformat(plan["week"])).write_text(json.dumps(plan, ensure_ascii=False, indent=1), "utf-8")


async def get_plan(start: date, settings: dict) -> dict:
    plan = load_plan(start)
    if plan is None:
        plan = await build_week(start, settings)
        save_plan(plan)
    return plan


async def regenerate(start: date, settings: dict) -> dict:
    plan = await build_week(start, settings, salt=uuid.uuid4().hex[:6])
    save_plan(plan)
    return plan


async def swap(start: date, entry_id: str, settings: dict) -> dict:
    """Remplace un seul programme par une autre proposition."""
    plan = await get_plan(start, settings)
    items, _ = await library.get()
    target = next((e for e in plan["entries"] if e["id"] == entry_id), None)
    if not target:
        return plan
    used = {e["item"]["uid"] for e in plan["entries"] if e.get("item")}
    skipped = set(target.get("skipped") or [])
    if target.get("item"):
        skipped.add(target["item"]["uid"])
    slot = {
        "start": target["start"],
        "max_minutes": target["max_minutes"],
        "audience": target["audience"],
        "kind": target["slot_kind"],
        "label": target["label"],
    }
    upcoming = await library.upcoming(start, days=7)
    ctx = {
        "today": date.today(),
        "rng": random.Random(),
        "used": used | skipped,
        "new_episodes": {u.get("series_uid") for u in upcoming if u.get("kind") == "serie"},
    }
    candidates = [it for it in items if it["uid"] not in skipped]
    best = _pick(candidates, slot, settings, ctx)
    if best is None and skipped:  # on a fait le tour : on recommence
        skipped = set()
        best = _pick(items, slot, settings, ctx)
    new = _entry(date.fromisoformat(target["date"]), slot, best[1] if best else None, best[2] if best else "", settings)
    new["id"] = target["id"]
    new["skipped"] = sorted(skipped)
    plan["entries"] = [new if e["id"] == entry_id else e for e in plan["entries"]]
    await fill_episodes(plan, items, settings)
    save_plan(plan)
    return plan


async def add_entry(day: date, start_time: str, uid: str, audience: str, settings: dict) -> dict:
    """Ajoute un choix « Surprends-moi » au programme."""
    ws = week_start(day)
    plan = await get_plan(ws, settings)
    items, _ = await library.get()
    item = next((it for it in items if it["uid"] == uid), None)
    if not item:
        return plan
    if any(e.get("item") and e["item"]["uid"] == uid and e["date"] == day.isoformat() for e in plan["entries"]):
        return plan  # déjà au programme ce jour-là
    slot = {"start": start_time, "max_minutes": max(int(item.get("runtime") or 60), 30),
            "audience": audience, "kind": item["kind"], "label": "Surprise !"}
    entry = _entry(day, slot, item, "Choisi sur les étagères", settings)
    plan["entries"].append(entry)
    plan["entries"].sort(key=lambda e: (e["date"], e["start"]))
    await fill_episodes(plan, items, settings)
    save_plan(plan)
    return plan


def remove_entry(start: date, entry_id: str) -> dict | None:
    plan = load_plan(start)
    if plan:
        plan["entries"] = [e for e in plan["entries"] if e["id"] != entry_id]
        save_plan(plan)
    return plan


# --------------------------------------------------------------------------- #
# Surprends-moi : trois étagères façon vidéoclub
# --------------------------------------------------------------------------- #

async def shelves(settings: dict) -> list[dict]:
    items, _ = await library.get()
    rng = random.Random()
    ctx = {"today": date.today(), "rng": rng, "used": set(), "new_episodes": set()}
    defs = [
        ("moi", "Pour moi", "Une série ou un docu, à son rythme",
         {"audience": "adultes", "kind": "any", "max_minutes": 600}, lambda it: it["kind"] == "serie" or is_doc(it)),
        ("nous", "Pour nous deux", "Un film pour la soirée des parents",
         {"audience": "adultes", "kind": "film", "max_minutes": 600}, lambda it: not set(it.get("genres") or []) & KIDS_GENRES),
        ("famille", "Pour la famille", "Tout le monde dans le canapé",
         {"audience": "famille", "kind": "any", "max_minutes": 600}, lambda it: it["kind"] == "film" or set(it.get("genres") or []) & KIDS_GENRES),
    ]
    out = []
    for key, title, subtitle, slot, extra in defs:
        scored = []
        for it in items:
            if not extra(it) or not fits(it, slot, settings):
                continue
            res = score(it, slot, settings, ctx)
            if res:
                scored.append((res[0] + rng.random() * 3, it, res[1]))
        scored.sort(key=lambda x: -x[0])
        out.append(
            {
                "key": key,
                "title": title,
                "subtitle": subtitle,
                "audience": slot["audience"],
                "items": [dict(_snapshot(it), reason=r) for _, it, r in scored[:10]],
            }
        )
    return out
