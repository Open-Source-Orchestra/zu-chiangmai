// Hero regression test (9 checks): node hero-test.mjs <base-url> <out-dir> <label>
// Needs Playwright (globally installed) + axe-core: set AXE_PATH if axe.min.js lives elsewhere.
import { chromium } from "/usr/lib/node_modules/playwright/index.mjs";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const [base, out, label] = process.argv.slice(2);
const axeSource = await readFile(process.env.AXE_PATH || "/workspace/hash-cafe-test-tools/node_modules/axe-core/axe.min.js", "utf8");
const results = { base, label, checks: [], console_errors: [], page_errors: [], http_errors: [], external: [], photo_sequence: [], axe: [] };
const check = (s) => { results.checks.push(s); console.log("PASS", s); };
async function axe(page, name) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })));
  results.axe.push({ name, violations });
  assert.equal(violations.length, 0, JSON.stringify(violations));
}
const EXPECT_IDS = ["market-hall", "stage-set", "nomad-stair", "nomad-flyer", "peace-signs", "stage-intro", "stage-laugh", "stage-host", "mic-builder", "mic-pitch", "mic-smile", "window-light", "red-curtain", "hands-on-hips", "session", "lounge-laptops"];
const browser = await chromium.launch({ headless: true });
try {
  const wire = (page) => {
    page.on("console", (m) => { if (m.type() === "error") results.console_errors.push(m.text()); });
    page.on("pageerror", (e) => results.page_errors.push(e.message));
    page.on("response", (r) => { if (r.status() >= 400) results.http_errors.push({ status: r.status(), url: r.url() }); });
    page.on("request", (r) => { if (!r.url().startsWith(base) && !r.url().startsWith("data:")) results.external.push(r.url()); });
  };
  // 1. mobile 390
  let context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Bangkok" });
  let page = await context.newPage(); wire(page);
  await page.goto(base, { waitUntil: "networkidle" });
  const expectedEvents = (await (await page.request.get(new URL("schedule.json", base).href)).json()).counts.events;
  assert.equal(await page.locator(".event-card").count(), expectedEvents);
  assert.equal(await page.locator(".milestone-card").count(), 16);
  const ids = await page.evaluate(() => JSON.parse(document.querySelector("#photo-data").textContent).map((p) => p.id));
  assert.deepEqual(ids, EXPECT_IDS);
  assert.equal(await page.locator("[data-photo-hero]").getAttribute("data-photo-id"), "market-hall");
  assert.equal(await page.locator("[data-photo-frame]").count(), 2);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.match(await page.locator("[data-photo-link] small").innerText(), /4SEAS\.ORG · USED WITH PERMISSION/);
  check(`mobile: ${expectedEvents} cards + 16 milestones; 16 new hero ids; market-hall first; permission caption; no overflow`);
  // all 48 derivatives reachable
  for (const id of EXPECT_IDS) for (const size of [480, 960, 1440]) {
    const r = await page.request.get(new URL(`photos/${id}-${size}.webp`, base).href);
    assert.equal(r.status(), 200, `${id}-${size}`); if (label !== "local") assert.match(r.headers()["content-type"] || "", /image\/webp/); else assert.ok(Number(r.headers()["content-length"]) > 4000, `${id}-${size} size`);
  }
  check(label === "local" ? "48 derivatives HTTP 200 (local python server has no webp mimetype; size checked)" : "48 derivatives HTTP 200 image/webp");
  await axe(page, `${label}-mobile`);
  await page.screenshot({ path: `${out}/${label}-mobile-390x844.png` });
  // shuffle progresses and uses only new ids
  const seen = new Set([await page.locator("[data-photo-hero]").getAttribute("data-photo-id")]);
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(2600); seen.add(await page.locator("[data-photo-hero]").getAttribute("data-photo-id")); }
  results.photo_sequence = [...seen];
  assert.ok(seen.size >= 3, `shuffle progressed: ${[...seen]}`);
  for (const id of seen) assert.ok(EXPECT_IDS.includes(id), id);
  const srcset = await page.locator("[data-photo-frame].is-active").getAttribute("srcset");
  assert.match(srcset, /1440w/);
  check(`shuffle progressed through ${seen.size} photos, srcset includes 1440w`);
  await page.locator("[data-photo-toggle]").click();
  assert.equal(await page.locator("[data-photo-toggle]").getAttribute("aria-pressed"), "true");
  const frozen = await page.locator("[data-photo-hero]").getAttribute("data-photo-id");
  await page.waitForTimeout(3000);
  assert.equal(await page.locator("[data-photo-hero]").getAttribute("data-photo-id"), frozen);
  check("pause control freezes the shuffle");
  await context.close();
  // 2. desktop 1280
  context = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Asia/Bangkok" });
  page = await context.newPage(); wire(page);
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const bg = await page.locator("[data-photo-bg].is-active").evaluate((e) => e.style.backgroundImage);
  assert.match(bg, /market-hall-1440\.webp/);
  await axe(page, `${label}-desktop`);
  await page.screenshot({ path: `${out}/${label}-desktop-1280x800.png` });
  check("desktop: backdrop uses 1440 derivative, axe clean, no overflow");
  const lic = await page.goto(new URL("licenses/#photo-sources", base).href, { waitUntil: "networkidle" });
  assert.equal(lic.status(), 200);
  const licText = await page.locator("#photo-sources").innerText();
  assert.match(licText, /© 4Seas\.org — used with permission/); assert.match(licText, /4Seas \/ Zuzalu Chiang Mai/);
  assert.equal(await page.locator("#photo-sources li").count(), 16);
  assert.match(licText, /not.*covered by this site's CC0 or GPL dedications/);
  check("licenses: 16 credit lines, © 4Seas.org used with permission, explicitly excluded from CC0/GPL");
  await context.close();
  // 3. no-JS mobile
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  page = await context.newPage(); wire(page);
  await page.goto(base, { waitUntil: "load" });
  assert.equal(await page.locator(".event-card").count(), expectedEvents);
  const src = await page.locator("[data-photo-frame].is-active").getAttribute("src");
  assert.match(src, /market-hall-960\.webp/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/${label}-nojs-390x844.png` });
  check("no-JS: full agenda + static market-hall fallback, no overflow");
  await context.close();
  // 4. reduced motion
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  page = await context.newPage(); wire(page);
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  assert.equal(await page.locator("[data-photo-hero]").getAttribute("data-photo-id"), "market-hall");
  assert.equal(await page.locator("[data-photo-toggle]").isHidden(), true);
  check("reduced motion: static market-hall, toggle hidden");
  await context.close();
  assert.deepEqual(results.console_errors, []); assert.deepEqual(results.page_errors, []); assert.deepEqual(results.http_errors, []);
  const ext = results.external.filter((u) => !u.includes("zu-chiangmai-schedule.shakaverse.workers.dev"));
  assert.deepEqual(ext, []);
  check("zero console/page/HTTP errors; no external runtime except the schedule Worker");
  results.status = "PASS";
} catch (e) { results.status = "FAIL"; results.error = String(e); console.error("FAIL", e); process.exitCode = 1; }
finally { await browser.close(); await writeFile(`${out}/${label}-results.json`, JSON.stringify(results, null, 2)); console.log(`${results.status} ${results.checks.length} checks`); }
