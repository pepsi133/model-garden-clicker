/*
 * Service worker: owns the job queue, the worker tab and the watchdog.
 *
 * All writes to chrome.storage.local go through this file and are
 * serialized with a promise chain, so the content script and the popup
 * never race on a read-modify-write. The content script reads storage
 * directly and sends messages for anything it wants changed.
 *
 * Every run gets a random runId, stored under KEYS.RUN together with a
 * snapshot of live_mode taken at Start. Messages about a job carry that
 * runId and are dropped when it is not the current run's.
 */
import "../common/constants.js";

const K = globalThis.MGC;
const { KEYS, STATUS, PHASE, MSG } = K;

/* ---------------------------------------------------------------- storage */

const get = (keys) => chrome.storage.local.get(keys);
const set = (obj) => chrome.storage.local.set(obj);

let chain = Promise.resolve();
/** Run `fn` after every previously queued mutation has finished. */
function serialized(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function appendLogUnsafe(level, msg, src) {
  const o = await get(KEYS.LOG);
  const log = Array.isArray(o[KEYS.LOG]) ? o[KEYS.LOG] : [];
  log.push({ t: Date.now(), level, src: src || "worker", msg: String(msg) });
  if (log.length > K.LOG_CAP) log.splice(0, log.length - K.LOG_CAP);
  await set({ [KEYS.LOG]: log });
}
function log(level, msg, src) {
  return serialized(() => appendLogUnsafe(level, msg, src));
}

/* ---------------------------------------------------------------- tab */

async function tabExists(tabId) {
  if (typeof tabId !== "number") return false;
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Navigate the run's tab to `url`, creating the tab on first use. Only the
 * creation (the instant after Start) brings the tab to the front; later
 * navigations never activate it, so a user who switched away is not
 * pulled back (nothing in the extension focuses a tab or a window).
 */
async function navigateTo(url) {
  const o = await get(KEYS.TAB_ID);
  const tabId = o[KEYS.TAB_ID];
  if (await tabExists(tabId)) {
    await chrome.tabs.update(tabId, { url });
    return tabId;
  }
  const tab = await chrome.tabs.create({ url, active: true });
  await set({ [KEYS.TAB_ID]: tab.id });
  return tab.id;
}

/* ---------------------------------------------------------------- run control */

/** Effective timing: the advanced settings from storage, else the constants. */
async function timingUnsafe() {
  const o = await get(KEYS.TIMING);
  return o[KEYS.TIMING] && typeof o[KEYS.TIMING] === "object" ? K.timingFrom(o[KEYS.TIMING]) : null;
}
async function watchdogMinutesUnsafe() {
  const t = await timingUnsafe();
  return t ? t.watchdog_min : K.WATCHDOG_MINUTES;
}
async function settleMsUnsafe() {
  const t = await timingUnsafe();
  return t ? t.settle_ms : K.JOB_SETTLE_MS;
}

function newRunId() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** slug -> display name from models.json, or {} when it cannot be read. */
async function modelNames() {
  try {
    const res = await fetch(chrome.runtime.getURL("models.json"));
    const list = await res.json();
    const names = {};
    for (const m of Array.isArray(list) ? list : []) if (m && m.slug && m.name) names[m.slug] = String(m.name);
    return names;
  } catch (e) {
    return {};
  }
}

/**
 * `live` is the mode the popup showed and, in live mode, had confirmed. It
 * must equal the stored setting at this instant: the run's snapshot is the
 * confirmed mode, never a value the options page wrote in between.
 */
async function startRunUnsafe({ projects, models, live }) {
  const o = await get([KEYS.RUNNING, KEYS.SETTINGS]);
  if (o[KEYS.RUNNING] === true) return { ok: false, error: "a run is already in progress" };

  const settings = Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {});
  const missing = K.missingSettings(settings);
  if (missing.length) return { ok: false, error: `fill these options first: ${missing.map((k) => K.SETTINGS_LABELS[k] || k).join(", ")}` };
  if (typeof live !== "boolean") return { ok: false, error: "start request carries no mode; open the popup and start again" };
  if (live !== (settings.live_mode === true)) {
    return { ok: false, error: "live mode changed while starting; look at the popup's mode banner and start again" };
  }

  const projectIds = [...new Set((projects || []).map((p) => String(p).trim()).filter(Boolean))];
  const modelSlugs = [...new Set((models || []).map((m) => String(m).trim()).filter(Boolean))];
  if (!projectIds.length) return { ok: false, error: "no project IDs given" };
  if (!modelSlugs.length) return { ok: false, error: "no models selected" };
  const badProject = projectIds.find((p) => !K.isValidProjectId(p));
  if (badProject) return { ok: false, error: `invalid project ID: ${badProject}` };
  const badModel = modelSlugs.find((m) => !K.isValidModelSlug(m));
  if (badModel) return { ok: false, error: `invalid model slug: ${badModel}` };

  const names = await modelNames();
  const queue = [];
  for (const projectId of projectIds) {
    for (const modelSlug of modelSlugs) {
      queue.push({
        projectId, modelSlug, modelName: names[modelSlug] || null,
        status: STATUS.PENDING, phase: null, message: "", startedAt: null, finishedAt: null,
        productId: null, agreeClicked: false
      });
    }
  }
  const run = { runId: newRunId(), live, startedAt: Date.now(), finishedAt: null, reason: null };
  await set({
    [KEYS.QUEUE]: queue,
    [KEYS.RUNNING]: true,
    [KEYS.STOP_REQUESTED]: false,
    [KEYS.CURRENT]: null,
    [KEYS.TAB_ID]: null,
    [KEYS.RUN]: run,
    [KEYS.SUMMARY_ACK]: null // the previous run's summary, acknowledged or not, is gone with the new Start
  });
  await appendLogUnsafe("info", `run ${run.runId} started: ${projectIds.length} project(s) x ${modelSlugs.length} model(s) = ${queue.length} job(s), mode ${live ? "FULL RUN" : "DRY RUN"}${settings.step_by_step === true ? ", step-by-step confirmation on" : ""}`);
  await advanceUnsafe();
  return { ok: true, jobs: queue.length, runId: run.runId };
}

/**
 * End the run (every reason: all jobs processed, Stop, a lost tab, a
 * reload). The end-of-run summary record is written with the run id and
 * the worker tab's id: the badge in that tab and the popup show the
 * summary until OK (MSG.SUMMARY_ACK) or the next Start. The tab is never
 * activated for it and no notification is raised.
 */
async function finishRunUnsafe(reason) {
  const o = await get([KEYS.RUN, KEYS.TAB_ID]);
  const run = Object.assign({}, o[KEYS.RUN] || {}, { finishedAt: Date.now(), reason });
  await chrome.alarms.clear(K.WATCHDOG_ALARM);
  const updates = { [KEYS.RUNNING]: false, [KEYS.CURRENT]: null, [KEYS.STOP_REQUESTED]: false, [KEYS.TAB_ID]: null, [KEYS.RUN]: run };
  if (typeof run.runId === "string") {
    updates[KEYS.SUMMARY_ACK] = { runId: run.runId, tabId: typeof o[KEYS.TAB_ID] === "number" ? o[KEYS.TAB_ID] : null, reason, ack: false };
  }
  await set(updates);
  await appendLogUnsafe("info", `run finished: ${reason}`);
}

/**
 * OK on the end-of-run summary: from the extension's own UI (the action
 * popup, or the popup opened in a tab; fromTab is null for both), or from
 * the content script of the tab the run used. A content script of any
 * other tab is refused.
 */
async function ackSummaryUnsafe(runId, fromTab) {
  const o = await get(KEYS.SUMMARY_ACK);
  const s = o[KEYS.SUMMARY_ACK];
  if (!s || typeof runId !== "string" || s.runId !== runId) return { ok: false, error: "no summary for that run" };
  if (fromTab !== null && fromTab !== s.tabId) return { ok: false, error: "not the tab the run used" };
  if (s.ack === true) return { ok: true, note: "already acknowledged" };
  await set({ [KEYS.SUMMARY_ACK]: Object.assign({}, s, { ack: true }) });
  await appendLogUnsafe("info", "end-of-run summary acknowledged");
  return { ok: true };
}

async function armWatchdog() {
  await chrome.alarms.clear(K.WATCHDOG_ALARM);
  await chrome.alarms.create(K.WATCHDOG_ALARM, { delayInMinutes: await watchdogMinutesUnsafe() });
}

/** Start the next pending job or finish the run. No-op while a job is running. */
async function advanceUnsafe() {
  const o = await get([KEYS.QUEUE, KEYS.RUNNING, KEYS.STOP_REQUESTED, KEYS.CURRENT]);
  if (o[KEYS.RUNNING] !== true) return;
  if (o[KEYS.STOP_REQUESTED] === true) return finishRunUnsafe("stopped by user");
  if (o[KEYS.CURRENT] && o[KEYS.CURRENT].phase !== PHASE.FINISHED) return; // a job is in progress
  const queue = o[KEYS.QUEUE] || [];
  const idx = queue.findIndex((j) => j.status === STATUS.PENDING);
  if (idx < 0) return finishRunUnsafe("all jobs processed");

  queue[idx] = Object.assign({}, queue[idx], { status: STATUS.RUNNING, phase: PHASE.NAVIGATE, startedAt: Date.now() });
  await set({ [KEYS.QUEUE]: queue, [KEYS.CURRENT]: { jobIndex: idx, phase: PHASE.NAVIGATE, updatedAt: Date.now() } });
  await armWatchdog();
  const url = K.modelUrl(queue[idx].projectId, queue[idx].modelSlug);
  await appendLogUnsafe("info", `job ${idx}: navigating to ${queue[idx].modelSlug} for ${queue[idx].projectId}`);
  try {
    await navigateTo(url);
  } catch (err) {
    await appendLogUnsafe("error", `job ${idx}: could not open tab: ${err.message}`);
    await finishJobUnsafe(idx, STATUS.FAILED, `could not open tab: ${err.message}`);
  }
}

/**
 * Record a result for the current job and move on. stopAfter (the dry-run
 * panel's Stop) asks the run to stop instead of advancing; it is honoured
 * only once the result itself is accepted (the job must be the current,
 * unfinished one), so a late result for an earlier job cannot stop the
 * run after a job nobody pressed Stop for.
 */
async function finishJobUnsafe(jobIndex, status, message, stopAfter) {
  const o = await get([KEYS.QUEUE, KEYS.RUNNING, KEYS.CURRENT]);
  if (o[KEYS.RUNNING] !== true) return;
  const current = o[KEYS.CURRENT];
  if (!current || current.jobIndex !== jobIndex) {
    await appendLogUnsafe("warn", `ignored result for job ${jobIndex} (current is ${current ? current.jobIndex : "none"})${stopAfter === true ? "; its stop request is ignored with it" : ""}`);
    return;
  }
  if (current.phase === PHASE.FINISHED) return;
  const queue = o[KEYS.QUEUE] || [];
  queue[jobIndex] = Object.assign({}, queue[jobIndex], { status, message: String(message || ""), finishedAt: Date.now(), phase: PHASE.FINISHED });
  const updates = { [KEYS.QUEUE]: queue, [KEYS.CURRENT]: Object.assign({}, current, { phase: PHASE.FINISHED, updatedAt: Date.now() }) };
  if (stopAfter === true) updates[KEYS.STOP_REQUESTED] = true;
  await set(updates);
  await chrome.alarms.clear(K.WATCHDOG_ALARM);
  await appendLogUnsafe("info", `job ${jobIndex}: ${status} - ${message}${stopAfter === true ? " (the run stops after this job)" : ""}`);

  // Optional pause (settle_ms, default 0) that leaves the finished job's page
  // on screen before the next job's navigation. If the worker dies during
  // this pause, recoverUnsafe() advances on restart.
  const settle = await settleMsUnsafe();
  if (settle > 0) await new Promise((resolve) => setTimeout(resolve, settle));
  return advanceUnsafe();
}

/** True when `runId` is the current run's id (messages from older runs are dropped). */
async function isCurrentRun(runId) {
  const o = await get([KEYS.RUN, KEYS.RUNNING]);
  return o[KEYS.RUNNING] === true && !!o[KEYS.RUN] && typeof runId === "string" && o[KEYS.RUN].runId === runId;
}

/**
 * A phase change re-arms the watchdog: each phase gets the full budget.
 * The exception is awaiting_confirmation (step-by-step: the page is filled
 * and the panel waits for the user): the watchdog is cleared, since a user
 * may take any time to answer, and `awaiting` names the step (next or
 * agree) on the current record and the job. The next real phase change
 * (the content script sets the page's phase again on Continue) re-arms it.
 */
async function setPhaseUnsafe(jobIndex, phase, awaiting) {
  const o = await get([KEYS.QUEUE, KEYS.CURRENT, KEYS.RUNNING]);
  const current = o[KEYS.CURRENT];
  if (o[KEYS.RUNNING] !== true || !current || current.jobIndex !== jobIndex) return { ok: false };
  if (current.phase === PHASE.FINISHED) return { ok: false };
  if (!Object.values(PHASE).includes(phase)) return { ok: false };
  const waiting = phase === PHASE.AWAITING_CONFIRMATION;
  if (waiting && !Object.values(K.CONFIRM_STEP).includes(awaiting)) return { ok: false, error: "awaiting_confirmation needs a known step" };
  const step = waiting ? awaiting : null;
  const queue = o[KEYS.QUEUE] || [];
  if (queue[jobIndex]) queue[jobIndex] = Object.assign({}, queue[jobIndex], { phase, awaiting: step });
  await set({ [KEYS.QUEUE]: queue, [KEYS.CURRENT]: Object.assign({}, current, { phase, awaiting: step, updatedAt: Date.now() }) });
  if (waiting) {
    await chrome.alarms.clear(K.WATCHDOG_ALARM);
    await appendLogUnsafe("info", `job ${jobIndex}: waiting for your confirmation before ${K.CONFIRM_STEP_LABEL[step] || step} (watchdog paused)`);
  } else {
    await armWatchdog();
    await appendLogUnsafe("debug", `job ${jobIndex}: phase ${phase}`);
  }
  return { ok: true };
}

const JOB_UPDATE_FIELDS = new Set(K.JOB_UPDATE_FIELDS);

async function updateJobUnsafe(jobIndex, fields) {
  const o = await get([KEYS.QUEUE, KEYS.CURRENT, KEYS.RUNNING]);
  const current = o[KEYS.CURRENT];
  if (o[KEYS.RUNNING] !== true || !current || current.jobIndex !== jobIndex) return { ok: false };
  if (current.phase === PHASE.FINISHED) return { ok: false };
  const queue = o[KEYS.QUEUE] || [];
  if (!queue[jobIndex]) return { ok: false };
  const allowed = {};
  for (const [k, v] of Object.entries(fields || {})) if (JOB_UPDATE_FIELDS.has(k)) allowed[k] = v;
  queue[jobIndex] = Object.assign({}, queue[jobIndex], allowed);
  await set({ [KEYS.QUEUE]: queue });
  if (allowed.agreeClickedByUser === true) await appendLogUnsafe("info", `job ${jobIndex}: you clicked the console's Agree yourself; recorded`);
  else if (allowed.agreeClicked === true) await appendLogUnsafe("info", `job ${jobIndex}: Agree click recorded`);
  return { ok: true };
}

async function stopRunUnsafe(reason) {
  const o = await get([KEYS.RUNNING, KEYS.CURRENT, KEYS.QUEUE]);
  if (o[KEYS.RUNNING] !== true) return { ok: true, note: "no run in progress" };
  await set({ [KEYS.STOP_REQUESTED]: true });
  const current = o[KEYS.CURRENT];
  const queue = o[KEYS.QUEUE] || [];
  if (current && queue[current.jobIndex] && queue[current.jobIndex].status === STATUS.RUNNING) {
    queue[current.jobIndex] = Object.assign({}, queue[current.jobIndex], { status: STATUS.STOPPED, message: reason, finishedAt: Date.now(), phase: PHASE.FINISHED });
    await set({ [KEYS.QUEUE]: queue });
  }
  await finishRunUnsafe(reason);
  return { ok: true };
}

/**
 * Worker start: a run that was mid-settle (job finished, next not started)
 * when the worker was terminated would otherwise wait forever, so it is
 * advanced. A run mid-phase keeps going: the content script is still in
 * the tab and its result is handled by this instance.
 *
 * Alarms survive a worker termination, so a running mid-phase job with no
 * watchdog alarm means the extension was disabled and re-enabled (or
 * reloaded without onInstalled firing): the content script is gone from
 * the tab and the user read the silence as "stopped". The run is stopped
 * with a clear result on the job instead of being re-armed and resumed
 * unattended ten minutes later. A browser restart is handled by onStartup.
 */
async function recoverUnsafe() {
  const o = await get([KEYS.RUNNING, KEYS.CURRENT, KEYS.QUEUE]);
  if (o[KEYS.RUNNING] !== true) return;
  const current = o[KEYS.CURRENT];
  if (!current || current.phase === PHASE.FINISHED) {
    await appendLogUnsafe("warn", "worker restarted between jobs; advancing");
    return advanceUnsafe();
  }
  const alarm = await chrome.alarms.get(K.WATCHDOG_ALARM);
  if (alarm) return;
  // A job waiting for the user's Continue has no alarm by design (the
  // watchdog is paused); the worker is routinely terminated while the user
  // thinks. Keep waiting: the panel in the tab, or Stop in the popup, ends
  // it. Unless the worker tab itself is gone (closed while the extension
  // was disabled, so tabs.onRemoved never fired): then nobody can answer
  // the panel and the run is stopped with a result that says so.
  if (current.phase === PHASE.AWAITING_CONFIRMATION) {
    const t = await get(KEYS.TAB_ID);
    if (await tabExists(t[KEYS.TAB_ID])) return;
    await appendLogUnsafe("warn", "worker restarted while a job waited for your confirmation and its tab no longer exists; run stopped");
    return stopRunUnsafe("worker tab is gone while the job waited for your confirmation");
  }
  const reason = "extension was disabled or reloaded during the run";
  const queue = o[KEYS.QUEUE] || [];
  const job = queue[current.jobIndex];
  if (job && job.status === STATUS.RUNNING) {
    const clicked = job.agreeClicked === true;
    queue[current.jobIndex] = Object.assign({}, job, {
      status: clicked ? STATUS.UNVERIFIED : STATUS.STOPPED,
      message: clicked ? `Agree was clicked but the ${reason}; no confirmation observed; check manually` : reason,
      finishedAt: Date.now(),
      phase: PHASE.FINISHED
    });
    await set({ [KEYS.QUEUE]: queue });
  }
  await appendLogUnsafe("warn", `worker restarted mid-job (phase ${current.phase}) without its watchdog alarm: ${reason}; run stopped`);
  await finishRunUnsafe(reason);
}

/* ---------------------------------------------------------------- events */

/**
 * True when the message comes from one of the extension's own pages (the
 * action popup, the popup opened in a tab, the options page): its URL is
 * under the extension's origin. Chrome sets sender.tab for an extension
 * page shown in a normal tab as it does for a content script, so the tab
 * id alone cannot tell the two apart.
 */
function fromExtensionPage(sender) {
  try {
    const base = chrome.runtime.getURL ? chrome.runtime.getURL("") : null;
    return !!(base && sender && typeof sender.url === "string" && sender.url.startsWith(base));
  } catch (e) {
    return false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") return false;
  // fromTab: the tab of a content script; null for the extension's own UI,
  // wherever it is shown, so a job message from the popup-in-a-tab is
  // refused like any UI message and its summary OK is accepted like the
  // action popup's.
  const fromTab = sender && sender.tab && !fromExtensionPage(sender) ? sender.tab.id : null;

  const handle = async () => {
    switch (msg.type) {
      case MSG.START:
        return serialized(() => startRunUnsafe(msg));
      case MSG.STOP:
        return serialized(() => stopRunUnsafe("stopped by user"));
      case MSG.WHOAMI: {
        // isWorkerTab: the tab of the run in progress. showsSummary: the tab
        // the finished run used, while its summary is unacknowledged.
        const o = await get([KEYS.TAB_ID, KEYS.SUMMARY_ACK]);
        const s = o[KEYS.SUMMARY_ACK];
        return {
          isWorkerTab: fromTab !== null && fromTab === o[KEYS.TAB_ID],
          showsSummary: fromTab !== null && !!s && s.ack !== true && s.tabId === fromTab
        };
      }
      case MSG.SUMMARY_ACK:
        return serialized(() => ackSummaryUnsafe(msg.runId, fromTab));
      // The tab and run-id checks run inside the serialized chain, in the
      // same turn as the write they gate: a message checked under one run
      // can never be applied after a STOP and START replaced it.
      case MSG.SET_PHASE:
        return serialized(async () => {
          const refused = await refuseJobMessageUnsafe(fromTab, msg.runId);
          return refused || setPhaseUnsafe(msg.jobIndex, msg.phase, msg.awaiting);
        });
      case MSG.JOB_UPDATE:
        return serialized(async () => {
          const refused = await refuseJobMessageUnsafe(fromTab, msg.runId);
          return refused || updateJobUnsafe(msg.jobIndex, msg.fields);
        });
      case MSG.JOB_RESULT:
        return serialized(async () => {
          const refused = await refuseJobMessageUnsafe(fromTab, msg.runId);
          if (refused) return refused;
          if (!Object.values(STATUS).includes(msg.status)) return { ok: false, error: "unknown status" };
          // stopAfter: the job ends with this result and the run stops
          // instead of advancing (the dry-run panel's Stop button); the
          // flag is set by finishJobUnsafe, after its job index check.
          await finishJobUnsafe(msg.jobIndex, msg.status, msg.message, msg.stopAfter === true);
          return { ok: true };
        });
      case MSG.LOG:
        await log(msg.level || "info", msg.msg, msg.src || (fromTab !== null ? "content" : "ui"));
        return { ok: true };
      case MSG.VERSION: {
        // Lets a harness check that the worker Chrome runs is the one on disk
        // (Chrome caches an unpacked extension's worker script in the profile).
        const manifest = chrome.runtime.getManifest ? chrome.runtime.getManifest() : {};
        return { ok: true, manifest: manifest.version || null, keys: Object.values(KEYS).sort(), messages: Object.values(MSG).sort() };
      }
      default:
        return { ok: false, error: `unknown message type ${msg.type}` };
    }
  };

  handle().then(sendResponse, (err) => sendResponse({ ok: false, error: err && err.message ? err.message : String(err) }));
  return true; // keep the channel open for the async response
});

async function isWorkerTab(tabId) {
  if (tabId === null || tabId === undefined) return false;
  const o = await get(KEYS.TAB_ID);
  return o[KEYS.TAB_ID] === tabId;
}

/** { ok: false, error } when a job message is not from the worker tab of the current run, else null. */
async function refuseJobMessageUnsafe(fromTab, runId) {
  if (!(await isWorkerTab(fromTab))) return { ok: false, error: "not the worker tab" };
  if (!(await isCurrentRun(runId))) return { ok: false, error: "not the current run" };
  return null;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== K.WATCHDOG_ALARM) return;
  serialized(async () => {
    const o = await get([KEYS.RUNNING, KEYS.CURRENT, KEYS.QUEUE]);
    const current = o[KEYS.CURRENT];
    if (o[KEYS.RUNNING] !== true || !current || current.phase === PHASE.FINISHED) return;
    // No alarm is armed while a job waits for confirmation; a stale one that
    // fires anyway (armed before the wait began) must not end the job.
    if (current.phase === PHASE.AWAITING_CONFIRMATION) return;
    const job = (o[KEYS.QUEUE] || [])[current.jobIndex] || {};
    const why = `no result within ${await watchdogMinutesUnsafe()} minutes in phase ${current.phase}`;
    if (job.agreeClicked === true) {
      await finishJobUnsafe(current.jobIndex, STATUS.UNVERIFIED, `Agree was clicked but ${why}; check manually`);
    } else {
      await finishJobUnsafe(current.jobIndex, STATUS.FAILED, `timeout: ${why}`);
    }
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serialized(async () => {
    const o = await get([KEYS.TAB_ID, KEYS.RUNNING]);
    if (o[KEYS.TAB_ID] !== tabId) return;
    await set({ [KEYS.TAB_ID]: null });
    if (o[KEYS.RUNNING] === true) await stopRunUnsafe("worker tab was closed");
  });
});

chrome.runtime.onInstalled.addListener(() => {
  serialized(async () => {
    const o = await get([KEYS.SETTINGS, KEYS.RUNNING]);
    const updates = {};
    if (!o[KEYS.SETTINGS]) updates[KEYS.SETTINGS] = Object.assign({}, K.DEFAULT_SETTINGS);
    await set(updates);
    if (o[KEYS.RUNNING] === true) await stopRunUnsafe("extension was reloaded");
  });
});

chrome.runtime.onStartup.addListener(() => {
  serialized(async () => {
    const o = await get(KEYS.RUNNING);
    if (o[KEYS.RUNNING] === true) await stopRunUnsafe("browser was restarted");
  });
});

// Runs every time the worker is (re)started, including after Chrome
// terminated an idle worker in the middle of a run. Delayed so that the
// onStartup / onInstalled handlers above run first after a browser restart
// or a reload (they end the run instead of resuming it).
setTimeout(() => serialized(recoverUnsafe), K.RECOVER_DELAY_MS);
