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
    POPUP_STATE: "popup_state",     // last popup inputs: { projects (text), models (ticked slugs), extra (text), version (the manifest version that saved them) }
    RUN: "run",                     // { runId, live, startedAt, finishedAt, reason }: the run's identity and mode snapshot
    TIMING: "timing",               // advanced timing settings (options page "Advanced"); absent = constants below
    SUMMARY_ACK: "summary_ack",     // { runId, tabId, reason, ack }: written when a run ends; the end-of-run summary shows until ack is true (OK) or the next Start clears it
    RUNS_KEEP: "runs_keep",         // integer: how many per-run logs (common/runlog.js, IndexedDB) to keep; absent = RUNS_KEEP_DEFAULT
    PAUSED: "paused"                // boolean: the popup's Pause; the worker starts no new job while true (the job in progress finishes); cleared by Resume, Stop and the run's end
  };

  /*
   * Per-run logs: every log line the worker writes to KEYS.LOG (capped at
   * LOG_CAP) is also appended, uncapped, to the run's record in the
   * extension's IndexedDB (common/runlog.js; the worker is the only writer).
   * When a run starts the oldest records beyond RUNS_KEEP are deleted.
   */
  MGC.RUNS_KEEP_DEFAULT = 50;
  MGC.RUNS_KEEP_BOUNDS = [1, 500];
  /** The effective number of runs to keep from a stored value: an integer within the bounds, else the default. */
  MGC.runsKeepFrom = function (stored) {
    const [lo, hi] = MGC.RUNS_KEEP_BOUNDS;
    return typeof stored === "number" && Number.isInteger(stored) && stored >= lo && stored <= hi ? stored : MGC.RUNS_KEEP_DEFAULT;
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
    VERSION: "mgc:version",         // any -> worker: { manifest, keys } of the worker that is running
    SUMMARY_ACK: "mgc:summary-ack", // popup or worker-tab content -> worker { runId }: OK on the end-of-run summary
    RUNS_DELETE: "mgc:runs-delete", // runs page -> worker { runId }: delete that run's full log (refused for the run in progress)
    RUNS_PURGE: "mgc:runs-purge",   // runs or options page -> worker: delete every full log (the run in progress is kept)
    PAUSE: "mgc:pause",             // popup -> worker: start no new job until RESUME (the job in progress finishes)
    RESUME: "mgc:resume",           // popup -> worker: clear the pause and start the next pending job
    GUARD_PREVIEW: "mgc:guard-preview" // popup -> worker { projects, models }: { total, done, skipped } for the full-run confirm (read-only)
  };

  /* The end-of-run summary: at most this many per-job lines, then "and N more"; messages cut to this length. */
  MGC.SUMMARY_MAX_LINES = 12;
  MGC.SUMMARY_MESSAGE_CHARS = 80;
  MGC.SUMMARY_STATUSES = ["done", "dry-run", "skipped", "failed", "unverified", "stopped"];

  /** True when `summary` (KEYS.SUMMARY_ACK) is the unacknowledged summary of `run`. */
  MGC.summaryPending = function (summary, run) {
    return !!(summary && run && typeof summary.runId === "string" && summary.runId === run.runId && summary.ack !== true);
  };

  /**
   * Counts and per-job lines of a finished run, shared by the worker tab's
   * badge and the popup: { total, counts: { done, "dry-run", skipped,
   * failed, unverified, stopped, pending }, lines: [{ text }], more }.
   * lines holds at most SUMMARY_MAX_LINES entries; more is the number
   * left out.
   */
  MGC.runSummary = function (queue) {
    const jobs = Array.isArray(queue) ? queue : [];
    const counts = {};
    for (const s of MGC.SUMMARY_STATUSES) counts[s] = 0;
    counts.pending = 0;
    for (const j of jobs) {
      const s = MGC.SUMMARY_STATUSES.includes(j.status) ? j.status : "pending";
      counts[s] += 1;
    }
    const lines = jobs.slice(0, MGC.SUMMARY_MAX_LINES).map((j) => {
      let message = String(j.message || "").replace(/\s+/g, " ").trim();
      if (message.length > MGC.SUMMARY_MESSAGE_CHARS) message = message.slice(0, MGC.SUMMARY_MESSAGE_CHARS - 1) + "…";
      const status = j.status || "pending";
      return { text: `${j.projectId} · ${j.modelSlug} · ${status}${message ? ` · ${message}` : ""}` };
    });
    return { total: jobs.length, counts, lines, more: Math.max(0, jobs.length - lines.length) };
  };

  /** "done 1 · dry-run 2 · skipped 0 · ..." (pending only when some job is left pending). */
  MGC.summaryCountsText = function (counts) {
    const parts = MGC.SUMMARY_STATUSES.map((s) => `${s} ${counts[s] || 0}`);
    if (counts.pending) parts.push(`pending ${counts.pending}`);
    return parts.join(" · ");
  };

  /* Job fields the content script may set through JOB_UPDATE. `step` is the
   * current step line shown in the popup (mirrors the worker tab's badge);
   * `agreeClickedByUser` records that the user clicked the console's own
   * Agree while the step-by-step panel was waiting; `purchaseObserved`
   * records that the console reported a purchase with no Agree activation
   * seen (the cross-run guard counts it as done). The trusted Continue
   * itself is recorded only in the content script's memory, for the guard. */
  MGC.JOB_UPDATE_FIELDS = ["productId", "agreeClicked", "agreeClickedByUser", "purchaseObserved", "step"];

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
    AGREE_GRACE: 15000,       // after Agree: how long a success dialog may still arrive once an error dialog that is not the console's refusal opened (live mode only; bounded by CONFIRM)
    API_DIALOG_CLOSE: 120000  // "Enable APIs" dialog to close after its Enable
  };

  /*
   * The console's refusal of a purchase after Agree, as recorded in
   * docs/dom-map.md ("Error"): a behavior-failure-dialog titled "Action
   * Required: Choose Different Billing Account" whose body says the product
   * "cannot be purchased using a billing account currently associated with
   * a free trial". A dialog is a refusal when it holds that component or
   * its title or text carries one of these phrases; any other error dialog
   * after Agree is not taken as the click's outcome (content/actions.js).
   */
  MGC.REFUSAL_PHRASES = ["cannot be purchased", "choose different billing account"];
  /** True when `s` (a dialog's title and text) carries the console's recorded refusal wording. */
  MGC.isRefusalText = function (s) {
    const t = String(s || "").toLowerCase().replace(/\s+/g, " ");
    return MGC.REFUSAL_PHRASES.some((p) => t.includes(p));
  };
  MGC.WATCHDOG_ALARM = "mgc-watchdog";
  MGC.WATCHDOG_MINUTES = 10;
  MGC.LOG_CAP = 500;
  MGC.URL_POLL_MS = 250;                    // content script loop and every D.waitFor poll
  MGC.ENABLED_CONFIRM_MIN_MS = 500;         // model page: the "already enabled" state must hold at least this long (and two polls) before a job is skipped
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
    agree_grace_ms: ["TIMEOUTS", "AGREE_GRACE"],
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
    agree_grace_ms: [1000, 600000],
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
    step_by_step: false,            // true = wait for Continue in the page before Next and before Agree
    inside_joke: false              // options page "inside joke" box: true shows step-by-step off as "kubardy mode", false as "fast mode" (text only)
  };

  /** The user-visible name of step-by-step off: "kubardy mode" with the inside joke box ticked, else "fast mode". */
  MGC.stepOffName = function (settings) {
    return settings && settings.inside_joke === true ? "kubardy mode" : "fast mode";
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

  /*
   * The settings file (options page, Advanced: Export settings / Import
   * settings). One JSON object:
   *   { app, schema, exported, settings: { questionnaire fields,
   *     step_by_step, inside_joke }, popup: { projects: [ids], models:
   *     [ticked slugs], extra: "extra slugs" }, timing: {...}, runs_keep }
   * The DRY RUN / full-run mode (live_mode) is never exported or imported,
   * nor is the per-run "Include pairs already done or skipped" box. A
   * timing-only object (what the Advanced field takes) is the old format
   * and still imports as the timing section.
   */
  MGC.CONFIG_APP = "model-garden-clicker";
  MGC.CONFIG_SCHEMA = 1;
  MGC.CONFIG_TEXT_MAX = 2000;       // the longest text value an import accepts (a longer one is refused, naming the key)
  MGC.CONFIG_SETTINGS_KEYS = MGC.SETTINGS_FIELDS.concat(["step_by_step", "inside_joke"]);
  const CONFIG_TOP_KEYS = ["app", "schema", "exported", "settings", "popup", "timing", "runs_keep"];
  const NEVER_IMPORTED = ["live_mode", "dry_run", "include_done", "includeDone"];
  const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  /** The settings file for what is stored: settings, popup_state, timing and runs_keep as chrome.storage.local holds them. */
  MGC.buildConfig = function (stored) {
    const o = stored || {};
    const s = Object.assign({}, MGC.DEFAULT_SETTINGS, isPlainObject(o[MGC.KEYS.SETTINGS]) ? o[MGC.KEYS.SETTINGS] : {});
    const settings = {};
    for (const k of MGC.CONFIG_SETTINGS_KEYS) settings[k] = k === "step_by_step" || k === "inside_joke" ? s[k] === true : String(s[k] === undefined || s[k] === null ? "" : s[k]);
    const ps = isPlainObject(o[MGC.KEYS.POPUP_STATE]) ? o[MGC.KEYS.POPUP_STATE] : {};
    return {
      app: MGC.CONFIG_APP,
      schema: MGC.CONFIG_SCHEMA,
      exported: new Date().toISOString(),
      settings,
      popup: {
        projects: String(ps.projects || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
        models: Array.isArray(ps.models) ? ps.models.filter((m) => typeof m === "string") : [],
        extra: typeof ps.extra === "string" ? ps.extra : ""
      },
      timing: MGC.timingFrom(o[MGC.KEYS.TIMING]),
      runs_keep: MGC.runsKeepFrom(o[MGC.KEYS.RUNS_KEEP])
    };
  };

  /**
   * Read a parsed settings file. Returns { ok, errors, notices, values,
   * format }: errors name the key of every invalid value (the import is
   * refused as a whole when there is one); notices name the keys that are
   * ignored (unknown keys, and the mode, which is never imported); values
   * holds only what the file sets: { settings: {}, popup: {}, timing: {},
   * runs_keep? }. A missing, null or empty value is left out, so it leaves
   * the current value unchanged; a text value longer than CONFIG_TEXT_MAX
   * is refused. format is "full" or "timing" (the old,
   * timing-only object).
   */
  MGC.parseConfig = function (obj) {
    const errors = [], notices = [];
    const values = { settings: {}, popup: {}, timing: {} };
    if (!isPlainObject(obj)) return { ok: false, errors: ["the file must hold one JSON object"], notices, values, format: null };
    // null means missing, for every key: it leaves the current value and
    // raises no notice.
    const entries = (o) => Object.entries(o).filter(([, v]) => v !== null && v !== undefined);
    const present = (o, k) => own(o, k) && o[k] !== null && o[k] !== undefined;
    const tooLong = (path, text) => {
      if (text.length <= MGC.CONFIG_TEXT_MAX) return false;
      errors.push(`${path} is longer than ${MGC.CONFIG_TEXT_MAX} characters`);
      return true;
    };
    const full = CONFIG_TOP_KEYS.some((k) => own(obj, k));
    const ignore = (path, key) => {
      if (NEVER_IMPORTED.includes(key)) notices.push(`${path} is never imported (the mode and the per-run box stay as they are)`);
      else notices.push(`${path} is not a known key`);
    };
    const takeTiming = (src, prefix) => {
      for (const [k, v] of entries(src)) {
        if (!own(MGC.TIMING_KEYS, k)) { ignore(`${prefix}${k}`, k); continue; }
        const [lo, hi] = MGC.TIMING_BOUNDS[k];
        if (typeof v !== "number" || !Number.isInteger(v) || v < lo || v > hi) { errors.push(`${prefix}${k} must be an integer between ${lo} and ${hi}`); continue; }
        values.timing[k] = v;
      }
    };
    if (!full) {
      takeTiming(obj, "");
      return { ok: errors.length === 0, errors, notices, values, format: "timing" };
    }
    for (const [k] of entries(obj)) if (!CONFIG_TOP_KEYS.includes(k)) ignore(k, k);
    if (present(obj, "app") && obj.app !== MGC.CONFIG_APP) errors.push(`app must be "${MGC.CONFIG_APP}"`);
    if (present(obj, "schema") && !(Number.isInteger(obj.schema) && obj.schema >= 1 && obj.schema <= MGC.CONFIG_SCHEMA)) errors.push(`schema must be an integer from 1 to ${MGC.CONFIG_SCHEMA} (this version reads ${MGC.CONFIG_SCHEMA})`);
    if (present(obj, "settings")) {
      if (!isPlainObject(obj.settings)) errors.push("settings must be an object");
      else for (const [k, v] of entries(obj.settings)) {
        const path = `settings.${k}`;
        if (!MGC.CONFIG_SETTINGS_KEYS.includes(k)) { ignore(path, k); continue; }
        if (k === "step_by_step" || k === "inside_joke") {
          if (typeof v !== "boolean") errors.push(`${path} must be true or false`);
          else values.settings[k] = v;
          continue;
        }
        if (typeof v !== "string") { errors.push(`${path} must be text`); continue; }
        if (tooLong(path, v)) continue;
        const t = v.trim();
        if (!t) continue; // empty: leaves the current value
        if (k === "aup_additional_requirements" && !/^(yes|no)$/i.test(t)) { errors.push(`${path} must be "yes" or "no"`); continue; }
        values.settings[k] = k === "aup_additional_requirements" ? t.toLowerCase() : t;
      }
    }
    if (present(obj, "popup")) {
      const p = obj.popup;
      if (!isPlainObject(p)) errors.push("popup must be an object");
      else for (const [k, v] of entries(p)) {
        const path = `popup.${k}`;
        if (k === "projects") {
          // null entries in a list are missing entries, dropped; the cap
          // applies to the trimmed IDs joined, whether the file gives a list
          // or one text.
          const list = typeof v === "string" ? v.split(/\r?\n/) : Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : v;
          if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) { errors.push(`${path} must be a list of project IDs`); continue; }
          const ids = list.map((x) => x.trim()).filter(Boolean);
          if (tooLong(path, ids.join("\n"))) continue;
          const bad = ids.find((x) => !MGC.isValidProjectId(x));
          if (bad) { errors.push(`${path} holds an invalid project ID: "${bad.slice(0, 60)}"`); continue; }
          if (ids.length) values.popup.projects = ids;
          else notices.push(`${path} holds no project ID, so the current ones are kept`);
        } else if (k === "models") {
          const list = Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined) : v;
          if (!Array.isArray(list) || list.some((x) => typeof x !== "string")) { errors.push(`${path} must be a list of model slugs`); continue; }
          const slugs = list.map((x) => x.trim()).filter(Boolean);
          if (tooLong(path, slugs.join(", "))) continue;
          const bad = slugs.find((x) => !MGC.isValidModelSlug(x));
          if (bad) { errors.push(`${path} holds an invalid model slug: "${bad.slice(0, 60)}"`); continue; }
          if (slugs.length) values.popup.models = slugs;
          else notices.push(`${path} holds no model slug, so the current selection is kept`);
        } else if (k === "extra") {
          if (typeof v !== "string") { errors.push(`${path} must be text`); continue; }
          if (tooLong(path, v)) continue;
          const bad = v.split(/[\s,]+/).filter(Boolean).find((x) => !MGC.isValidModelSlug(x));
          if (bad) { errors.push(`${path} holds an invalid model slug: "${bad.slice(0, 60)}"`); continue; }
          if (v.trim()) values.popup.extra = v.trim();
        } else ignore(path, k);
      }
    }
    if (present(obj, "timing")) {
      if (!isPlainObject(obj.timing)) errors.push("timing must be an object");
      else takeTiming(obj.timing, "timing.");
    }
    if (present(obj, "runs_keep")) {
      const [lo, hi] = MGC.RUNS_KEEP_BOUNDS;
      if (!Number.isInteger(obj.runs_keep) || obj.runs_keep < lo || obj.runs_keep > hi) errors.push(`runs_keep must be an integer between ${lo} and ${hi}`);
      else values.runs_keep = obj.runs_keep;
    }
    return { ok: errors.length === 0, errors, notices, values, format: "full" };
  };

  /**
   * How long the model page's "already enabled" state must hold before a
   * job is skipped: two poll intervals, never under ENABLED_CONFIRM_MIN_MS.
   * The console can render the Agent Studio link a poll before the Enable
   * button, so one poll of margin is not enough; the window follows the
   * poll interval, which the advanced settings can change.
   */
  MGC.enabledConfirmMs = function () {
    return Math.max(MGC.ENABLED_CONFIRM_MIN_MS, 2 * MGC.URL_POLL_MS);
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
