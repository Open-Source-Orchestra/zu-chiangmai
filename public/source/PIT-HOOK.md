# In-app ZuChiangMai PIT — integration hook

Shaka expanded scope on 12 Nov 2026: **ZuChiangMai PIT lives inside `zuchiangmai.app`; no separate PIT domain.** A separate scout/engineer owns the content/module discovery and build.

## Reserved paths — this schedule builder does not touch them

- Source mount reserved for the PIT engineer: `/workspace/new-doors-scope/zu-app-src/pit/`
- Generated preview mount reserved for that engineer: `/shared/public/zu-chiangmai/pit/`
- Future production route: `https://zuchiangmai.app/pit/` (not deployed or DNS-changed here)
- Preview route: `/pit/` relative to the hosted `zu-chiangmai` preview root

The generator intentionally avoids a blanket delete of the output directory. It never reads, creates, removes, or overwrites either PIT path. If `/shared/public/zu-chiangmai/pit/` already exists at build time, it is preserved.

## Existing navigation contract

The schedule shell links to `./pit/` in three visible places:

1. Main navigation: **PIT · in-app**
2. Hero secondary action: **Enter the PIT**
3. In-app room invitation: **Open /pit/**

Each anchor carries `data-pit-hook="zuchiangmai-pit"`. `<meta name="zu:pit-module" content="./pit/">` also declares the mount. Keep these hooks in future template edits. The PIT should link back to the agenda with `../#agenda`, not `./#agenda` from inside `/pit/`.

## Module integration expectations

- Provide `/pit/index.html` as the no-JS entrypoint. It can have its own first-party JS/CSS/assets below `/pit/`.
- Keep it a true in-app module at the same origin; do not introduce a separate PIT hostname or iframe a Taurus preview (taur.link blocks framing).
- The schedule app does not require the PIT bundle to boot. Likewise, the PIT should boot independently of the agenda JS.
- A PIT module may read the public sanitized `../schedule.json` if useful, but must not depend on the deployed read-only Worker for its core content, write to it, or expose private/auth/RSVP/attendee fields.
- Use only public, consented 4Seas.org and 4SeasPIT material selected by the PIT engineer. Keep the source/caption/license/consent/takedown provenance with each item. Never infer consent from technical public availability alone.
- No official logos or third-party photos are introduced by the schedule shell. The PIT engineer owns any media-specific consent and accessibility checks.
- Match the shell's keyboard/focus/mobile/no-JS/reduced-motion standards and no-tracker/read-only posture. Keep original module code GPL-3.0-or-later and original words/art CC0 where appropriate; third-party media/content retains its own licensing.
- Do not publish a second competing schedule. PIT is memory/storytelling; the agenda remains the schedule source of truth.
- Preserve preview noindex until the parent explicitly deploys and configures the real domain.

The separate PIT engineer should report its actual module readiness. Until that module exists, the navigation hook is an explicit integration slot, not a claim that PIT content has shipped.
