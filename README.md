# ZU / CHIANG MAI

Official living field guide and memory PIT: https://zuchiangmai.app/

- `public/` — the exact production static bundle served by the `zu-chiangmai-site` Worker. The agenda has 199 listings + 16 reviewed milestones; `/pit/` is preserved as a first-class native route.
- `builder/` — source builders and data for future edits. Do not replace the current production bundle with an older 197-event snapshot.
- `deploy/wrangler.jsonc` — assets-only deployment configuration for apex and `www`.

The separate `zu-chiangmai-schedule` API Worker is independent and must not be redeployed for static-site changes. The taur.link preview keeps `noindex`; only this production bundle enables indexing.

See `builder/README.md` and `builder/pit/README.md` for source policies, source-of-truth boundaries, licensing, and rebuild instructions.
