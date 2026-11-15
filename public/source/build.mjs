import { mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_BASE, ENDPOINTS, buildSchedule, validateSchedule } from "./lib/schedule.mjs";
import { renderPage, eventFileName, escapeHtml } from "./lib/templates.mjs";
import { eventToIcs } from "./lib/ics.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const output = process.argv[2] ? path.resolve(process.argv[2]) : "/shared/public/zu-chiangmai";
const checkedAt = () => new Date().toISOString();

async function fetchPublic(url, kind = "json", withBrowserOrigin = false) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: kind === "json" ? "application/json" : kind === "ics" ? "text/calendar" : "text/html", "User-Agent": "ZuChiangMaiFieldGuide/1.0 public read-only build", ...(withBrowserOrigin ? { Origin: "https://zuchiangmai.app" } : {}) },
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) throw new Error(`${response.status} for ${url}`);
      const body = kind === "json" ? await response.json() : await response.text();
      return { body, response, fetched_at: checkedAt() };
    } catch (error) {
      lastError = error;
      if (!attempt) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastError;
}

function currentEthVerification(html, fetchedAt) {
  const series = [];
  for (const match of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1]);
      if (value?.["@type"] === "EventSeries") series.push(value);
    } catch { /* A non-JSON-LD block does not contribute schedule data. */ }
  }
  const current = series.find((item) => item.startDate === "2026-11-11") || series[0] || null;
  const legacy = (current?.subEvent || []).filter((item) => item.startDate && current?.startDate && item.startDate < current.startDate);
  return {
    key: "eth-website",
    url: "https://ethchiangmai.com/",
    status: current ? "ok" : "metadata-not-found",
    fetched_at: fetchedAt,
    start_date: current?.startDate || null,
    end_date: current?.endDate || null,
    legacy_programme_present: legacy.length > 0,
    legacy_entry_count: legacy.length,
    note: legacy.length ? "Current season metadata and legacy programme entries coexist; only current season metadata is shown." : "No legacy programme conflict detected in the current EventSeries metadata.",
  };
}

async function main() {
  const ethBrowseUrl = `${API_BASE}/events?group_id=ethchiangmai2025&collection=upcoming&limit=500`;
  const [fourGroup, fourEvents, fourCalendar, ethGroup, ethCalendar, ethBrowse, ethWebsite, corsOrigin] = await Promise.all([
    fetchPublic(ENDPOINTS.fourGroup),
    fetchPublic(ENDPOINTS.fourEvents),
    fetchPublic(ENDPOINTS.fourCalendar, "ics"),
    fetchPublic(ENDPOINTS.ethGroup),
    fetchPublic(ENDPOINTS.ethCalendar, "ics"),
    fetchPublic(ethBrowseUrl),
    fetchPublic("https://ethchiangmai.com/", "html"),
    fetchPublic(ENDPOINTS.fourEvents, "json", true),
  ]);
  if (!Array.isArray(fourEvents.body?.data)) throw new Error("4Seas public events payload has no data array");
  const fourIds = fourEvents.body.data.map((event) => event.id).sort();
  const ethBrowseIds = Array.isArray(ethBrowse.body?.data) ? ethBrowse.body.data.map((event) => event.id).sort() : [];
  const sameFederatedRows = fourIds.length === ethBrowseIds.length && fourIds.every((id, index) => id === ethBrowseIds[index]);
  const sameEtag = Boolean(fourEvents.response.headers.get("etag") && fourEvents.response.headers.get("etag") === ethBrowse.response.headers.get("etag"));
  const verifications = [
    {
      key: "four-calendar",
      url: ENDPOINTS.fourCalendar,
      status: "ok",
      fetched_at: fourCalendar.fetched_at,
      vevent_count: (fourCalendar.body.match(/BEGIN:VEVENT/g) || []).length,
      advertised_refresh: /REFRESH-INTERVAL;VALUE=DURATION:PT1H/.test(fourCalendar.body) ? "PT1H" : null,
      use: "Whole-calendar subscription link and source verification only; upcoming agenda entries come from the public events collection.",
    },
    {
      key: "eth-federated-browse",
      url: ethBrowseUrl,
      status: "ok",
      fetched_at: ethBrowse.fetched_at,
      count: ethBrowseIds.length,
      same_public_rows_as_four_seas: sameFederatedRows,
      same_etag_as_four_seas: sameEtag,
      interpretation: "SocialLayer supports event_union federation. Shared browse rows are expected cross-listing behavior, not proof of an API fault. These rows are not relabelled as ETH-owned events; ETH-owned entries come from self-ICS.",
    },
    currentEthVerification(ethWebsite.body, ethWebsite.fetched_at),
    {
      key: "source-cors",
      status: "ok",
      fetched_at: corsOrigin.fetched_at,
      request_origin: "https://zuchiangmai.app",
      browser_cross_origin_readable: corsOrigin.response.headers.get("access-control-allow-origin") === "*",
      acao_with_origin: corsOrigin.response.headers.get("access-control-allow-origin"),
      acao_without_origin: fourEvents.response.headers.get("access-control-allow-origin"),
      vary: fourEvents.response.headers.get("vary"),
      note: "At this snapshot, anonymous browser Origin requests received Access-Control-Allow-Origin: *; the no-Origin server request lacked ACAO and the response varied by Origin. The Worker remains recommended for field allowlisting, privacy, caching and stale-last-good semantics, not because direct browser CORS is impossible.",
    },
  ];
  const fetchedAt = checkedAt();
  const programs = JSON.parse(await readFile(path.join(root, "data/program-milestones.json"), "utf8"));
  const heroPhotos = JSON.parse(await readFile(path.join(root, "data/hero-photos.json"), "utf8"));
  if (!Array.isArray(heroPhotos) || heroPhotos.length !== 16) throw new Error("Hero photo set must contain exactly sixteen reviewed images");
  for (const photo of heroPhotos) {
    // Each hero photo is a reviewed frame from the 4Seas.org professional album, used with permission (not CC0).
    if (!/^[a-z][a-z0-9-]+$/.test(photo.id || "") || !photo.title || !/^(https:\/\/|\.\/licenses\/)/.test(photo.source_page || "") || !/^\d{1,3}% \d{1,3}%$/.test(photo.position || "") || !photo.credit || !/^© 4Seas\.org/.test(photo.license || "") || !/^DSC\d{5}\.JPG$/.test(photo.original_file || "") || !/^\d{4}-\d{2}-\d{2}$/.test(photo.captured || "")) throw new Error(`Invalid hero photo provenance: ${photo.id}`);
    for (const size of [480, 960, 1440]) if (!existsSync(path.join(root, "client/photos", `${photo.id}-${size}.webp`))) throw new Error(`Missing hero derivative: ${photo.id}-${size}.webp`);
  }
  if (programs.schema_version !== 1 || !Array.isArray(programs.milestones) || programs.milestones.length !== 16 || !Array.isArray(programs.disagreements)) throw new Error("Reviewed programme milestone payload is incomplete");
  for (const item of programs.milestones) {
    if (!item.id || !item.title || !/^\d{4}-\d{2}-\d{2}$/.test(item.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(item.end_date) || !/^https:\/\/(ethchiangmai\.com|chiangmai\.devfolio\.co|4seas\.xyz)\//.test(item.source_url)) throw new Error(`Invalid reviewed milestone: ${item.id}`);
    if (item.displayed_time && item.timezone !== null) throw new Error(`Unconfirmed Devfolio timezone must remain null: ${item.id}`);
  }
  const schedule = buildSchedule({
    fourGroup: fourGroup.body,
    fourRows: fourEvents.body.data,
    ethGroup: ethGroup.body,
    ethIcs: ethCalendar.body,
    fetchedAt,
    generatedAt: fetchedAt,
    verifications,
  });
  schedule.programs = programs;
  validateSchedule(schedule);

  // ZU_PRODUCTION=1 → the exact production flavour served at https://zuchiangmai.app/
  // (indexable, canonical + Open Graph, robots Allow + sitemap). Default = noindex preview.
  const production = process.env.ZU_PRODUCTION === "1";
  const today = fetchedAt.slice(0, 10);
  let indexHtml = renderPage(schedule, heroPhotos);
  if (production) {
    const og = `<link rel="canonical" href="https://zuchiangmai.app/">\n  <meta property="og:type" content="website"><meta property="og:url" content="https://zuchiangmai.app/"><meta property="og:title" content="ZU / CHIANG MAI — Living Field Guide"><meta property="og:description" content="Public gatherings around 4Seas, the ETHChiangmai season, and paths into community memory."><meta property="og:image" content="https://zuchiangmai.app/photos/${heroPhotos[0].id}-1440.webp">\n  <meta name="zu:pit-module"`;
    const before = indexHtml;
    indexHtml = indexHtml
      .replace('<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">')
      .replace('<meta name="zu:pit-module"', og)
      .replace("Rendered by this static preview;", "Rendered by this static production bundle;");
    if (indexHtml === before || !indexHtml.includes("og:image") || !indexHtml.includes("index,follow")) throw new Error("Production meta splice failed");
  }
  const robotsTxt = production ? "User-agent: *\nAllow: /\n\nSitemap: https://zuchiangmai.app/sitemap.xml\n" : "User-agent: *\nDisallow: /\n";
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://zuchiangmai.app/</loc><lastmod>${today}</lastmod></url>\n  <url><loc>https://zuchiangmai.app/pit/</loc><lastmod>${today}</lastmod></url>\n</urlset>\n`;

  await mkdir(output, { recursive: true });
  await mkdir(path.join(output, "licenses"), { recursive: true });
  await rm(path.join(output, "ics"), { recursive: true, force: true });
  await rm(path.join(output, "photos"), { recursive: true, force: true });
  await mkdir(path.join(output, "ics"), { recursive: true });
  await Promise.all([
    writeFile(path.join(output, "index.html"), indexHtml),
    ...(production ? [writeFile(path.join(output, "sitemap.xml"), sitemapXml)] : []),
    writeFile(path.join(output, "schedule.json"), `${JSON.stringify(schedule, null, 2)}\n`),
    writeFile(path.join(output, "app.js"), await readFile(path.join(root, "client/app.js"), "utf8")),
    writeFile(path.join(output, "styles.css"), await readFile(path.join(root, "client/styles.css"), "utf8")),
    cp(path.join(root, "client/photos"), path.join(output, "photos"), { recursive: true }),
    readFile(path.join(root, "client/favicon.svg")).then((data) => writeFile(path.join(output, "favicon.svg"), data)),
    readFile(path.join(root, "client/favicon.ico")).then((data) => writeFile(path.join(output, "favicon.ico"), data)),
    writeFile(path.join(output, "robots.txt"), robotsTxt),
    ...schedule.events.map((event) => writeFile(path.join(output, "ics", eventFileName(event)), eventToIcs(event, schedule.generated_at))),
  ]);
  const photoCredits = heroPhotos.map((photo) => `<li><strong>${escapeHtml(photo.title)}</strong> · ${escapeHtml(photo.original_file)} · captured ${escapeHtml(photo.captured)} · ${escapeHtml(photo.credit)} · ${escapeHtml(photo.license)}</li>`).join("");
  const licenseHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Licenses & source — ZU / CHIANG MAI</title><style>body{max-width:760px;margin:40px auto;padding:0 20px;background:#102f35;color:#f3eddd;font:16px/1.65 system-ui}a{color:#f4c876}code{background:#ffffff12;padding:2px 5px}section{border-top:1px solid #ffffff2b;margin-top:28px;padding-top:20px}</style></head><body><a href="../">← ZU / CHIANG MAI</a><h1>Licenses &amp; source offer</h1><p>Independent public preview; no official endorsement is implied.</p><section><h2>Original code</h2><p>GPL-3.0-or-later. Corresponding source for the generator, browser client, shared normalizer, and read-only Worker source is included in this preview under <a href="../source/">./source/</a>.</p><p><a href="../source/LICENSE">Read GPL-3.0-or-later</a> · <a href="https://www.gnu.org/licenses/gpl-3.0.html" rel="noopener">Canonical GNU license text ↗</a></p></section><section><h2>Original words &amp; abstract art</h2><p>Original guide wording and original SVG mountain/lantern composition: CC0 1.0 Universal. See <a href="../source/CC0.txt">the CC0 dedication</a>.</p></section><section><h2>Third-party public schedule content</h2><p>Event titles, place names, tags, dates, and source listings remain the content of their respective source owners. No third-party photos, official logos, attendee data, notes, meeting links, or precise coordinates are republished. Source licensing is not relicensed as CC0 or GPL.</p></section><section id="photo-sources"><h2>Hero photographs</h2><p>The first-page decorative shuffle uses sixteen resized derivatives (480/960/1440px WebP) of professional photographs from the 4Seas.org album of Nomad Market #1 and the ETH Chiang Mai 2025 season at 4Seas, Chiang Mai (22 and 28 October 2026). Photographer credit: <strong>4Seas / Zuzalu Chiang Mai</strong>, shared by Shaka Lei Kaumaka and used with permission on 14 November 2026. These photographs are <strong>© 4Seas.org — used with permission</strong>; they are <em>not</em> covered by this site's CC0 or GPL dedications and may not be reused without 4Seas.org's permission. Likeness rights remain with the people pictured; the same corrections and takedown path applies.</p><ul>${photoCredits}</ul></section><section><h2>Corrections &amp; takedown</h2><p>Use the <a href="https://github.com/zuchiangmai" rel="noopener">Zu Chiang Mai community’s public GitHub channel ↗</a> to find its current contact route, and consult the linked official event source for event corrections.</p></section><p><small>Snapshot generated ${schedule.generated_at}</small></p><script src="https://live.zuchiangmai.app/widget.js" async></script></body></html>`;
  await writeFile(path.join(output, "licenses/index.html"), licenseHtml);

  // Publish corresponding first-party source, never raw upstream payloads or tests.
  const sourceOut = path.join(output, "source");
  await rm(sourceOut, { recursive: true, force: true });
  await mkdir(sourceOut, { recursive: true });
  for (const entry of ["build.mjs", "wrangler.jsonc", "README.md", "PIT-HOOK.md", "LICENSE", "CC0.txt", "lib", "client", "worker", "data"]) {
    const source = path.join(root, entry);
    if (existsSync(source)) await cp(source, path.join(sourceOut, entry), { recursive: true });
  }
  await writeFile(path.join(sourceOut, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Preview source</title><style>body{max-width:800px;margin:40px auto;padding:0 20px;background:#102f35;color:#f3eddd;font:16px/1.65 system-ui}a{color:#f4c876}li{margin:9px}</style></head><body><a href="../licenses/">← Licenses</a><h1>Corresponding preview source</h1><p>GPL-3.0-or-later code; original words/art CC0. Third-party schedule content is not under those dedications.</p><ul><li><a href="./README.md">Build &amp; maintenance notes</a></li><li><a href="./PIT-HOOK.md">In-app PIT integration contract</a></li><li><a href="./build.mjs">Static generator</a></li><li><a href="./lib/schedule.mjs">Shared public-data normalizer</a></li><li><a href="./lib/templates.mjs">No-JS HTML renderer</a></li><li><a href="./lib/ics.mjs">Individual calendar generator</a></li><li><a href="./data/program-milestones.json">Reviewed programme milestone data</a></li><li><a href="./data/hero-photos.json">Hero photo provenance</a></li><li><a href="../app.js">Browser client</a></li><li><a href="../styles.css">Preview styles</a></li><li><a href="./worker/worker.js">Read-only Worker source</a></li><li><a href="./wrangler.jsonc">Wrangler configuration</a></li><li><a href="./LICENSE">GPL license</a> · <a href="./CC0.txt">CC0 dedication</a></li></ul><script src="https://live.zuchiangmai.app/widget.js" async></script></body></html>`);
  console.log(JSON.stringify({
    output,
    generated_at: schedule.generated_at,
    events: schedule.counts,
    duplicates: schedule.duplicates.map((item) => item.event_keys),
    eth_federation: { same_rows: sameFederatedRows, same_etag: sameEtag, browse_count: ethBrowseIds.length },
    four_calendar_vevents: verifications[0].vevent_count,
    eth_website: verifications[2],
    pit_preserved: existsSync(path.join(output, "pit")),
    programs: { milestones: programs.milestones.length, snapshot_at: programs.snapshot_at, disagreements: programs.disagreements.length },
    files: schedule.events.length + 11 + (heroPhotos.length * 2),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
