import { API_BASE, ENDPOINTS, buildSchedule, validateSchedule } from "../lib/schedule.mjs";

const SCHEDULE_CACHE = "https://zu-chiangmai-schedule.internal/v1/schedule";
const LAST_GOOD_CACHE = "https://zu-chiangmai-schedule.internal/last-good";
const MAX_AGE = 60;
let memoryLastGood = null;

function headers(contentType = "application/json; charset=utf-8") {
  return {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cache-Control": "no-store",
  };
}

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers(), ...extra } });
}

async function originFetch(url, accept, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { Accept: accept, "User-Agent": "ZuChiangMaiFieldGuide/1.0 (public read-only schedule proxy)" },
        signal: controller.signal,
        cf: { cacheTtl: 30, cacheEverything: true },
      });
      if (!response.ok) {
        const error = new Error(`Origin ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts && error.retryable !== false) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error("Origin unavailable");
}

async function fetchFreshSchedule() {
  // Fixed allowlist only: no request URL, query, or header can select an upstream.
  const [fourGroupResponse, fourEventsResponse, ethGroupResponse, ethCalendarResponse] = await Promise.all([
    originFetch(ENDPOINTS.fourGroup, "application/json"),
    originFetch(ENDPOINTS.fourEvents, "application/json"),
    originFetch(ENDPOINTS.ethGroup, "application/json"),
    originFetch(ENDPOINTS.ethCalendar, "text/calendar"),
  ]);
  const [fourGroup, fourPayload, ethGroup, ethIcs] = await Promise.all([
    fourGroupResponse.json(), fourEventsResponse.json(), ethGroupResponse.json(), ethCalendarResponse.text(),
  ]);
  if (!Array.isArray(fourPayload?.data) || fourPayload.data.length > 500) throw new Error("Invalid 4Seas event payload");
  const fetchedAt = new Date().toISOString();
  const schedule = buildSchedule({
    fourGroup,
    fourRows: fourPayload.data,
    ethGroup,
    ethIcs,
    fetchedAt,
    generatedAt: fetchedAt,
  });
  schedule.worker = { name: "zu-chiangmai-schedule", cache_seconds: MAX_AGE, origin_cache_seconds: 30, stale_last_good: true };
  return validateSchedule(schedule);
}

function cachedResponse(payload, lastGood = false) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      ...headers(),
      "Cache-Control": lastGood ? "public, max-age=604800" : `public, max-age=${MAX_AGE}, s-maxage=${MAX_AGE}`,
      "X-Zu-Cache": lastGood ? "LAST-GOOD-STORE" : "MISS",
    },
  });
}

async function staleLastGood(reason) {
  let candidate = memoryLastGood;
  if (!candidate) {
    const cached = await caches.default.match(LAST_GOOD_CACHE);
    if (cached) candidate = await cached.json();
  }
  if (!candidate) return null;
  const stale = {
    ...candidate,
    stale: true,
    stale_reason: "One or more fixed public origins were unavailable; this is the last good cached payload.",
    served_at: new Date().toISOString(),
  };
  return json(stale, 200, { "Cache-Control": "no-store", "X-Zu-Cache": "STALE-LAST-GOOD", Warning: '110 - "Response is stale"' });
}

async function scheduleResponse() {
  const cached = await caches.default.match(SCHEDULE_CACHE);
  if (cached) {
    const payload = await cached.json();
    const age = Date.now() - Date.parse(payload.generated_at);
    if (Number.isFinite(age) && age >= 0 && age <= MAX_AGE * 1000) {
      return json(payload, 200, { "Cache-Control": `public, max-age=${MAX_AGE}, s-maxage=${MAX_AGE}`, "X-Zu-Cache": "HIT" });
    }
    // Cache API behavior varies by platform; generated_at is the explicit freshness gate.
  }
  try {
    const schedule = await fetchFreshSchedule();
    memoryLastGood = schedule;
    const response = cachedResponse(schedule);
    const lastGood = cachedResponse(schedule, true);
    // These fixed keys prevent arbitrary-query cache growth. No KV, D1, or DO is required.
    await Promise.all([
      caches.default.put(SCHEDULE_CACHE, response.clone()),
      caches.default.put(LAST_GOOD_CACHE, lastGood),
    ]);
    return response;
  } catch (error) {
    const stale = await staleLastGood(error);
    if (stale) return stale;
    return json({ error: "Public schedule origins are temporarily unavailable", stale: true, served_at: new Date().toISOString() }, 503, { "Retry-After": "60", "X-Zu-Cache": "NO-LAST-GOOD" });
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers("text/plain; charset=utf-8") });
    if (!["GET", "HEAD"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET, HEAD, OPTIONS" });
    }
    if (url.search) return json({ error: "Query parameters are not accepted on this fixed public endpoint" }, 400);
    let response;
    if (url.pathname === "/health") {
      response = json({ status: "ok", service: "zu-chiangmai-schedule", read_only: true, upstream: API_BASE, time: new Date().toISOString() }, 200, { "Cache-Control": "no-store" });
    } else if (url.pathname === "/v1/schedule") {
      response = await scheduleResponse();
    } else {
      response = json({ error: "Not found" }, 404);
    }
    if (request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
    return response;
  },
};
