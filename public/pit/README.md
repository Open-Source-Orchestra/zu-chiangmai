# ZuChiangMai `/pit/` — native in-app memory room

This is the first native PIT module for the ZuChiangMai field guide: **generation 3, forked from the public 4SeasPIT repository**. It is mounted at same-origin `/pit/`, not an iframe and not a new PIT hostname. No registry number is invented. **Official production:** https://zuchiangmai.app/pit/ with canonical metadata and indexing enabled. The taur.link preview remains `noindex,nofollow,noarchive`.

## What ships

- `index.html`: complete server-independent/no-JS catalog of all 29 reviewed public recordings, direct native audio (`preload="none"`), source/transcript links, item-level captions, provenance, rights/consent and takedown.
- `manifest.json`: same-origin, sanitized public metadata only. **29 recordings · 191,878 seconds · 53.3 hours · 10 Start here · 11 knowledge / 9 community / 8 music / 1 tutorial · phases 13/5/11.** The UI computes these from the manifest at build time.
- `app.js` + `styles.css`: progressively enhanced filters, sorting, deep links, one persistent native audio dock, lazy transcript reading, timestamp seeking and explicit spoken-word search.
- `licenses.html`, `LICENSE.txt`, `CC0.txt`: code is GPL-3.0-or-later; only new original module words/abstract art are CC0. Existing recordings, transcripts, posters, titles, voices, performances and other third-party content retain their source rights. No blanket CC0 claim applies to them.
- `source/`: corresponding generator/client source and the local removal list.

## Zero media copies

The build **does not run the research/source media harvest or upload scripts**, does not download original videos, and does not mirror MP3s, posters or transcript bodies. It reads the reviewed public research manifest and emits pointers/metadata. Remote MP3 total is 1,535,154,157 bytes; copied media bytes are **0**.

Audio uses the canonical public R2 URL directly in `<audio src>`. R2 supports byte ranges but did not supply ACAO at research time, so JavaScript must never `fetch()` MP3 bytes. Shelves have no enhanced audio element. Opening a recording sets the single shared element to `preload="metadata"`; playback is always user initiated. Closing/changing sessions pauses and clears the old source. No service worker, full-file cache, autoplay, Drive iframe or fake Download control is used.

Existing public 4SeasPIT posters remain remote, `loading="lazy"`, with a neutral app-owned failure state and item-level caption/rights. No new photography, child/bystander imagery, NOMAD/private-drive material, attendee/contact lists, new profiles or inferred credits are introduced.

## Rebuild deterministically

Requires Node 18+ (developed on Node 24), no package install:

```sh
cd /workspace/new-doors-scope/zu-app-src/pit
node build.mjs /shared/public/zu-chiangmai/pit
```

The builder reads only:

1. `/workspace/new-doors-scope/zu-pit-research/manifest.json` (the finished reviewed public research output);
2. this module's `denylist.json`, templates/client and license/readme files.

It does not fetch the network. Identical inputs produce identical output; source timestamps come from the reviewed manifest, not the wall clock. It validates the schema, all 29 reviewed IDs, required fields, URL hosts/paths, duration and byte totals, type/phase/transcript/search counts, three dead-preview records, three alternate-capture pairs and the Vitalik session/media split. Unknown/missing IDs, unexpected fields, forbidden private-shaped fields, email-shaped strings, changed reviewed facts, unapproved URL hosts, or media-copy claims fail the entire build. HTML rendering escapes source strings.

### Human-reviewed upstream updates

1. Run the **research package's** `build_manifest.py` separately to make a candidate research manifest. That public-only research script checks metadata/transcripts/one-byte ranges; this app builder deliberately does not invoke it.
2. Review the complete candidate diff: additions/removals, source fields, credits, topics, rights, privacy and timestamp/search consistency. Unknown new session IDs fail closed in the research builder and this app builder. Update the reviewed-ID/fact list only after human review; never auto-accept a new Drive/folder/person.
3. On a successful upstream fetch, a disappeared ID is a removal candidate, not silent stale retention. On whole-source network/schema failure, retain the last-known-good app manifest and privately report failure rather than erasing the working catalog.
4. Run this app builder and unit/browser tests. Review the static output. Parent owns any deployment; there is no scheduler, auto-deploy, DNS or Worker step here.

## Local removal / takedown

Add the exact reviewed source session ID to `denylist.json` and rebuild. Denial is applied before counts and output. The ID then has no card, app route, poster URL, audio URL, transcript URL or local search target in generated output. Runtime deep search maps only to local non-denied IDs. A later upstream sync cannot re-add it without editing the independent app-owned denylist.

Sweep built assets, previews, caches/indexes and logs within our control. External Drive/R2/GitHub/permanent-archive copies require their own upstream removal; the module cannot honestly recall them. Use the existing public consent and takedown routes linked throughout the UI. No takedown request is sent by this build.

## Runtime network boundary

Initial enhancement reads same-origin `manifest.json`; native lazy posters come from `4seaspit.com` only near viewport. Transcript text is fetched from `4seaspit.com` only when a timestamped session opens. The no-text lunch-jam state does not fetch or fabricate transcript text. Audio requests go to user-selected canonical R2 media only.

Titles/topics/credits filter instantly and locally. Only an explicit spoken-word submit of 3+ characters fetches the public source catalog and ~1.65 MB search index together. Every `[catalogIndex,seconds,text]` tuple is mapped through that fetched catalog's session ID; the build-time `sourceCatalogIndex` is never used as a runtime search key. Failure leaves title/topic search and honestly labels spoken search unavailable. Shared spoken-search URLs do not auto-load the index.

No trackers, analytics, account, cookies, payment/tip/magnet scripts, external fonts, external runtime JS/CSS, RSVP/write endpoint or attendee collection exists.

## License and source care

New module code: GPL-3.0-or-later. New original module wording and abstract lantern/ridge art: CC0 1.0. Existing 4SeasPIT source content and media retain their owners' rights and source-specific permissions. Public per-person permission receipts are not itemized; this module does not claim independent new consent. Machine transcripts can contain recognition errors; quote with timestamps and source links.

Agenda truth remains at `../#agenda`. The PIT is memory/storytelling, not a competing current-events schedule.
