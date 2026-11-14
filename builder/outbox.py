#!/usr/bin/env python3
"""outbox.py — shared helpers for the AGENDA KEEPER hand-off files.

The keeper (a cheap scheduled agent with no deploy credentials) writes one JSON + one Markdown
file per Bangkok day into the outbox. The Admiral's office (which holds the Cloudflare token)
reads `pending_commit` and deploys; it then calls `outbox.py deployed …` to record the result.

CLI:
  outbox.py render   <YYYY-MM-DD>                       re-render the Markdown from the JSON
  outbox.py deployed <YYYY-MM-DD> <commit> <ok|fail> [note]   record a deploy attempt
  outbox.py pending                                      print "<date> <commit>" lines awaiting deploy

No secrets are ever written here; every agent on the shared drive can read these files.
"""
from __future__ import annotations
import datetime as dt, json, os, pathlib, sys
from zoneinfo import ZoneInfo

BKK = ZoneInfo("Asia/Bangkok")
REPO = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTBOX = pathlib.Path(os.environ.get("AGENDA_OUTBOX") or (
    "/shared/agenda-keeper/outbox" if pathlib.Path("/shared/agenda-keeper").is_dir() else str(REPO / ".outbox")))
PULSE = pathlib.Path("/shared/heartbeat/pulses/agenda-keeper.md")
SITE = "https://zuchiangmai.app/"

# The organisers' announced 2027 dates (canon: /shared/kb/public/ROAD-TO-2027-FACTS-2026-11-14.md).
# None is an Open Source Orchestra slot/stage/grant; the organiser's site wins if a date changes.
ROAD_2027 = [
    ("2027-04-12", "2027-04-15", "EthCC[10] · Cannes 🇫🇷"),
    ("2027-04-14", "2027-04-16", "ETHGlobal Cannes 🇫🇷"),
    ("2027-06-14", "2027-06-16", "ETHConf + ETHGlobal New York 🗽"),
    ("2027-08-23", "2027-08-25", "ETHGlobal Tokyo 🇯🇵"),
    ("2027-10-12", "2027-10-14", "Devcon IX · CCL Lisbon 🇵🇹"),
    ("2027-10-13", "2027-10-15", "ETHGlobal Lisbon 🇵🇹"),
]


def now_bkk() -> dt.datetime:
    return dt.datetime.now(BKK)


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def today_bkk() -> str:
    return now_bkk().strftime("%Y-%m-%d")


def fmt_range(a: str, b: str) -> str:
    da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    if da == db:
        return da.strftime("%-d %b %Y")
    if da.month == db.month:
        return f"{da.day}–{db.day} {db.strftime('%b %Y')}"
    return f"{da.strftime('%-d %b')}–{db.strftime('%-d %b %Y')}"


def road_line(today: str | None = None) -> str:
    today = today or today_bkk()
    nxt = [r for r in ROAD_2027 if r[1] >= today]
    if not nxt:
        return "Road to 2027: all announced stops have passed — check the organisers' sites for what is next."
    s, e, name = nxt[0]
    devcon = next((r for r in ROAD_2027 if r[2].startswith("Devcon IX")), None)
    tail = f" · Devcon IX Lisbon {fmt_range(devcon[0], devcon[1])}" if devcon and not name.startswith("Devcon IX") else ""
    return f"Road to 2027 → next stop {name} {fmt_range(s, e)}{tail} (organisers' dates; we hope to play open circles)."


def next_milestone(milestones: list[dict], today: str | None = None) -> str | None:
    today = today or today_bkk()
    upcoming = sorted((m for m in milestones if m.get("start_date", "") >= today), key=lambda m: (m["start_date"], m["end_date"]))
    ongoing = sorted((m for m in milestones if m.get("start_date", "") < today <= m.get("end_date", "")), key=lambda m: m["end_date"])
    pick = upcoming or ongoing
    if not pick:
        return None
    m = pick[0]
    return f"{m['title']} · {fmt_range(m['start_date'], m['end_date'])}"


def next_events(events: list[dict], n: int = 3, at: dt.datetime | None = None) -> list[str]:
    at = at or dt.datetime.now(dt.timezone.utc)
    out = []
    for ev in sorted((e for e in events if e.get("start")), key=lambda e: e["start"]):
        try:
            start = dt.datetime.fromisoformat(ev["start"].replace("Z", "+00:00"))
        except ValueError:
            continue
        if start < at:
            continue
        local = start.astimezone(BKK)
        when = local.strftime("%a %-d %b") if ev.get("all_day") else local.strftime("%a %-d %b %H:%M")
        venue = ev.get("venue_name") or ev.get("place_name") or ""
        out.append(f"{when} · {ev.get('title', '?')}" + (f" · {venue}" if venue else ""))
        if len(out) >= n:
            break
    return out


def load(date: str, outbox: pathlib.Path = DEFAULT_OUTBOX) -> dict:
    p = outbox / f"{date}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"date": date, "site": SITE, "runs": [], "pending_commit": None, "deploys": []}


def save(doc: dict, outbox: pathlib.Path = DEFAULT_OUTBOX) -> pathlib.Path:
    outbox.mkdir(parents=True, exist_ok=True)
    p = outbox / f"{doc['date']}.json"
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    (outbox / f"{doc['date']}.md").write_text(render(doc), encoding="utf-8")
    (outbox / "LATEST.json").write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return p


def digest_line(doc: dict) -> str:
    """One-line digest: the same text goes to Shaka's inbox and to the heartbeat pulse."""
    runs = doc.get("runs") or []
    r = runs[-1] if runs else {}
    c = r.get("counts") or {}
    d = r.get("diff") or {}
    status = r.get("status", "NO-RUN")
    if status == "CHANGED":
        delta = f"+{len(d.get('added', []))} −{len(d.get('removed', []))} ~{len(d.get('changed', []))} since last build"
    elif status == "UNCHANGED":
        delta = "no changes since last build"
    else:
        delta = status
    dep = doc.get("deploys") or []
    if doc.get("pending_commit"):
        deployed = "deploy: queued for the Admiral's office"
    elif dep and dep[-1].get("ok"):
        deployed = f"deployed: yes ({dep[-1]['commit'][:7]})"
    elif dep:
        deployed = f"deployed: NO — last attempt failed ({dep[-1].get('note', '')[:60]})"
    else:
        deployed = "deployed: not needed" if status == "UNCHANGED" else "deployed: no"
    return f"Zu Chiang Mai agenda {doc['date']}: {c.get('events', '?')} listings, {delta}; {deployed}."


def render(doc: dict) -> str:
    lines = [f"# 🗓️ Agenda Keeper outbox — {doc['date']} (Asia/Bangkok)", "", f"Door: {doc.get('site', SITE)} · repo clone: /shared/agenda-keeper/zu-chiangmai", ""]
    lines.append(f"**{digest_line(doc)}**")
    lines.append("")
    for i, r in enumerate(doc.get("runs") or [], 1):
        c = r.get("counts") or {}
        lines.append(f"## Run {i} · {r.get('at')} · {r.get('status')}")
        if r.get("message"):
            lines.append(f"- note: {r['message']}")
        lines.append(f"- listings: {c.get('events', '?')} (previous {r.get('previous_events', '?')}; 4Seas {c.get('four_seas', '?')}, ETH self {c.get('ethchiangmai', '?')}, duplicate groups {c.get('duplicate_groups', '?')})")
        if r.get("commit"):
            lines.append(f"- commit: `{r['commit']}` (keeper commit in the shared clone; the Admiral pulls, checks, deploys, pushes)")
        if r.get("pull"):
            lines.append(f"- git pull origin: {r['pull']}")
        if r.get("builder_changed"):
            lines.append("- builder/ or deploy/ source changed since the last deploy → rebuild counts as a change")
        d = r.get("diff") or {}
        for key, label in (("added", "➕ added"), ("removed", "➖ removed"), ("changed", "✏️ changed"), ("milestones", "🪧 milestone edits")):
            items = d.get(key) or []
            if items:
                lines.append(f"- {label} ({len(items)}):")
                lines += [f"  - {x}" for x in items[:25]]
                if len(items) > 25:
                    lines.append(f"  - … {len(items) - 25} more")
        if r.get("next_events"):
            lines.append("- next 3 events:")
            lines += [f"  - {x}" for x in r["next_events"]]
        if r.get("next_milestone"):
            lines.append(f"- Chiang Mai season next: {r['next_milestone']}")
        if r.get("road"):
            lines.append(f"- {r['road']}")
        lines.append("")
    if doc.get("pending_commit"):
        lines.append(f"## ⏳ DEPLOY PENDING — commit `{doc['pending_commit']}`")
        lines.append("The Admiral's office scan runs `builder/deploy.sh` (fail-closed checks → wrangler → hero + smoke tests → push). The keeper never deploys.")
        lines.append("")
    for dep in doc.get("deploys") or []:
        lines.append(f"## {'✅' if dep.get('ok') else '🚨'} Deploy {dep.get('at')} · `{dep.get('commit', '')[:12]}` · {'OK' if dep.get('ok') else 'FAILED'}")
        if dep.get("note"):
            lines.append(f"- {dep['note']}")
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def append_pulse(text: str) -> None:
    try:
        PULSE.parent.mkdir(parents=True, exist_ok=True)
        if not PULSE.exists():
            PULSE.write_text("# 🗓️ AGENDA KEEPER pulse — one line per day (https://zuchiangmai.app/)\n\n", encoding="utf-8")
        with PULSE.open("a", encoding="utf-8") as fh:
            fh.write(f"- {now_bkk().strftime('%Y-%m-%d %H:%M')} BKK · {text}\n")
    except OSError as exc:  # a read-only or missing shared drive must never break the agenda lane
        print(f"pulse append skipped: {exc}", file=sys.stderr)


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__); return 2
    cmd, *rest = argv
    if cmd == "render":
        doc = load(rest[0]); save(doc); print(render(doc)); return 0
    if cmd == "deployed":
        date, commit, ok, *note = rest
        doc = load(date)
        doc.setdefault("deploys", []).append({"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "commit": commit, "ok": ok == "ok", "note": " ".join(note)})
        if ok == "ok" and doc.get("pending_commit") == commit:
            doc["pending_commit"] = None
        save(doc)
        append_pulse(("✅ deployed " if ok == "ok" else "🚨 deploy FAILED ") + commit[:7] + (" · " + " ".join(note) if note else ""))
        print(digest_line(doc)); return 0
    if cmd == "pending":
        for p in sorted(DEFAULT_OUTBOX.glob("20*.json")):
            doc = json.loads(p.read_text(encoding="utf-8"))
            if doc.get("pending_commit"):
                print(doc["date"], doc["pending_commit"])
        return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
