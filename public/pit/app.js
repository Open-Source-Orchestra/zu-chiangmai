(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const normalize = (value) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const state = {
    manifest: null, byId: new Map(), session: null, audioSession: null, originator: null,
    pendingSeek: null, transcriptController: null, transcriptLines: [], deepPromise: null,
    deepRows: [], deepQuery: null, deepMatches: [], deepLimit: 50, deepToken: 0,
  };
  const form = $("#filters");
  const room = $("#session-room");
  const player = $("#player");
  const deepPanel = $("#deep-panel");
  let audio;

  function formatTime(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
  }
  function sessionUrl(id, time) {
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("session", id);
    if (Number.isFinite(Number(time)) && time !== null) url.searchParams.set("t", String(Math.max(0, Math.floor(Number(time)))));
    else url.searchParams.delete("t");
    return url;
  }
  function currentQuery() { return $("#search").value.trim(); }
  function currentMode() { return new FormData(form).get("mode") || "titles"; }
  function selected(id) { return $(`#${id}`).value; }
  function updateUrl() {
    const url = new URL(location.href);
    for (const key of ["q", "type", "phase", "reading", "topic", "lang", "sort", "mode"]) url.searchParams.delete(key);
    const q = currentQuery();
    if (q) url.searchParams.set("q", q);
    const values = { type: selected("type-filter"), phase: selected("phase-filter"), reading: selected("reading-filter"), topic: selected("topic-filter"), lang: selected("language-filter"), sort: selected("sort") };
    for (const [key, value] of Object.entries(values)) if (value !== "all" && !(key === "sort" && value === "curated")) url.searchParams.set(key, value);
    if (currentMode() === "spoken") url.searchParams.set("mode", "spoken");
    history.replaceState({}, "", url);
  }
  function readFiltersFromUrl() {
    const params = new URLSearchParams(location.search);
    $("#search").value = params.get("q") || "";
    const fields = { "type-filter": params.get("type") || "all", "phase-filter": params.get("phase") || "all", "reading-filter": params.get("reading") || "all", "topic-filter": params.get("topic") || "all", "language-filter": params.get("lang") || "all", sort: params.get("sort") || "curated" };
    for (const [id, value] of Object.entries(fields)) if ($$(`#${id} option`).some((option) => option.value === value)) $(`#${id}`).value = value;
    const mode = params.get("mode") === "spoken" ? "spoken" : "titles";
    $(`input[name="mode"][value="${mode}"]`).checked = true;
  }
  function matchesFacets(session) {
    if (selected("type-filter") !== "all" && session.type !== selected("type-filter")) return false;
    if (selected("phase-filter") !== "all" && String(session.phase.id) !== selected("phase-filter")) return false;
    const reading = selected("reading-filter");
    if (reading === "timestamped" && !session.syncAvailable) return false;
    if (!["all", "timestamped"].includes(reading) && session.transcriptStatus !== reading) return false;
    if (selected("topic-filter") !== "all" && !session.topics.includes(selected("topic-filter"))) return false;
    const language = selected("language-filter");
    if (language !== "all" && (session.languages || []).join("+") !== language) return false;
    return true;
  }
  function matchesTitle(session, query) {
    if (!query) return true;
    const haystack = normalize([session.title, session.summary, session.topics.join(" "), session.credits.source, session.credits.speakers.join(" "), session.phase.label, session.type, (session.languages || []).join(" ")].join(" "));
    return normalize(query).split(/\s+/).every((word) => haystack.includes(word));
  }
  function sortedSessions(sessions) {
    const sort = selected("sort");
    return [...sessions].sort((a, b) => {
      if (sort === "oldest") return a.date.localeCompare(b.date) || a.sourceCatalogIndex - b.sourceCatalogIndex;
      if (sort === "newest") return b.date.localeCompare(a.date) || a.sourceCatalogIndex - b.sourceCatalogIndex;
      if (sort === "source") return a.sourceCatalogIndex - b.sourceCatalogIndex;
      return Number(b.startHere) - Number(a.startHere) || a.date.localeCompare(b.date) || a.sourceCatalogIndex - b.sourceCatalogIndex;
    });
  }
  function applyFilters() {
    const query = currentQuery();
    const spoken = currentMode() === "spoken";
    const hasDeep = spoken && state.deepQuery === normalize(query) && query.length >= 3 && !state.deepError;
    const deepIds = hasDeep && state.deepRows.length ? new Set(state.deepMatches.map((row) => row.session.id)) : null;
    let visible = state.manifest.sessions.filter(matchesFacets);
    if (deepIds) visible = visible.filter((session) => deepIds.has(session.id));
    else visible = visible.filter((session) => matchesTitle(session, query));
    visible = sortedSessions(visible);
    const visibleIds = new Set(visible.map((session) => session.id));
    const catalog = $("#catalog");
    for (const session of sortedSessions(state.manifest.sessions)) catalog.append($( `[data-recording][data-id="${session.id}"]`));
    for (const session of state.manifest.sessions) $( `[data-recording][data-id="${session.id}"]`).hidden = !visibleIds.has(session.id);
    $("#empty-results").hidden = visible.length !== 0;
    const filtered = query || ["type-filter", "phase-filter", "reading-filter", "topic-filter", "language-filter"].some((id) => selected(id) !== "all");
    $("#start-here").hidden = Boolean(filtered);
    if (hasDeep) {
      $("#filter-summary").textContent = `${visible.length} recordings · ${state.deepMatches.filter((row) => visibleIds.has(row.session.id)).length} spoken-word excerpts`;
      renderDeepResults(visibleIds);
    } else {
      $("#filter-summary").textContent = `${visible.length} of ${state.manifest.counts.includedSessions} recordings${spoken && query ? " · title/topic fallback until spoken search runs" : ""}`;
    }
    updateUrl();
  }

  async function fetchJsonChecked(url, maxBytes) {
    const response = await fetch(url, { credentials: "omit", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    const length = Number(response.headers.get("content-length") || 0);
    if (length > maxBytes) throw new Error("Response exceeds reviewed size limit");
    const text = await response.text();
    if (text.length > maxBytes) throw new Error("Response exceeds reviewed size limit");
    return JSON.parse(text);
  }
  async function loadDeepIndex() {
    if (state.deepPromise) return state.deepPromise;
    state.deepPromise = (async () => {
      const [catalog, tuples] = await Promise.all([
        fetchJsonChecked(state.manifest.sources.catalog.url, 100_000),
        fetchJsonChecked(state.manifest.sources.searchIndex.url, 2_000_000),
      ]);
      if (!Array.isArray(catalog) || !Array.isArray(tuples) || catalog.length !== state.manifest.counts.sourceSessions || tuples.length !== state.manifest.counts.searchChunks) throw new Error("Catalog/index counts disagree with the reviewed manifest");
      const ids = catalog.map((entry) => entry?.id);
      if (new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) throw new Error("Source catalog IDs are invalid");
      if (state.manifest.sessions.some((session) => !ids.includes(session.id))) throw new Error("Source catalog no longer contains every reviewed local session");
      const rows = tuples.map((tuple, index) => {
        if (!Array.isArray(tuple) || tuple.length !== 3 || !Number.isInteger(tuple[0]) || tuple[0] < 0 || tuple[0] >= catalog.length || !Number.isFinite(tuple[1]) || tuple[1] < 0 || typeof tuple[2] !== "string") throw new Error(`Invalid search tuple ${index}`);
        const id = catalog[tuple[0]].id;
        const session = state.byId.get(id);
        return session ? { session, seconds: tuple[1], text: tuple[2] } : null;
      }).filter(Boolean);
      state.deepRows = rows;
      return rows;
    })().catch((error) => { state.deepPromise = null; throw error; });
    return state.deepPromise;
  }
  function setDeepStatus(message) { $("#deep-status").textContent = message; }
  async function runSpokenSearch() {
    const query = currentQuery();
    state.deepError = null;
    state.deepQuery = null;
    state.deepLimit = 50;
    deepPanel.hidden = false;
    if (query.length < 3) {
      setDeepStatus("Enter at least 3 characters, then explicitly search spoken words. Title/topic matching stays local.");
      applyFilters();
      return;
    }
    const token = ++state.deepToken;
    setDeepStatus(`Loading ${state.manifest.counts.searchChunks.toLocaleString("en-US")} public transcript chunks over ${state.manifest.counts.searchIndexedSessions} recordings… No audio is fetched for search.`);
    try {
      await loadDeepIndex();
      if (token !== state.deepToken) return;
      const needle = normalize(query);
      state.deepMatches = state.deepRows.filter((row) => normalize(row.text).includes(needle) && matchesFacets(row.session));
      state.deepQuery = needle;
      setDeepStatus(`${state.deepMatches.length} matching public transcript chunks. Each timestamp opens its mapped recording and seeks only after media metadata is ready.`);
      applyFilters();
    } catch (error) {
      if (token !== state.deepToken) return;
      state.deepError = true;
      state.deepMatches = [];
      setDeepStatus(`Spoken-word search is unavailable right now (${error.message}). Title/topic results remain available; no positional fallback was used. You can use the original 4SeasPIT source links below.`);
      applyFilters();
    }
  }
  function renderDeepResults(visibleIds = null) {
    const container = $("#deep-results");
    container.replaceChildren();
    const matches = state.deepMatches.filter((row) => matchesFacets(row.session) && (!visibleIds || visibleIds.has(row.session.id)));
    const shown = matches.slice(0, state.deepLimit);
    for (const row of shown) {
      const article = document.createElement("article");
      article.className = "deep-result";
      const link = document.createElement("a");
      link.href = `./?session=${encodeURIComponent(row.session.id)}&t=${Math.floor(row.seconds)}`;
      link.dataset.open = row.session.id;
      link.dataset.time = String(Math.floor(row.seconds));
      const time = document.createElement("time");
      time.textContent = formatTime(row.seconds);
      link.append(time);
      const body = document.createElement("div");
      const titleLink = link.cloneNode(true);
      titleLink.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = row.session.title;
      titleLink.append(title);
      const text = document.createElement("p");
      text.textContent = row.text;
      const note = document.createElement("small");
      note.textContent = `${row.session.date} · machine transcript · open at ${formatTime(row.seconds)}; playback does not start automatically`;
      body.append(titleLink, text, note);
      article.append(link, body);
      container.append(article);
    }
    if (matches.length > shown.length) {
      const more = document.createElement("button");
      more.className = "button";
      more.type = "button";
      more.textContent = `Show more (${shown.length} of ${matches.length} shown)`;
      more.addEventListener("click", () => { state.deepLimit += 50; renderDeepResults(visibleIds); });
      container.append(more);
    } else if (matches.length) {
      const note = document.createElement("small");
      note.textContent = `Showing all ${matches.length} matching excerpt${matches.length === 1 ? "" : "s"}.`;
      container.append(note);
    }
  }

  function createAudio() {
    audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.id = "native-audio";
    audio.setAttribute("aria-label", "Selected recording audio");
    $("#player-audio").append(audio);
    audio.addEventListener("loadedmetadata", () => {
      $("#player-status").textContent = `Ready · actual audio duration ${formatTime(audio.duration)} · press play when you choose.`;
      if (state.pendingSeek !== null) {
        const target = state.pendingSeek;
        state.pendingSeek = null;
        seekAudio(target, false);
      }
    });
    audio.addEventListener("play", () => { $("#player-status").textContent = `Playing ${state.audioSession?.title || "recording"}.`; });
    audio.addEventListener("pause", () => { if (state.audioSession && !audio.ended) $("#player-status").textContent = `Paused at ${formatTime(audio.currentTime)}.`; });
    audio.addEventListener("ended", () => { $("#player-status").textContent = "Recording ended. Silence restored."; });
    audio.addEventListener("waiting", () => { if (!audio.paused) $("#player-status").textContent = "Buffering audio…"; });
    audio.addEventListener("canplay", () => { if (audio.paused && state.pendingSeek === null && state.audioSession) $("#player-status").textContent = `Ready at ${formatTime(audio.currentTime)} · no autoplay.`; });
    audio.addEventListener("error", () => { if (state.audioSession && audio.getAttribute("src")) $("#player-status").textContent = "Audio is unavailable right now. The transcript and original source links remain below; no audio-byte fetch fallback was attempted."; });
    audio.addEventListener("timeupdate", highlightTranscript);
  }
  function silenceAudio() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    state.audioSession = null;
    state.pendingSeek = null;
  }
  function prepareAudio(session, time) {
    if (state.audioSession?.id !== session.id) {
      silenceAudio();
      state.audioSession = session;
      audio.src = session.mediaUrl;
      audio.preload = "metadata";
      audio.playbackRate = Number($("#playback-speed").value);
      audio.load();
    }
    state.pendingSeek = Number.isFinite(time) ? Math.max(0, time) : null;
    player.hidden = false;
    document.body.classList.add("has-player");
    $("#player-title").textContent = session.title;
    $("#player-status").textContent = state.pendingSeek !== null ? `Loading metadata to seek to ${formatTime(state.pendingSeek)}; playback will not start automatically.` : "Loading audio metadata only; press play when you choose.";
  }
  function seekAudio(time, updateRoute = true) {
    if (!state.session) return;
    prepareAudio(state.session, time);
    const targetTime = Math.max(0, Number(time) || 0);
    if (audio.readyState < 1) { state.pendingSeek = targetTime; return; }
    state.pendingSeek = null;
    let end = Number.isFinite(audio.duration) ? audio.duration : targetTime;
    if (audio.seekable.length) end = audio.seekable.end(audio.seekable.length - 1);
    const target = Math.min(targetTime, Math.max(0, end));
    try { audio.currentTime = target; } catch { state.pendingSeek = targetTime; return; }
    $("#player-status").textContent = `Seeking to ${formatTime(target)} · press play when you choose.`;
    if (updateRoute) history.replaceState({}, "", sessionUrl(state.session.id, target));
  }

  function transcriptExplanation(session) {
    if (session.transcriptStatus === "file-no-timestamped-text") return "The source transcript file contains metadata but no timestamped spoken text. Sync and spoken-search affordances are disabled for this recording; no replacement text was invented.";
    if (session.transcriptStatus === "sparse-timestamped-text") return `Sparse machine transcript: ${session.transcriptTimestampCount} timestamped lines. Large silent gaps are expected; this is not every word.`;
    return `Machine transcript · ${session.transcriptTimestampCount} timestamped lines · ${session.searchChunkCount} public search chunks. Recognition errors may remain; quote with a timestamp and the source.`;
  }
  function renderSession(session, time) {
    room.replaceChildren();
    const inner = document.createElement("div");
    inner.className = "session-inner";
    inner.innerHTML = `<div class="session-top"><div><p class="eyebrow">LISTENING / READING ROOM · PHASE ${session.phase.id}</p><h2 tabindex="-1">${esc(session.title)}</h2><p class="session-meta">${esc(session.date)} · ${esc(session.duration)} catalog duration · ${esc(session.phase.label)}</p></div><button class="icon-button" type="button" data-close-session aria-label="Close recording">×</button></div><div class="session-columns"><aside class="session-provenance"><h3>About this recording</h3><p>${esc(session.summary)}</p><div class="session-badges"></div><p><strong>Press play yourself.</strong> The persistent player below uses the canonical MP3 with native byte-range seeking. No audio bytes are fetched by JavaScript.</p><div class="session-provenance-details"></div></aside><div class="session-transcript"><h3>Knowledge Transponder</h3><p class="transcript-explanation">${esc(transcriptExplanation(session))}</p><div class="transcript-content" aria-live="polite"></div></div></div>`;
    const card = $(`[data-recording][data-id="${session.id}"]`);
    $(".session-badges", inner).append($(".badges", card).cloneNode(true));
    const details = $(".provenance", card).cloneNode(true);
    details.removeAttribute("id");
    details.open = true;
    $(".session-provenance-details", inner).append(details);
    room.append(inner);
    room.hidden = false;
    $("[data-close-session]", room).addEventListener("click", () => closeSession(true, true));
    loadTranscript(session);
  }
  function parseTranscript(text, session) {
    if (text.length > 2_000_000) throw new Error("Transcript exceeds the reviewed text-size limit");
    const lines = [];
    for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
      const match = raw.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
      if (match) {
        const seconds = match[3] !== undefined ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : Number(match[1]) * 60 + Number(match[2]);
        lines.push({ seconds, text: match[4] });
      } else if (lines.length && raw.trim()) lines.at(-1).text += `\n${raw}`;
    }
    if (session.syncAvailable && !lines.length) throw new Error("No timestamped text parsed; refusing to invent a transcript");
    return lines;
  }
  async function loadTranscript(session) {
    if (state.transcriptController) state.transcriptController.abort();
    const container = $(".transcript-content", room);
    state.transcriptLines = [];
    if (!session.syncAvailable) {
      const note = document.createElement("p");
      note.textContent = "There is no timestamped spoken text to display. Use the original transcript (.txt) and source links in provenance; sync and per-item spoken search are unavailable.";
      container.append(note);
      return;
    }
    container.textContent = "Loading the existing public machine transcript…";
    const controller = new AbortController();
    state.transcriptController = controller;
    try {
      const response = await fetch(session.transcriptUrl, { credentials: "omit", signal: controller.signal, headers: { Accept: "text/plain" } });
      if (!response.ok) throw new Error(`${response.status} transcript response`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > 2_000_000) throw new Error("Transcript exceeds reviewed size limit");
      const text = await response.text();
      if (controller.signal.aborted || state.session?.id !== session.id) return;
      const lines = parseTranscript(text, session);
      state.transcriptLines = lines;
      container.replaceChildren();
      const list = document.createElement("div");
      list.className = "transcript-lines";
      list.setAttribute("aria-label", "Timestamped machine transcript");
      for (const line of lines) {
        const row = document.createElement("div");
        row.className = "transcript-line";
        row.dataset.seconds = String(line.seconds);
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.seek = String(line.seconds);
        button.textContent = formatTime(line.seconds);
        button.setAttribute("aria-label", `Seek audio to ${formatTime(line.seconds)}; does not autoplay`);
        button.addEventListener("click", () => seekAudio(line.seconds));
        const words = document.createElement("p");
        words.textContent = line.text;
        row.append(button, words);
        list.append(row);
      }
      container.append(list);
    } catch (error) {
      if (error.name === "AbortError" || state.session?.id !== session.id) return;
      container.textContent = `The transcript could not load (${error.message}). No replacement text was generated. Use “Open original transcript (.txt)” in provenance.`;
    }
  }
  function highlightTranscript() {
    if (!state.session || !state.transcriptLines.length || audio.paused) return;
    const time = audio.currentTime;
    let active = null;
    for (const line of state.transcriptLines) {
      if (line.seconds <= time) active = line.seconds;
      else break;
    }
    $$(".transcript-line", room).forEach((row) => row.classList.toggle("is-current", Number(row.dataset.seconds) === active));
  }
  function openSession(id, time = null, push = true, focus = true, originator = null) {
    const session = state.byId.get(id);
    if (!session) { closeSession(false, false); return; }
    if (originator) state.originator = originator;
    if (state.session?.id !== id) {
      if (state.transcriptController) state.transcriptController.abort();
      audio.pause();
      state.session = session;
      renderSession(session, time);
    }
    prepareAudio(session, Number.isFinite(time) ? time : null);
    if (Number.isFinite(time) && audio.readyState >= 1) seekAudio(time, false);
    if (push) history.pushState({}, "", sessionUrl(id, time));
    if (focus) {
      const heading = $("h2", room);
      heading.focus({ preventScroll: true });
      room.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
    }
  }
  function closeSession(push = true, restoreFocus = true) {
    if (state.transcriptController) state.transcriptController.abort();
    state.session = null;
    state.transcriptLines = [];
    room.hidden = true;
    room.replaceChildren();
    silenceAudio();
    player.hidden = true;
    document.body.classList.remove("has-player");
    if (push) {
      const url = new URL(location.href);
      url.searchParams.delete("session"); url.searchParams.delete("t");
      history.pushState({}, "", url);
    }
    if (restoreFocus && state.originator?.isConnected) state.originator.focus({ preventScroll: true });
    state.originator = null;
  }
  function routeFromLocation() {
    const params = new URLSearchParams(location.search);
    readFiltersFromUrl();
    deepPanel.hidden = currentMode() !== "spoken";
    if (currentMode() === "spoken") setDeepStatus("Spoken-word search waits for you to press Search; a shared URL does not auto-load the 1.65 MB index.");
    applyFilters();
    const id = params.get("session");
    if (id && state.byId.has(id)) openSession(id, params.has("t") ? Number(params.get("t")) : null, false, true);
    else if (state.session) closeSession(false, false);
  }

  function bind() {
    document.addEventListener("click", (event) => {
      const opener = event.target.closest("[data-open]");
      if (opener && state.byId.has(opener.dataset.open)) {
        event.preventDefault();
        openSession(opener.dataset.open, opener.dataset.time !== undefined ? Number(opener.dataset.time) : null, true, true, opener);
        return;
      }
      const provenanceLink = event.target.closest("[data-provenance-link]");
      if (provenanceLink) {
        event.preventDefault();
        const card = provenanceLink.closest("[data-recording]");
        const details = $(".provenance", card);
        details.open = true;
        details.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
        $("summary", details).focus({ preventScroll: true });
      }
      const leaving = event.target.closest('a[href^="../"]');
      if (leaving) silenceAudio();
    });
    $$('[data-poster]').forEach((image) => {
      const fail = () => {
        image.hidden = true;
        const fallback = image.parentElement.querySelector(".poster-fallback");
        fallback.replaceChildren();
        const message = document.createElement("p");
        message.className = "poster-error";
        message.textContent = "Poster unavailable. The recording, truthful transcript state and source links remain.";
        fallback.append(message);
      };
      image.addEventListener("error", fail);
      if (image.complete && !image.naturalWidth) fail();
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (currentMode() === "spoken") runSpokenSearch();
      else { state.deepQuery = null; state.deepError = null; deepPanel.hidden = true; applyFilters(); }
    });
    $("#search").addEventListener("input", () => {
      if (currentMode() === "titles") { state.deepQuery = null; applyFilters(); }
      else setDeepStatus("Press Search to explicitly load/query spoken words. No deep index request has been made by typing.");
    });
    $$('input[name="mode"]').forEach((radio) => radio.addEventListener("change", () => {
      deepPanel.hidden = currentMode() !== "spoken";
      state.deepError = null;
      if (currentMode() === "spoken") setDeepStatus(`Explicit action required: load ${state.manifest.counts.searchChunks.toLocaleString("en-US")} public chunks over ${state.manifest.counts.searchIndexedSessions} recordings (about 1.65 MB). No MP3 is fetched for search.`);
      applyFilters();
    }));
    for (const id of ["type-filter", "phase-filter", "reading-filter", "topic-filter", "language-filter", "sort"]) $(`#${id}`).addEventListener("change", () => {
      if (currentMode() === "spoken" && state.deepQuery) state.deepMatches = state.deepRows.filter((row) => normalize(row.text).includes(state.deepQuery));
      applyFilters();
    });
    $("#clear-filters").addEventListener("click", () => {
      form.reset();
      state.deepQuery = null; state.deepMatches = []; state.deepError = null; state.deepLimit = 50;
      deepPanel.hidden = true; $("#deep-results").replaceChildren();
      applyFilters(); $("#search").focus();
    });
    $("#playback-speed").addEventListener("change", () => { audio.playbackRate = Number($("#playback-speed").value); });
    $("#close-player").addEventListener("click", () => { silenceAudio(); player.hidden = true; document.body.classList.remove("has-player"); });
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && state.session) closeSession(true, true); });
    addEventListener("popstate", routeFromLocation);
    addEventListener("pagehide", silenceAudio);
  }

  async function init() {
    try {
      const response = await fetch("./manifest.json", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`${response.status} manifest`);
      const manifest = await response.json();
      if (manifest.spec !== "zu-pit-public-manifest/0.1" || !Array.isArray(manifest.sessions) || manifest.sessions.length !== manifest.counts.includedSessions) throw new Error("Manifest schema/count mismatch");
      state.manifest = manifest;
      state.byId = new Map(manifest.sessions.map((session) => [session.id, session]));
      $$(".nojs-listen").forEach((element) => element.remove());
      createAudio();
      bind();
      document.documentElement.classList.add("js");
      routeFromLocation();
    } catch (error) {
      console.warn(`PIT progressive enhancement unavailable; complete static catalog retained: ${error.message}`);
    }
  }
  init();
})();
