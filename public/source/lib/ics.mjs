function escapeIcs(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,");
}

export function icsUtc(value) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function localDate(value, timezone) {
  const parts = {};
  for (const part of new Intl.DateTimeFormat("en-GB", { timeZone: timezone || "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value))) {
    if (part.type !== "literal") parts[part.type] = part.value;
  }
  return `${parts.year}${parts.month}${parts.day}`;
}

/** Fold content lines to at most 75 UTF-8 octets including a continuation space. */
export function foldIcsLine(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const output = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (encoder.encode(current + char).length > limit) {
      output.push(current);
      current = ` ${char}`;
      limit = 75;
    } else current += char;
  }
  if (current) output.push(current);
  return output.join("\r\n");
}

export function eventToIcs(event, generatedAt) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZU Chiang Mai//Public Field Guide//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ZU Chiang Mai — Public Field Guide",
    "BEGIN:VEVENT",
    `UID:event-${event.id}@app.sola.day`,
    `DTSTAMP:${icsUtc(generatedAt)}`,
  ];
  if (event.all_day) {
    lines.push(`DTSTART;VALUE=DATE:${localDate(event.start, event.timezone)}`, `DTEND;VALUE=DATE:${localDate(event.end, event.timezone)}`);
  } else {
    lines.push(`DTSTART:${icsUtc(event.start)}`, `DTEND:${icsUtc(event.end)}`);
  }
  lines.push(`SUMMARY:${escapeIcs(event.title)}`);
  const place = event.venue_name || event.place_name;
  if (place) lines.push(`LOCATION:${escapeIcs(place)}`);
  lines.push(
    `STATUS:${["confirmed", "published"].includes(event.status) ? "CONFIRMED" : escapeIcs(event.status).toUpperCase()}`,
    `URL:${event.source_url}`,
    `X-ZU-SOURCE:${event.source}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  );
  return lines.map(foldIcsLine).join("\r\n");
}
