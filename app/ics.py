"""Export du programme au format calendrier (.ics), lisible par iCloud,
Google Agenda et Outlook."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

TZ = ZoneInfo(os.environ.get("TZ", "Europe/Brussels"))

AUD = {"enfants": "les enfants", "famille": "toute la famille", "adultes": "les parents"}


def _esc(text: str) -> str:
    return (
        (text or "")
        .replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fold(line: str) -> str:
    """Les lignes .ics ne doivent pas dépasser 75 octets."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        b = ch.encode("utf-8")
        if len(cur) + len(b) > 74:
            parts.append(cur.decode("utf-8"))
            cur = b""
        cur += b
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def _utc(day: str, hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    local = datetime.fromisoformat(day).replace(hour=h, minute=m, tzinfo=TZ)
    return local.astimezone(timezone.utc)


def _stamp(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def build(plans: list[dict], reminder_minutes: int = 15) -> str:
    now = _stamp(datetime.now(timezone.utc))
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Calendarr//Programme familial//FR",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Calendarr",
        "X-WR-CALDESC:Le programme télé de la famille",
        "X-PUBLISHED-TTL:PT1H",
        "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    ]
    for plan in plans:
        for e in plan.get("entries", []):
            item = e.get("item")
            if not item:
                continue
            start = _utc(e["date"], e["start"])
            end = start + timedelta(minutes=int(e.get("duration") or 60))
            title = item["title"]
            if e.get("episodes"):
                eps = e["episodes"]
                title += f" · {eps[0]['code']}" + (f"→{eps[-1]['code'][-3:]}" if len(eps) > 1 else "")
            summary = f"{'🎬' if item['kind'] == 'film' else '📺'} {title}"
            desc = [f"{e.get('label') or 'Programme'} pour {AUD.get(e['audience'], '')}."]
            if e.get("reason"):
                desc.append(e["reason"] + ".")
            for ep in e.get("episodes", []):
                desc.append(f"{ep['code']} {ep.get('name') or ''}".strip())
            if item.get("overview"):
                desc.append("")
                desc.append(item["overview"])
            lines += [
                "BEGIN:VEVENT",
                f"UID:{e['id']}-{e['date']}@calendarr",
                f"DTSTAMP:{now}",
                f"DTSTART:{_stamp(start)}",
                f"DTEND:{_stamp(end)}",
                f"SUMMARY:{_esc(summary)}",
                f"DESCRIPTION:{_esc(chr(10).join(desc))}",
                "CATEGORIES:Calendarr",
                "TRANSP:TRANSPARENT",
            ]
            if reminder_minutes:
                lines += [
                    "BEGIN:VALARM",
                    "ACTION:DISPLAY",
                    f"DESCRIPTION:{_esc(summary)}",
                    f"TRIGGER:-PT{int(reminder_minutes)}M",
                    "END:VALARM",
                ]
            lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(l) for l in lines) + "\r\n"


def today_local() -> date:
    return datetime.now(TZ).date()
