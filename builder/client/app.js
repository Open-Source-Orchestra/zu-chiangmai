/* ZU / CHIANG MAI — dependency-free, read-only progressive enhancement. */
(() => {
  "use strict";
  document.documentElement.classList.add("js");

  const WORKER_URL = "https://zu-chiangmai-schedule.shakaverse.workers.dev/v1/schedule";
  const REFRESH_MS = 120_000;
  const STORAGE_KEY = "zu-chiangmai:saved:v1";
  const ETH_LIST = "https://app.sola.day/event/ethchiangmai2025";
  const ETH_HOME = "https://ethchiangmai.com/";
  const FOUR_HOME = "https://4seas.xyz/";
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const safeUrl = (value, sourceOnly = false) => {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      if (sourceOnly && !/^https:\/\/sola\.day\/event\/detail\/[A-Za-z0-9_-]+\/?$/.test(url.href)) return null;
      return url.href;
    } catch { return null; }
  };
  const initial = JSON.parse($("#schedule-data").textContent);
  let schedule = initial;
  let connectionMode = "snapshot";
  let refreshing = false;
  let currentDialogKey = null;
  let focusBeforeDialog = null;
  let toastTimer = null;
  const state = { query: "", range: "all", source: "all", tag: "all", kind: "all", timezone: "Asia/Bangkok" };

  function validateSchedule(data) {
    if (!data || data.schema_version !== 1 || !Array.isArray(data.events) || data.events.length > 500 || !data.sources || !data.seasons || !Number.isFinite(Date.parse(data.generated_at))) throw new Error("Invalid schedule schema");
    const forbidden = ["owner", "participants", "participant_count", "notes", "meeting_url", "image_note", "latitude", "longitude", "memberships", "attendees", "tickets"];
    for (const event of data.events) {
      if (!event || !/^[A-Za-z0-9_-]{3,64}$/.test(event.id || "") || !["4seas", "ethchiangmai2025"].includes(event.source) || typeof event.title !== "string" || !event.title || !Number.isFinite(Date.parse(event.start)) || !Number.isFinite(Date.parse(event.end)) || !safeUrl(event.source_url, true)) throw new Error("Invalid public event");
      if (forbidden.some((key) => Object.hasOwn(event, key))) throw new Error("Unsafe public event field");
    }
    return data;
  }

  function readSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.filter((key) => typeof key === "string" && /^(4seas|ethchiangmai2025):[A-Za-z0-9_-]+$/.test(key)).slice(0, 500) : []);
    } catch { return new Set(); }
  }
  const saved = readSaved();

  function toast(message) {
    const node = $("#toast");
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, 3800);
  }

  function zone() {
    if (state.timezone !== "local") return state.timezone;
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Bangkok";
  }

  function dateParts(value, timezone) {
    const output = {};
    for (const part of new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value))) {
      if (part.type !== "literal") output[part.type] = part.value;
    }
    return output;
  }
  function dayKey(value, timezone = zone()) {
    const p = dateParts(value, timezone);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function shiftDay(key, amount) {
    const date = new Date(`${key}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }
  function chiangMaiDayStart(key) {
    return new Date(`${key}T00:00:00+07:00`).getTime();
  }
  function dayLabel(key) {
    const base = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(`${key}T12:00:00Z`));
    const today = dayKey(new Date(), zone());
    if (key === today) return `Today · ${base}`;
    if (key === shiftDay(today, 1)) return `Tomorrow · ${base}`;
    return base;
  }
  function timeLabel(event) {
    if (event.all_day) return "All day";
    const format = new Intl.DateTimeFormat("en-GB", { timeZone: zone(), hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    let suffix = "";
    const startKey = dayKey(event.start);
    const endKey = dayKey(event.end);
    if (endKey !== startKey) {
      const difference = Math.round((new Date(`${endKey}T00:00:00Z`) - new Date(`${startKey}T00:00:00Z`)) / 86_400_000);
      suffix = ` +${difference} ${difference === 1 ? "day" : "days"}`;
    }
    return `${format.format(new Date(event.start))}–${format.format(new Date(event.end))}${suffix}`;
  }
  function fullTime(event) {
    const timezone = zone();
    const options = { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: event.all_day ? undefined : "2-digit", minute: event.all_day ? undefined : "2-digit", hourCycle: "h23" };
    const start = new Intl.DateTimeFormat("en-GB", options).format(new Date(event.start));
    const end = new Intl.DateTimeFormat("en-GB", options).format(new Date(event.end));
    return `${start} → ${end} · ${timezone === "Asia/Bangkok" ? "Chiang Mai" : timezone}`;
  }
  function sourceName(source) { return source === "4seas" ? "4Seas" : "ETHChiangmai"; }
  function domId(event) { return `event-${event.source}-${event.id}`; }
  function icsName(event) { return `${event.source}-${event.id}.ics`; }

  function inSelectedRange(event, now = new Date()) {
    if (state.range === "all") return true;
    if (state.range === "saved") return saved.has(event.key);
    const today = dayKey(now, "Asia/Bangkok");
    const start = chiangMaiDayStart(today);
    const end = chiangMaiDayStart(shiftDay(today, state.range === "today" ? 1 : 7));
    return new Date(event.start).getTime() < end && new Date(event.end).getTime() >= start;
  }
  function filteredEvents() {
    const query = state.query.trim().toLocaleLowerCase();
    return schedule.events.filter((event) => {
      if (!inSelectedRange(event)) return false;
      if (state.source !== "all" && event.source !== state.source) return false;
      if (state.tag !== "all" && !event.tags.includes(state.tag)) return false;
      if (state.kind !== "all" && event.kind !== state.kind) return false;
      if (query) {
        const haystack = [event.title, event.venue_name, event.place_name, event.kind, ...event.tags, event.source].filter(Boolean).join(" ").toLocaleLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }

  function card(event) {
    const place = event.venue_name || event.place_name;
    const duplicate = event.duplicate_key ? `<a class="duplicate-badge" href="#source-notices">Possible duplicate source listing${event.duplicate_role === "first" ? " · pair retained" : ""}</a>` : "";
    const isSaved = saved.has(event.key);
    const id = domId(event);
    const html = `<article class="event-card${event.duplicate_role === "repeat" ? " is-repeat" : ""}" id="${id}" data-event-key="${escapeHtml(event.key)}" data-source="${event.source}">
      <div class="event-rail" aria-hidden="true"><span></span></div><div class="event-body">
      <div class="event-topline"><time datetime="${escapeHtml(event.start)}" data-event-time>${escapeHtml(timeLabel(event))}</time><span class="source-chip">${escapeHtml(event.group_name || sourceName(event.source))}</span>${duplicate}</div>
      <h4><a href="#${id}" data-detail="${escapeHtml(event.key)}">${escapeHtml(event.title)}</a></h4>
      ${place ? `<p class="event-place"><span aria-hidden="true">⌖</span> ${escapeHtml(place)}</p>` : `<p class="event-place muted">Place not listed in the public fields · check source</p>`}
      <div class="event-tags">${event.kind ? `<span>${escapeHtml(event.kind)}</span>` : ""}${event.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="event-actions"><button class="save-button" type="button" data-save="${escapeHtml(event.key)}" aria-pressed="${isSaved}" aria-label="${isSaved ? "Remove" : "Save"} ${escapeHtml(event.title)} on this device"><span aria-hidden="true">${isSaved ? "★" : "☆"}</span> ${isSaved ? "Saved" : "Save"}</button><a class="text-link" href="#${id}" data-detail="${escapeHtml(event.key)}">Details <span aria-hidden="true">→</span></a></div>
      <noscript><p><a href="${escapeHtml(event.source_url)}" rel="noopener noreferrer">Official source ↗</a></p></noscript>
      </div></article>`;
    if (event.duplicate_role === "repeat") {
      const open = location.hash === `#${id}` ? " open" : "";
      return `<details class="duplicate-fold"${open}><summary>Retained possible duplicate · open to compare source listings</summary>${html}</details>`;
    }
    return html;
  }

  function renderAgenda() {
    const events = filteredEvents();
    const groups = new Map();
    for (const event of events) {
      const key = dayKey(event.start);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(event);
    }
    $("#agenda-list").innerHTML = [...groups.entries()].map(([key, entries]) => `<section class="day-group" data-day="${key}"><h3><span>${escapeHtml(dayLabel(key))}</span><small>${entries.length} source ${entries.length === 1 ? "listing" : "listings"}</small></h3><div class="day-events">${entries.map(card).join("")}</div></section>`).join("");
    $("#result-count").textContent = `${events.length} ${events.length === 1 ? "listing" : "listings"}`;
    const ethEmpty = state.source === "ethchiangmai2025" && schedule.events.filter((event) => event.source === "ethchiangmai2025").length === 0 && !state.query && state.tag === "all" && state.kind === "all" && state.range !== "saved";
    $("#empty-eth").hidden = !ethEmpty;
    $("#empty-results").hidden = events.length !== 0 || ethEmpty;
    $("#agenda-list").hidden = events.length === 0;
    $("#saved-count").textContent = String(saved.size);
    updateFavoriteButtons();
  }

  function populateFilters() {
    const tags = [...new Set(schedule.events.flatMap((event) => event.tags))].sort((a, b) => a.localeCompare(b));
    const kinds = [...new Set(schedule.events.map((event) => event.kind).filter(Boolean))].sort();
    const replaceOptions = (select, values, first, current) => {
      select.innerHTML = `<option value="all">${first}</option>${values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
      select.value = values.includes(current) ? current : "all";
      return select.value;
    };
    state.tag = replaceOptions($("#tag-filter"), tags, "All public tags", state.tag);
    state.kind = replaceOptions($("#kind-filter"), kinds, "All kinds", state.kind);
  }

  function updateFavoriteButtons() {
    $$('[data-save]').forEach((button) => {
      const key = button.dataset.save;
      const event = schedule.events.find((item) => item.key === key);
      const active = saved.has(key);
      button.setAttribute("aria-pressed", String(active));
      button.innerHTML = `<span aria-hidden="true">${active ? "★" : "☆"}</span> ${active ? "Saved" : "Save"}`;
      if (event) button.setAttribute("aria-label", `${active ? "Remove" : "Save"} ${event.title} on this device`);
    });
    if (currentDialogKey) {
      const active = saved.has(currentDialogKey);
      $("#dialog-save").setAttribute("aria-pressed", String(active));
      $("#dialog-save").textContent = `${active ? "★ Saved on this device" : "☆ Save on this device"}`;
    }
    $("#saved-count").textContent = String(saved.size);
  }

  function toggleSaved(key) {
    const event = schedule.events.find((item) => item.key === key);
    if (!event) return;
    const wasSaved = saved.has(key);
    if (wasSaved) saved.delete(key); else saved.add(key);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...saved].sort()));
      toast(wasSaved ? "Removed from this device." : "Saved only in this browser. No account or sync.");
    } catch {
      if (wasSaved) saved.add(key); else saved.delete(key);
      toast("This browser blocked local saving. Nothing was stored.");
    }
    updateFavoriteButtons();
    if (state.range === "saved") renderAgenda();
  }

  function icsEscape(value) { return String(value || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/;/g, "\\;").replace(/,/g, "\\,"); }
  function icsUtc(value) { return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function localDateKey(value, timezone) {
    try { return dayKey(value, timezone).replaceAll("-", ""); } catch { return dayKey(value, "Asia/Bangkok").replaceAll("-", ""); }
  }
  function eventIcs(event) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ZU Chiang Mai//Public Field Guide//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:event-${event.id}@app.sola.day`, `DTSTAMP:${icsUtc(schedule.generated_at)}`];
    if (event.all_day) {
      lines.push(`DTSTART;VALUE=DATE:${localDateKey(event.start, event.timezone)}`, `DTEND;VALUE=DATE:${localDateKey(event.end, event.timezone)}`);
    } else lines.push(`DTSTART:${icsUtc(event.start)}`, `DTEND:${icsUtc(event.end)}`);
    lines.push(`SUMMARY:${icsEscape(event.title)}`);
    const place = event.venue_name || event.place_name;
    if (place) lines.push(`LOCATION:${icsEscape(place)}`);
    lines.push(`STATUS:${event.status === "confirmed" || event.status === "published" ? "CONFIRMED" :icsEscape(event.status).toUpperCase()}`, `URL:${event.source_url}`, `X-ZU-SOURCE:${event.source}`, "END:VEVENT", "END:VCALENDAR", "");
    return lines.join("\r\n");
  }
  function downloadEvent(event) {
    const blob = new Blob([eventIcs(event)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = icsName(event);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function openEvent(key, updateHash = true) {
    const event = schedule.events.find((item) => item.key === key);
    if (!event) return;
    const dialog = $("#event-dialog");
    focusBeforeDialog = document.activeElement;
    currentDialogKey = key;
    $("#dialog-source").textContent = `${event.group_name || sourceName(event.source)} · PUBLIC SOURCE LISTING`;
    $("#dialog-title").textContent = event.title;
    const place = event.venue_name || event.place_name;
    const otherPlace = event.venue_name && event.place_name && event.venue_name !== event.place_name ? event.place_name : null;
    const duplicate = event.duplicate_key ? `<p class="dialog-meta"><strong>Possible duplicate:</strong> the same source title and start appear more than once. Both listings remain in this guide; verify before treating them as one plan.</p>` : "";
    $("#dialog-content").innerHTML = `<p class="dialog-event-time">${escapeHtml(fullTime(event))}</p><p class="dialog-place">${place ? `⌖ ${escapeHtml(place)}` : "Place not included in the public fields. Check the source listing."}${otherPlace ? `<br><small>Public place name: ${escapeHtml(otherPlace)}</small>` : ""}</p><div class="dialog-tags">${event.kind ? `<span>${escapeHtml(event.kind)}</span>` : ""}${event.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>${duplicate}<p class="dialog-description">${event.description ? escapeHtml(event.description) : "No separately verified public description is mirrored here. Open the official source for full event details, updates, and any attendance instructions."}</p><p class="dialog-meta">Status: ${escapeHtml(event.status)} · Visibility: ${escapeHtml(event.visibility)}<br>Source fetched: ${escapeHtml(schedule.sources[event.source === "4seas" ? "four_seas_events" : "eth_calendar"]?.fetched_at || schedule.generated_at)}</p>`;
    $("#dialog-source-link").href = safeUrl(event.source_url, true);
    $("#dialog-ics").href = `./ics/${icsName(event)}`;
    $("#dialog-ics").setAttribute("download", icsName(event));
    updateFavoriteButtons();
    if (updateHash && location.hash !== `#${domId(event)}`) history.pushState(null, "", `#${domId(event)}`);
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog() { $("#event-dialog").close(); }
  $("#dialog-close").addEventListener("click", closeDialog);
  $("#event-dialog").addEventListener("click", (event) => { if (event.target === $("#event-dialog")) closeDialog(); });
  $("#event-dialog").addEventListener("close", () => {
    const event = schedule.events.find((item) => item.key === currentDialogKey);
    if (event && location.hash === `#${domId(event)}`) history.replaceState(null, "", "#agenda");
    currentDialogKey = null;
    if (focusBeforeDialog?.isConnected) focusBeforeDialog.focus({ preventScroll: true });
  });
  $("#dialog-save").addEventListener("click", () => { if (currentDialogKey) toggleSaved(currentDialogKey); });
  $("#dialog-ics").addEventListener("click", (event) => {
    event.preventDefault();
    const item = schedule.events.find((entry) => entry.key === currentDialogKey);
    if (item) downloadEvent(item);
  });

  function openFromHash() {
    const id = decodeURIComponent(location.hash.slice(1));
    const event = schedule.events.find((item) => domId(item) === id);
    if (event) {
      const target = document.getElementById(id);
      if (target?.parentElement?.tagName === "DETAILS") target.parentElement.open = true;
      openEvent(event.key, false);
    }
  }

  function setConnection(mode, explanation) {
    const pill = $("#connection-status");
    pill.dataset.state = mode;
    const labels = { live: "LIVE · READ-ONLY PROXY", snapshot: "SOURCE SNAPSHOT", stale: "STALE · LAST GOOD", error: connectionMode === "live" ? "LAST GOOD · REFRESH FAILED" : "SNAPSHOT · REFRESH FAILED" };
    pill.innerHTML = `<span aria-hidden="true"></span> ${labels[mode]}`;
    $("#status-explanation").textContent = explanation;
  }

  function renderHealth() {
    $("#source-health").innerHTML = Object.entries(schedule.sources).map(([key, source]) => {
      const url = safeUrl(source.url);
      const okay = source.status === "ok";
      return `<li data-source-health="${escapeHtml(key)}"><span class="health-dot" style="background:${okay ? "#91c49c" : "#ec9b77"}" aria-hidden="true"></span><div><strong>${escapeHtml(source.label)}</strong><small>${okay ? "Source fetch OK" : `Source ${escapeHtml(source.status)}`} · <time datetime="${escapeHtml(source.fetched_at)}">${escapeHtml(source.fetched_at)}</time>${source.count !== null && source.count !== undefined ? ` · ${Number(source.count) || 0} public entries` : ""}</small></div>${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer" aria-label="Open ${escapeHtml(source.label)} source">↗</a>` : ""}</li>`;
    }).join("");
    const fetchedTime = $("#fetched-time");
    if (fetchedTime) {
      fetchedTime.dateTime = schedule.generated_at;
      fetchedTime.textContent = schedule.generated_at;
    }
    $("#render-time").dateTime = new Date().toISOString();
    $("#render-time").textContent = new Date().toISOString();
  }

  function renderNotices() {
    const notices = [...(schedule.notices || [])];
    const website = (schedule.verifications || []).find((item) => item.key === "eth-website");
    if (website?.legacy_programme_present) notices.push({ tone: "note", text: "The official ETHChiangmai site currently mixes its current 2026–27 season metadata with legacy 2025–26 programme entries. This guide shows the current season dates and does not import those older sessions.", url: ETH_HOME });
    const container = $("#source-notices");
    container.querySelector("summary").textContent = `Source notices & methodology (${notices.length + 1 + (schedule.duplicates || []).length})`;
    container.querySelector(":scope > div").innerHTML = `${notices.map((notice) => `<article class="notice ${escapeHtml(notice.tone || "info")}"><p>${escapeHtml(notice.text)}</p>${String(notice.url || "").startsWith("#") ? `<a href="#source-notices">See related entries</a>` : `<a href="${escapeHtml(safeUrl(notice.url) || ETH_HOME)}" rel="noopener noreferrer">Check source ↗</a>`}</article>`).join("")}<article class="notice"><p>SocialLayer’s documented <code>event_union</code> federation allows ETH group browse to include 4Seas-owned rows intentionally; at static build time its browse returned the same public rows and ETag as 4Seas. ETH-owned entries therefore come from the ETH self-calendar, and every row keeps its actual group label. Public event notes, meeting links, owners, attendee data, ticket data, precise coordinates, and membership data are never mirrored.</p><a href="https://api.sola.day/api/v1/groups/ethchiangmai2025/calendar.ics">Verify the ETH calendar source ↗</a></article>${(schedule.duplicates || []).map((duplicate) => `<article class="notice note"><p><strong>${escapeHtml(duplicate.title)}</strong><br>${escapeHtml(duplicate.note)}<br><small>${duplicate.event_keys.map(escapeHtml).join(" · ")}</small></p></article>`).join("")}`;
  }

  async function refreshSchedule(manual = false) {
    if (refreshing) return;
    refreshing = true;
    const button = $("#refresh-button");
    button.disabled = true;
    button.textContent = "Checking sources…";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(WORKER_URL, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(`Proxy returned ${response.status}`);
      const incoming = validateSchedule(await response.json());
      if (!incoming.verifications?.length) incoming.verifications = schedule.verifications || [];
      // Human-reviewed programme milestones intentionally remain static; the Worker updates timed events only.
      if (!incoming.programs) incoming.programs = schedule.programs || null;
      schedule = incoming;
      connectionMode = schedule.stale ? "stale" : "live";
      const allOkay = Object.values(schedule.sources).every((source) => source.status === "ok");
      if (schedule.stale || !allOkay) {
        connectionMode = "stale";
        setConnection("stale", `The proxy returned its last good payload generated ${schedule.generated_at}. Browser render ${new Date().toISOString()}; this is not labelled Live.`);
      } else {
        setConnection("live", `Public sources fetched by the Worker; payload generated ${schedule.generated_at}. Browser render ${new Date().toISOString()}. Source fetch and render times are shown separately below.`);
      }
      populateFilters();
      renderAgenda();
      renderHealth();
      renderNotices();
      if (manual) toast(schedule.stale ? "Last good data loaded; a source is unavailable." : "Public schedule refreshed.");
    } catch {
      setConnection("error", `Refresh unavailable. The ${connectionMode === "live" ? "last good Worker payload" : "static source snapshot"} from ${schedule.generated_at} remains visible; it is not Live. Browser attempt ${new Date().toISOString()}.`);
      if (manual) toast("Could not refresh. Kept the last good data.");
    } finally {
      clearTimeout(timeout);
      refreshing = false;
      button.disabled = false;
      button.textContent = "Refresh sources";
    }
  }

  document.addEventListener("click", (event) => {
    const detail = event.target.closest("[data-detail]");
    if (detail) { event.preventDefault(); openEvent(detail.dataset.detail); return; }
    const save = event.target.closest("[data-save]");
    if (save) { event.preventDefault(); toggleSaved(save.dataset.save); }
  });
  $("#search").addEventListener("input", (event) => { state.query = event.target.value; $("#clear-search").hidden = !state.query; renderAgenda(); });
  $("#clear-search").addEventListener("click", () => { $("#search").value = ""; state.query = ""; $("#clear-search").hidden = true; $("#search").focus(); renderAgenda(); });
  $$('[data-range]').forEach((button) => button.addEventListener("click", () => {
    state.range = button.dataset.range;
    $$('[data-range]').forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
    renderAgenda();
  }));
  $("#source-filter").addEventListener("change", (event) => { state.source = event.target.value; renderAgenda(); });
  $("#tag-filter").addEventListener("change", (event) => { state.tag = event.target.value; renderAgenda(); });
  $("#kind-filter").addEventListener("change", (event) => { state.kind = event.target.value; renderAgenda(); });
  $("#timezone").addEventListener("change", (event) => { state.timezone = event.target.value; renderAgenda(); if (currentDialogKey) openEvent(currentDialogKey, false); });
  $("#reset-filters").addEventListener("click", () => {
    Object.assign(state, { query: "", range: "all", source: "all", tag: "all", kind: "all" });
    $("#search").value = ""; $("#source-filter").value = "all"; $("#tag-filter").value = "all"; $("#kind-filter").value = "all"; $("#clear-search").hidden = true;
    $$('[data-range]').forEach((item) => item.setAttribute("aria-pressed", String(item.dataset.range === "all")));
    renderAgenda();
  });
  $("#refresh-button").addEventListener("click", () => refreshSchedule(true));
  window.addEventListener("hashchange", openFromHash);
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !$("#event-dialog").open && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) { event.preventDefault(); $("#search").focus(); }
  });
  setInterval(() => { if (document.visibilityState === "visible") refreshSchedule(false); }, REFRESH_MS);

  function initPhotoHero() {
    const hero = $("[data-photo-hero]");
    const data = $("#photo-data");
    if (!hero || !data) return;
    const photoData = JSON.parse(data.textContent);
    if (!Array.isArray(photoData) || photoData.length < 2) return;
    const photos = photoData.map((photo) => ({
      ...photo,
      src: photo.src || `./photos/${photo.id}-960.webp`,
      small: photo.small || `./photos/${photo.id}-480.webp`,
      large: photo.large || `./photos/${photo.id}-1440.webp`,
      sourcePage: photo.sourcePage || photo.source_page,
    }));
    const frames = $$('[data-photo-frame]');
    const backdrops = $$('[data-photo-bg]');
    const title = $("[data-photo-title]");
    const link = $("[data-photo-link]");
    const toggle = $("[data-photo-toggle]");
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    hero.dataset.photoId = photos[0].id;
    if (reduced.matches) { toggle.hidden = true; return; }

    let active = 0;
    let current = 0;
    let timer = null;
    let paused = false;
    let inView = true;
    const shuffle = (items) => {
      const output = [...items];
      for (let i = output.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [output[i], output[j]] = [output[j], output[i]];
      }
      return output;
    };
    let queue = shuffle(photos.map((_, index) => index).slice(1));
    const nextIndex = () => {
      if (!queue.length) {
        queue = shuffle(photos.map((_, index) => index));
        if (queue[0] === current) queue.push(queue.shift());
      }
      return queue.shift();
    };
    const show = (index) => {
      const next = 1 - active;
      const photo = photos[index];
      frames[next].src = photo.src;
      frames[next].srcset = `${photo.small} 480w, ${photo.src} 960w, ${photo.large} 1440w`;
      frames[next].sizes = "(max-width: 900px) 100vw, 50vw";
      frames[next].style.objectPosition = photo.position;
      backdrops[next].style.backgroundImage = `url("${photo.large}")`;
      backdrops[next].style.backgroundPosition = photo.position;
      frames[active].classList.remove("is-active");
      backdrops[active].classList.remove("is-active");
      frames[next].classList.add("is-active");
      backdrops[next].classList.add("is-active");
      title.textContent = photo.title;
      link.href = photo.sourcePage;
      hero.dataset.photoId = photo.id;
      active = next;
      current = index;
    };
    const scheduleNext = () => {
      clearTimeout(timer);
      if (paused || document.hidden || !inView) return;
      timer = setTimeout(() => { show(nextIndex()); scheduleNext(); }, 2400);
    };
    toggle.addEventListener("click", () => {
      paused = !paused;
      toggle.setAttribute("aria-pressed", String(paused));
      toggle.textContent = paused ? "Resume photos" : "Pause photos";
      scheduleNext();
    });
    document.addEventListener("visibilitychange", scheduleNext);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; scheduleNext(); }, { threshold: 0.04 }).observe(hero);
    }
    // Preload the community set so fast transitions do not flash empty frames.
    const preload = photos.map((photo) => new Promise((resolve) => {
      const image = new Image();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = window.innerWidth > 900 ? photo.large : photo.src;
    }));
    Promise.race([
      Promise.all(preload),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ]).then(scheduleNext);
  }

  initPhotoHero();
  populateFilters();
  renderAgenda();
  renderHealth();
  if (location.hash.startsWith("#event-")) openFromHash();
})();
