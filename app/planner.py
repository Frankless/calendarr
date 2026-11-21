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

from . import feedback, library
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
    "R": 16, "16": 16, "TV-MA": 16, "17": 16,
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
    item = library.view(item, slot.get("audience", "adultes"))
    today = ctx["today"]
    rng = ctx["rng"]
    used = ctx["used"]
    s = rng.random() * 2.0
    reason = ""
    since = _days_since(item.get("last_played"), today)
    kids_slot = slot["audience"] != "adultes"

    fb = ctx.get("fb") or {}
    uid = item["uid"]
    if uid in fb.get("no", ()):
        return None  # quelqu'un a dit « pas pour nous »
    if uid in fb.get("seen", ()) and item["kind"] == "film" and not kids_slot:
        return None  # déjà vu, même hors Jellyfin

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

    if uid in fb.get("later", ()):
        s -= 1.5
    fans = fb.get("yes", {}).get(uid)
    if fans:
        s += 2.0 + len(fans)
        if not reason.startswith("Vous en êtes"):
            reason = "Vous en aviez envie ♥" if len(fans) == 1 else "Un match ♥ : vous l'avez choisi à deux"

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
        "fb": feedback.summary(),
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
        if e.get("watched"):
            continue
        e["episodes"] = []
        it = e.get("item")
        if not it or it["kind"] != "serie":
            continue
        full = by_uid.get(it["uid"])
        if not full:
            continue
        full = library.view(full, e.get("audience", "adultes"))
        key = (it["uid"], e.get("audience", "adultes"))  # chaque public a sa propre progression
        if it["uid"] not in cache:
            cache[it["uid"]] = await library.episodes_for(full)
        if key not in cursors:
            eps = cache[it["uid"]]
            nxt = full.get("next_up")
            idx = 0
            if nxt:
                for i, ep in enumerate(eps):
                    if (ep["season"], ep["episode"]) >= (nxt["season"], nxt["episode"]):
                        idx = i
                        break
            cursors[key] = idx
        eps = cache[it["uid"]]
        slot = {"max_minutes": e["max_minutes"]}
        n = episodes_count(full, slot, settings)
        idx = cursors[key]
        chosen = eps[idx : idx + n]
        if not chosen and eps:  # fin de la série : on recommence
            chosen = eps[:n]
            idx = 0
        cursors[key] = idx + len(chosen)
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
        "fb": feedback.summary(),
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
    ctx = {"today": date.today(), "rng": rng, "used": set(), "new_episodes": set(), "fb": feedback.summary()}
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


# --------------------------------------------------------------------------- #
# Swipe : piles de cartes et placement d'un « oui » dans le programme
# --------------------------------------------------------------------------- #

DECKS = {
    "moi": {"title": "Pour moi", "audience": "adultes",
            "slot": {"audience": "adultes", "kind": "any", "max_minutes": 600},
            "keep": lambda it: it["kind"] == "serie" or is_doc(it)},
    "nous": {"title": "Pour nous deux", "audience": "adultes",
             "slot": {"audience": "adultes", "kind": "film", "max_minutes": 600},
             "keep": lambda it: not set(it.get("genres") or []) & KIDS_GENRES},
    "famille": {"title": "Pour la famille", "audience": "famille",
                "slot": {"audience": "famille", "kind": "any", "max_minutes": 600},
                "keep": lambda it: it["kind"] == "film" or set(it.get("genres") or []) & KIDS_GENRES},
}


async def deck(key: str, user_id: str, settings: dict, size: int = 20) -> list[dict]:
    """Cartes à proposer à ce membre : jamais un titre qu'il a déjà jugé
    (sauf « plus tard » après 14 jours), ni un titre refusé par la famille."""
    d = DECKS[key]
    items, _ = await library.get()
    fb = feedback.summary()
    mine = fb["by_user"].get(user_id, {})
    rng = random.Random()
    ctx = {"today": date.today(), "rng": rng, "used": set(), "new_episodes": set(), "fb": fb}
    scored = []
    for it in items:
        decided = mine.get(it["uid"])
        if decided and not (decided == "later" and it["uid"] not in fb["later"]):
            continue
        if not d["keep"](it) or not fits(it, d["slot"], settings):
            continue
        res = score(it, d["slot"], settings, ctx)
        if not res:
            continue
        sc, reason = res
        others = fb["yes"].get(it["uid"], set()) - {user_id}
        if key == "nous" and others:
            sc += 6  # l'autre a déjà dit oui : un match est possible
            reason = "L'autre a déjà dit oui… et vous ?"
        scored.append((sc + rng.random() * 3, it, reason))
    scored.sort(key=lambda x: -x[0])
    return [dict(_snapshot(it), reason=r) for _, it, r in scored[:size]]


def _slot_accepts(entry: dict, item: dict, audience: str) -> bool:
    if entry.get("audience") != audience:
        return False
    kind = entry.get("slot_kind", "any")
    if kind == "doc" and not is_doc(item):
        return False
    if kind in ("film", "serie") and item["kind"] != kind:
        return False
    if item["kind"] == "film" and int(item.get("runtime") or 0) > int(entry.get("max_minutes") or 0) + 5:
        return False
    return not str(entry.get("reason", "")).startswith(("Vous en aviez envie", "Un match", "Choisi"))


async def place(uid: str, audience: str, settings: dict, reason: str, days: int = 14) -> dict | None:
    """Met le titre dans le prochain créneau compatible (à la place de ce qui
    était prévu). Renvoie où il a été placé et ce qu'il remplace, pour annuler."""
    from .ics import today_local  # import local : évite une boucle d'imports

    items, _ = await library.get()
    item = next((it for it in items if it["uid"] == uid), None)
    if not item:
        return None
    today = today_local()
    now = datetime.now().strftime("%H:%M")
    start = week_start(today)
    for offset in range(0, days + 7, 7):
        ws = start + timedelta(days=offset)
        plan = await get_plan(ws, settings)
        for e in sorted(plan["entries"], key=lambda x: (x["date"], x["start"])):
            if e["date"] < today.isoformat() or (e["date"] == today.isoformat() and e["start"] <= now):
                continue
            if e["date"] > (today + timedelta(days=days)).isoformat():
                return None
            if e.get("item") and e["item"]["uid"] == uid:
                return {"week": ws.isoformat(), "entry_id": e["id"], "date": e["date"], "start": e["start"], "previous": None}
            if not _slot_accepts(e, item, audience):
                continue
            slot = {"start": e["start"], "max_minutes": e["max_minutes"], "audience": e["audience"],
                    "kind": e["slot_kind"], "label": e["label"]}
            new = _entry(date.fromisoformat(e["date"]), slot, item, reason, settings)
            new["id"] = e["id"]
            plan["entries"] = [new if x["id"] == e["id"] else x for x in plan["entries"]]
            await fill_episodes(plan, items, settings)
            save_plan(plan)
            return {"week": ws.isoformat(), "entry_id": e["id"], "date": e["date"], "start": e["start"], "previous": e}
    return None


async def unplace(placed: dict, settings: dict) -> None:
    """Remet ce qui était prévu avant un « oui » annulé."""
    if not placed or not placed.get("previous"):
        return
    ws = date.fromisoformat(placed["week"])
    plan = load_plan(ws)
    if not plan:
        return
    plan["entries"] = [placed["previous"] if e["id"] == placed["entry_id"] else e for e in plan["entries"]]
    items, _ = await library.get()
    await fill_episodes(plan, items, settings)
    save_plan(plan)


def mark_seen_locally(uid: str) -> None:
    """Retire des programmes à venir un titre marqué « déjà vu »."""
    from .ics import today_local

    today = today_local().isoformat()
    for p in PLANS_DIR.glob("*.json") if PLANS_DIR.exists() else []:
        plan = json.loads(p.read_text("utf-8"))
        changed = False
        for e in plan["entries"]:
            if e.get("item") and e["item"]["uid"] == uid and e["date"] >= today and e["item"]["kind"] == "film":
                e["item"] = None
                e["episodes"] = []
                e["reason"] = "Déjà vu : utilisez « Autre idée » pour choisir autre chose"
                changed = True
        if changed:
            save_plan(plan)


# --------------------------------------------------------------------------- #
# « Autre idée » : plusieurs propositions pour un créneau, au choix
# --------------------------------------------------------------------------- #

def _slot_of(entry: dict) -> dict:
    return {"start": entry["start"], "max_minutes": entry["max_minutes"], "audience": entry["audience"],
            "kind": entry["slot_kind"], "label": entry["label"]}


async def alternatives(start: date, entry_id: str, settings: dict, n: int = 6) -> dict:
    """Les meilleures propositions pour ce créneau, sans ce qui est déjà au programme."""
    plan = await get_plan(start, settings)
    target = next((e for e in plan["entries"] if e["id"] == entry_id), None)
    if not target:
        return {"entry": None, "items": []}
    items, _ = await library.get()
    current = (target.get("item") or {}).get("uid")
    skipped = set(target.get("skipped") or [])  # ce qu'on vient d'écarter (« Déjà vu », « Au hasard »)
    used = {e["item"]["uid"] for e in plan["entries"] if e.get("item") and e["id"] != entry_id}
    slot = _slot_of(target)
    ctx = {"today": date.today(), "rng": random.Random(), "used": used | ({current} if current else set()),
           "new_episodes": set(), "fb": feedback.summary()}
    scored = []
    for it in items:
        if it["uid"] == current or it["uid"] in skipped or not fits(it, slot, settings):
            continue
        res = score(it, slot, settings, ctx)
        if res:
            scored.append((res[0], it, res[1]))
    scored.sort(key=lambda x: -x[0])
    return {
        "entry": {"id": target["id"], "date": target["date"], "start": target["start"], "label": target["label"],
                  "audience": target["audience"], "title": (target.get("item") or {}).get("title")},
        "items": [dict(_snapshot(it), reason=r) for _, it, r in scored[:n]],
    }


async def replace(start: date, entry_id: str, uid: str, settings: dict) -> dict:
    """Met le titre choisi dans ce créneau."""
    plan = await get_plan(start, settings)
    items, _ = await library.get()
    target = next((e for e in plan["entries"] if e["id"] == entry_id), None)
    item = next((it for it in items if it["uid"] == uid), None)
    if not target or not item:
        return plan
    new = _entry(date.fromisoformat(target["date"]), _slot_of(target), item, "Choisi par vous", settings)
    new["id"] = target["id"]
    plan["entries"] = [new if e["id"] == entry_id else e for e in plan["entries"]]
    await fill_episodes(plan, items, settings)
    save_plan(plan)
    return plan
