/*
 * Shared constants for every part of the extension.
 *
 * This file is loaded three ways:
 *   - as the first classic content script (manifest "content_scripts"),
 *   - via a <script> tag in the popup and options pages,
 *   - via `import "../common/constants.js"` from the module service worker.
 * It therefore attaches everything to globalThis and uses no module syntax.
 */
(function () {
  if (globalThis.MGC) return;

  const MGC = {};

  /* Keys in chrome.storage.local. Nothing is ever written to storage.sync. */
  MGC.KEYS = {
    SETTINGS: "settings",           // questionnaire values + live_mode + step_by_step
    QUEUE: "queue",                 // array of job objects
    CURRENT: "current",             // { jobIndex, phase, updatedAt } or null
    RUNNING: "running",             // boolean: a run is in progress
    STOP_REQUESTED: "stop_requested", // boolean: stop flag honored by worker + content script
    TAB_ID: "tab_id",               // id of the worker tab used for the run
    LOG: "log",                     // array of { t, level, src, msg }, capped
    POPUP_STATE: "popup_state",     // last popup inputs (projects text, models, extras)
    RUN: "run",                     // { runId, live, startedAt, finishedAt, reason }: the run's identity and mode snapshot
    TIMING: "timing"                // advanced timing settings (options page "Advanced"); absent = constants below
  };

  /* Job phases, written to storage as current.phase. */
  MGC.PHASE = {
    NAVIGATE: "navigate",           // worker navigated the tab; waiting for the model page
    MODEL: "model",                 // on the model page, clicking "Enable"
    QUESTIONNAIRE: "questionnaire", // filling the form, clicking "Next"
    AGREEMENTS: "agreements",       // on the Agreements page
    AWAITING_CONFIRMATION: "awaiting_confirmation", // step-by-step: the page is filled, the panel waits for Continue (current.awaiting names the step)
    FINISHED: "finished"            // a result was reported for this job
  };

  /* Steps a step-by-step run pauses before (current.awaiting / job.awaiting). */
  MGC.CONFIRM_STEP = {
    NEXT: "next",                   // the questionnaire's Next button
    AGREE: "agree",                 // the Agreements page's Agree button (full run only)
    NEXT_JOB: "next-job"            // dry run: the Agreements page is done; "Next job" or "Stop" ends the job
  };
  MGC.CONFIRM_STEP_LABEL = { next: "Next", agree: "Agree", "next-job": "Next job" };
  /* A trusted Continue older than this no longer satisfies the Agree guard. */
  MGC.CONTINUE_MAX_AGE_MS = 5 * 60 * 1000;

  /* Job statuses, stored in queue[i].status. */
  MGC.STATUS = {
    PENDING: "pending",
    RUNNING: "running",
    DONE: "done",                   // live mode: Agree clicked and confirmation observed
    UNVERIFIED: "unverified",       // live mode: Agree clicked, no confirmation observed in time
    DRY_RUN: "dry-run",             // dry run: stopped on the Agreements page before Agree
    SKIPPED: "skipped",             // model already enabled for this project
    FAILED: "failed",
    STOPPED: "stopped"
  };

  /* Page types returned by the detector in content/selectors.js. */
  MGC.PAGE = {
    MODEL: "model",
    QUESTIONNAIRE: "questionnaire",
    AGREEMENTS: "agreements",
    UNKNOWN: "unknown"
  };

  /* Message types exchanged over chrome.runtime. Every content -> worker
   * message about a job carries the runId it belongs to; the worker ignores
   * messages from a run that is no longer the current one. */
  MGC.MSG = {
    START: "mgc:start",             // popup -> worker  { projects: [], models: [], live: bool } (the mode the popup showed)
    STOP: "mgc:stop",               // popup -> worker
    WHOAMI: "mgc:whoami",           // content -> worker: is this the run's worker tab?
    SET_PHASE: "mgc:set-phase",     // content -> worker  { runId, jobIndex, phase, awaiting? } (awaiting: the step, with phase awaiting_confirmation)
    JOB_UPDATE: "mgc:job-update",   // content -> worker  { runId, jobIndex, fields } (whitelisted fields only)
    JOB_RESULT: "mgc:job-result",   // content -> worker  { runId, jobIndex, status, message, stopAfter? } (stopAfter: record the result, then stop the run instead of advancing)
    LOG: "mgc:log",                 // any -> worker      { level, msg }
    VERSION: "mgc:version"          // any -> worker: { manifest, keys } of the worker that is running
  };

  /* Job fields the content script may set through JOB_UPDATE. `step` is the
   * current step line shown in the popup (mirrors the worker tab's badge);
   * `agreeClickedByUser` records that the user clicked the console's own
   * Agree while the step-by-step panel was waiting. The trusted Continue
   * itself is recorded only in the content script's memory, for the guard. */
  MGC.JOB_UPDATE_FIELDS = ["productId", "agreeClicked", "agreeClickedByUser", "step"];

  MGC.CONSOLE_BASE = "https://console.cloud.google.com";
  MGC.MODEL_PATH_PREFIX = "/agent-platform/publishers/anthropic/model-garden/";
  MGC.QUESTIONNAIRE_PATH = "/agent-platform/model-garden/questionnaire";
  MGC.AGREEMENTS_PATH_PREFIX = "/marketplace/agreements/anthropic/";

  /*
   * Time budget. Measured on the live console (docs/dom-map.md, "Flow
   * timing"): the cold shell load takes 16-25 s before the Enable button
   * exists, Enable -> questionnaire form 2-5 s, Next -> Agree button 8-18 s,
   * Agree -> result dialog 5-7 s, "Enable APIs" dialog 8 s to close.
   *
   * The watchdog alarm is re-armed on every phase change, so it bounds one
   * phase, not the whole job. Each phase's budget (phaseBudgetsMs below) is
   * what its handler can wait across MAX_ATTEMPTS_PER_PAGE attempts, plus
   * the "Enable APIs" dialog wait that can precede any of them; the watchdog
   * must exceed the largest. With these defaults the model phase is the
   * largest: 3 x (60 + 45) s + 60 s + 120 s = 495 s, under the 10-minute watchdog.
   *
   * Every value here is a default: the options page ("Advanced") stores an
   * override under KEYS.TIMING (see TIMING_DEFAULTS); the worker and the
   * content script read that and fall back to these constants.
   */
  MGC.TIMEOUTS = {
    MODEL_READY: 60000,       // Enable button or enabled state on the model page
    FORM_READY: 30000,        // questionnaire form rendered
    FORM_VALID: 3000,         // every questionnaire field ng-valid after filling
    NEXT_BUTTON: 10000,       // enabled Next button after filling
    NAV: 45000,               // URL change after Enable (1-4 s) or Next (up to ~18 s)
    AGREEMENTS_READY: 45000,  // terms checkbox rendered
    CONFIRM: 60000,           // confirmation or error dialog after Agree (live mode only)
    API_DIALOG_CLOSE: 120000  // "Enable APIs" dialog to close after its Enable
  };
  MGC.WATCHDOG_ALARM = "mgc-watchdog";
  MGC.WATCHDOG_MINUTES = 10;
  MGC.LOG_CAP = 500;
  MGC.URL_POLL_MS = 250;                    // content script loop and every D.waitFor poll
  MGC.MAX_ATTEMPTS_PER_PAGE = 3;
  MGC.JOB_SETTLE_MS = 0;                    // pause between a job's result and the next job's navigation (0 = none)
  MGC.RECOVER_DELAY_MS = 1500;              // worker start -> check for a run left mid-settle by a terminated worker

  /*
   * Advanced timing settings: the JSON the options page edits. Keys map onto
   * the constants above (ms unless the name says min). TIMING_DEFAULTS is a
   * snapshot taken at load; applyTiming() mutates TIMEOUTS/URL_POLL_MS in
   * place so every module that holds a reference sees the stored values.
   */
  MGC.TIMING_KEYS = {
    model_ready_ms: ["TIMEOUTS", "MODEL_READY"],
    api_dialog_close_ms: ["TIMEOUTS", "API_DIALOG_CLOSE"],
    form_ready_ms: ["TIMEOUTS", "FORM_READY"],
    form_valid_ms: ["TIMEOUTS", "FORM_VALID"],
    next_button_ms: ["TIMEOUTS", "NEXT_BUTTON"],
    nav_ms: ["TIMEOUTS", "NAV"],
    agreements_ready_ms: ["TIMEOUTS", "AGREEMENTS_READY"],
    confirm_ms: ["TIMEOUTS", "CONFIRM"],
    poll_ms: ["URL_POLL_MS"],
    settle_ms: ["JOB_SETTLE_MS"],
    watchdog_min: ["WATCHDOG_MINUTES"]
  };
  /* [min, max] per key; integers only. */
  MGC.TIMING_BOUNDS = {
    model_ready_ms: [1000, 600000],
    api_dialog_close_ms: [1000, 600000],
    form_ready_ms: [1000, 600000],
    form_valid_ms: [500, 60000],
    next_button_ms: [500, 60000],
    nav_ms: [1000, 600000],
    agreements_ready_ms: [1000, 600000],
    confirm_ms: [1000, 600000],
    poll_ms: [50, 5000],
    settle_ms: [0, 60000],
    watchdog_min: [1, 60]
  };
  function readConst(path) {
    return path.length === 2 ? MGC[path[0]][path[1]] : MGC[path[0]];
  }
  MGC.TIMING_DEFAULTS = {};
  for (const [key, path] of Object.entries(MGC.TIMING_KEYS)) MGC.TIMING_DEFAULTS[key] = readConst(path);

  /**
   * What each phase can wait, in ms, across MAX_ATTEMPTS_PER_PAGE attempts
   * (a timed-out wait is retried by the page loop):
   *   model          attempts x (model_ready + nav) + one more model_ready
   *                  after the "Enable APIs" dialog was cleared mid-wait;
   *   questionnaire  attempts x (form_ready + form_valid + next_button + nav);
   *   agreements     attempts x agreements_ready + confirm (the confirm wait
   *                  runs once: its end is the job's result).
   * The watchdog must exceed the largest of these plus api_dialog_close.
   */
  MGC.phaseBudgetsMs = function (t) {
    const n = MGC.MAX_ATTEMPTS_PER_PAGE;
    return {
      model: n * (t.model_ready_ms + t.nav_ms) + t.model_ready_ms,
      questionnaire: n * (t.form_ready_ms + t.form_valid_ms + t.next_button_ms + t.nav_ms),
      agreements: n * t.agreements_ready_ms + t.confirm_ms
    };
  };

  /**
   * Validate a timing object (parsed JSON). Returns { ok, errors, value }:
   * value holds every key (defaults filled in for missing ones) when ok.
   * Unknown keys (including inherited names such as "__proto__" or
   * "constructor"), non-integers and out-of-bounds values are errors, as is
   * a watchdog that does not exceed the largest phase budget plus the
   * "Enable APIs" dialog wait (phaseBudgetsMs).
   */
  MGC.validateTiming = function (obj) {
    const errors = [];
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, errors: ["timing must be a JSON object"], value: null };
    const value = Object.assign({}, MGC.TIMING_DEFAULTS);
    for (const [key, raw] of Object.entries(obj)) {
      if (!Object.prototype.hasOwnProperty.call(MGC.TIMING_KEYS, key)) { errors.push(`unknown key "${key}"`); continue; }
      const [lo, hi] = MGC.TIMING_BOUNDS[key];
      if (typeof raw !== "number" || !Number.isInteger(raw)) { errors.push(`${key} must be an integer`); continue; }
      if (raw < lo || raw > hi) { errors.push(`${key} must be between ${lo} and ${hi}`); continue; }
      value[key] = raw;
    }
    if (!errors.length) {
      const budgets = MGC.phaseBudgetsMs(value);
      const longest = Object.keys(budgets).reduce((a, b) => (budgets[b] > budgets[a] ? b : a));
      const longestMs = budgets[longest] + value.api_dialog_close_ms;
      if (value.watchdog_min * 60000 <= longestMs) {
        errors.push(`watchdog_min must exceed the longest phase budget (${longest} phase plus the "Enable APIs" dialog wait: ${Math.ceil(longestMs / 60000)} min with these values)`);
      }
    }
    return { ok: errors.length === 0, errors, value: errors.length ? null : value };
  };

  /**
   * The effective timing from a stored value: a valid stored object wins,
   * key by key (an invalid key falls back to its default; a stored object
   * that is not an object at all yields the defaults).
   */
  MGC.timingFrom = function (stored) {
    const value = Object.assign({}, MGC.TIMING_DEFAULTS);
    if (!stored || typeof stored !== "object") return value;
    for (const key of Object.keys(MGC.TIMING_KEYS)) {
      const raw = stored[key];
      const [lo, hi] = MGC.TIMING_BOUNDS[key];
      if (typeof raw === "number" && Number.isInteger(raw) && raw >= lo && raw <= hi) value[key] = raw;
    }
    return value;
  };

  /** Write a timing object into the live constants (TIMEOUTS, URL_POLL_MS, ...). */
  MGC.applyTiming = function (timing) {
    const t = MGC.timingFrom(timing);
    for (const [key, path] of Object.entries(MGC.TIMING_KEYS)) {
      if (path.length === 2) MGC[path[0]][path[1]] = t[key]; else MGC[path[0]] = t[key];
    }
    return t;
  };

  MGC.SETTINGS_FIELDS = [
    "business_name",
    "business_website",
    "contact_email",
    "headquarters",
    "industry",
    "intended_users",
    "use_cases",
    "aup_additional_requirements",
    "aup_details"
  ];
  MGC.REQUIRED_SETTINGS = MGC.SETTINGS_FIELDS.filter((k) => k !== "aup_details");
  MGC.SETTINGS_LABELS = {
    business_name: "Business name",
    business_website: "Business website",
    contact_email: "Contact email",
    headquarters: "Headquarters country",
    industry: "Industry",
    intended_users: "Intended users",
    use_cases: "Use cases",
    aup_additional_requirements: "Acceptable Use Policy answer",
    aup_details: "Acceptable Use Policy details"
  };

  /** True when the Acceptable Use Policy answer is "yes". */
  MGC.aupYes = function (settings) {
    return String((settings && settings.aup_additional_requirements) || "").trim().toLowerCase() === "yes";
  };

  /**
   * Keys of the settings that are required but empty. The AUP details are
   * required exactly when the AUP answer is "yes" (the console shows the
   * details field only then). Shared by the worker (Start), the popup (the
   * notice and the disabled Start button) and the options page (Save).
   */
  MGC.missingSettings = function (settings) {
    const s = settings || {};
    const blank = (k) => !String(s[k] === undefined || s[k] === null ? "" : s[k]).trim();
    const missing = MGC.REQUIRED_SETTINGS.filter(blank);
    if (MGC.aupYes(s) && blank("aup_details")) missing.push("aup_details");
    return missing;
  };

  MGC.DEFAULT_SETTINGS = {
    business_name: "",
    business_website: "",
    contact_email: "",
    headquarters: "",
    industry: "",
    intended_users: "",
    use_cases: "",
    aup_additional_requirements: "no",
    aup_details: "",
    live_mode: false,               // false = dry run (the options page shows it as a ticked "DRY RUN" box)
    step_by_step: false             // true = wait for Continue in the page before Next and before Agree
  };

  /**
   * Merge `patch` into the stored settings and write them back. The one
   * write path for settings, shared by the options page (Save) and the
   * popup's header toggles. While a run is active a change of `live_mode`
   * or `step_by_step` is refused (the run keeps the mode and the behaviour
   * it was started with): { ok: false, error, settings: the stored values }.
   * Otherwise { ok: true, settings: what was written }.
   */
  MGC.RUN_LOCK_MESSAGE = "A run is in progress: stop it before changing the mode or step-by-step confirmation. Nothing was saved.";
  MGC.saveSettings = async function (area, patch) {
    const o = await area.get([MGC.KEYS.SETTINGS, MGC.KEYS.RUNNING]);
    const stored = Object.assign({}, MGC.DEFAULT_SETTINGS, o[MGC.KEYS.SETTINGS] || {});
    const next = Object.assign({}, stored, patch || {});
    const modeChanged = (next.live_mode === true) !== (stored.live_mode === true) || (next.step_by_step === true) !== (stored.step_by_step === true);
    if (o[MGC.KEYS.RUNNING] === true && modeChanged) return { ok: false, error: MGC.RUN_LOCK_MESSAGE, settings: stored };
    await area.set({ [MGC.KEYS.SETTINGS]: next });
    return { ok: true, settings: next };
  };

  /** Build the model page URL for a (project, model) pair. */
  MGC.modelUrl = function (projectId, modelSlug) {
    const params = new URLSearchParams({ project: projectId });
    return MGC.CONSOLE_BASE + MGC.MODEL_PATH_PREFIX + encodeURIComponent(modelSlug) + "?" + params.toString();
  };

  /** Cloud project IDs: 6-30 chars, lowercase letters, digits, hyphens, start with a letter. */
  MGC.isValidProjectId = function (s) {
    return /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(s);
  };

  /** Model slugs as used in Model Garden URLs. */
  MGC.isValidModelSlug = function (s) {
    return /^[a-z0-9][a-z0-9._-]{0,99}$/i.test(s);
  };

  /**
   * Lower-case alphanumeric tokens: "Claude Haiku 4.5", "claude-haiku-4-5"
   * and the SKU row text "Claude Haiku 4 5" all become
   * ["claude", "haiku", "4", "5"]. Used to check that a page talks about
   * the job's model.
   */
  MGC.identityTokens = function (s) {
    return String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  };

  /**
   * True when `needle` (a model slug or display name) occurs in `haystack`
   * (page text) as a whole run of tokens whose numeric version is exactly
   * the needle's: "claude-sonnet-5" is not found in "Claude Sonnet 5 5 -
   * Batch ..." (that is Claude Sonnet 5.5) and "claude-sonnet-5-5" is not
   * found in "Claude Sonnet 5 - Batch ...". A match must be followed by a
   * non-digit token or the end of the text, so a longer version never
   * satisfies a shorter one; a digit before the match is tolerated (the
   * family name starts the identity).
   */
  MGC.mentionsIdentity = function (haystack, needle) {
    const key = MGC.identityTokens(needle);
    if (!key.length) return false;
    const body = MGC.identityTokens(haystack);
    const isDigits = (t) => /^[0-9]+$/.test(t);
    for (let i = 0; i + key.length <= body.length; i++) {
      let same = true;
      for (let j = 0; j < key.length; j++) {
        if (body[i + j] !== key[j]) { same = false; break; }
      }
      if (!same) continue;
      const next = body[i + key.length];
      if (next === undefined || !isDigits(next)) return true;
    }
    return false;
  };

  globalThis.MGC = MGC;
})();
