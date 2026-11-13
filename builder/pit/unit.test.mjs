import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { sanitizeManifest } from "./build.mjs";
import { renderPage } from "./template.mjs";

const source = JSON.parse(await readFile("/workspace/new-doors-scope/zu-pit-research/manifest.json", "utf8"));
const clone = () => JSON.parse(JSON.stringify(source));

test("reviewed manifest preserves all real counts and 29 records", () => {
  const result = sanitizeManifest(clone(), []);
  assert.equal(result.sessions.length, 29);
  assert.equal(result.counts.startHere, 10);
  assert.deepEqual(result.counts.byType, { music: 8, knowledge: 11, community: 9, tutorial: 1 });
  assert.deepEqual(result.counts.byPhase, { 1: 13, 2: 5, 3: 11 });
  assert.equal(result.counts.searchChunks, 12440);
  assert.equal(result.counts.searchIndexedSessions, 28);
  assert.equal(result.counts.sparseTimestampedTranscripts, 6);
  assert.equal(result.counts.filesWithoutTimestampedText, 1);
  assert.equal(result.counts.remoteMediaBytes, 1535154157);
  assert.equal(result.counts.copiedMediaBytes, 0);
  assert.equal(result.sessions.filter((session) => session.sourcePreview === "dead").length, 3);
  assert.equal(result.sessions.filter((session) => session.captureGroup).length, 6);
});

test("sanitization and rendering are deterministic", () => {
  const first = sanitizeManifest(clone(), []);
  const second = sanitizeManifest(clone(), []);
  assert.deepEqual(first, second);
  assert.equal(renderPage(first), renderPage(second));
  assert.equal((renderPage(first).match(/data-recording data-id=/g) || []).length, 29);
  assert.equal((renderPage(first).match(/class="start-number"/g) || []).length, 10);
  assert.match(renderPage(first), /noindex,nofollow,noarchive/);
  assert.match(renderPage(first), /href="\.\.\/#agenda"/);
});

test("unknown source IDs fail closed", () => {
  const input = clone();
  input.sessions[0].id = "unreviewed-new-session";
  assert.throws(() => sanitizeManifest(input, []), /unknown, missing, or unreviewed/);
});

test("unexpected/private-shaped fields and email strings fail closed", () => {
  for (const mutate of [
    (input) => { input.sessions[0].attendees = ["not allowed"]; },
    (input) => { input.sessions[0].transcriptText = "not vendored"; },
    (input) => { input.sessions[0].summary = "contact person@example.com"; },
    (input) => { input.newUnreviewedField = true; },
  ]) {
    const input = clone(); mutate(input);
    assert.throws(() => sanitizeManifest(input, []), /PIT manifest refused/);
  }
});

test("media/transcript/poster/source hosts are allowlisted", () => {
  for (const key of ["mediaUrl", "transcriptUrl", "poster", "sourceUrl"]) {
    const input = clone(); input.sessions[0][key] = "https://example.com/private";
    assert.throws(() => sanitizeManifest(input, []), /unapproved URL|media ID\/URL mismatch/);
  }
});

test("reviewed counts and Vitalik media/session distinction fail closed", () => {
  let input = clone(); input.sessions[0].durationSeconds += 1;
  assert.throws(() => sanitizeManifest(input, []), /duration mismatch/);
  input = clone(); input.sessions[28].mediaBytes = input.sessions[28].sourceDeclaredMediaBytes;
  assert.throws(() => sanitizeManifest(input, []), /Vitalik session\/media provenance changed/);
});

test("denylist removes card, pointers, route and counts before output", () => {
  const id = source.sessions[0].id;
  const result = sanitizeManifest(clone(), [id]);
  assert.equal(result.sessions.length, 28);
  assert.equal(result.counts.denylistedSessions, 1);
  assert.equal(result.sessions.some((session) => session.id === id), false);
  const html = renderPage(result);
  assert.equal(html.includes(`data-id="${id}"`), false);
  assert.equal(html.includes(source.sessions[0].mediaUrl), false);
  assert.equal(html.includes(source.sessions[0].transcriptUrl), false);
  assert.equal(html.includes(source.sessions[0].poster), false);
});

test("transcript truth, dead previews, capture groups and no-JS audio render", () => {
  const html = renderPage(sanitizeManifest(clone(), []));
  assert.match(html, /Transcript file · no timestamped text/);
  assert.equal((html.match(/Source video preview pending/g) || []).length, 3);
  assert.equal((html.match(/Alternate capture — kept separate/g) || []).length, 6);
  assert.equal((html.match(/<audio controls preload="none"/g) || []).length, 29);
  assert.match(html, /Session ID ≠ media ID/);
  assert.match(html, /12,440 chunks over 28 recordings/);
});

test("canonical consent, takedown and positional-search routes are pinned", () => {
  for (const mutate of [
    (input) => { input.rights.takedown = "https://example.com/remove"; },
    (input) => { input.sources.catalog.url = "https://example.com/catalog.json"; },
    (input) => { input.sources.searchIndex.url = "javascript:alert(1)"; },
  ]) {
    const input = clone(); mutate(input);
    assert.throws(() => sanitizeManifest(input, []), /routes changed/);
  }
});

test("an upstream-disappeared ID requires and accepts an explicit denylist entry", () => {
  const id = source.sessions[0].id;
  const input = clone(); input.sessions.shift();
  assert.throws(() => sanitizeManifest(input, []), /missing reviewed ID/);
  const result = sanitizeManifest(input, [id]);
  assert.equal(result.sessions.length, 28);
  assert.equal(result.sessions.some((session) => session.id === id), false);
  assert.deepEqual(result.selection.localDenylist, [id]);
});
