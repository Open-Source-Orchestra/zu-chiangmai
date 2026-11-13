# ZU / CHIANG MAI — Living Field Guide

Independent, mobile-first, read-only public field guide for `zuchiangmai.app`. No official umbrella/voice or endorsement is implied. No account, RSVP, write endpoint, analytics, tracker, external font, or third-party image is used. **Production is live at https://zuchiangmai.app/; the taur.link preview remains noindex.**

## Ownership boundary

This builder owns only:

- `/workspace/new-doors-scope/zu-app-src/`
- `/workspace/new-doors-scope/zu-app-test/`
- `/shared/public/zu-chiangmai/`

It does not change DNS, real domains, other doors, repos, or agents. The parent deployed Worker version **`9d07f4c8-1931-426b-8d17-218317938131`**; this builder did not deploy or redeploy it. `/pit/` is an integration slot for a separate engineer; see [PIT-HOOK.md](./PIT-HOOK.md). The generator never cleans or writes either PIT directory.

## Data policy and current source behavior

Public sources only:

- 4Seas group: `GET https://api.sola.day/api/v1/groups/4seas`
- 4Seas upcoming public browse: `GET /events?group_id=4seas&collection=upcoming&limit=500`
- 4Seas whole group subscription: `GET /groups/4seas/calendar.ics` (includes past events; do not mistake that count for upcoming)
- ETHChiangmai season group: `GET /groups/ethchiangmai2025`
- ETH self-calendar: `GET /groups/ethchiangmai2025/calendar.ics`
- Current ETH season cross-check: `https://ethchiangmai.com/`

SocialLayer's `Group#event_group_ids` supports intentional `event_union` federation: group browse includes self plus every configured union group. Thus shared ETH/4Seas browse rows are **not necessarily an API fault**. Every normalized event carries safe `group_handle` and `group_name` fields from its actual public group object. Only ETH self-ICS entries become ETH-owned agenda rows; federated 4Seas rows remain 4Seas.

At snapshot time, SocialLayer returned `Access-Control-Allow-Origin: *` when the request supplied `Origin: https://zuchiangmai.app`; a no-Origin server request had no ACAO and the response included `Vary: Origin`. Thus anonymous direct browser reads were technically possible at that snapshot, but this is not a permanent upstream SLA. The first-party read-only Worker remains recommended for field allowlisting/privacy, fixed origins, shared caching, and stale-last-good semantics. Never copy event owner/user data, participant counts/lists, notes, meeting URLs, image notes, memberships, attendee/ticket data, precise coordinates, place addresses, or descriptions derived from notes. Only safe public title/time/timezone/kind/tags/status/visibility/group labels/place or venue name/external URL fields are retained. Event-source links are generated from validated IDs.

Suspected duplicates are an exact same-source + actual-group + title + start-time match. Every row remains in JSON and HTML. The first is flagged; subsequent entries are collapsed in an explicitly labelled `<details>` with direct provenance. No silent de-duplication.

The official ETH website currently combines current 2026–27 season metadata with legacy 2025–26 programme entries. Only current season metadata is shown; older sessions are not imported as current. If a future build no longer finds that conflict, the verification changes and its notice disappears.

### Reviewed programme milestone rail

`data/program-milestones.json` is a human-reviewed static snapshot of 16 official ETHChiangmai / current `chiangmai.devfolio.co` / 4Seas Longevity programme milestones from the social scout's final public research. It is deliberately separate from timed agenda events and from the Worker payload. Date-only entries stay date-only. Devfolio's displayed clock times retain `timezone: null`; never convert them to UTC or infer 09:00.

The rail preserves Nomad Market II's ETH Dec 25–26 vs Longevity Dec 24–25 disagreement; season end Jan 3 vs 4Seas residency Jan 5 / one current ETH section Dec 30; Longevity's Nov 29–Dec 29 package window distinct from its Nov 30 opening; and two distinct timed 4Seas hackathon listings. The current hackathon source is **`chiangmai.devfolio.co`**, not the prior-season `ethchiangmai.devfolio.co`. Milestones are not auto-refreshed or silently reconciled. Static milestone changes require human source review and a static rebuild only, **never a Worker redeploy by themselves**.

## Build the static preview

Requires Node 18+ (developed with Node 24), no package install:

```sh
cd /workspace/new-doors-scope/zu-app-src
node build.mjs /shared/public/zu-chiangmai
```

This re-fetches public sources, sanitizes them in memory, and emits:

- `index.html` — complete no-JS agenda, 16-milestone ETH + Longevity rail, details, source links, notices, ETH empty state, and PIT links
- `schedule.json` — sanitized static fallback
- `app.js`, `styles.css` — first-party progressive enhancement; local `favicon.svg` and multi-size `favicon.ico`
- `photos/` — sixteen curated, already-public 4Seas community images at 480/960px; provenance in `data/hero-photos.json` and `/licenses/#photo-sources`
- `ics/<source>-<id>.ics` — an individual downloadable calendar per current event, including no-JS access
- `licenses/`, `source/` — license statement and corresponding source offer
- `robots.txt` + meta noindex for the preview

Initial HTML always says **SOURCE SNAPSHOT** until a refresh completes. The client attempts the deployed fixed Worker on manual refresh or roughly every 120 seconds while visible. A schema-valid, non-stale Worker response with every source OK is required for **LIVE · READ-ONLY PROXY**. Network/schema/origin failures keep the current snapshot/last-good data and visibly remove Live. Source fetch and browser render timestamps are separate.

The first-page hero uses a two-frame/two-backdrop **2.4-second gentle continuous shuffle** of sixteen already-public 4Seas community photographs. The first road/ukulele photograph is the no-JS and reduced-motion static fallback. Reduced-motion downloads no extra photo set and hides the motion control; no-JS keeps the complete agenda and one photograph. A visible Pause/Resume control, hidden-tab and offscreen pausing, decorative alt handling, local WebP assets, and per-photo source links are included. No private-Drive, new NOMAD or child imagery is introduced; public availability is not presented as a new consent claim.

## Worker deployment status / future parent review

**Current parent-deployed production version:** `9d07f4c8-1931-426b-8d17-218317938131` at `https://zu-chiangmai-schedule.shakaverse.workers.dev`. Parent verified `/health` + `/v1/schedule` (197 / 0 / one duplicate pair), fixed-query 400, POST 405, OPTIONS 204 with public CORS, privacy-field absence, and browser LIVE refresh. Static milestone/favicon/documentation updates do not require or authorize a redeploy.

If Worker source changes later, review `worker/worker.js` and `wrangler.jsonc` again first. There are no routes, secrets, DO/D1/KV bindings, custom domains, write paths, arbitrary proxy targets, or query-driven cache keys. `/health` and `/v1/schedule` only. The last-good fallback uses isolate memory plus a fixed long-lived Cache API key; cache persistence is best-effort, so a cold failure without a cached last-good returns honest 503 rather than fabricating data.

Exact review / deploy lane (token file path only; never echo its value):

```sh
cd /workspace/new-doors-scope/zu-app-src
npx wrangler deploy --dry-run --config wrangler.jsonc
CLOUDFLARE_ACCOUNT_ID=f4c27480e870fc5788a1e1b8095bc744 \
CLOUDFLARE_API_TOKEN="$(cat /workspace/.cf-workers-token)" \
  npx wrangler deploy --config wrangler.jsonc
```

Live URL: `https://zu-chiangmai-schedule.shakaverse.workers.dev`.

Verification commands:

```sh
curl -fsS https://zu-chiangmai-schedule.shakaverse.workers.dev/health | jq .
curl -fsS https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule -o /tmp/zu-schedule.json
jq '{generated_at,stale,counts,sources,duplicates}' /tmp/zu-schedule.json
curl -fsSI https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule
curl -fsS -X OPTIONS -i https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule
curl -sS -X POST -o /dev/null -w '%{http_code}\n' https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule  # expect 405
curl -sS 'https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule?url=https://example.com' -o /dev/null -w '%{http_code}\n'  # expect 400; no arbitrary fetch
jq -e '[.events[] | has("owner") or has("notes") or has("meeting_url") or has("participant_count") or has("latitude") or has("longitude")] | any | not' /tmp/zu-schedule.json
```

Then use the preview's **Refresh sources** and verify `LIVE · READ-ONLY PROXY`, event counts, source health, and console/network cleanliness. Do not change real DNS as part of this preview task.

## Licenses

Original code: GPL-3.0-or-later; corresponding source is in the hosted `source/` directory. Original guide words and abstract SVG art: CC0 1.0. Third-party public schedule content remains its source owners' content and is not relicensed.

No outreach, social announcement, archive submission, dreambook publishing, or Worker deploy/redeploy was performed by this builder. The parent separately deployed and verified the Worker version recorded above.
