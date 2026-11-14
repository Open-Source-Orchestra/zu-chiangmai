#!/usr/bin/env bash
# deploy.sh — the ONLY lane that publishes https://zuchiangmai.app/ (Admiral's office; holds the CF token).
#
#   builder/deploy.sh [--pending-only] [--date YYYY-MM-DD]
#
# 1. fast-forward /workspace/zu-chiangmai from GitHub and from the keeper's shared clone
# 2. fail-closed checks on public/ (structure + listing count ≥ 80 % of what production serves now)
# 3. wrangler dry-run → real deploy of the static bundle (zu-chiangmai-site Worker, apex + www)
# 4. verify production serves the new generated_at, then run the 9-check hero test + smoke test
# 5. on any post-deploy failure: redeploy the previously deployed commit (rollback) and exit 1
# 6. on success: push main to GitHub, record state/last-deploy.json, mark the outbox + pulse
#
# --pending-only: exit 0 doing nothing unless the outbox has a pending_commit (used by the office scan).
# Secrets: /workspace/.cf-workers-token is read by this script only; never copied to /shared or git.
set -uo pipefail
# Pin the shared hand-off paths so a caller's test environment can never redirect them.
export AGENDA_OUTBOX=/shared/agenda-keeper/outbox AGENDA_STATE=/shared/agenda-keeper/state
REPO=/workspace/zu-chiangmai
SHARED_CLONE=/shared/agenda-keeper/zu-chiangmai
STATE=/shared/agenda-keeper/state
OUTBOX=/shared/agenda-keeper/outbox
TOKEN_FILE=/workspace/.cf-workers-token
SITE=https://zuchiangmai.app/
OUT=$REPO/.test-out
PENDING_ONLY=0; DATE=$(TZ=Asia/Bangkok date +%F)
while [ $# -gt 0 ]; do case "$1" in --pending-only) PENDING_ONLY=1;; --date) DATE="$2"; shift;; *) echo "unknown arg $1" >&2; exit 2;; esac; shift; done
mkdir -p "$OUT" "$STATE"
log(){ echo "[deploy $(date -u +%H:%M:%SZ)] $*"; }
mark(){ python3 "$REPO/builder/outbox.py" deployed "$DATE" "$1" "$2" "${3:-}" >/dev/null 2>&1 || true; }

PENDING=$(python3 "$REPO/builder/outbox.py" pending 2>/dev/null | awk -v d="$DATE" '$1==d{print $2}' | tail -1)
if [ "$PENDING_ONLY" = 1 ] && [ -z "$PENDING" ]; then log "nothing pending for $DATE"; exit 0; fi

cd "$REPO" || exit 2
if ! git diff --quiet || ! git diff --cached --quiet; then log "ABORT: /workspace/zu-chiangmai has uncommitted changes — commit or stash first"; exit 2; fi
git pull --ff-only origin main >/dev/null 2>&1 || log "warn: pull from origin failed (offline or diverged) — continuing with local main"
if [ -d "$SHARED_CLONE/.git" ]; then
  if ! git pull --ff-only "$SHARED_CLONE" main 2>&1 | tail -1; then log "ABORT: cannot fast-forward from the keeper clone (diverged history) — reconcile by hand"; exit 2; fi
fi
HEAD=$(git rev-parse HEAD)
if [ -n "$PENDING" ] && [ "$PENDING" != "$HEAD" ]; then log "note: pending commit $PENDING is not HEAD ($HEAD); deploying HEAD"; fi

# ── fail-closed checks ──────────────────────────────────────────────────────────
CHECK=$(python3 builder/refresh.py --check-only) || { log "ABORT: bundle check failed: $CHECK"; mark "$HEAD" fail "bundle check failed"; exit 3; }
NEW_COUNT=$(echo "$CHECK" | python3 -c 'import json,sys;print(json.load(sys.stdin)["events"])')
NEW_GEN=$(echo "$CHECK" | python3 -c 'import json,sys;print(json.load(sys.stdin)["generated_at"])')
LIVE_COUNT=$(curl -fsS --max-time 20 "${SITE}schedule.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["counts"]["events"])' 2>/dev/null || echo 0)
LIVE_GEN=$(curl -fsS --max-time 20 "${SITE}schedule.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["generated_at"])' 2>/dev/null || echo "")
if [ "$LIVE_COUNT" -gt 0 ] && [ $((NEW_COUNT * 100)) -lt $((LIVE_COUNT * 80)) ]; then
  log "ABORT (fail-closed): new bundle has $NEW_COUNT listings < 80% of live $LIVE_COUNT"; mark "$HEAD" fail "shrink gate: $NEW_COUNT < 80% of live $LIVE_COUNT"; exit 3
fi
if [ "$NEW_GEN" = "$LIVE_GEN" ] && [ "$PENDING_ONLY" = 1 ]; then log "production already serves $NEW_GEN; nothing to deploy"; mark "$HEAD" ok "already live"; exit 0; fi
[ -d public/pit ] || { log "ABORT: public/pit missing"; exit 3; }
PREV_COMMIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("commit",""))' "$STATE/last-deploy.json" 2>/dev/null || true)
[ -n "$PREV_COMMIT" ] && git cat-file -e "$PREV_COMMIT^{commit}" 2>/dev/null || PREV_COMMIT=$(git rev-parse HEAD~1)
log "deploying $HEAD ($NEW_COUNT listings, generated $NEW_GEN; live $LIVE_COUNT / $LIVE_GEN; rollback target $PREV_COMMIT)"

# ── wrangler ────────────────────────────────────────────────────────────────────
[ -s "$TOKEN_FILE" ] || { log "ABORT: token file missing"; exit 2; }
wr(){ env -u CF_API_TOKEN CLOUDFLARE_API_TOKEN="$(cat "$TOKEN_FILE")" npx wrangler deploy --config deploy/wrangler.jsonc "$@"; }
wr --dry-run >"$OUT/wrangler-dry-run.log" 2>&1 || { log "ABORT: wrangler dry-run failed"; tail -5 "$OUT/wrangler-dry-run.log"; mark "$HEAD" fail "wrangler dry-run failed"; exit 4; }
wr >"$OUT/wrangler-deploy.log" 2>&1 || { log "ABORT: wrangler deploy failed"; tail -8 "$OUT/wrangler-deploy.log"; mark "$HEAD" fail "wrangler deploy failed"; exit 4; }
VERSION=$(grep -oE 'Version ID: [0-9a-f-]+' "$OUT/wrangler-deploy.log" | awk '{print $3}' | tail -1)
log "wrangler deployed version ${VERSION:-?}"

# ── verify + tests, rollback on failure ─────────────────────────────────────────
ok=0
for i in 1 2 3 4 5 6 7 8; do
  G=$(curl -fsS --max-time 20 -H 'Cache-Control: no-cache' "${SITE}schedule.json" | python3 -c 'import json,sys;print(json.load(sys.stdin)["generated_at"])' 2>/dev/null || echo "")
  [ "$G" = "$NEW_GEN" ] && { ok=1; break; }; sleep 10
done
rollback(){
  log "ROLLBACK → $PREV_COMMIT public/"
  git checkout -q "$PREV_COMMIT" -- public && wr >"$OUT/wrangler-rollback.log" 2>&1 && log "rollback deployed" || log "ROLLBACK FAILED — manual action needed"
  git checkout -q HEAD -- public
}
if [ "$ok" != 1 ]; then log "FAIL: production did not pick up $NEW_GEN"; rollback; mark "$HEAD" fail "production did not serve new generated_at"; exit 5; fi
if ! node builder/tests/hero-test.mjs "$SITE" "$OUT" production >"$OUT/hero-test.log" 2>&1; then log "FAIL: hero test"; tail -5 "$OUT/hero-test.log"; rollback; mark "$HEAD" fail "hero test failed"; exit 5; fi
if ! node builder/tests/smoke.mjs "$SITE" "$OUT" >"$OUT/smoke.log" 2>&1; then log "FAIL: smoke test"; tail -5 "$OUT/smoke.log"; rollback; mark "$HEAD" fail "smoke test failed"; exit 5; fi
HERO=$(tail -1 "$OUT/hero-test.log"); SMOKE=$(tail -1 "$OUT/smoke.log")
log "tests: hero=$HERO smoke=$SMOKE"

# ── record + push ───────────────────────────────────────────────────────────────
git push -q origin main 2>&1 | tail -1 || log "warn: push to GitHub failed (fix by hand: git push origin main)"
python3 - "$STATE/last-deploy.json" "$HEAD" "$NEW_COUNT" "$NEW_GEN" "${VERSION:-}" <<'EOF'
import json, sys, datetime
p, commit, count, gen, ver = sys.argv[1:]
json.dump({"commit": commit, "events": int(count), "generated_at": gen, "worker_version": ver, "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, open(p, "w"), indent=1)
EOF
mark "$HEAD" ok "$NEW_COUNT listings · worker ${VERSION:-?} · $HERO · $SMOKE"
log "DONE $HEAD live ($NEW_COUNT listings)"
