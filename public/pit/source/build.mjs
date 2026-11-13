import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderPage } from "./template.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const RESEARCH_MANIFEST = "/workspace/new-doors-scope/zu-pit-research/manifest.json";
const EXPECTED_IDS = Object.freeze([
  "1ENnx6z5rKez3d_AmB8Ych9Nz2vj2LkBj", "1GjVxbNsCYs4N091LCk6f3dNP8Wzg54Dx",
  "18nyCniuewAlYXevRiFojuc5s_VcnyGdA", "1JivZiM76yBwcvdwtugKiXJGnPy55VabU",
  "1qxAmLFH6ZrZYW-NdBT94F4BCpOuzNw0u", "1s74JXt4Hd0ZggS664z6ASWBfTeOgKOaI",
  "1sdsBLqYBuyqmIbd_c1UB9B1x8rtdooAb", "1Ln--o_12zGDkPpLHHWjn63ZoIJaxwjnf",
  "1pVqTM-h1c_yhG-gUuAKai0vdhFEGYfIS", "1jjF_qproMIJy5cfbkrSdQ5kqJ1DsEuos",
  "1qTN-ZdKvvK_prl-FOt3lksoWreqjtbjb", "1v8SFR4UJTyKSsH7ximZoF1c8uqZ0viBR",
  "1UipOhDNKN2NkM6gICQV0-QsSqIyaSOt2", "1ulwW2HGb4maeNCg27iSlc7AbkIIuHc2e",
  "1OoAbVHEvdp1UPVDzDegMV7CmmgKncXuM", "1LWmhT68dELJggunbvZUx1wRaQmFysEpp",
  "1EGdyD1RdJSKx65-F02t-WRShn2x-r4iP", "1bCOganv1iUdFQxnAl-XJd4VAIKy03Kbx",
  "10aMMkblnCUxQFb69mZo_bHGvmAZRG2CO", "1fMucChc-fLtKl_74kmvarky4UG296rJe",
  "1moS9mQJ7HSGUnZlzCqRCFVzs0CAJswnA", "1_OU0RoVV2YpGr1nyNmc9tk7N7Py_UJ3H",
  "1uQ05uxrAawPTYfpjmoGatd27YpUpUg0K", "1p6wg2GM9hrEi-tncpzaUMMR6jnlZyrRt",
  "1p-tDp5UtDS46YmgbEYf77g_yUEG0X3eg", "1zIFeF54BXdHZ41SGmJuZx80p3VDGgSuq",
  "1I4ZPRlhrIzcIKVK6EjiRRG8X9kyZywi7", "16ni7_A3mf4zDK5iDruUDqc6lWBIIuOaf",
  "1tBw0NJYvuoT9wObiOw4hVetvat25l2kI",
]);
const TOP_KEYS = new Set(["spec", "basedOn", "pit", "generatedAt", "counts", "selection", "sources", "contextSources", "rights", "runtime", "sessions"]);
const SESSION_KEYS = new Set(["id", "type", "title", "date", "duration", "durationSeconds", "summary", "sourceUrl", "mediaUrl", "transcriptUrl", "poster", "credits", "topics", "sourceTimestamps", "phase", "shelf", "startHere", "featuredInSource", "originalMediaKind", "mediaType", "mediaBytes", "mediaETag", "mediaRangeSupported", "mediaCrossOriginJsReadable", "sourcePreview", "sourceQuality", "sourceNote", "sourceMediaId", "sourceDeclaredMediaBytes", "transcriptStatus", "transcriptTimestampCount", "transcriptBytes", "transcriptLastModified", "syncAvailable", "searchChunkCount", "sourceCatalogIndex", "languages", "captureGroup", "captureNote"]);
const FORBIDDEN_KEYS = /^(owner|owners|attendee|attendees|participant|participants|guest|guests|email|emails|notes_private|private|drive_folder|registry|cname|transcript|transcriptText)$/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const MEDIA_HOST = "pub-3d88701638314a20ad2241ee26e6824f.r2.dev";
const PHASES = { 1: "Opening & Unconference", 2: "Bootcamp & Tuesdays", 3: "Hackathon & Summit" };
const TYPES = new Set(["knowledge", "community", "music", "tutorial"]);
const STATUSES = new Set(["timestamped-text", "sparse-timestamped-text", "file-no-timestamped-text"]);
const DEAD = new Set(["1sdsBLqYBuyqmIbd_c1UB9B1x8rtdooAb", "1bCOganv1iUdFQxnAl-XJd4VAIKy03Kbx", "1zIFeF54BXdHZ41SGmJuZx80p3VDGgSuq"]);
const VITALIK = "1tBw0NJYvuoT9wObiOw4hVetvat25l2kI";
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function assert(condition, message) { if (!condition) throw new Error(`PIT manifest refused: ${message}`); }
function safeUrl(value, host, prefix = "") {
  assert(typeof value === "string", "URL must be a string");
  const parsed = new URL(value);
  assert(parsed.protocol === "https:" && parsed.hostname === host && parsed.pathname.startsWith(prefix), `unapproved URL ${value}`);
  assert(!parsed.username && !parsed.password && !parsed.search && !parsed.hash, `URL must be plain and public ${value}`);
  return value;
}
function scanStrings(value, pathName = "root") {
  if (typeof value === "string") assert(!EMAIL.test(value), `email-shaped text at ${pathName}`);
  else if (Array.isArray(value)) value.forEach((entry, index) => scanStrings(entry, `${pathName}[${index}]`));
  else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
    assert(!FORBIDDEN_KEYS.test(key), `forbidden/unreviewed field ${pathName}.${key}`);
    scanStrings(entry, `${pathName}.${key}`);
  }
}
function countBy(items, key) {
  return Object.fromEntries([...new Set(items.map(key))].map((value) => [value, items.filter((item) => key(item) === value).length]));
}

export function sanitizeManifest(input, denylist = []) {
  assert(input && typeof input === "object" && !Array.isArray(input), "top-level object required");
  assert(Object.keys(input).every((key) => TOP_KEYS.has(key)), "unknown top-level field");
  assert(input.spec === "zu-pit-public-manifest/0.1" && input.basedOn === "pit-manifest/0.1", "unexpected schema");
  assert(input.pit?.generation === 3 && input.pit?.forked_from === "https://github.com/shakaleikaumaka/4seaspit", "generation/fork identity changed");
  assert(input.pit?.mount === "/pit/", "in-app mount changed");
  assert(!("registry" in input.pit) && !("cname" in input.pit), "standalone registry/CNAME is forbidden");
  assert(Array.isArray(input.sessions) && Array.isArray(denylist), "sessions and denylist must be arrays");
  assert(new Set(denylist).size === denylist.length && denylist.every((id) => EXPECTED_IDS.includes(id)), "invalid denylist");
  assert(input.rights?.consentPolicy === "https://publicinform.com/#consent" && input.rights?.takedown === "https://opensourceorchestra.org/takedown/", "consent/takedown routes changed");
  assert(input.sources?.catalog?.url === "https://4seaspit.com/data/catalog.json" && input.sources?.searchIndex?.url === "https://4seaspit.com/data/search-index.json", "deep-search source routes changed");
  assert(input.sources?.manifest?.url === "https://4seaspit.com/pit.json" && input.sources?.repository?.url === "https://github.com/shakaleikaumaka/4seaspit", "canonical source routes changed");
  const ids = input.sessions.map((session) => session?.id);
  assert(new Set(ids).size === ids.length, "duplicate session IDs");
  assert(ids.every((id) => EXPECTED_IDS.includes(id)), "unknown, missing, or unreviewed source session");
  assert(EXPECTED_IDS.every((id) => ids.includes(id) || denylist.includes(id)), "a missing reviewed ID must be explicitly denylisted before omission");
  scanStrings(input);

  const sessions = input.sessions.map((source, index) => {
    assert(source && typeof source === "object" && Object.keys(source).every((key) => SESSION_KEYS.has(key)), `unreviewed session field at ${source?.id || index}`);
    assert(source.id === EXPECTED_IDS.find((id) => id === source.id), "invalid ID");
    assert(TYPES.has(source.type) && TYPES.has(source.shelf) || source.shelf === "practical" && source.type === "tutorial", `bad type/shelf ${source.id}`);
    assert(typeof source.title === "string" && source.title.length > 0 && source.title.length < 300, `bad title ${source.id}`);
    assert(/^202[5-6]-\d{2}-\d{2}$/.test(source.date), `bad archival date ${source.id}`);
    assert(/^\d{2}:\d{2}:\d{2}$/.test(source.duration) && Number.isInteger(source.durationSeconds) && source.durationSeconds > 0, `bad duration ${source.id}`);
    const durationParts = source.duration.split(":").map(Number);
    assert(durationParts[0] * 3600 + durationParts[1] * 60 + durationParts[2] === source.durationSeconds, `duration mismatch ${source.id}`);
    assert(typeof source.summary === "string" && source.summary.length > 0 && source.summary.length < 1000, `bad summary ${source.id}`);
    assert(Array.isArray(source.topics) && source.topics.every((topic) => typeof topic === "string" && topic.length < 100), `bad topics ${source.id}`);
    assert(source.phase?.label === PHASES[source.phase?.id], `bad phase ${source.id}`);
    assert(typeof source.startHere === "boolean" && typeof source.featuredInSource === "boolean", `bad flags ${source.id}`);
    safeUrl(source.mediaUrl, MEDIA_HOST, "/audio/");
    assert(source.mediaUrl.endsWith(`/${source.sourceMediaId}.mp3`), `media ID/URL mismatch ${source.id}`);
    safeUrl(source.transcriptUrl, "4seaspit.com", "/transcripts/");
    safeUrl(source.poster, "4seaspit.com", "/thumbs/");
    safeUrl(source.sourceUrl, "drive.google.com", "/file/d/");
    assert(source.mediaType === "audio/mpeg" && source.mediaRangeSupported === true && source.mediaCrossOriginJsReadable === false, `media delivery facts changed ${source.id}`);
    assert(Number.isInteger(source.mediaBytes) && source.mediaBytes > 0, `bad actual media bytes ${source.id}`);
    assert(STATUSES.has(source.transcriptStatus) && Number.isInteger(source.transcriptTimestampCount) && Number.isInteger(source.searchChunkCount), `bad transcript facts ${source.id}`);
    assert(source.syncAvailable === (source.transcriptStatus !== "file-no-timestamped-text"), `sync flag mismatch ${source.id}`);
    assert((source.transcriptTimestampCount > 0) === source.syncAvailable, `timestamp count mismatch ${source.id}`);
    assert(source.transcriptStatus !== "sparse-timestamped-text" || source.transcriptTimestampCount < 10, `sparse rule mismatch ${source.id}`);
    assert((source.searchChunkCount > 0) === source.syncAvailable, `search/transcript disagreement ${source.id}`);
    assert(source.sourcePreview === "dead" || source.sourcePreview === "not-flagged-dead", `bad preview state ${source.id}`);
    assert((source.sourcePreview === "dead") === DEAD.has(source.id), `dead-preview set changed ${source.id}`);
    assert(source.credits?.archive === "The 4SeasPIT · ETHChiangmai × 4Seas" && typeof source.credits?.poster === "string", `credits missing ${source.id}`);
    assert(Array.isArray(source.credits?.speakers) && source.credits.speakers.every((speaker) => typeof speaker === "string"), `source speakers invalid ${source.id}`);
    if (source.captureGroup) assert(typeof source.captureNote === "string" && source.captureNote.length > 10, `capture explanation missing ${source.id}`);
    return JSON.parse(JSON.stringify(source));
  });
  const vitalik = sessions.find((session) => session.id === VITALIK);
  assert(vitalik.sourceMediaId === "1HdGdG25ai1JmD2M-mbWlaS3UgAb1dBwF" && vitalik.mediaBytes === 74210193 && vitalik.sourceDeclaredMediaBytes === 208942362, "Vitalik session/media provenance changed");
  const captureCounts = countBy(sessions.filter((session) => session.captureGroup), (session) => session.captureGroup);
  assert(Object.keys(captureCounts).length === 3 && Object.values(captureCounts).every((count) => count === 2), "three alternate-capture pairs must remain");

  const denied = new Set(denylist);
  const included = sessions.filter((session) => !denied.has(session.id));
  const seconds = included.reduce((sum, session) => sum + session.durationSeconds, 0);
  const byType = countBy(included, (session) => session.type);
  const byPhase = Object.fromEntries(Object.keys(PHASES).map((phase) => [phase, included.filter((session) => session.phase.id === Number(phase)).length]));
  const counts = {
    sourceSessions: sessions.length,
    includedSessions: included.length,
    excludedSourceSessions: input.counts.excludedSourceSessions,
    denylistedSessions: sessions.length - included.length,
    startHere: included.filter((session) => session.startHere).length,
    transcriptFiles: included.length,
    timestampedTranscripts: included.filter((session) => session.syncAvailable).length,
    sparseTimestampedTranscripts: included.filter((session) => session.transcriptStatus === "sparse-timestamped-text").length,
    filesWithoutTimestampedText: included.filter((session) => !session.syncAvailable).length,
    searchIndexedSessions: included.filter((session) => session.searchChunkCount > 0).length,
    searchChunks: included.reduce((sum, session) => sum + session.searchChunkCount, 0),
    seconds,
    hours: Math.round(seconds / 360) / 10,
    remoteMediaBytes: included.reduce((sum, session) => sum + session.mediaBytes, 0),
    copiedMediaBytes: 0,
    byType,
    byPhase,
  };
  if (denied.size === 0) {
    assert(counts.includedSessions === 29 && counts.startHere === 10, "reviewed 29/10 counts changed");
    assert(byType.knowledge === 11 && byType.community === 9 && byType.music === 8 && byType.tutorial === 1, "11/9/8/1 type counts changed");
    assert(byPhase[1] === 13 && byPhase[2] === 5 && byPhase[3] === 11, "13/5/11 phase counts changed");
    assert(counts.timestampedTranscripts === 28 && counts.sparseTimestampedTranscripts === 6 && counts.filesWithoutTimestampedText === 1, "28/6/1 transcript counts changed");
    assert(counts.searchIndexedSessions === 28 && counts.searchChunks === 12440, "12,440 chunks over 28 sessions changed");
    assert(counts.seconds === 191878 && counts.hours === 53.3 && counts.remoteMediaBytes === 1535154157, "duration/remote byte counts changed");
    for (const [key, value] of Object.entries(counts)) if (key in input.counts && !["byType", "byPhase"].includes(key)) assert(input.counts[key] === value, `source count ${key} disagrees`);
  }
  const output = {
    spec: input.spec, basedOn: input.basedOn,
    pit: { ...input.pit, status: "reviewed in-app preview; noindex; not deployed to zuchiangmai.app" },
    generatedAt: input.generatedAt,
    counts,
    selection: { ...input.selection, notPromotedToStartHere: included.length - counts.startHere, localDenylist: [...denylistedSorted(denylist)] },
    sources: input.sources, contextSources: input.contextSources, rights: input.rights, runtime: input.runtime,
    sessions: included,
  };
  assert(output.counts.copiedMediaBytes === 0, "media copies forbidden");
  return output;
}
function denylistedSorted(list) { return [...list].sort(); }

async function main() {
  const output = process.argv[2] ? path.resolve(process.argv[2]) : "/shared/public/zu-chiangmai/pit";
  const input = JSON.parse(await readFile(RESEARCH_MANIFEST, "utf8"));
  const denylist = JSON.parse(await readFile(path.join(root, "denylist.json"), "utf8"));
  const manifest = sanitizeManifest(input, denylist);
  const [app, styles, license, readme] = await Promise.all([
    readFile(path.join(root, "client/app.js"), "utf8"), readFile(path.join(root, "client/styles.css"), "utf8"),
    readFile(path.join(root, "../LICENSE"), "utf8"), readFile(path.join(root, "README.md"), "utf8"),
  ]);
  const cc0 = await readFile(path.join(root, "CC0.txt"), "utf8");
  await mkdir(path.join(output, "source"), { recursive: true });
  const files = {
    "index.html": renderPage(manifest), "manifest.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "app.js": app, "styles.css": styles, "README.md": readme, "LICENSE.txt": license, "CC0.txt": cc0,
    "licenses.html": renderLicenses(manifest), "robots.txt": "User-agent: *\nDisallow: /\n",
    "source/build.mjs": await readFile(path.join(root, "build.mjs"), "utf8"),
    "source/template.mjs": await readFile(path.join(root, "template.mjs"), "utf8"),
    "source/app.js": app, "source/styles.css": styles, "source/denylist.json": `${JSON.stringify(denylist, null, 2)}\n`,
    "source/README.md": readme, "source/LICENSE.txt": license, "source/CC0.txt": cc0,
  };
  await Promise.all(Object.entries(files).map(([name, body]) => writeFile(path.join(output, name), body)));
  console.log(JSON.stringify({ output, counts: manifest.counts, files: Object.keys(files).length, mediaBytesCopied: 0 }, null, 2));
}
function renderLicenses(manifest) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><title>Licenses & care — ZuChiangMai PIT</title><link rel="stylesheet" href="./styles.css"></head><body><main class="legal"><p><a href="./">← Back to the PIT</a> · <a href="../#agenda">Agenda</a></p><h1>Licenses & care</h1><section><h2>Original module code</h2><p>GPL-3.0-or-later. <a href="./LICENSE.txt">Read the license</a>. Corresponding generator and browser source are included under <a href="./source/README.md">./source/</a>.</p></section><section><h2>Original words & abstract lantern/ridge art</h2><p>CC0 1.0 Universal; see <a href="./CC0.txt">the dedication</a>. This applies only to new module wording and original abstract art.</p></section><section><h2>Third-party recordings, words & images</h2><p>${esc(manifest.rights.thirdPartyMedia)} The upstream declaration is <strong>${esc(manifest.rights.upstreamDeclaration)}</strong>, but it does not clear third-party rights. Source recordings, machine transcripts, titles, credits, performances and posters retain their existing source rights. No blanket CC0 claim is made for them.</p><p>${esc(manifest.rights.consentBasis)}</p></section><section><h2>Consent & takedown</h2><p><a href="${esc(manifest.rights.consentPolicy)}" rel="noopener noreferrer">Public consent protocol ↗</a> · <a href="${esc(manifest.rights.takedown)}" rel="noopener noreferrer">Takedown first ↗</a></p><p>${esc(manifest.rights.removalRequirement)}</p></section><p><small>Reviewed source snapshot: ${esc(manifest.generatedAt)}. Memory archive, not a current-events schedule.</small></p></main></body></html>`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
