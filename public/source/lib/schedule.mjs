/** Public, read-only schedule normalization shared by the builder and Worker. */

export const API_BASE = "https://api.sola.day/api/v1";
export const ENDPOINTS = Object.freeze({
  fourGroup: `${API_BASE}/groups/4seas`,
  fourEvents: `${API_BASE}/events?group_id=4seas&collection=upcoming&limit=500`,
  fourCalendar: `${API_BASE}/groups/4seas/calendar.ics`,
  ethGroup: `${API_BASE}/groups/ethchiangmai2025`,
  ethCalendar: `${API_BASE}/groups/ethchiangmai2025/calendar.ics`,
});
export const PUBLIC_LINKS = Object.freeze({
  fourHome: "https://4seas.xyz/",
  fourGift: "https://4seas.org/",
  ethHome: "https://ethchiangmai.com/",
  ethEventList: "https://app.sola.day/event/ethchiangmai2025",
  corrections: "https://github.com/zuchiangmai",
});

export function cleanText(value, max = 500) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, max);
  return text || null;
}

export function safeId(value) {
  const id = cleanText(value, 64);
  return id && /^[A-Za-z0-9_-]{3,64}$/.test(id) ? id : null;
}

export function isoDate(value) {
  if (typeof value !== "string" || value.length > 64) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function safeHttpUrl(value, max = 600) {
  const raw = cleanText(value, max);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function sourceUrl(id) {
  const valid = safeId(id);
  return valid ? `https://sola.day/event/detail/${encodeURIComponent(valid)}` : null;
}

export function sanitizeGroup(raw, expectedName) {
  if (!raw || raw.name !== expectedName) throw new Error(`Unexpected public group payload for ${expectedName}`);
  const timezone = cleanText(raw.timezone, 80) || "Asia/Bangkok";
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`Invalid source timezone for ${expectedName}`);
  }
  return {
    handle: expectedName,
    name: cleanText(raw.nickname, 160) || (expectedName === "4seas" ? "4Seas Community" : "ETHChiangmai"),
    start_date: /^\d{4}-\d{2}-\d{2}$/.test(raw.start_date || "") ? raw.start_date : null,
    end_date: /^\d{4}-\d{2}-\d{2}$/.test(raw.end_date || "") ? raw.end_date : null,
    timezone,
    location_name: cleanText(raw.location, 240),
  };
}

export function normalizeFourEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = safeId(raw.id);
  const title = cleanText(raw.title, 300);
  const start = isoDate(raw.start_time);
  const end = isoDate(raw.end_time);
  if (!id || !title || !start || !end || new Date(end) < new Date(start)) return null;
  // The guide publishes only rows explicitly exposed as normal, published public events.
  if (raw.visibility !== "normal" || raw.status !== "published") return null;
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((tag) => cleanText(tag, 60)).filter(Boolean))].slice(0, 20)
    : [];
  return {
    key: `4seas:${id}`,
    id,
    source: "4seas",
    group_handle: safeId(raw.group?.name),
    group_name: cleanText(raw.group?.nickname, 160) || cleanText(raw.group?.name, 160),
    title,
    start,
    end,
    timezone: cleanText(raw.timezone, 80) || "Asia/Bangkok",
    all_day: false,
    kind: cleanText(raw.kind, 60),
    tags,
    status: cleanText(raw.status, 40) || "published",
    visibility: cleanText(raw.visibility, 40) || "normal",
    venue_name: cleanText(raw.venue?.name, 300),
    place_name: cleanText(raw.place?.name, 300),
    external_url: safeHttpUrl(raw.external_url),
    // DESCRIPTION/notes and meeting URLs are deliberately not imported.
    description: null,
    source_url: sourceUrl(id),
    duplicate_key: null,
    duplicate_of: null,
    duplicate_role: null,
  };
}

/** Unfold RFC 5545 content lines and split VEVENT blocks without a dependency. */
export function unfoldIcs(text) {
  if (typeof text !== "string" || text.length > 3_000_000) throw new Error("Invalid or oversized calendar feed");
  const physical = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const lines = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

function parseProperty(line) {
  const colon = line.indexOf(":");
  if (colon < 1) return null;
  const left = line.slice(0, colon);
  const pieces = left.split(";");
  const name = pieces.shift().toUpperCase();
  const params = {};
  for (const piece of pieces) {
    const at = piece.indexOf("=");
    if (at > 0) params[piece.slice(0, at).toUpperCase()] = piece.slice(at + 1);
  }
  return { name, params, value: line.slice(colon + 1) };
}

export function icsUnescape(value) {
  return String(value || "")
    .replace(/\\n/gi, "\n")
    .replace(/\\([\\,;])/g, "$1")
    .replace(/\\\\/g, "\\");
}

function zonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== "literal") out[part.type] = Number(part.value);
  return Date.UTC(out.year, out.month - 1, out.day, out.hour, out.minute, out.second);
}

/** Convert a floating ICS local time to UTC with an IANA timezone (DST included). */
export function zonedTimeToUtc(local, timezone) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(local);
  if (!match) return null;
  const [, y, m, d, h, min, s = "00"] = match;
  const wanted = Date.UTC(Number(y), Number(m) - 1, Number(d), Number(h), Number(min), Number(s));
  let guess = wanted;
  for (let i = 0; i < 3; i += 1) {
    const actual = zonedParts(new Date(guess), timezone);
    const adjustment = wanted - actual;
    guess += adjustment;
    if (!adjustment) break;
  }
  const result = new Date(guess);
  return Number.isFinite(result.getTime()) ? result.toISOString() : null;
}

function temporalValue(prop, fallbackTimezone) {
  if (!prop) return { instant: null, allDay: false };
  if (prop.params.VALUE === "DATE" || /^\d{8}$/.test(prop.value)) {
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(prop.value);
    if (!match) return { instant: null, allDay: true };
    const local = `${match[1]}${match[2]}${match[3]}T000000`;
    return { instant: zonedTimeToUtc(local, prop.params.TZID || fallbackTimezone), allDay: true };
  }
  if (/^\d{8}T\d{6}Z$/.test(prop.value)) {
    const v = prop.value;
    return { instant: isoDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}T${v.slice(9, 11)}:${v.slice(11, 13)}:${v.slice(13, 15)}Z`), allDay: false };
  }
  return { instant: zonedTimeToUtc(prop.value, prop.params.TZID || fallbackTimezone), allDay: false };
}

export function parseEthEvents(icsText, timezone = "Asia/Bangkok") {
  const lines = unfoldIcs(icsText);
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") current = [];
    else if (line === "END:VEVENT" && current) {
      blocks.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  const events = [];
  for (const block of blocks.slice(0, 500)) {
    const props = [];
    for (const line of block) {
      const parsed = parseProperty(line);
      if (parsed) props.push(parsed);
    }
    const first = (name) => props.find((prop) => prop.name === name);
    const url = safeHttpUrl(first("URL")?.value);
    const uid = cleanText(first("UID")?.value, 160);
    const idFromUid = uid ? safeId(/^event-([A-Za-z0-9_-]+)@/.exec(uid)?.[1]) : null;
    const idFromUrl = url ? safeId(/sola\.day\/event\/detail\/([A-Za-z0-9_-]+)/.exec(url)?.[1]) : null;
    const id = idFromUid || idFromUrl;
    const title = cleanText(icsUnescape(first("SUMMARY")?.value), 300);
    const startInfo = temporalValue(first("DTSTART"), timezone);
    const endInfo = temporalValue(first("DTEND"), timezone);
    if (!id || !title || !startInfo.instant || new Date(endInfo.instant || startInfo.instant) < new Date(startInfo.instant)) continue;
    const status = (cleanText(first("STATUS")?.value, 40) || "confirmed").toLowerCase();
    if (["cancelled", "canceled"].includes(status)) continue;
    const categories = first("CATEGORIES")?.value;
    const tags = categories
      ? [...new Set(categories.split(/(?<!\\),/).map((v) => cleanText(icsUnescape(v), 60)).filter(Boolean))].slice(0, 20)
      : [];
    events.push({
      key: `ethchiangmai2025:${id}`,
      id,
      source: "ethchiangmai2025",
      group_handle: "ethchiangmai2025",
      group_name: "ETHChiangmai",
      title,
      start: startInfo.instant,
      end: endInfo.instant || startInfo.instant,
      timezone: first("DTSTART")?.params.TZID || timezone,
      all_day: startInfo.allDay,
      kind: null,
      tags,
      status,
      visibility: "public-calendar",
      venue_name: null,
      place_name: cleanText(icsUnescape(first("LOCATION")?.value), 300),
      external_url: null,
      // Feed DESCRIPTION may be derived from event notes; do not mirror it.
      description: null,
      source_url: sourceUrl(id),
      duplicate_key: null,
      duplicate_of: null,
      duplicate_role: null,
    });
  }
  return events;
}

function applyDuplicateMetadata(events) {
  const pairs = new Map();
  for (const event of events) {
    const key = `${event.source}\u0000${event.group_handle || "unknown-group"}\u0000${event.title}\u0000${event.start}`;
    if (!pairs.has(key)) pairs.set(key, []);
    pairs.get(key).push(event);
  }
  const duplicates = [];
  for (const group of pairs.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id.localeCompare(b.id));
    const key = `duplicate-${duplicates.length + 1}`;
    for (const event of sorted) {
      event.duplicate_key = key;
      event.duplicate_role = event === sorted[0] ? "first" : "repeat";
      event.duplicate_of = event === sorted[0] ? null : sorted[0].key;
    }
    duplicates.push({
      key,
      source: sorted[0].source,
      title: sorted[0].title,
      start: sorted[0].start,
      event_keys: sorted.map((event) => event.key),
      count: sorted.length,
      note: "Same source title and start time; retained as separate source listings. Confirm at the source before treating them as one plan.",
    });
  }
  return duplicates;
}

function health(label, url, fetchedAt, count = null, extra = {}) {
  return { label, url, status: "ok", fetched_at: fetchedAt, count, ...extra };
}

export function buildSchedule({ fourGroup, fourRows, ethGroup, ethIcs, fetchedAt, generatedAt = fetchedAt, verifications = [] }) {
  const observedAt = isoDate(fetchedAt);
  const madeAt = isoDate(generatedAt);
  if (!observedAt || !madeAt) throw new Error("Valid source and generation timestamps are required");
  const four = fourRows.map(normalizeFourEvent).filter(Boolean);
  const eth = parseEthEvents(ethIcs, ethGroup.timezone || "Asia/Bangkok");
  const events = [...four, ...eth].sort((a, b) =>
    a.start.localeCompare(b.start) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id),
  );
  const duplicates = applyDuplicateMetadata(events);
  const ethSeason = sanitizeGroup(ethGroup, "ethchiangmai2025");
  const notices = [
    {
      key: "eth-source-rule",
      tone: "info",
      text: "SocialLayer group browse supports event_union federation, so a group can intentionally cross-list partner-group events. ETH-owned entries here come from its self-calendar; federated 4Seas rows keep their actual 4Seas group label.",
      url: ENDPOINTS.ethCalendar,
    },
  ];
  if (!eth.length) {
    notices.push({
      key: "eth-calendar-empty",
      tone: "info",
      text: "The official ETHChiangmai group calendar currently contains no event entries. That is an empty source feed, not a fetch error; check the official event list for updates.",
      url: PUBLIC_LINKS.ethEventList,
    });
  }
  if (duplicates.length) {
    notices.push({
      key: "duplicate-source-listings",
      tone: "note",
      text: `${duplicates.length} suspected duplicate source ${duplicates.length === 1 ? "pair is" : "groups are"} retained and flagged. No listing has been silently removed.`,
      url: "#source-notices",
    });
  }
  return {
    schema_version: 1,
    generated_at: madeAt,
    served_at: madeAt,
    stale: false,
    stale_reason: null,
    worker: null,
    seasons: {
      four_seas: sanitizeGroup(fourGroup, "4seas"),
      ethchiangmai: ethSeason,
    },
    sources: {
      four_seas_group: health("4Seas public group", ENDPOINTS.fourGroup, observedAt),
      four_seas_events: health("4Seas upcoming events", ENDPOINTS.fourEvents, observedAt, four.length, { upstream_count: fourRows.length }),
      eth_group: health("ETHChiangmai public season", ENDPOINTS.ethGroup, observedAt),
      eth_calendar: health("ETHChiangmai public calendar", ENDPOINTS.ethCalendar, observedAt, eth.length),
    },
    counts: { events: events.length, four_seas: four.length, ethchiangmai: eth.length, duplicate_groups: duplicates.length },
    events,
    duplicates,
    notices,
    verifications,
  };
}

export function validateSchedule(value) {
  if (!value || value.schema_version !== 1 || !isoDate(value.generated_at) || !Array.isArray(value.events)) {
    throw new Error("Invalid schedule response");
  }
  if (value.events.length > 500 || !value.sources || !value.seasons) throw new Error("Incomplete schedule response");
  for (const event of value.events) {
    if (!safeId(event.id) || !["4seas", "ethchiangmai2025"].includes(event.source) || !cleanText(event.title, 300) || !isoDate(event.start) || !sourceUrl(event.id)) {
      throw new Error("Invalid event in schedule response");
    }
    // Never accept fields that this public proxy is explicitly designed not to carry.
    const forbidden = ["owner", "participants", "participant_count", "notes", "meeting_url", "image_note", "latitude", "longitude", "memberships", "attendees", "tickets"];
    if (forbidden.some((key) => Object.hasOwn(event, key))) throw new Error("Unsafe event field in schedule response");
  }
  return value;
}
