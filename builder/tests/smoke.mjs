// Production smoke test (agenda-agnostic): node smoke.mjs <base-url> <out-dir>
// Generalised from the 13 Nov production-smoke.mjs so it keeps passing while the agenda changes daily:
// the search term and the ICS file are taken from the live schedule.json instead of hard-coded titles.
import { chromium } from "/usr/lib/node_modules/playwright/index.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const [base = "https://zuchiangmai.app/", out = "./.test-out"] = process.argv.slice(2);
await mkdir(out, { recursive: true });
const axeSource = await readFile(process.env.AXE_PATH || "/workspace/hash-cafe-test-tools/node_modules/axe-core/axe.min.js", "utf8");
const results = { base, checks: [], console_errors: [], page_errors: [], http_errors: [], external: [], axe: [] };
const check = (name) => { results.checks.push(name); console.log("PASS", name); };
async function axe(page, name) {
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } })).violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })));
  results.axe.push({ name, violations });
  assert.equal(violations.length, 0, JSON.stringify(violations));
}
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Bangkok" });
  const page = await context.newPage();
  page.on("console", (m) => { if (m.type() === "error") results.console_errors.push(m.text()); });
  page.on("pageerror", (e) => results.page_errors.push(e.message));
  page.on("response", (r) => { if (r.status() >= 400) results.http_errors.push({ status: r.status(), url: r.url() }); });
  page.on("request", (r) => { if (!r.url().startsWith(base)) results.external.push(r.url()); });
  const scheduleResponse = await page.request.get(new URL("schedule.json", base).href);
  assert.equal(scheduleResponse.status(), 200);
  const schedule = await scheduleResponse.json();
  const expectedEvents = schedule.counts.events;
  assert.ok(expectedEvents > 0);
  await page.goto(base, { waitUntil: "networkidle" });
  assert.match(await page.title(), /ZU \/ CHIANG MAI/);
  assert.equal(await page.locator(".event-card").count(), expectedEvents);
  assert.equal(await page.locator(".milestone-card").count(), 16);
  assert.equal(await page.locator(".clock-unconfirmed").count(), 4);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  check(`production mobile: ${expectedEvents} agenda cards + 16 milestones + no overflow`);
  await axe(page, "production-main-mobile");
  // Search with a real title from today's agenda, then clear.
  const probe = schedule.events[0].title;
  await page.locator("#search").fill(probe);
  const hits = await page.locator(".event-card:visible").count();
  assert.ok(hits >= 1 && hits < expectedEvents, `search "${probe}" → ${hits}`);
  await page.locator("#clear-search").click();
  await page.locator("[data-detail]").first().click();
  assert.equal(await page.locator("#event-dialog").isVisible(), true);
  await page.keyboard.press("Escape");
  check("production search, clear, dialog and Escape");
  await page.locator("#refresh-button").click();
  await page.waitForFunction(() => document.querySelector("#connection-status").dataset.state === "live", null, { timeout: 30000 });
  assert.equal(await page.locator(".milestone-card").count(), 16);
  check("production first-party schedule refresh reaches LIVE and preserves milestone rail");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${out}/smoke-desktop-1280x800.png` });
  check("production desktop without overflow");

  const nojs = await browser.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto(base, { waitUntil: "networkidle" });
  assert.equal(await np.locator(".event-card").count(), expectedEvents);
  assert.equal(await np.locator(".milestone-card").count(), 16);
  assert.equal(await np.locator(".controls").isVisible(), false);
  check("production no-JS full agenda and milestones");
  await nojs.close();

  const pit = await context.newPage();
  pit.on("console", (m) => { if (m.type() === "error") results.console_errors.push(m.text()); });
  pit.on("pageerror", (e) => results.page_errors.push(e.message));
  pit.on("response", (r) => { if (r.status() >= 400) results.http_errors.push({ status: r.status(), url: r.url() }); });
  await pit.goto(new URL("pit/", base).href, { waitUntil: "networkidle" });
  assert.equal(await pit.locator("[data-recording]").count(), 29);
  assert.equal(await pit.locator(".start-grid > li").count(), 10);
  assert.equal(await pit.locator("iframe").count(), 0);
  assert.equal(await pit.locator("#native-audio").getAttribute("src"), null);
  assert.equal(await pit.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await axe(pit, "production-pit-mobile");
  check("production PIT: 29 recordings + 10 Start Here + no iframe/autoplay + no overflow");

  const first = schedule.events[0];
  const ics = await page.request.get(new URL(`ics/${first.source}-${first.id}.ics`, base).href);
  assert.equal(ics.status(), 200);
  assert.match(ics.headers()["content-type"] || "", /text\/calendar/);
  check("production individual calendar serves text/calendar");
  const notFound = await page.request.get(new URL("definitely-not-a-route/", base).href);
  assert.equal(notFound.status(), 404);
  check("production unknown route answers 404");
  assert.deepEqual(results.console_errors, []);
  assert.deepEqual(results.page_errors, []);
  assert.deepEqual(results.http_errors.filter((e) => !e.url.includes("definitely-not-a-route")), []);
  const externalOrigins = [...new Set(results.external.map((u) => new URL(u).origin))];
  assert.deepEqual(externalOrigins, ["https://zu-chiangmai-schedule.shakaverse.workers.dev"]);
  results.external_origins = externalOrigins;
  check("zero console/page errors; only the schedule-Worker external origin");
  results.status = "PASS";
} catch (e) {
  results.status = "FAIL"; results.error = String(e.stack || e); console.error("FAIL", e); process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(`${out}/smoke-results.json`, JSON.stringify(results, null, 2));
  console.log(`${results.status} ${results.checks.length} checks`);
}
