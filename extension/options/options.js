/*
 * Options page: load and save the questionnaire values, the mode (a "DRY
 * RUN" box that is stored inverted as live_mode), the step-by-step flag and
 * the advanced timing settings.
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
    const r = await K.saveSettings(chrome.storage.local, s);
    if (!r.ok) {
      syncModeBoxes(r.settings);
      note(r.error, true);
      return;
    }
    await chrome.storage.local.set({ [KEYS.TIMING]: timing.value, [KEYS.RUNS_KEEP]: runsKeep.value });
    form.elements.timing_json.value = timingText(timing.value);
    form.elements.runs_keep.value = String(runsKeep.value);
    note("Saved.", false);
  }

  /** The two mode boxes from a settings object (load, a refused Save, a change made in the popup). */
  function syncModeBoxes(s) {
    form.elements.dry_run.checked = s.live_mode !== true;
    form.elements.step_by_step.checked = s.step_by_step === true;
    syncModeWarning();
  }

  function init() {
    for (const field of CHOICE_FIELDS) buildChoice(field);
    for (const radio of form.querySelectorAll('input[name="aup_additional_requirements"]')) radio.addEventListener("change", syncAup);
    form.elements.dry_run.addEventListener("change", syncModeWarning);
    document.getElementById("timing-keys").textContent = Object.keys(K.TIMING_KEYS).join(", ");
    document.getElementById("timing-reset").addEventListener("click", () => {
      form.elements.timing_json.value = timingText(K.TIMING_DEFAULTS);
    });
    form.addEventListener("submit", save);
    document.getElementById("purge-runs").addEventListener("click", purgeRuns);
    // The popup's header toggles write the same two settings: reflect them
    // here while this page is open (the questionnaire fields are left alone).
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[KEYS.SETTINGS]) return;
        syncModeBoxes(Object.assign({}, K.DEFAULT_SETTINGS, changes[KEYS.SETTINGS].newValue || {}));
      });
    }
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
