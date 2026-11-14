#!/usr/bin/env python3
"""refresh.py — rebuild the ZU / CHIANG MAI agenda from its live public sources, fail-closed.

    python3 builder/refresh.py [--dry-run] [--force] [--min-ratio 0.8] [--check-only]

What it does (the AGENDA KEEPER runs this daily; humans/Cursor can run it any time):
  1. `git pull --ff-only origin main` so human edits (builder/data/*.json, templates) are included.
  2. Build the PRODUCTION bundle into a temp dir with `ZU_PRODUCTION=1 node builder/build.mjs`
     (live sources: 4Seas / ETHChiangmai public SocialLayer endpoints + ethchiangmai.com metadata).
  3. Validate the result (schema, counts, card count in index.html, photos, robots/sitemap, licenses).
  4. FAIL-CLOSED: if the new listing count is below --min-ratio (default 80 %) of the previous
     bundle, refuse (exit 3) and leave public/ untouched. Parse/build errors exit 2.
  5. Diff events (added / removed / changed) + reviewed milestones vs the current public/ bundle.
  6. Only when something changed (or builder/ source changed since the last deploy): copy the new
     bundle into public/ (never touching public/pit/), commit it, and mark the outbox
     `pending_commit` so the Admiral's office deploys. With --dry-run nothing is written to public/
     or git, but the diff summary is still printed.
  7. Always write the day's outbox (JSON + Markdown) and print a JSON summary on stdout.

Exit codes: 0 ok (changed or unchanged) · 2 build/validation error · 3 refused (shrunken agenda).
No deploy, no network writes, no secrets. The Cloudflare token is NOT needed here.
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, pathlib, re, shutil, subprocess, sys, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import outbox  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = REPO / "public"
STATE_DIR = pathlib.Path(os.environ.get("AGENDA_STATE") or ("/shared/agenda-keeper/state" if pathlib.Path("/shared/agenda-keeper").is_dir() else str(REPO / ".state")))
COMPARE_FIELDS = ("title", "start", "end", "timezone", "all_day", "venue_name", "place_name", "status", "visibility", "tags", "external_url", "kind", "group_handle")
GIT = ["git", "-c", "safe.directory=*", "-C", str(REPO)]


def sh(cmd: list[str], timeout: int = 240, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env={**os.environ, **(env or {})})


def utcnow() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_schedule(path: pathlib.Path) -> dict:
    doc = json.loads(path.read_text(encoding="utf-8"))
    if doc.get("schema_version") != 1 or not isinstance(doc.get("events"), list):
        raise ValueError(f"{path}: not a schema_version 1 schedule")
    return doc


def event_label(ev: dict) -> str:
    start = ev.get("start", "")
    try:
        local = dt.datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(outbox.BKK)
        when = local.strftime("%a %-d %b") if ev.get("all_day") else local.strftime("%a %-d %b %H:%M")
    except ValueError:
        when = start
    return f"{when} · {ev.get('title', '?')} ({ev.get('key', ev.get('id', '?'))})"


def diff_events(prev: list[dict], new: list[dict]) -> dict:
    p = {e["key"]: e for e in prev if e.get("key")}
    n = {e["key"]: e for e in new if e.get("key")}
    added = [event_label(n[k]) for k in n if k not in p]
    removed = [event_label(p[k]) for k in p if k not in n]
    changed = []
    for k in n:
        if k in p:
            fields = [f for f in COMPARE_FIELDS if p[k].get(f) != n[k].get(f)]
            if fields:
                changed.append(f"{event_label(n[k])} → {', '.join(fields)}")
    return {"added": sorted(added), "removed": sorted(removed), "changed": sorted(changed)}


def diff_milestones(prev: list[dict], new: list[dict]) -> list[str]:
    p = {m["id"]: m for m in prev}
    n = {m["id"]: m for m in new}
    out = [f"added {n[k]['title']} ({k})" for k in n if k not in p]
    out += [f"removed {p[k]['title']} ({k})" for k in p if k not in n]
    for k in n:
        if k in p and any(p[k].get(f) != n[k].get(f) for f in ("title", "start_date", "end_date", "displayed_time", "source_url")):
            out.append(f"edited {n[k]['title']} ({k})")
    return sorted(out)


def validate_bundle(out: pathlib.Path) -> dict:
    """Structural checks that must hold before a bundle may replace public/. Raises on failure."""
    sched = load_schedule(out / "schedule.json")
    events = sched["events"]
    counts = sched.get("counts") or {}
    if counts.get("events") != len(events):
        raise ValueError(f"counts.events {counts.get('events')} != len(events) {len(events)}")
    if len(events) < 1:
        raise ValueError("empty agenda — refusing")
    html = (out / "index.html").read_text(encoding="utf-8")
    cards = len(re.findall(r'<article class="event-card', html))
    if cards != len(events):
        raise ValueError(f"index.html has {cards} event cards but schedule has {len(events)} events")
    if len(re.findall(r'<article class="milestone-card', html)) != 16:
        raise ValueError("index.html must carry the 16 reviewed milestones")
    if 'content="index,follow"' not in html or 'og:image' not in html:
        raise ValueError("index.html lacks production meta (ZU_PRODUCTION=1 missing?)")
    if "Allow: /" not in (out / "robots.txt").read_text(encoding="utf-8") or not (out / "sitemap.xml").exists():
        raise ValueError("robots.txt/sitemap.xml are not the production flavour")
    photos = list((out / "photos").glob("*.webp"))
    if len(photos) != 48:
        raise ValueError(f"expected 48 hero derivatives, found {len(photos)}")
    if not (out / "licenses" / "index.html").exists() or "© 4Seas.org" not in (out / "licenses" / "index.html").read_text(encoding="utf-8"):
        raise ValueError("licenses page missing the 4Seas.org permission statement")
    ics = list((out / "ics").glob("*.ics"))
    if len(ics) != len(events):
        raise ValueError(f"{len(ics)} ics files for {len(events)} events")
    return sched


def last_deploy() -> dict:
    p = STATE_DIR / "last-deploy.json"
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    except (OSError, ValueError):
        return {}


def builder_changed_since(commit: str | None) -> bool:
    if not commit:
        return False
    r = sh(GIT + ["diff", "--quiet", commit, "HEAD", "--", "builder", "deploy"])
    return r.returncode == 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true", help="build + diff + outbox, but do not touch public/ or git")
    ap.add_argument("--force", action="store_true", help="accept a shrunken agenda / missing previous bundle (human decision)")
    ap.add_argument("--min-ratio", type=float, default=0.8, help="refuse when new listings < ratio × previous (default 0.8)")
    ap.add_argument("--no-pull", action="store_true", help="skip git pull --ff-only origin main")
    ap.add_argument("--check-only", action="store_true", help="only validate the current public/ bundle (used by deploy.sh)")
    args = ap.parse_args()

    date = outbox.today_bkk()
    run: dict = {"at": utcnow(), "status": "ERROR", "dry_run": args.dry_run}
    doc = outbox.load(date)
    code = 2

    try:
        if args.check_only:
            sched = validate_bundle(PUBLIC)
            print(json.dumps({"check": "ok", "events": sched["counts"]["events"], "generated_at": sched["generated_at"]}))
            return 0

        if not args.no_pull and not args.dry_run:
            r = sh(GIT + ["pull", "--ff-only", "origin", "main"], timeout=120)
            run["pull"] = "ok" if r.returncode == 0 else f"skipped ({(r.stderr or r.stdout).strip().splitlines()[-1][:120] if (r.stderr or r.stdout).strip() else 'error'})"

        prev_sched = load_schedule(PUBLIC / "schedule.json") if (PUBLIC / "schedule.json").exists() else None
        prev_events = prev_sched["events"] if prev_sched else []
        run["previous_events"] = len(prev_events) if prev_sched else None
        if prev_sched is None and not args.force:
            raise ValueError("no previous public/schedule.json — refusing to publish blind (use --force once)")

        with tempfile.TemporaryDirectory(prefix="zu-refresh-") as tmp:
            out = pathlib.Path(tmp) / "bundle"
            build = sh(["node", str(REPO / "builder" / "build.mjs"), str(out)], timeout=300, env={"ZU_PRODUCTION": "1"})
            if build.returncode != 0:
                raise ValueError("build.mjs failed: " + (build.stderr or build.stdout).strip()[-400:])
            sched = validate_bundle(out)
            new_events = sched["events"]
            run["counts"] = sched["counts"]
            run["generated_at"] = sched["generated_at"]

            # Fail-closed shrink gate.
            if prev_sched and len(new_events) < args.min_ratio * len(prev_events) and not args.force:
                run["status"] = "REFUSED-SHRINK"
                run["message"] = f"new agenda has {len(new_events)} listings < {int(args.min_ratio * 100)}% of previous {len(prev_events)} — public/ untouched; a human must look at the sources (api.sola.day 4seas) before --force"
                run["next_events"] = outbox.next_events(prev_events)
                code = 3
                raise SystemExit(code)

            d = diff_events(prev_events, new_events)
            d["milestones"] = diff_milestones((prev_sched or {}).get("programs", {}).get("milestones", []), sched.get("programs", {}).get("milestones", []))
            run["diff"] = d
            ld = last_deploy()
            run["builder_changed"] = builder_changed_since(ld.get("commit"))
            run["next_events"] = outbox.next_events(new_events)
            run["next_milestone"] = outbox.next_milestone(sched.get("programs", {}).get("milestones", []), date)
            run["road"] = outbox.road_line(date)
            changed = any(d.values()) or run["builder_changed"]

            if not changed:
                run["status"] = "UNCHANGED"
                code = 0
            elif args.dry_run:
                run["status"] = "CHANGED"
                run["message"] = "dry run — public/ and git untouched"
                code = 0
            else:
                # Replace public/ except the independently maintained /pit/.
                for child in PUBLIC.iterdir():
                    if child.name == "pit":
                        continue
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
                for child in out.iterdir():
                    dest = PUBLIC / child.name
                    shutil.copytree(child, dest) if child.is_dir() else shutil.copy2(child, dest)
                sh(GIT + ["add", "-A", "public"])
                msg = f"agenda refresh {date}: {len(new_events)} listings (+{len(d['added'])} −{len(d['removed'])} ~{len(d['changed'])}{', milestones edited' if d['milestones'] else ''}{', builder changed' if run['builder_changed'] else ''})"
                c = sh(GIT + ["-c", "user.name=AGENDA KEEPER 🗓️", "-c", "user.email=agenda-keeper@noreply.myagentohana.com", "commit", "-q", "-m", msg])
                if c.returncode != 0:
                    raise ValueError("git commit failed: " + (c.stderr or c.stdout).strip()[-300:])
                run["commit"] = sh(GIT + ["rev-parse", "HEAD"]).stdout.strip()
                run["status"] = "CHANGED"
                doc["pending_commit"] = run["commit"]
                code = 0
    except SystemExit:
        pass
    except Exception as exc:  # noqa: BLE001 — every failure must land in the outbox, never a silent crash
        run["status"] = run.get("status") if run.get("status") not in (None, "ERROR") else "BUILD-ERROR"
        run["message"] = f"{type(exc).__name__}: {exc}"[:600]
        code = 2
    finally:
        if not args.check_only:
            doc.setdefault("runs", []).append(run)
            outbox.save(doc)
            summary = {"status": run.get("status"), "date": date, "events": (run.get("counts") or {}).get("events"), "previous": run.get("previous_events"),
                       "added": len((run.get("diff") or {}).get("added", [])), "removed": len((run.get("diff") or {}).get("removed", [])), "changed": len((run.get("diff") or {}).get("changed", [])),
                       "milestones": len((run.get("diff") or {}).get("milestones", [])), "builder_changed": run.get("builder_changed"), "commit": run.get("commit"), "pending_commit": doc.get("pending_commit"),
                       "message": run.get("message"), "outbox": str(outbox.DEFAULT_OUTBOX / f"{date}.md"), "digest": outbox.digest_line(doc)}
            print(json.dumps(summary, ensure_ascii=False, indent=1))
    return code


if __name__ == "__main__":
    sys.exit(main())
