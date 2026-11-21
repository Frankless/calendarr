"""Composer la semaine : une main de cartes à poser dans les créneaux.

La main mélange les prochains épisodes des séries « On la regarde », les
titres aimés dans « Surprends-moi » et des films suggérés (âge, durée, goûts,
déjà vu). Une carte posée reste une idée jusqu'à « C'est bon pour la
semaine », qui confirme tout ce qui a été posé.

Dans /config/plans/<semaine>.json, une carte posée a "picked": true et la
semaine garde "skipped_week" (cartes écartées avec « Pas cette semaine ») et
"validated_at" (date de la validation). Ces champs sont ignorés par les
versions précédentes.
"""

from __future__ import annotations

import random
from datetime import date, datetime

from . import feedback, ics, library, planner, watchstate

HAND_SIZE = 5


def _open_entries(plan: dict) -> list[dict]:
    """Créneaux sur lesquels on peut encore poser une carte : à venir, ou pas encore terminés aujourd'hui."""
    now = datetime.now(ics.TZ)
    today, hhmm = now.date().isoformat(), now.hour * 60 + now.minute

    def still_open(e: dict) -> bool:
        if e["date"] != today:
            return e["date"] > today
        h, m = map(int, e["start"].split(":"))
        return h * 60 + m + int(e.get("max_minutes") or 0) > hhmm

    return [e for e in plan["entries"] if still_open(e)]


def _placed(e: dict) -> bool:
    return bool(e.get("item")) and bool(e.get("picked") or e.get("confirmed"))


def _ctx(plan: dict, rng: random.Random) -> dict:
    return {
        "today": date.today(), "rng": rng, "new_episodes": set(), "fb": feedback.summary(),
        "ws": watchstate.load(), "planning": True,
        "used": {e["item"]["uid"] for e in plan["entries"] if _placed(e)},
    }


def _card(it: dict, fits: list[str], reason: str, settings: dict) -> dict:
    card = planner._snapshot(it) | {"fits": fits, "reason": reason}
    if it["kind"] == "serie":
        nxt = it.get("next_up")
        card["next"] = f"S{nxt['season']:02d}E{nxt['episode']:02d}" if nxt else "S01E01"
    return card


async def hand(plan: dict, settings: dict, exclude: set[str] | None = None, seed: str | None = None,
               size: int = HAND_SIZE) -> list[dict]:
    """Des cartes (cinq par défaut), chacune compatible avec au moins une case libre."""
    items, _ = await library.get()
    rng = random.Random(seed)
    ctx = _ctx(plan, rng)
    exclude = set(exclude or ()) | set(plan.get("skipped_week") or [])
    slots = [e for e in _open_entries(plan) if not _placed(e)]
    liked = ctx["fb"].get("yes", {})
    scored = []
    for it in items:
        if it["uid"] in exclude or it["uid"] in ctx["used"]:
            continue
        fits, best, why = [], None, ""
        for e in slots:
            slot = planner._slot_of(e)
            if not planner.fits(it, slot, settings):
                continue
            res = planner.score(it, slot, settings, ctx)
            if res is None:
                continue
            fits.append(e["id"])
            if best is None or res[0] > best:
                best, why = res[0], res[1]
        if not fits:
            continue
        bonus = 4 if it["uid"] in liked else 0
        if it["kind"] == "serie" and it.get("next_up"):
            bonus += 3
        scored.append((best + bonus + rng.random() * 2, it, fits, why))
    scored.sort(key=lambda x: -x[0])

    # un peu de variété : au moins une série et un titre pour les enfants s'il y en a
    picked, seen = [], set()

    def take(pred):
        for s in scored:
            if s[1]["uid"] not in seen and pred(s):
                picked.append(s)
                seen.add(s[1]["uid"])
                return

    kids_ids = {e["id"] for e in slots if e["audience"] != "adultes"}
    if size >= 3:
        take(lambda s: s[1]["kind"] == "serie")
        take(lambda s: bool(set(s[2]) & kids_ids))
    max_series = 2 if size >= 4 else size
    for relax in (False, True):  # d'abord au plus 2 séries, puis on complète si besoin
        for s in scored:
            if len(picked) >= size:
                break
            if s[1]["uid"] in seen:
                continue
            if not relax and s[1]["kind"] == "serie" and sum(p[1]["kind"] == "serie" for p in picked) >= max_series:
                continue
            picked.append(s)
            seen.add(s[1]["uid"])
    picked.sort(key=lambda s: -s[0])
    return [_card(it, fits, why, settings) for _, it, fits, why in picked[:size]]


def board(plan: dict) -> list[dict]:
    """Les cases de la semaine (aujourd'hui et après), avec ce qui y est posé."""
    out = []
    for e in sorted(_open_entries(plan), key=lambda x: (x["date"], x["start"])):
        out.append({
            "id": e["id"], "date": e["date"], "weekday": e["weekday"], "start": e["start"],
            "audience": e["audience"], "label": e["label"], "kind": e["slot_kind"], "max_minutes": e["max_minutes"],
            "item": e["item"] if _placed(e) else None, "episodes": e.get("episodes") if _placed(e) else [],
            "confirmed": bool(e.get("confirmed")),
        })
    return out


async def state(start: date, settings: dict, exclude: set[str] | None = None) -> dict:
    plan = await planner.get_plan(start, settings)
    return {
        "week": plan["week"],
        "board": board(plan),
        "hand": await hand(plan, settings, exclude),
        "validated_at": plan.get("validated_at"),
    }


async def place(start: date, entry_id: str, uid: str, settings: dict) -> dict:
    """Pose une carte dans une case (elle reste une idée jusqu'à la validation)."""
    plan = await planner.get_plan(start, settings)
    items, _ = await library.get()
    target = next((e for e in plan["entries"] if e["id"] == entry_id), None)
    item = next((it for it in items if it["uid"] == uid), None)
    if not target or not item:
        raise ValueError("Case ou carte introuvable")
    if target["date"] < ics.today_local().isoformat():
        raise ValueError("Ce jour est passé")
    slot = planner._slot_of(target)
    ctx = _ctx(plan, random.Random())
    ctx["used"].discard((target.get("item") or {}).get("uid"))
    if not planner.fits(item, slot, settings) or planner.score(item, slot, settings, ctx) is None:
        raise ValueError("Cette carte ne convient pas à ce créneau")
    new = planner._entry(date.fromisoformat(target["date"]), slot, item, "Choisi pour la semaine", settings)
    new["id"] = target["id"]
    new["picked"] = True  # reste une idée jusqu'à « C'est bon pour la semaine »
    plan["entries"] = [new if e["id"] == entry_id else e for e in plan["entries"]]
    await planner.fill_episodes(plan, items, settings)
    planner.save_plan(plan)
    return plan


async def clear(start: date, entry_id: str, settings: dict) -> dict:
    """Vide une case : elle pourra rester vide (soirée libre)."""
    plan = await planner.get_plan(start, settings)
    target = next((e for e in plan["entries"] if e["id"] == entry_id), None)
    if target:
        slot = planner._slot_of(target)
        new = planner._entry(date.fromisoformat(target["date"]), slot, None, "", settings)
        new["id"] = target["id"]
        new["reason"] = "Case vide : soirée libre, ou une carte à poser."
        plan["entries"] = [new if e["id"] == entry_id else e for e in plan["entries"]]
        planner.save_plan(plan)
    return plan


async def skip(start: date, uid: str, settings: dict) -> dict:
    """« Pas cette semaine » : la carte ne revient pas pour cette semaine."""
    plan = await planner.get_plan(start, settings)
    plan["skipped_week"] = sorted(set(plan.get("skipped_week") or []) | {uid})
    planner.save_plan(plan)
    return plan


async def validate(start: date, settings: dict) -> dict:
    """« C'est bon pour la semaine » : tout ce qui est posé devient confirmé.
    Les idées que personne n'a choisies sont retirées (les cases restent vides)."""
    plan = await planner.get_plan(start, settings)
    today = ics.today_local().isoformat()
    entries = []
    for e in plan["entries"]:
        if e["date"] >= today:
            if _placed(e):
                e["confirmed"] = True
            elif e.get("item"):
                slot = planner._slot_of(e)
                empty = planner._entry(date.fromisoformat(e["date"]), slot, None, "", settings)
                empty["id"] = e["id"]
                empty["reason"] = "Soirée libre."
                e = empty
        entries.append(e)
    plan["entries"] = entries
    plan["validated_at"] = datetime.now().isoformat(timespec="seconds")
    planner.save_plan(plan)
    return plan
