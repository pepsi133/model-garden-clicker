/* Popup: build a run, start/stop it, and show results from storage. The same
 * page runs inside the action popup and, through "Open in a tab", in a
 * normal tab: both read the same chrome.storage.local and talk to the same
 * service worker; only the layout class on <html> differs. The header's
 * MODE banner and the step-by-step button toggle their settings in place. */
(function () {
  const K = globalThis.MGC;
  const { KEYS, MSG, STATUS, PHASE } = K;
  const $ = (id) => document.getElementById(id);
  /** Add a listener to the element with `id`; a missing element is warned about, never thrown on. */
  function on(id, event, fn) {
    const el = $(id);
    if (!el) { try { console.warn(`[MG Clicker] popup: no element #${id} to wire ${event} to`); } catch (e) { /* ignore */ } return; }
    el.addEventListener(event, fn);
  }
  /** Set a property on an optional element; a missing one is skipped so a render never aborts on it. */
  function setIf(id, fn) {
    const el = $(id);
    if (el) fn(el);
    return el;
  }

  function send(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (reply) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(reply);
      });
    });
  }

  /* ---------------------------------------------------------- popup or tab */

  function setLayout(mode) {
    document.documentElement.classList.remove("popup", "tab");
    document.documentElement.classList.add(mode);
  }

  /** The page is "in a tab" when it was opened with ?tab=1 (the header link). */
  function detectLayout() {
    setLayout(new URLSearchParams(location.search).has("tab") ? "tab" : "popup");
  }

  function openInTab(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("popup/popup.html?tab=1") });
    window.close();
  }

  /** The Runs page (every run's full log) in a normal tab; the popup itself stays as it is. */
  function openRuns(e) {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("runs/runs.html") });
  }

  /* ---------------------------------------------------------- header toggles */

  /**
   * The MODE banner and the step-by-step button toggle their settings in
   * place through MGC.saveSettings, the same path the options page's Save
   * uses; while a run is active the worker's lock refuses the change and
   * the reason is shown. Switching to FULL RUN asks once; starting a full
   * run asks again.
   */
  async function toggleMode() {
    showError("");
    const o = await chrome.storage.local.get(KEYS.SETTINGS);
    const live = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {}).live_mode === true;
    if (!live) {
      const ok = confirm("Switch to FULL RUN? In a full run the extension clicks Agree and makes Marketplace purchases that bill the project. Starting a full run asks once more.");
      if (!ok) return;
    }
    const r = await K.saveSettings(chrome.storage.local, { live_mode: !live });
    if (!r.ok) showError(r.error);
    render();
  }

  async function toggleStepByStep() {
    showError("");
    const o = await chrome.storage.local.get(KEYS.SETTINGS);
    const on = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {}).step_by_step === true;
    const r = await K.saveSettings(chrome.storage.local, { step_by_step: !on });
    if (!r.ok) showError(r.error);
    render();
  }

  function renderStepToggle(on, running) {
    const btn = $("step-toggle");
    if (!btn) return;
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    setIf("step-toggle-label", (el) => { el.textContent = on ? "slow mode" : "kubardy mode"; });
    // One icon at a time: the snail for slow mode, the warning sign for
    // kubardy mode. The hidden attribute does not apply to inline SVG (it
    // is an HTML attribute), so the display style is set directly.
    setIf("icon-snail", (el) => { el.style.display = on ? "" : "none"; });
    setIf("icon-warning", (el) => { el.style.display = on ? "none" : ""; });
    const lock = running ? " A run is in progress: stop it before changing this." : "";
    btn.title = on
      ? `slow mode: step-by-step confirmation is on. The extension fills each page and waits for your Continue before Next and before Agree. Click for kubardy mode (no pauses).${lock}`
      : `kubardy mode: step-by-step confirmation is off. The extension runs each job through without pausing: no Continue before Next, and in a full run no Continue before Agree. Click for slow mode (a Continue before Next and before Agree).${lock}`;
  }

  /* ---------------------------------------------------------- models.json */

  /**
   * Accepts several shapes so the file can be replaced without code changes:
   *   ["slug", ...]
   *   [{ slug, name?, launchStage? }, ...]   (also "id" instead of "slug")
   *   { models: <either of the above> }
   *   { "slug": "Name" | { name?, ... }, ... }
   */
  function parseModelsFile(data) {
    let list = data;
    if (list && !Array.isArray(list) && typeof list === "object") {
      if (Array.isArray(list.models)) list = list.models;
      else list = Object.entries(list).filter(([k]) => !k.startsWith("_")).map(([slug, v]) =>
        typeof v === "string" ? { slug, name: v } : Object.assign({ slug }, v || {}));
    }
    if (!Array.isArray(list)) return [];
    return list.map((item) => {
      if (typeof item === "string") return { slug: item, name: item };
      const slug = item.slug || item.id;
      if (!slug) return null;
      return { slug, name: item.name || item.label || item.title || slug, launchStage: item.launchStage || "" };
    }).filter(Boolean).filter((m) => K.isValidModelSlug(m.slug));
  }

  async function loadModels() {
    try {
      const res = await fetch(chrome.runtime.getURL("models.json"));
      return parseModelsFile(await res.json());
    } catch (err) {
      showError(`could not read models.json: ${err.message}`);
      return [];
    }
  }

  /**
   * The model checklist. No model is ticked until the user ticks one (a
   * first-use popup must not offer every model of the list to a Start):
   * `selected` is the last selection, kept in popup_state with the
   * project IDs and the extra slugs and restored on every open.
   */
  function renderModels(models, selected) {
    const box = $("models");
    box.textContent = "";
    for (const m of models) {
      const label = document.createElement("label");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = m.slug;
      cb.checked = Array.isArray(selected) && selected.includes(m.slug);
      cb.addEventListener("change", savePopupState);
      label.appendChild(cb);
      label.appendChild(document.createTextNode(" " + m.name));
      if (m.launchStage) {
        const s = document.createElement("span");
        s.className = "stage";
        s.textContent = ` (${m.launchStage})`;
        label.appendChild(s);
      }
      label.title = m.slug;
      box.appendChild(label);
    }
    if (!models.length) box.textContent = "models.json is empty or unreadable; use the extra slugs field.";
  }

  function selectedModels() {
    const ticked = Array.from(document.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    const extra = ($("extra-models") ? $("extra-models").value : "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return [...new Set([...ticked, ...extra])];
  }

  function projectIds() {
    return ($("projects") ? $("projects").value : "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }

  /* ---------------------------------------------------------- state */

  function savePopupState() {
    chrome.storage.local.set({
      [KEYS.POPUP_STATE]: {
        projects: $("projects") ? $("projects").value : "",
        models: Array.from(document.querySelectorAll("#models input:checked")).map((cb) => cb.value),
        extra: $("extra-models") ? $("extra-models").value : ""
      }
    });
  }

  function showError(text) {
    const el = $("error");
    if (!el) { if (text) { try { console.warn("[MG Clicker] popup:", text); } catch (e) { /* ignore */ } } return; }
    el.hidden = !text;
    el.textContent = text || "";
  }

  /**
   * The end-of-run summary block above the results: shown while the
   * finished run's summary is unacknowledged (the same record the worker
   * tab's badge shows), with its own OK that acknowledges it through the
   * worker. Hidden while a run is active or once acknowledged.
   */
  function renderSummary(o, running) {
    const box = $("summary");
    if (!box) return;
    const run = o[KEYS.RUN];
    const pending = !running && K.summaryPending(o[KEYS.SUMMARY_ACK], run);
    box.hidden = !pending;
    box.textContent = "";
    if (!pending) return;
    const s = K.runSummary(o[KEYS.QUEUE] || []);
    const add = (cls, textContent) => { const d = document.createElement("div"); d.className = cls; d.textContent = textContent; box.appendChild(d); return d; };
    add("title", `Run ${run.reason || "finished"}: ${s.total} job(s)`);
    add("counts", K.summaryCountsText(s.counts));
    for (const l of s.lines) add("line", l.text);
    if (s.more > 0) add("more", `and ${s.more} more`);
    const ok = document.createElement("button");
    ok.type = "button";
    ok.id = "summary-ok";
    ok.textContent = "OK";
    ok.addEventListener("click", async () => {
      ok.disabled = true;
      const r = await send({ type: MSG.SUMMARY_ACK, runId: run.runId });
      if (!r || !r.ok) showError((r && r.error) || "could not acknowledge the summary");
      render();
    });
    box.appendChild(ok);
  }

  function fmtTime(t) {
    return t ? new Date(t).toLocaleTimeString() : "";
  }

  function labels(keys) {
    return keys.map((k) => K.SETTINGS_LABELS[k] || k).join(", ");
  }

  let lastRunning = null; // the log opens itself when a run becomes active

  async function render() {
    const o = await chrome.storage.local.get([KEYS.SETTINGS, KEYS.QUEUE, KEYS.CURRENT, KEYS.RUNNING, KEYS.RUN, KEYS.LOG, KEYS.STOP_REQUESTED, KEYS.SUMMARY_ACK]);
    const settings = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {});
    const running = o[KEYS.RUNNING] === true;
    // While a run is active the banner shows the mode the run was started
    // with; the setting cannot change under a run, but the snapshot is the
    // authoritative value.
    const live = running && o[KEYS.RUN] ? o[KEYS.RUN].live === true && settings.live_mode === true : settings.live_mode === true;
    const lock = running ? " A run is in progress: stop it before changing the mode." : "";
    setIf("mode", (mode) => {
      mode.textContent = live ? "MODE: FULL RUN" : "MODE: DRY RUN";
      mode.className = "mode " + (live ? "live" : "dry");
      mode.setAttribute("aria-pressed", live ? "true" : "false");
      mode.title = live
        ? `Full run: the extension clicks Agree and makes purchases that bill the project. Click to switch to DRY RUN.${lock}`
        : `Dry run: fills the forms, stops on the Agreements page, never clicks Agree. Click to switch to FULL RUN (asks for confirmation).${lock}`;
    });
    renderStepToggle(settings.step_by_step === true, running);

    const queue = o[KEYS.QUEUE] || [];
    const current = o[KEYS.CURRENT];

    // Required settings that are still empty: a red notice naming them, and
    // Start is disabled with that reason. The Options button in the header
    // is the way to the options page.
    const missing = K.missingSettings(settings);
    setIf("missing", (missingBox) => {
      missingBox.hidden = missing.length === 0;
      missingBox.textContent = missing.length ? `Missing options: ${labels(missing)}. Fill them in on the Options page.` : "";
    });
    setIf("start", (start) => {
      start.disabled = running || missing.length > 0;
      start.title = running ? "a run is in progress" : (missing.length ? `fill these options first: ${labels(missing)}` : "");
    });
    setIf("stop", (stop) => { stop.disabled = !running; });

    let status;
    let step = "";
    if (running && current && queue[current.jobIndex]) {
      const j = queue[current.jobIndex];
      if (current.phase === PHASE.AWAITING_CONFIRMATION) {
        const which = K.CONFIRM_STEP_LABEL[current.awaiting || j.awaiting] || current.awaiting || j.awaiting || "?";
        status = `waiting for your confirmation on ${j.projectId}/${j.modelSlug}: ${which} (job ${current.jobIndex + 1}/${queue.length})`;
      } else {
        status = `running job ${current.jobIndex + 1}/${queue.length}: ${j.projectId} / ${j.modelSlug} [${current.phase}]`;
      }
      if (o[KEYS.STOP_REQUESTED]) status += " (stopping)";
      // The worker tab's badge step line, mirrored through the job record.
      step = j.step ? `step: ${j.step}` : "";
    } else if (running) {
      status = "running, preparing next job";
    } else if (o[KEYS.RUN] && o[KEYS.RUN].finishedAt) {
      status = `idle; last run ${o[KEYS.RUN].reason} at ${fmtTime(o[KEYS.RUN].finishedAt)}`;
    } else {
      status = "idle";
    }
    const counts = {};
    for (const j of queue) counts[j.status] = (counts[j.status] || 0) + 1;
    const summary = Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ");
    setIf("status", (el) => { el.textContent = summary ? `${status} | ${summary}` : status; });
    setIf("step", (el) => { el.hidden = !step; el.textContent = step; });
    renderSummary(o, running);

    const results = $("results");
    const tbody = results ? results.querySelector("tbody") : null;
    if (tbody) tbody.textContent = "";
    if (tbody) queue.forEach((j) => {
      const tr = document.createElement("tr");
      tr.className = j.status;
      for (const [cls, val] of [["", j.projectId], ["", j.modelSlug], ["st", j.status], ["msg", j.message || (j.status === STATUS.RUNNING ? j.phase || "" : "")]]) {
        const td = document.createElement("td");
        td.className = cls;
        td.textContent = val || "";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });

    const log = o[KEYS.LOG] || [];
    setIf("log", (el) => { el.textContent = log.slice(-50).map((l) => `${fmtTime(l.t)} [${l.level}] ${l.src}: ${l.msg}`).join("\n"); });
    // The log opens when a run is active (at load, or the moment one starts);
    // the user may fold it again, which is kept until the next run starts.
    if (running && lastRunning !== true) setIf("log-details", (el) => { el.open = true; });
    lastRunning = running;
  }

  /* ---------------------------------------------------------- wiring */

  async function init() {
    detectLayout();
    const o = await chrome.storage.local.get(KEYS.POPUP_STATE);
    const ps = o[KEYS.POPUP_STATE] || {};
    setIf("projects", (el) => { el.value = ps.projects || ""; });
    setIf("extra-models", (el) => { el.value = ps.extra || ""; });
    const models = await loadModels();
    if ($("models")) renderModels(models, Array.isArray(ps.models) ? ps.models : null);

    // Every listener goes through on(): a missing element is warned about
    // in the console and skipped, so the rest of the page still works.
    on("projects", "input", savePopupState);
    on("extra-models", "input", savePopupState);
    on("models-all", "click", (e) => { e.preventDefault(); document.querySelectorAll("#models input").forEach((cb) => { cb.checked = true; }); savePopupState(); });
    on("models-none", "click", (e) => { e.preventDefault(); document.querySelectorAll("#models input").forEach((cb) => { cb.checked = false; }); savePopupState(); });
    on("options", "click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
    on("open-tab", "click", openInTab);
    on("runs", "click", openRuns);
    on("mode", "click", toggleMode);
    on("step-toggle", "click", toggleStepByStep);
    on("clear-results", "click", async (e) => {
      e.preventDefault();
      const st = await chrome.storage.local.get(KEYS.RUNNING);
      if (st[KEYS.RUNNING]) { showError("stop the run before clearing results"); return; }
      await chrome.storage.local.set({ [KEYS.QUEUE]: [], [KEYS.RUN]: null, [KEYS.LOG]: [], [KEYS.SUMMARY_ACK]: null });
      render();
    });

    on("start", "click", async () => {
      showError("");
      const projects = projectIds();
      const models = selectedModels();
      const badProject = projects.find((p) => !K.isValidProjectId(p));
      if (!projects.length) return showError("enter at least one project ID");
      if (badProject) return showError(`invalid project ID: ${badProject}`);
      if (!models.length) return showError("select at least one model");
      const badModel = models.find((m) => !K.isValidModelSlug(m));
      if (badModel) return showError(`invalid model slug: ${badModel}`);
      const settings = Object.assign({}, K.DEFAULT_SETTINGS, (await chrome.storage.local.get(KEYS.SETTINGS))[KEYS.SETTINGS] || {});
      const missing = K.missingSettings(settings);
      if (missing.length) return showError(`fill these options first: ${labels(missing)}`);
      const live = settings.live_mode === true;
      // Only a full run asks for a confirmation; a dry run starts at once.
      if (live) {
        const ok = confirm(`FULL RUN: this will click Agree and make purchases that bill the project for ${projects.length * models.length} project/model pair(s). Continue?`);
        if (!ok) return;
      }
      setIf("start", (el) => { el.disabled = true; });
      // The mode shown (and, for a full run, confirmed) travels with the
      // request; the worker refuses to start if the setting changed in between.
      const reply = await send({ type: MSG.START, projects, models, live });
      if (!reply || !reply.ok) { showError((reply && reply.error) || "start failed"); setIf("start", (el) => { el.disabled = false; }); }
      render();
    });

    on("stop", "click", async () => {
      setIf("stop", (el) => { el.disabled = true; });
      await send({ type: MSG.STOP });
      render();
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local") render();
    });
    render();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
