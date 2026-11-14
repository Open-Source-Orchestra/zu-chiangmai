import { PUBLIC_LINKS } from "./schedule.mjs";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function eventFileName(event) {
  return `${event.source}-${event.id}.ics`;
}

const bangkok = "Asia/Bangkok";
function parts(value, timezone = bangkok) {
  const result = {};
  for (const part of new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value))) {
    if (part.type !== "literal") result[part.type] = part.value;
  }
  return result;
}

export function dayKey(value, timezone = bangkok) {
  const p = parts(value, timezone);
  return `${p.year}-${p.month}-${p.day}`;
}

function dateLabel(value, timezone = bangkok) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}

function timeLabel(event) {
  if (event.all_day) return "All day";
  const format = (value) => new Intl.DateTimeFormat("en-GB", { timeZone: bangkok, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
  const crossing = dayKey(event.start) !== dayKey(event.end);
  return `${format(event.start)}–${format(event.end)}${crossing ? " +1 day" : ""}`;
}

export function formatDateOnly(value) {
  if (!value) return "Date to be confirmed";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

function sourceName(source) {
  return source === "4seas" ? "4Seas" : "ETHChiangmai";
}

export function eventCard(event) {
  const id = `event-${event.source}-${event.id}`;
  const place = event.venue_name || event.place_name;
  const otherPlace = event.venue_name && event.place_name && event.place_name !== event.venue_name ? event.place_name : null;
  const duplicate = event.duplicate_key
    ? `<a class="duplicate-badge" href="#source-notices">Possible duplicate source listing${event.duplicate_role === "first" ? " · pair retained" : ""}</a>`
    : "";
  const card = `<article class="event-card${event.duplicate_role === "repeat" ? " is-repeat" : ""}" id="${id}" data-event-key="${escapeHtml(event.key)}" data-source="${event.source}">
    <div class="event-rail" aria-hidden="true"><span></span></div>
    <div class="event-body">
      <div class="event-topline"><time datetime="${event.start}" data-event-time>${timeLabel(event)}</time><span class="source-chip">${escapeHtml(event.group_name || sourceName(event.source))}</span>${duplicate}</div>
      <h4><a href="#${id}" data-detail="${escapeHtml(event.key)}">${escapeHtml(event.title)}</a></h4>
      ${place ? `<p class="event-place"><span aria-hidden="true">⌖</span> ${escapeHtml(place)}</p>` : `<p class="event-place muted">Place not listed in the public fields · check source</p>`}
      <div class="event-tags">${event.kind ? `<span>${escapeHtml(event.kind)}</span>` : ""}${event.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="event-actions">
        <button class="save-button js-only" type="button" data-save="${escapeHtml(event.key)}" aria-pressed="false" aria-label="Save ${escapeHtml(event.title)} on this device"><span aria-hidden="true">☆</span> Save</button>
        <a class="text-link" href="#${id}" data-detail="${escapeHtml(event.key)}">Details <span aria-hidden="true">→</span></a>
      </div>
      <details class="nojs-event-details">
        <summary>Details &amp; verified source</summary>
        <dl><div><dt>Starts</dt><dd>${escapeHtml(dateLabel(event.start))}, ${escapeHtml(timeLabel(event))} (Asia/Bangkok)</dd></div>${otherPlace ? `<div><dt>Public place name</dt><dd>${escapeHtml(otherPlace)}</dd></div>` : ""}<div><dt>Status</dt><dd>${escapeHtml(event.status)} · ${escapeHtml(event.visibility)}</dd></div></dl>
        <p>${event.description ? escapeHtml(event.description) : "No separately verified public description is mirrored here. Read the source listing for full details before attending."}</p>
        <p><a href="${escapeHtml(event.source_url)}" rel="noopener noreferrer">Open official source listing ↗</a> · <a href="./ics/${eventFileName(event)}" download>Download this event (.ics)</a></p>
      </details>
    </div>
  </article>`;
  if (event.duplicate_role === "repeat") {
    return `<details class="duplicate-fold"><summary>Retained possible duplicate · open to compare source listings</summary>${card}</details>`;
  }
  return card;
}

export function staticAgenda(events) {
  const groups = new Map();
  for (const event of events) {
    const key = dayKey(event.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  return [...groups.entries()].map(([key, dayEvents]) => `<section class="day-group" data-day="${key}">
    <h3><span>${escapeHtml(dateLabel(dayEvents[0].start))}</span><small>${dayEvents.length} source ${dayEvents.length === 1 ? "listing" : "listings"}</small></h3>
    <div class="day-events">${dayEvents.map(eventCard).join("")}</div>
  </section>`).join("\n");
}

export function renderProgramRail(programs) {
  if (!programs?.milestones?.length) return "";
  const milestones = [...programs.milestones].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.program.localeCompare(b.program) || a.id.localeCompare(b.id));
  const dateRange = (item) => item.start_date === item.end_date ? formatDateOnly(item.start_date) : `${formatDateOnly(item.start_date)} → ${formatDateOnly(item.end_date)}`;
  return `<section class="program-rail" id="program-milestones" aria-labelledby="program-title">
    <div class="program-heading"><div><p class="eyebrow">REVIEWED PUBLIC PROGRAMME · NOT AUTO-RECONCILED</p><h3 id="program-title">Current ETH + Longevity milestones</h3><p>Official programme dates live alongside the timed agenda—not inside an invented ETH calendar. ${programs.milestones.length} source-stamped milestones, checked <time datetime="${programs.snapshot_at}">${programs.snapshot_at}</time>.</p></div><div class="program-links"><a href="https://chiangmai.devfolio.co/schedule" rel="noopener noreferrer">Current Devfolio schedule ↗</a><a href="https://4seas.xyz/longevity/en/" rel="noopener noreferrer">Longevity programme ↗</a></div></div>
    <p class="timezone-policy">${escapeHtml(programs.timezone_policy)}</p>
    <div class="milestone-scroller" tabindex="0" role="region" aria-label="Chronological programme milestone rail; scroll horizontally for more">
      ${milestones.map((item) => {
        const longevity = item.program.toLowerCase().includes("longevity month");
        const related = item.related_public_events || [];
        return `<article class="milestone-card${longevity ? " longevity" : ""}${item.displayed_time ? " clock-unconfirmed" : ""}" id="milestone-${escapeHtml(item.id)}">
          <div class="milestone-date"><time datetime="${item.start_date}">${escapeHtml(dateRange(item))}</time><span>${item.displayed_time ? "SOURCE TIME · ZONE UNSPECIFIED" : "DATE-ONLY"}</span></div>
          <h4>${escapeHtml(item.title)}</h4><p class="milestone-program">${escapeHtml(item.program)}</p>${item.displayed_time ? `<p class="source-clock">${escapeHtml(item.displayed_time)} <small>as displayed · timezone not stated</small></p>` : ""}${item.venue ? `<p class="milestone-venue">⌖ ${escapeHtml(item.venue)}</p>` : ""}
          ${related.length ? `<div class="related-events"><strong>Distinct timed source ${related.length === 1 ? "listing" : "listings"}</strong>${related.map((event, index) => `<a href="${escapeHtml(event.url)}" rel="noopener noreferrer">${related.length > 1 ? `Timed listing ${index + 1} · ` : ""}${escapeHtml(event.title)} ↗</a>`).join("")}</div>` : ""}
          <details class="milestone-evidence"><summary>Evidence${item.warnings?.length ? " & source note" : ""}</summary><p>${escapeHtml(item.evidence || "Current official public source.")}</p>${(item.warnings || []).map((warning) => `<p class="milestone-warning">${escapeHtml(warning)}</p>`).join("")}<small>${escapeHtml(item.confidence || "official public source")}</small></details>
          <a class="milestone-source" href="${escapeHtml(item.source_url)}" rel="noopener noreferrer">Official source ↗</a>
        </article>`;
      }).join("")}
    </div>
    <div class="program-conflicts"><strong>Source disagreements kept visible</strong><ul>${programs.disagreements.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul></div>
  </section>`;
}

function staticSources(schedule) {
  return Object.entries(schedule.sources).map(([key, source]) => `<li data-source-health="${key}"><span class="health-dot" aria-hidden="true"></span><div><strong>${escapeHtml(source.label)}</strong><small><span data-source-status>Source fetch OK</span> · <time datetime="${source.fetched_at}" data-source-time>${escapeHtml(source.fetched_at)}</time>${source.count !== null ? ` · ${source.count} public entries` : ""}</small></div><a href="${escapeHtml(source.url)}" rel="noopener noreferrer" aria-label="Open ${escapeHtml(source.label)} source">↗</a></li>`).join("");
}

function verificationNotices(schedule) {
  const notices = [...schedule.notices];
  const website = schedule.verifications.find((item) => item.key === "eth-website");
  if (website?.legacy_programme_present) {
    notices.push({
      key: "eth-legacy-note",
      tone: "note",
      text: "The official ETHChiangmai site currently mixes its current 2026–27 season metadata with legacy 2025–26 programme entries. This guide shows the current season dates and does not import those older sessions.",
      url: PUBLIC_LINKS.ethHome,
    });
  }
  return notices;
}

export function renderPage(schedule, heroPhotos = []) {
  const eth = schedule.seasons.ethchiangmai;
  const json = JSON.stringify(schedule).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const photoJson = JSON.stringify(heroPhotos.map((photo) => ({
    id: photo.id,
    title: photo.title,
    src: `./photos/${photo.id}-960.webp`,
    small: `./photos/${photo.id}-480.webp`,
    large: `./photos/${photo.id}-1440.webp`,
    position: photo.position,
    sourcePage: photo.source_page,
    credit: photo.credit,
  }))).replace(/</g, "\\u003c");
  const firstPhoto = heroPhotos[0] || { id: "road", title: "4Seas public memory", position: "50% 42%", source_page: "./licenses/#photo-sources" };
  const notices = verificationNotices(schedule);
  const fourVerification = schedule.verifications.find((item) => item.key === "four-calendar");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="robots" content="noindex,nofollow">
  <meta name="theme-color" content="#102f35">
  <meta name="description" content="An independent, read-only Chiang Mai community field guide: current public 4Seas gatherings, the ETHChiangmai season, and an in-app PIT.">
  <meta name="zu:pit-module" content="./pit/">
  <title>ZU / CHIANG MAI — Living Field Guide</title>
  <link rel="icon" href="./favicon.ico" sizes="48x48">
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="./styles.css">
  ${firstPhoto ? `<link rel="preload" as="image" href="./photos/${firstPhoto.id}-960.webp" imagesrcset="./photos/${firstPhoto.id}-480.webp 480w, ./photos/${firstPhoto.id}-960.webp 960w, ./photos/${firstPhoto.id}-1440.webp 1440w" imagesizes="(max-width: 900px) 100vw, 50vw">` : ""}
  <script src="./app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#agenda">Skip to the agenda</a>
  <header class="site-header">
    <a class="brand" href="#top" aria-label="ZU Chiang Mai home"><span>ZU</span><i>/</i><span>CHIANG MAI</span></a>
    <nav aria-label="Field guide navigation"><a href="#agenda">Agenda</a><a href="#eth-season">ETH season</a><a class="pit-nav" data-pit-hook="zuchiangmai-pit" href="./pit/">PIT <small>in-app</small></a><a href="#sources">Sources</a></nav>
  </header>

  <main id="top">
    <section class="hero photo-hero" aria-labelledby="hero-title" data-photo-hero>
      <div class="hero-backdrop" aria-hidden="true">
        <div class="hero-backdrop-layer is-active" data-photo-bg style="background-image:url('./photos/${firstPhoto.id}-1440.webp');background-position:${firstPhoto.position}"></div>
        <div class="hero-backdrop-layer" data-photo-bg></div>
      </div>
      <div class="hero-copy">
        <p class="eyebrow"><span class="lantern-dot" aria-hidden="true"></span> AN INDEPENDENT COMMUNITY FIELD GUIDE</p>
        <h1 id="hero-title">Find your next<br><em>small yes.</em></h1>
        <p class="hero-deck">Public gatherings around 4Seas, the current ETHChiangmai season, and paths into community memory—all in one read-only field guide.</p>
        <div class="hero-actions"><a class="button primary" href="#agenda">Explore the agenda <span aria-hidden="true">↓</span></a><a class="button ghost" data-pit-hook="zuchiangmai-pit" href="./pit/">Enter the PIT <span aria-hidden="true">↗</span></a></div>
        <p class="independence">Built with public sources. Not an official umbrella, organizer voice, or endorsement. Always check the source before setting out.</p>
      </div>
      <div class="hero-art photo-stage" data-photo-stage>
        <img class="photo-frame is-active" data-photo-frame src="./photos/${firstPhoto.id}-960.webp" srcset="./photos/${firstPhoto.id}-480.webp 480w, ./photos/${firstPhoto.id}-960.webp 960w, ./photos/${firstPhoto.id}-1440.webp 1440w" sizes="(max-width: 900px) 100vw, 50vw" alt="" fetchpriority="high" decoding="async" style="object-position:${firstPhoto.position}">
        <img class="photo-frame" data-photo-frame alt="" decoding="async">
        <div class="photo-stage-footer">
          <a class="photo-caption" data-photo-link href="${escapeHtml(firstPhoto.source_page)}" rel="noopener noreferrer"><span data-photo-title>${escapeHtml(firstPhoto.title)}</span><small>© 4SEAS.ORG · USED WITH PERMISSION ↗</small></a>
          <button class="photo-motion-toggle js-only" data-photo-toggle type="button" aria-pressed="false">Pause photos</button>
        </div>
      </div>
      <script id="photo-data" type="application/json">${photoJson}</script>
    </section>

    <section class="season-wrap" id="eth-season" aria-labelledby="eth-title">
      <article class="season-card">
        <div class="season-mark" aria-hidden="true">ETH<br><span>CM</span></div>
        <div><p class="eyebrow">A SEPARATE SOURCE · CURRENT SEASON</p><h2 id="eth-title">ETHChiangmai</h2><p class="season-dates">${formatDateOnly(eth.start_date)} <span>→</span> ${formatDateOnly(eth.end_date)}</p><p>The official group calendar has <strong>${schedule.counts.ethchiangmai === 0 ? "no event entries right now" : `${schedule.counts.ethchiangmai} public ${schedule.counts.ethchiangmai === 1 ? "entry" : "entries"}`}</strong>. The season is current; an empty self-calendar is not an error and does not erase the official programme milestones below.</p></div>
        <div class="season-links"><a href="${PUBLIC_LINKS.ethHome}" rel="noopener noreferrer">Official season site ↗</a><a href="${PUBLIC_LINKS.ethEventList}" rel="noopener noreferrer">Official event list ↗</a><a href="https://chiangmai.devfolio.co/schedule" rel="noopener noreferrer">Current hackathon schedule ↗</a><a href="https://api.sola.day/api/v1/groups/ethchiangmai2025/calendar.ics">Self-calendar feed ↗</a></div>
      </article>
      ${renderProgramRail(schedule.programs)}
    </section>

    <section class="agenda-shell" id="agenda" aria-labelledby="agenda-title">
      <div class="section-heading">
        <div><p class="eyebrow">THE PUBLIC NOTEBOOK · CHRONOLOGICAL</p><h2 id="agenda-title">Live agenda<span class="title-dot">.</span></h2><p>${schedule.counts.events} public source listings · upcoming as reported by 4Seas${schedule.counts.ethchiangmai ? " and ETHChiangmai" : ""}.</p></div>
        <div class="refresh-cluster"><span class="status-pill" id="connection-status" data-state="snapshot"><span aria-hidden="true"></span> SOURCE SNAPSHOT</span><button class="button small ghost js-only" id="refresh-button" type="button">Refresh sources</button></div>
      </div>
      <p class="status-explanation" id="status-explanation">Source snapshot fetched <time datetime="${schedule.generated_at}" id="fetched-time">${escapeHtml(schedule.generated_at)}</time>. Rendered by this static preview; it is not labelled live until the read-only proxy answers.</p>

      <div class="controls js-only" aria-label="Agenda filters">
        <div class="search-field"><label for="search">Search the notebook</label><input id="search" type="search" placeholder="Title, place, tag…" autocomplete="off"><button id="clear-search" type="button" aria-label="Clear search" hidden>×</button></div>
        <fieldset class="range-filters"><legend>When</legend><div><button type="button" data-range="all" aria-pressed="true">All</button><button type="button" data-range="today" aria-pressed="false">Today</button><button type="button" data-range="next7" aria-pressed="false">Next 7 days</button><button type="button" data-range="saved" aria-pressed="false">Saved <span id="saved-count">0</span></button></div></fieldset>
        <div class="select-grid"><label>Source<select id="source-filter"><option value="all">All sources</option><option value="4seas">4Seas</option><option value="ethchiangmai2025">ETHChiangmai</option></select></label><label>Tag<select id="tag-filter"><option value="all">All public tags</option></select></label><label>Kind<select id="kind-filter"><option value="all">All kinds</option></select></label><label>Time zone<select id="timezone"><option value="Asia/Bangkok">Chiang Mai (UTC+7)</option><option value="local">My device</option><option value="UTC">UTC</option></select></label></div>
        <div class="control-notes"><p id="result-count" role="status">${schedule.counts.events} listings</p><p>Today / next 7 use Chiang Mai days. Saving is always your explicit tap—only in this browser, never synced.</p></div>
      </div>

      <noscript><p class="noscript-note">JavaScript is off: all ${schedule.counts.events} listings remain readable below in Chiang Mai time. Open any “Details &amp; verified source” for its source and individual calendar file.</p></noscript>
      <div class="empty-state" id="empty-results" hidden><span aria-hidden="true">○</span><h3>No listings match this view.</h3><p>Try clearing a filter or search. Your saved events stay only on this device.</p><button class="button small ghost js-only" type="button" id="reset-filters">Reset filters</button></div>
      <div class="empty-state eth-empty" id="empty-eth" hidden><span aria-hidden="true">◇</span><h3>The ETH calendar feed is open—and currently empty.</h3><p>The ${formatDateOnly(eth.start_date)}–${formatDateOnly(eth.end_date)} season and official programme milestones are still shown above. No 4Seas event has been relabelled to fill this space.</p><a class="button small primary" href="${PUBLIC_LINKS.ethEventList}" rel="noopener noreferrer">Check the official ETH event list ↗</a></div>
      <div id="agenda-list" class="agenda-list">${staticAgenda(schedule.events)}</div>
    </section>

    <section class="pit-invitation" aria-labelledby="pit-title"><div><p class="eyebrow">ONE APP · ANOTHER ROOM</p><h2 id="pit-title">Follow the path into the PIT.</h2><p>The in-app ZuChiangMai PIT has its own module slot here—community memory and consented public stories, not a separate PIT domain. The schedule remains this room’s own guide.</p></div><a class="button paper" data-pit-hook="zuchiangmai-pit" href="./pit/">Open /pit/ <span aria-hidden="true">↗</span></a></section>

    <section class="sources" id="sources" aria-labelledby="sources-title">
      <div class="section-heading"><div><p class="eyebrow">READ THE FOOTNOTES</p><h2 id="sources-title">Sources &amp; source health</h2></div><a class="button small ghost" href="https://api.sola.day/api/v1/groups/4seas/calendar.ics">Subscribe to the full 4Seas calendar (.ics)</a></div>
      <p>Source fetch time tells you when the public data was obtained. Browser render time tells you when this copy was drawn. They are different. Automatic timed-agenda refresh attempts run about every two minutes; failures keep the last good data and never turn a snapshot into “Live.” Programme milestones are a separate, human-reviewed static source rail.</p>
      <div class="source-grid"><div><h3>Current payload</h3><ul class="source-health" id="source-health">${staticSources(schedule)}</ul><p class="render-time">Browser render: <time id="render-time">not run yet (static HTML)</time></p></div>
      <div><h3>Canonical rooms</h3><ul class="canonical-links"><li><a href="${PUBLIC_LINKS.fourHome}" rel="noopener noreferrer">4Seas official home &amp; host door ↗</a><span>Official programmes, events, and hosting.</span></li><li><a href="${PUBLIC_LINKS.fourGift}" rel="noopener noreferrer">4Seas.org public gift &amp; memory ↗</a><span>A content pool for community stories; only consented public material.</span></li><li><a href="https://api.sola.day/api/v1/groups/4seas/calendar.ics">SocialLayer whole-group calendar ↗</a><span>${fourVerification ? `${fourVerification.vevent_count} entries including past events; advertised hourly refresh.` : "Official iCalendar feed, including past events."}</span></li><li><a href="${PUBLIC_LINKS.ethHome}" rel="noopener noreferrer">ETHChiangmai official site ↗</a><span>Current top-level season: ${formatDateOnly(eth.start_date)}–${formatDateOnly(eth.end_date)}.</span></li></ul></div></div>
      <details class="source-notices" id="source-notices"><summary>Source notices &amp; methodology (${notices.length})</summary><div>${notices.map((notice) => `<article class="notice ${notice.tone}"><p>${escapeHtml(notice.text)}</p>${notice.url.startsWith("#") ? `<a href="${notice.url}">See related entries</a>` : `<a href="${escapeHtml(notice.url)}" rel="noopener noreferrer">Check source ↗</a>`}</article>`).join("")}<article class="notice"><p>SocialLayer’s documented <code>event_union</code> federation allows ETH group browse to include 4Seas-owned rows intentionally; at static build time its browse returned the same public rows and ETag as 4Seas. ETH-owned entries therefore come from the ETH self-calendar, and every row keeps its actual group label. Public event notes, meeting links, owners, attendee data, ticket data, precise coordinates, and membership data are never mirrored.</p><a href="https://api.sola.day/api/v1/groups/ethchiangmai2025/calendar.ics">Verify the ETH calendar source ↗</a></article>${schedule.duplicates.map((duplicate) => `<article class="notice note"><p><strong>${escapeHtml(duplicate.title)}</strong><br>${escapeHtml(duplicate.note)}<br><small>${duplicate.event_keys.map(escapeHtml).join(" · ")}</small></p></article>`).join("")}</div></details>
    </section>

    <section class="care" aria-labelledby="care-title"><h2 id="care-title">A guide, not a gate.</h2><p>No account. No RSVP. No posting. No trackers. Favorites exist only after your explicit tap and stay in this browser. Event details and attendance decisions belong at the source.</p><div><a href="${PUBLIC_LINKS.corrections}" rel="noopener noreferrer">Corrections &amp; takedown ↗</a><a href="./licenses/">Licenses &amp; source offer</a><a href="./schedule.json">Sanitized snapshot JSON</a></div><p class="small-print">For corrections or takedown, use the Zu Chiang Mai community’s public GitHub channel to find its current contact route. Event content belongs to its source owners; this independent preview does not imply official endorsement.</p></section>
  </main>

  <footer><a class="brand" href="#top"><span>ZU</span><i>/</i><span>CHIANG MAI</span></a><p>Make something · Read together · Share a meal · Offer a hand</p><p>Original words &amp; art: CC0 · Code: GPL-3.0-or-later · Public schedule data remains with its sources.</p></footer>

  <dialog id="event-dialog" aria-labelledby="dialog-title"><div class="dialog-inner"><button id="dialog-close" class="dialog-close" type="button" aria-label="Close event details">×</button><p class="eyebrow" id="dialog-source">PUBLIC SOURCE LISTING</p><h2 id="dialog-title">Event details</h2><div id="dialog-content"></div><div class="dialog-actions"><button class="save-button" type="button" id="dialog-save" aria-pressed="false">☆ Save on this device</button><a class="button small ghost" id="dialog-ics" href="#" download>Download .ics</a><a class="button small primary" id="dialog-source-link" href="#" rel="noopener noreferrer">Official source ↗</a></div><p class="small-print">No separately verified description is mirrored unless the source exposes one safely. No RSVP or attendance action happens here.</p></div></dialog>
  <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  <script id="schedule-data" type="application/json">${json}</script>
<script src="https://live.zuchiangmai.app/widget.js" async></script></body>
</html>`;
}
