/*
 * Options page: load and save the questionnaire values, the mode (a "DRY
 * RUN" box that is stored inverted as live_mode), the step-by-step flag,
 * the advanced timing settings and the "inside joke" box (the name the
 * popup and this page give step-by-step off: "fast mode" or "kubardy mode").
 *
 * The three dropdown fields are a <select> built from common/option-lists.js
 * plus a text input that is shown for "Other (type the exact console
 * option)". Whatever is chosen, the stored value is the plain option text
 * (the content script picks the console option by that text). A stored
 * value that is not in the list is shown in the "Other" input. A field
 * whose list is empty stays a plain text input.
 */
(function () {
  const K = globalThis.MGC;
  const O = globalThis.MGC_OPTIONS || { OTHER: "Other (type the exact console option)", BY_FIELD: {} };
  const { KEYS } = K;
  const form = document.getElementById("form");
  const CHOICE_FIELDS = ["headquarters", "industry", "intended_users"];

  /* ---------------------------------------------------------- choice fields */

  const choices = {}; // field -> { list, select, input }

  function buildChoice(field) {
    const wrap = form.querySelector(`.choice[data-field="${field}"]`);
    const input = form.elements[field];
    const list = (O.BY_FIELD && O.BY_FIELD[field]) || [];
    if (!wrap || !input || !list.length) {
      if (input) input.required = true;
      choices[field] = { list: [], select: null, input };
      return;
    }
    const select = document.createElement("select");
    select.name = `${field}_choice`;
    select.required = true;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "(choose)";
    select.appendChild(blank);
    for (const text of list) {
      const opt = document.createElement("option");
      opt.value = text;
      opt.textContent = text;
      select.appendChild(opt);
    }
    const other = document.createElement("option");
    other.value = O.OTHER;
    other.textContent = O.OTHER;
    select.appendChild(other);
    wrap.insertBefore(select, input);
    input.placeholder = "exact text of the console option";
    choices[field] = { list, select, input };

    select.addEventListener("change", () => {
      const isOther = select.value === O.OTHER;
      showOther(field, isOther);
      if (!isOther) input.value = select.value;
    });
    // A completed entry in the text input (change: focus left it, or a
    // harness set the value) brings the select in step: a listed value
    // selects it, anything else stays "Other". Keystrokes (input events)
    // never touch the select, so the field cannot hide while it is typed in.
    input.addEventListener("change", () => syncFromValue(field, input.value));
    syncFromValue(field, input.value);
  }

  function showOther(field, visible) {
    const c = choices[field];
    if (!c || !c.select) return;
    c.input.hidden = !visible;
    c.input.required = visible;
  }

  /** Reflect a plain value into the select/input pair. */
  function syncFromValue(field, value) {
    const c = choices[field];
    const v = String(value || "").trim();
    if (!c) return;
    if (!c.select) { c.input.value = v; return; }
    if (!v) { c.select.value = ""; showOther(field, false); return; }
    if (c.list.includes(v)) { c.select.value = v; showOther(field, false); return; }
    c.select.value = O.OTHER;
    c.input.value = v;
    showOther(field, true);
  }

  /**
   * The plain value of a choice field as it will be stored: the select's
   * option, or the text input for "Other". With nothing chosen, text that
   * reached the input without a change event (a script) counts and is
   * reflected into the pair, so Save never drops a typed value.
   */
  function choiceValue(field) {
    const c = choices[field];
    if (!c) return "";
    if (!c.select) return String(c.input.value || "").trim();
    if (c.select.value === O.OTHER) return String(c.input.value || "").trim();
    if (!c.select.value && String(c.input.value || "").trim()) syncFromValue(field, c.input.value);
    if (c.select.value === O.OTHER) return String(c.input.value || "").trim();
    return String(c.select.value || "").trim();
  }

  /* ---------------------------------------------------------- AUP details */

  function aupYes() {
    return form.elements.aup_additional_requirements.value === "yes";
  }
  function syncAup() {
    const yes = aupYes();
    const wrap = document.getElementById("aup-details-wrap");
    wrap.hidden = !yes;
    form.elements.aup_details.required = yes;
  }

  /* ---------------------------------------------------------- timing */

  function timingText(timing) {
    return JSON.stringify(timing, null, 2);
  }

  function parseTiming() {
    const raw = String(form.elements.timing_json.value || "").trim();
    if (!raw) return K.validateTiming({});
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, errors: [`timing is not valid JSON: ${e.message}`], value: null }; }
    return K.validateTiming(obj);
  }

  /* ---------------------------------------------------------- load / save */

  /* ---------------------------------------------------------- logs */

  const RL = globalThis.MGC_RUNLOG;

  /** The "Runs to keep" field: { ok, value } or { ok: false, error }. */
  function parseRunsKeep() {
    const raw = String(form.elements.runs_keep.value || "").trim();
    const [lo, hi] = K.RUNS_KEEP_BOUNDS;
    const n = /^-?\d+$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < lo || n > hi) return { ok: false, error: `Runs to keep must be a whole number between ${lo} and ${hi}.` };
    return { ok: true, value: n };
  }

  function runsKeepError(text) {
    const el = document.getElementById("runs-keep-error");
    el.textContent = text;
    el.hidden = !text;
  }

  function purgeNote(text, isError) {
    const el = document.getElementById("purge-note");
    el.textContent = text;
    el.className = isError ? "error" : "saved";
    el.hidden = !text;
  }

  /** Purge all: the count comes from the database, the confirm states it, the worker deletes. */
  async function purgeRuns() {
    purgeNote("");
    let n = 0;
    try {
      n = await RL.count();
    } catch (err) {
      purgeNote(`Could not count the runs: ${err && err.message ? err.message : err}`, true);
      return;
    }
    if (!n) { purgeNote("No run logs to delete.", false); return; }
    if (!confirm(`Delete the full logs of all ${n} run(s)? The popup's results and its last 50 lines are not affected. A run in progress keeps its log.`)) return;
    const r = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: K.MSG.RUNS_PURGE }, (reply) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(reply || { ok: false, error: "no reply from the worker" });
        });
      } catch (e) { resolve({ ok: false, error: e && e.message ? e.message : String(e) }); }
    });
    if (!r.ok) purgeNote(r.error || "Could not purge the run logs.", true);
    else purgeNote(`${r.deleted} run log(s) deleted${r.kept ? "; the run in progress keeps its log" : ""}.`, false);
  }

  /* ---------------------------------------------------------- settings file */

  // The popup's part of an imported file (project IDs, ticked models, extra
  // slugs) has no field on this page: it is held here and written to the
  // popup's stored state by the next successful Save.
  let pendingPopup = null;

  function configNote(text, isError) {
    const el = document.getElementById("config-note");
    el.textContent = text;
    el.className = isError ? "error" : "saved";
    el.hidden = !text;
  }

  /** Export settings: what is stored, as one JSON file through a blob link (no permission needed). */
  async function exportConfig() {
    configNote("");
    const o = await chrome.storage.local.get([KEYS.SETTINGS, KEYS.TIMING, KEYS.RUNS_KEEP, KEYS.POPUP_STATE]);
    const text = JSON.stringify(K.buildConfig(o), null, 2) + "\n";
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, "0");
    const name = `model-garden-clicker-settings-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    configNote(`Exported ${name} (the stored settings; unsaved edits on this page are not in it).`, false);
  }

  /** Import settings: read the chosen file, check it, fill the page (never the mode); Save keeps it. */
  function importConfig() {
    const input = document.getElementById("config-import");
    const file = input.files && input.files[0];
    if (!file) return;
    configNote("");
    const reader = new FileReader();
    reader.onerror = () => configNote(`Not imported: could not read ${file.name}.`, true);
    reader.onload = () => {
      input.value = ""; // the same file can be chosen again
      finishImport(file.name, String(reader.result)).catch((err) => configNote(`Not imported: ${err && err.message ? err.message : err}`, true));
    };
    reader.readAsText(file);
  }

  /** The slugs of models.json (the popup's checklist), or null when it cannot be read. */
  async function listedModels() {
    try {
      const res = await fetch(chrome.runtime.getURL("models.json"));
      const list = await res.json();
      return Array.isArray(list) ? list.filter((m) => m && typeof m.slug === "string").map((m) => m.slug) : null;
    } catch (e) {
      return null;
    }
  }

  async function finishImport(name, text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { configNote(`Not imported: ${name} is not valid JSON (${e.message}).`, true); return; }
    const r = K.parseConfig(obj);
    if (!r.ok) { configNote(`Not imported, nothing changed: ${r.errors.join("; ")}.`, true); return; }
    const parts = [];
    // Ticked models must be on the popup's checklist; any other slug is
    // moved to the extra slugs, where the popup takes any slug.
    const popup = r.values.popup;
    if (popup.models) {
      const listed = await listedModels();
      if (!listed) parts.push("models.json could not be read, so the ticked models were not checked against the model list.");
      else {
        // Compared case-insensitively; a listed model keeps the list's own
        // spelling (the checklist ticks by exact value), each slug once.
        const byLower = new Map(listed.map((m) => [m.toLowerCase(), m]));
        const known = [], unknown = [], seen = new Set();
        for (const m of popup.models) {
          const key = m.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (byLower.has(key)) known.push(byLower.get(key)); else unknown.push(m);
        }
        popup.models = known;
        if (!popup.models.length) delete popup.models;
        if (unknown.length) {
          const extraSeen = new Set();
          const extra = String(popup.extra || "").split(/[\s,]+/).filter(Boolean).concat(unknown)
            .filter((x) => { const k = x.toLowerCase(); if (extraSeen.has(k)) return false; extraSeen.add(k); return true; });
          popup.extra = extra.join(", ");
          // The cap holds after the move as well.
          if (popup.extra.length > K.CONFIG_TEXT_MAX) {
            configNote(`Not imported, nothing changed: popup.extra is longer than ${K.CONFIG_TEXT_MAX} characters once the ticked models not in the model list are moved into it.`, true);
            return;
          }
          parts.push(`Not in the model list, so moved to the extra slugs: ${unknown.join(", ")}.`);
        }
      }
    }
    const n = applyImport(r.values);
    parts.unshift(`Imported ${n} value(s) from ${name}${r.format === "timing" ? " (a timing-only file)" : ""}. Click Save to keep them.`);
    if (pendingPopup) parts.push("The project IDs and models are written to the popup on Save; if the popup is open, reopen it to see them.");
    // A run in progress refuses a Save that changes step-by-step (the mode
    // cannot change either, and an import never touches it).
    const o = await chrome.storage.local.get([KEYS.SETTINGS, KEYS.RUNNING]);
    const stored = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {});
    if (o[KEYS.RUNNING] === true && "step_by_step" in r.values.settings && r.values.settings.step_by_step !== (stored.step_by_step === true)) {
      parts.push("A run is in progress and the imported step-by-step setting differs from the current one: Save is refused while the run is active. Stop the run first, then Save.");
    }
    if (r.notices.length) parts.push(`Ignored: ${r.notices.join("; ")}.`);
    configNote(parts.join(" "), false);
  }

  /** Fill the page from parsed values (MGC.parseConfig): only what the file sets; the DRY RUN box is never touched. Returns the count. */
  function applyImport(values) {
    let n = 0;
    const s = values.settings || {};
    for (const key of K.SETTINGS_FIELDS) {
      if (!(key in s)) continue;
      const els = form.elements[key];
      if (!els) continue;
      els.value = s[key]; // a RadioNodeList (the AUP answer) takes .value too
      if (CHOICE_FIELDS.includes(key)) syncFromValue(key, s[key]);
      n += 1;
    }
    syncAup();
    if ("step_by_step" in s) { form.elements.step_by_step.checked = s.step_by_step === true; n += 1; }
    if ("inside_joke" in s) { form.elements.inside_joke.checked = s.inside_joke === true; syncStepOffNames(); n += 1; }
    const timing = values.timing || {};
    if (Object.keys(timing).length) {
      let base = {};
      try { const cur = JSON.parse(String(form.elements.timing_json.value || "").trim() || "{}"); if (cur && typeof cur === "object" && !Array.isArray(cur)) base = cur; } catch (e) { base = {}; }
      form.elements.timing_json.value = timingText(Object.assign({}, K.TIMING_DEFAULTS, base, timing));
      n += Object.keys(timing).length;
    }
    if (typeof values.runs_keep === "number") { form.elements.runs_keep.value = String(values.runs_keep); n += 1; }
    const p = values.popup || {};
    pendingPopup = Object.keys(p).length ? Object.assign({}, p) : null;
    n += Object.keys(p).length;
    return n;
  }

  /** Write the imported popup part into the popup's stored state (popup_state only; a run's queue is never touched). */
  async function writePendingPopup() {
    if (!pendingPopup) return;
    const o = await chrome.storage.local.get(KEYS.POPUP_STATE);
    const ps = Object.assign({}, o[KEYS.POPUP_STATE] || {});
    if (pendingPopup.projects) ps.projects = pendingPopup.projects.join("\n");
    if (pendingPopup.models) ps.models = pendingPopup.models.slice();
    if (pendingPopup.extra) ps.extra = pendingPopup.extra;
    // The version marker of this extension, so the popup's once-per-upgrade
    // reset does not clear the imported model selection.
    ps.version = (chrome.runtime && chrome.runtime.getManifest && chrome.runtime.getManifest().version) || ps.version || null;
    await chrome.storage.local.set({ [KEYS.POPUP_STATE]: ps });
    pendingPopup = null;
  }

  /* ---------------------------------------------------------- load / save */

  async function load() {
    const o = await chrome.storage.local.get([KEYS.SETTINGS, KEYS.TIMING, KEYS.RUNS_KEEP]);
    form.elements.runs_keep.value = String(K.runsKeepFrom(o[KEYS.RUNS_KEEP]));
    const s = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {});
    for (const key of K.SETTINGS_FIELDS) {
      const els = form.elements[key];
      if (!els) continue;
      if (els instanceof RadioNodeList) els.value = s[key] || "no";
      else els.value = s[key] || "";
    }
    for (const field of CHOICE_FIELDS) syncFromValue(field, s[field]);
    syncAup();
    // The box reads "DRY RUN" and is stored inverted: live_mode = !dry_run.
    syncModeBoxes(s);
    syncInsideJoke(s);
    form.elements.timing_json.value = timingText(K.timingFrom(o[KEYS.TIMING]));
  }

  /** The red full-run notice under the DRY RUN box, shown while it is unticked. */
  function syncModeWarning() {
    document.getElementById("full-run-warning").hidden = form.elements.dry_run.checked === true;
  }

  function note(text, isError) {
    const el = document.getElementById("saved");
    el.textContent = text;
    el.className = isError ? "error" : "saved";
    el.hidden = false;
    setTimeout(() => { el.hidden = true; }, isError ? 8000 : 2000);
  }

  /** The error line under the Advanced timing field (cleared with ""). */
  function timingError(text) {
    const el = document.getElementById("timing-error");
    el.textContent = text;
    el.hidden = !text;
  }

  /**
   * Save: every check runs before anything is written, and a refused Save
   * leaves the form exactly as the user left it (the questionnaire edits
   * stay in their fields while the timing JSON is corrected). An unexpected
   * error is shown the same way instead of being lost in the console.
   */
  async function save(event) {
    event.preventDefault();
    try {
      await saveChecked();
    } catch (err) {
      note(`Not saved: ${err && err.message ? err.message : err}`, true);
    }
  }

  async function saveChecked() {
    timingError("");
    runsKeepError("");
    const liveWanted = form.elements.dry_run.checked !== true;
    const stepWanted = form.elements.step_by_step.checked === true;
    const s = {};
    for (const key of K.SETTINGS_FIELDS) {
      const els = form.elements[key];
      s[key] = els ? String(els.value || "").trim() : "";
    }
    for (const field of CHOICE_FIELDS) s[field] = choiceValue(field);
    s.aup_additional_requirements = s.aup_additional_requirements === "yes" ? "yes" : "no";
    if (s.aup_additional_requirements !== "yes") s.aup_details = ""; // ignored when the answer is No
    const missing = K.missingSettings(s);
    if (missing.length) {
      note(`Not saved. Fill in: ${missing.map((k) => K.SETTINGS_LABELS[k] || k).join(", ")}.`, true);
      return;
    }
    const timing = parseTiming();
    if (!timing.ok) {
      timingError(`Not saved: ${timing.errors.join("; ")}.`);
      note("Not saved. See the Advanced section.", true);
      return;
    }
    const runsKeep = parseRunsKeep();
    if (!runsKeep.ok) {
      runsKeepError(`Not saved: ${runsKeep.error}`);
      note("Not saved. See the Logs section.", true);
      return;
    }
    // No confirm() here: the box's own wording carries the warning, and the
    // popup asks once more before a full run starts. The write goes through
    // MGC.saveSettings (shared with the popup's header toggles): the mode of
    // a run is fixed when it starts and cannot be changed from under a run
    // that is still working through its jobs, nor can step-by-step.
    s.live_mode = liveWanted;
    s.step_by_step = stepWanted;
    s.inside_joke = form.elements.inside_joke.checked === true;
    const r = await K.saveSettings(chrome.storage.local, s);
    if (!r.ok) {
      syncModeBoxes(r.settings);
      note(r.error, true);
      return;
    }
    await chrome.storage.local.set({ [KEYS.TIMING]: timing.value, [KEYS.RUNS_KEEP]: runsKeep.value });
    form.elements.timing_json.value = timingText(timing.value);
    form.elements.runs_keep.value = String(runsKeep.value);
    const popupToo = !!pendingPopup;
    await writePendingPopup();
    note(popupToo ? "Saved, with the imported project IDs and models for the popup." : "Saved.", false);
  }

  /** The two mode boxes from a settings object (load, a refused Save, a change made in the popup). */
  function syncModeBoxes(s) {
    form.elements.dry_run.checked = s.live_mode !== true;
    form.elements.step_by_step.checked = s.step_by_step === true;
    syncModeWarning();
  }

  /** The inside joke box and every "fast mode" / "kubardy mode" text on the page. */
  function syncInsideJoke(s) {
    form.elements.inside_joke.checked = s.inside_joke === true;
    syncStepOffNames();
  }
  function syncStepOffNames() {
    const name = K.stepOffName({ inside_joke: form.elements.inside_joke.checked === true });
    for (const el of document.querySelectorAll(".step-off-name")) el.textContent = name;
  }

  /** The inside joke box is stored as soon as it changes (text only, allowed during a run); Save stores it too. */
  async function saveInsideJoke() {
    syncStepOffNames();
    // Never refused: the run lock refuses only a mode or step-by-step change.
    await K.saveSettings(chrome.storage.local, { inside_joke: form.elements.inside_joke.checked === true });
  }

  function init() {
    for (const field of CHOICE_FIELDS) buildChoice(field);
    for (const radio of form.querySelectorAll('input[name="aup_additional_requirements"]')) radio.addEventListener("change", syncAup);
    form.elements.dry_run.addEventListener("change", syncModeWarning);
    form.elements.inside_joke.addEventListener("change", saveInsideJoke);
    document.getElementById("timing-keys").textContent = Object.keys(K.TIMING_KEYS).join(", ");
    document.getElementById("timing-reset").addEventListener("click", () => {
      form.elements.timing_json.value = timingText(K.TIMING_DEFAULTS);
    });
    form.addEventListener("submit", save);
    document.getElementById("purge-runs").addEventListener("click", purgeRuns);
    document.getElementById("config-export").addEventListener("click", () => { exportConfig().catch((err) => configNote(`Not exported: ${err && err.message ? err.message : err}`, true)); });
    document.getElementById("config-import").addEventListener("change", importConfig);
    // The popup's header toggles write the same two settings: reflect them
    // here while this page is open (the questionnaire fields are left alone).
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[KEYS.SETTINGS]) return;
        const now = Object.assign({}, K.DEFAULT_SETTINGS, changes[KEYS.SETTINGS].newValue || {});
        const was = changes[KEYS.SETTINGS].oldValue;
        // A write that changed only the inside joke box (its own instant
        // save) leaves an unsaved DRY RUN or step-by-step edit in the form.
        if (!was || (was.live_mode === true) !== (now.live_mode === true) || (was.step_by_step === true) !== (now.step_by_step === true)) syncModeBoxes(now);
        syncInsideJoke(now);
      });
    }
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
