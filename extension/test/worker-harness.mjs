// Fake chrome API, then drive the service worker through a run.
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = {};
const listeners = { message: [], alarm: [], removed: [], installed: [], startup: [] };
const events = [];
let nextTabId = 100;
const tabs = new Map();
let alarm = null; // the single watchdog alarm, { name, delayInMinutes } or null
globalThis.chrome = {
  storage: { local: {
    get: async (keys) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (k in store) o[k] = structuredClone(store[k]); return o; },
    set: async (obj) => { Object.assign(store, structuredClone(obj)); },
  } },
  tabs: {
    create: async ({ url }) => { const id = nextTabId++; tabs.set(id, url); events.push(["tabs.create", id, url]); return { id }; },
    update: async (id, { url }) => { if (!tabs.has(id)) throw new Error("no tab"); tabs.set(id, url); events.push(["tabs.update", id, url]); return { id }; },
    get: async (id) => { if (!tabs.has(id)) throw new Error("no tab"); return { id }; },
    onRemoved: { addListener: (f) => listeners.removed.push(f) },
  },
  alarms: {
    create: async (name, info) => { alarm = { name, delayInMinutes: info.delayInMinutes }; events.push(["alarm.create", name, info.delayInMinutes]); },
    clear: async () => { alarm = null; return true; },
    get: async (name) => (alarm && alarm.name === name ? alarm : undefined),
    onAlarm: { addListener: (f) => listeners.alarm.push(f) },
  },
  runtime: {
    onMessage: { addListener: (f) => listeners.message.push(f) },
    onInstalled: { addListener: (f) => listeners.installed.push(f) },
    onStartup: { addListener: (f) => listeners.startup.push(f) },
    getManifest: () => ({ version: "0.0.0-test" }),
    // no getURL: modelNames() must cope without models.json
  },
};
await import(path.join(EXT, "common/constants.js"));
const K = globalThis.MGC;
K.RECOVER_DELAY_MS = 0;
const SETTLE_MS = K.JOB_SETTLE_MS;
K.JOB_SETTLE_MS = 0; // instant advance for the checks below; check 13 restores it
await import(path.join(EXT, "background/service-worker.js"));
function msg(m, tabId) {
  return new Promise((res) => listeners.message[listeners.message.length - 1](m, tabId ? { tab: { id: tabId } } : {}, res));
}
const settle = () => new Promise((r) => setTimeout(r, 10));
let n = 0;
function assert(c, m) { if (!c) { console.error("FAIL:", m, JSON.stringify(store, null, 1)); process.exit(1); } n++; console.log("ok  ", m); }
const runId = () => store.run && store.run.runId;
/** A START message as the popup sends it: with the mode it showed (the stored setting unless overridden). */
const START = (projects, models, live) => ({ type: K.MSG.START, projects, models, live: live === undefined ? !!(store.settings && store.settings.live_mode === true) : live });

// 1. start without settings -> refused
let r = await msg(START(["proj-one"], ["claude-haiku-4-5"]));
assert(r.ok === false && /fill these options/.test(r.error), "start refused without settings: " + r.error);

store.settings = { business_name: "x", business_website: "https://x.example", contact_email: "a@x.example", headquarters: "Y", industry: "Z", intended_users: "W", use_cases: "u", aup_additional_requirements: "no", aup_details: "", live_mode: false };

// 2. invalid project id refused
r = await msg(START(["Bad_ID"], ["claude-haiku-4-5"]));
assert(r.ok === false && /invalid project/.test(r.error), "invalid project id refused");

// 3. real start: 2 projects x 2 models = 4 jobs, one tab created, first job navigating, run id + mode snapshot stored
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5", "claude-sonnet-4-6"]));
await settle();
assert(r.ok && r.jobs === 4 && typeof r.runId === "string" && r.runId === runId(), "start ok with 4 jobs and a run id: " + r.runId);
assert(store.run.live === false && store.run.startedAt > 0 && store.run.finishedAt === null, "run snapshot: live=false (F2)");
assert(store.running === true && store.current.jobIndex === 0 && store.current.phase === "navigate", "job 0 navigating");
assert(store.queue[0].productId === null && store.queue[0].agreeClicked === false && store.queue[0].modelName === null, "job record starts with no product id, no Agree click, no models.json name here");
assert(events.filter((e) => e[0] === "tabs.create").length === 1, "exactly one tab created");
const tabId = store.tab_id;
assert(tabs.get(tabId) === K.modelUrl("proj-one", "claude-haiku-4-5"), "tab at first model url: " + tabs.get(tabId));
assert(alarm && alarm.delayInMinutes === K.WATCHDOG_MINUTES && K.WATCHDOG_MINUTES >= 7, `watchdog alarm ${K.WATCHDOG_MINUTES} min (above the longest phase budget)`);
const sumPhase = (K.TIMEOUTS.FORM_READY + K.TIMEOUTS.FORM_VALID + K.TIMEOUTS.NEXT_BUTTON + K.TIMEOUTS.NAV) * K.MAX_ATTEMPTS_PER_PAGE + K.TIMEOUTS.API_DIALOG_CLOSE;
assert(K.WATCHDOG_MINUTES * 60000 > sumPhase, `watchdog ${K.WATCHDOG_MINUTES * 60} s > longest phase ${sumPhase / 1000} s (F4)`);
const R1 = runId();

// 4. whoami from the worker tab vs another tab
r = await msg({ type: K.MSG.WHOAMI }, tabId); assert(r.isWorkerTab === true, "whoami worker tab");
r = await msg({ type: K.MSG.WHOAMI }, 999); assert(r.isWorkerTab === false, "whoami other tab");

// 5. phase update rejected from other tab / without the run id / with a stale run id; accepted from worker tab; re-arms the watchdog
r = await msg({ type: K.MSG.SET_PHASE, runId: R1, jobIndex: 0, phase: "model" }, 999); assert(r.ok === false, "phase from other tab rejected");
r = await msg({ type: K.MSG.SET_PHASE, jobIndex: 0, phase: "model" }, tabId); assert(r.ok === false && /current run/.test(r.error), "phase without run id rejected (F3)");
r = await msg({ type: K.MSG.SET_PHASE, runId: "stale-run", jobIndex: 0, phase: "model" }, tabId); assert(r.ok === false && store.current.phase === "navigate", "phase with a stale run id rejected (F3)");
alarm = null;
r = await msg({ type: K.MSG.SET_PHASE, runId: R1, jobIndex: 0, phase: "model" }, tabId); assert(r.ok === true && store.current.phase === "model", "phase set to model");
assert(alarm && alarm.delayInMinutes === K.WATCHDOG_MINUTES, "phase change re-armed the watchdog (F4)");

// 5b. job update: whitelisted fields only, worker tab only, current run only
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R1, jobIndex: 0, fields: { productId: "anthropic/anthropic-867.cloudpartnerservices.goog", status: "done" } }, 999); assert(r.ok === false, "job update from other tab rejected");
r = await msg({ type: K.MSG.JOB_UPDATE, runId: "stale-run", jobIndex: 0, fields: { productId: "x" } }, tabId); assert(r.ok === false && store.queue[0].productId === null, "job update with a stale run id rejected (F3)");
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R1, jobIndex: 0, fields: { productId: "anthropic/anthropic-867.cloudpartnerservices.goog", status: "done", live: true } }, tabId);
assert(r.ok === true && store.queue[0].productId === "anthropic/anthropic-867.cloudpartnerservices.goog" && store.queue[0].status === "running" && !("live" in store.queue[0]), "job update applies productId only");

// 6. result from other tab ignored; result with a stale run id ignored; result from worker tab advances
r = await msg({ type: K.MSG.JOB_RESULT, runId: R1, jobIndex: 0, status: "done", message: "x" }, 999); await settle();
assert(store.current.jobIndex === 0 && store.queue[0].status === "running", "result from other tab ignored");
r = await msg({ type: K.MSG.JOB_RESULT, runId: "stale-run", jobIndex: 0, status: "done", message: "x" }, tabId); await settle();
assert(r.ok === false && store.current.jobIndex === 0 && store.queue[0].status === "running", "result with a stale run id ignored (F3)");
r = await msg({ type: K.MSG.JOB_RESULT, runId: R1, jobIndex: 0, status: "dry-run", message: "stopped before Agree" }, tabId); await settle();
assert(store.queue[0].status === "dry-run" && store.current.jobIndex === 1, "job 0 dry-run, advanced to job 1");
assert(events.filter((e) => e[0] === "tabs.update").length === 1 && tabs.get(tabId).includes("claude-sonnet-4-6"), "same tab navigated to job 1");

// 7. stale result for job 0 ignored
r = await msg({ type: K.MSG.JOB_RESULT, runId: R1, jobIndex: 0, status: "failed", message: "late" }, tabId); await settle();
assert(store.queue[0].status === "dry-run" && store.current.jobIndex === 1, "stale result ignored");

// 7b. unknown status refused
r = await msg({ type: K.MSG.JOB_RESULT, runId: R1, jobIndex: 1, status: "agreed", message: "x" }, tabId); await settle();
assert(r.ok === false && store.queue[1].status === "running", "unknown status refused");

// 8. watchdog fires -> job 1 failed timeout, advance to 2
for (const f of listeners.alarm) f({ name: K.WATCHDOG_ALARM }); await settle();
assert(store.queue[1].status === "failed" && /timeout/.test(store.queue[1].message) && store.current.jobIndex === 2, "watchdog timeout advanced: " + store.queue[1].message);

// 8b. watchdog after a recorded Agree click -> unverified, not failed (F4)
r = await msg({ type: K.MSG.SET_PHASE, runId: R1, jobIndex: 2, phase: "agreements" }, tabId);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R1, jobIndex: 2, fields: { agreeClicked: true } }, tabId); assert(r.ok === true && store.queue[2].agreeClicked === true, "Agree click recorded on job 2");
for (const f of listeners.alarm) f({ name: K.WATCHDOG_ALARM }); await settle();
assert(store.queue[2].status === "unverified" && /Agree was clicked/.test(store.queue[2].message) && store.current.jobIndex === 3, "watchdog after Agree -> unverified (F4): " + store.queue[2].message);

// 9. stop -> job 3 stopped, run finished, tab id cleared
r = await msg({ type: K.MSG.STOP }); await settle();
assert(store.running === false && store.current === null && store.tab_id === null && store.queue[3].status === "stopped", "stop ended run and released the tab");
assert(store.run.finishedAt > 0 && store.run.reason === "stopped by user" && store.run.runId === R1, "run record closed with the reason");

// 10. stop then start: the old run's tab and run id are dead at once (F3)
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t2 = store.tab_id; const R2 = runId();
assert(r.ok && t2 !== tabId && R2 !== R1, "second run opened a new tab with a new run id");
r = await msg({ type: K.MSG.WHOAMI }, tabId); assert(r.isWorkerTab === false, "old worker tab is not the worker any more");
r = await msg({ type: K.MSG.JOB_RESULT, runId: R1, jobIndex: 0, status: "done", message: "from the old run" }, t2); await settle();
assert(r.ok === false && store.queue[0].status === "running", "result carrying the old run id is dropped by the new run (F3)");
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R1, jobIndex: 0, fields: { agreeClicked: true } }, t2);
assert(r.ok === false && store.queue[0].agreeClicked === false, "job update carrying the old run id is dropped (F3)");

// 10b. live snapshot: a run started in live mode records live=true; a second START while it runs is refused and cannot replace the snapshot (F2)
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.live_mode = true;
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(store.run.live === true, "run started live records live=true in the snapshot (F2)");
const R3 = runId();
store.settings.live_mode = false;
r = await msg(START(["proj-two"], ["claude-sonnet-4-6"])); await settle();
assert(r.ok === false && /already in progress/.test(r.error) && runId() === R3 && store.run.live === true && store.queue.length === 1, "second START while running is refused; run id and live snapshot untouched (F2)");
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.live_mode = false;

// 10c. the START message carries the mode the popup showed; the worker refuses a mismatch and a missing mode (N5)
store.settings.live_mode = true; // the options page wrote live=true after the popup read false and asked nothing
r = await msg(START(["proj-one"], ["claude-haiku-4-5"], false)); await settle();
assert(r.ok === false && /live mode changed/.test(r.error) && store.running !== true, "START with live=false while the setting is live is refused (N5): " + r.error);
store.settings.live_mode = false;
r = await msg(START(["proj-one"], ["claude-haiku-4-5"], true)); await settle();
assert(r.ok === false && /live mode changed/.test(r.error) && store.running !== true, "START with live=true while the setting is dry is refused (N5)");
r = await msg({ type: K.MSG.START, projects: ["proj-one"], models: ["claude-haiku-4-5"] }); await settle();
assert(r.ok === false && /no mode/.test(r.error) && store.running !== true, "START without a mode is refused (N5): " + r.error);
store.settings.live_mode = true;
r = await msg(START(["proj-one"], ["claude-haiku-4-5"], true)); await settle();
assert(r.ok === true && store.run.live === true, "START with the matching confirmed mode starts live (N5)");
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.live_mode = false;

// 11. worker tab closed mid-run stops the run
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t3 = store.tab_id; tabs.delete(t3); for (const f of listeners.removed) f(t3); await settle();
assert(store.running === false && store.queue[0].status === "stopped" && /tab was closed/.test(store.queue[0].message), "tab close stops run");

// 11b. version message answers with the manifest version and the storage keys of the running worker
r = await msg({ type: K.MSG.VERSION });
assert(r.ok === true && r.manifest === "0.0.0-test" && JSON.stringify(r.keys) === JSON.stringify(Object.values(K.KEYS).sort()), "version message reports manifest and keys");

// 12. log cap
for (let i = 0; i < 520; i++) await msg({ type: K.MSG.LOG, level: "info", msg: "line " + i });
assert(store.log.length === K.LOG_CAP, "log capped at " + K.LOG_CAP);
assert(!("sync" in store), "no sync storage touched");

// 13. settle delay: the result is recorded at once, the next job starts after JOB_SETTLE_MS
K.JOB_SETTLE_MS = 60;
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t4 = store.tab_id;
// the reply only arrives after the settle, so sample storage while the result message is still being handled
let pending = msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, t4); await settle();
assert(store.queue[0].status === "dry-run" && store.current.jobIndex === 0 && store.current.phase === "finished", "result recorded, advance held during the settle delay");
await pending; await settle();
assert(store.current.jobIndex === 1 && tabs.get(t4).includes("proj-two"), "advanced to job 1 after the settle delay");
r = await msg({ type: K.MSG.STOP }); await settle();
assert(SETTLE_MS === 0, "shipped JOB_SETTLE_MS is 0: the next job starts the instant a result is recorded");

// 13b. advanced timing from storage: watchdog minutes and settle delay come from KEYS.TIMING, invalid values fall back
store.timing = { watchdog_min: 3, settle_ms: 60, poll_ms: "fast", nav_ms: -5 };
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
assert(alarm && alarm.delayInMinutes === 3, "watchdog armed with watchdog_min from the stored timing (3)");
pending = msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, store.tab_id); await settle();
assert(store.current.jobIndex === 0 && store.current.phase === "finished", "stored settle_ms holds the advance");
await pending; await settle();
assert(store.current.jobIndex === 1, "advanced after the stored settle_ms");
r = await msg({ type: K.MSG.STOP }); await settle();
// the two keys the worker reads, both invalid, fall back to the constants while the run proceeds
store.timing = { watchdog_min: "x", settle_ms: -1, poll_ms: 60 };
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
assert(alarm && alarm.delayInMinutes === K.WATCHDOG_MINUTES, "invalid watchdog_min in the stored timing: the worker arms the constant (" + K.WATCHDOG_MINUTES + ")");
pending = msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, store.tab_id); await pending; await settle();
assert(store.current.jobIndex === 1 && tabs.get(store.tab_id).includes("proj-two"), "invalid settle_ms in the stored timing: the worker advances at once (constant 0)");
r = await msg({ type: K.MSG.STOP }); await settle();
delete store.timing;
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(alarm && alarm.delayInMinutes === K.WATCHDOG_MINUTES, "without stored timing the watchdog uses the constant again");
r = await msg({ type: K.MSG.STOP }); await settle();

// 13c. the AUP details are required when the answer is yes; a job's step line is a whitelisted update
store.settings.aup_additional_requirements = "yes"; store.settings.aup_details = "";
r = await msg(START(["proj-one"], ["claude-haiku-4-5"]));
assert(r.ok === false && /fill these options first: Acceptable Use Policy details/.test(r.error), "start refused: AUP answer yes without details: " + r.error);
store.settings.aup_details = "reviewed";
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(r.ok === true, "start ok once the details are filled");
r = await msg({ type: K.MSG.JOB_UPDATE, runId: runId(), jobIndex: 0, fields: { step: "waiting for Enable button", status: "done" } }, store.tab_id);
assert(r.ok === true && store.queue[0].step === "waiting for Enable button" && store.queue[0].status === "running", "step is a whitelisted job update, status is not");
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.aup_additional_requirements = "no"; store.settings.aup_details = "";

// 14. worker terminated during the settle: a fresh worker instance on the same storage advances the run (F5)
K.JOB_SETTLE_MS = 5000; // the old instance's timer stands in for a worker that never wakes up
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t5 = store.tab_id;
pending = msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, t5); await settle();
assert(store.running === true && store.current.jobIndex === 0 && store.current.phase === "finished" && alarm === null, "run is mid-settle: job 0 finished, nothing advanced, no watchdog");
const before = listeners.message.length;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=2"); // fresh module instance, same chrome + storage
await settle(); await settle();
assert(listeners.message.length === before + 1, "fresh worker instance registered its listeners");
assert(store.current.jobIndex === 1 && store.current.phase === "navigate" && tabs.get(t5).includes("proj-two") && alarm !== null, "fresh instance advanced the run to job 1 and armed the watchdog (F5)");
assert(store.log.some((l) => /worker restarted between jobs/.test(l.msg)), "recovery was logged");
K.JOB_SETTLE_MS = 0;
await pending; await settle(); // the old instance's settle timer fires: its advance must be a no-op while job 1 runs
assert(store.current.jobIndex === 1 && store.queue[1].status === "running" && store.queue.filter((j) => j.status === "running").length === 1, "a late advance from the old instance does not start a second job");
r = await msg({ type: K.MSG.STOP }); await settle();
assert(store.running === false, "stopped");

// 15. worker terminated mid-phase with its alarm intact (normal MV3 idle termination): the fresh instance neither advances nor stops (F5)
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t6 = store.tab_id; const R6 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R6, jobIndex: 0, phase: "agreements" }, t6);
assert(alarm !== null && store.current.phase === "agreements", "job 0 in the agreements phase with the watchdog armed");
let listenersBefore = listeners.message.length;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=3"); await settle(); await settle();
assert(listeners.message.length === listenersBefore + 1 && store.running === true && store.current.jobIndex === 0 && store.current.phase === "agreements" && store.queue[0].status === "running", "fresh instance mid-phase with the alarm kept: no advance, no stop (F5)");
assert(!store.log.some((l) => /restarted mid-job/.test(l.msg)), "nothing logged about a missing watchdog");

// 16. alarm gone mid-phase (extension disabled and re-enabled): the run is stopped, not re-armed and resumed (N2)
alarm = null;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=4"); await settle(); await settle();
assert(store.running === false && store.current === null && store.tab_id === null && alarm === null, "fresh instance mid-phase without the alarm stopped the run (N2)");
assert(store.queue[0].status === "stopped" && /disabled or reloaded/.test(store.queue[0].message) && store.queue[1].status === "pending", "current job marked stopped with the reason; later jobs untouched (N2): " + store.queue[0].message);
assert(store.run.runId === R6 && /disabled or reloaded/.test(store.run.reason), "run record closed with the reason (N2)");
assert(store.log.some((l) => /restarted mid-job .* without its watchdog alarm/.test(l.msg)), "the stop was logged (N2)");
assert(tabs.get(t6) === K.modelUrl("proj-one", "claude-haiku-4-5"), "the tab was not navigated to the next job (N2)");

// 16b. the same with a recorded Agree click: the job ends unverified, the run still stops (N2)
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t7 = store.tab_id; const R7 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R7, jobIndex: 0, phase: "agreements" }, t7);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R7, jobIndex: 0, fields: { agreeClicked: true } }, t7);
alarm = null;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=5"); await settle(); await settle();
assert(store.running === false && store.queue[0].status === "unverified" && /Agree was clicked/.test(store.queue[0].message) && /check manually/.test(store.queue[0].message), "no alarm after a recorded Agree click: job unverified, run stopped (N2): " + store.queue[0].message);

// 17. a job message pre-checked under one run cannot land on the next run's job of the same index (N4)
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t8 = store.tab_id; const R8 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R8, jobIndex: 0, phase: "agreements" }, t8);
// The result enters the handler, then STOP and START are enqueued before it is applied.
let pendingResult = msg({ type: K.MSG.JOB_RESULT, runId: R8, jobIndex: 0, status: "done", message: "result of the OLD run's job 0" }, t8);
let stopP = msg({ type: K.MSG.STOP });
let startP = msg(START(["proj-three"], ["claude-opus-4-6"]));
const [resultReply] = await Promise.all([pendingResult, stopP, startP]); await settle();
assert(runId() !== R8 && store.queue[0].projectId === "proj-three", "new run started after the interleaved stop");
assert(store.queue[0].status === "running" && store.queue[0].message === "", "the old run's result did not land on the new run's job 0 (N4): " + JSON.stringify({ reply: resultReply, job0: store.queue[0].status }));
r = await msg({ type: K.MSG.STOP }); await settle();
// and the same shape for a JOB_UPDATE: an old run's agreeClicked must not mark the new run's job
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t9 = store.tab_id; const R9 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R9, jobIndex: 0, phase: "agreements" }, t9);
pendingResult = msg({ type: K.MSG.JOB_UPDATE, runId: R9, jobIndex: 0, fields: { agreeClicked: true } }, t9);
stopP = msg({ type: K.MSG.STOP });
startP = msg(START(["proj-two"], ["claude-haiku-4-5"]));
await Promise.all([pendingResult, stopP, startP]); await settle();
assert(runId() !== R9 && store.queue[0].projectId === "proj-two" && store.queue[0].agreeClicked === false, "the old run's agreeClicked did not land on the new run's job 0 (N4)");
r = await msg({ type: K.MSG.STOP }); await settle();

// 18. step-by-step (S2): awaiting_confirmation stores the step and pauses the watchdog; the page's phase re-arms it;
//     a stale alarm firing meanwhile is ignored; a fresh worker instance without an alarm keeps waiting
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t10 = store.tab_id; const R10 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "questionnaire" }, t10);
assert(alarm !== null && store.current.phase === "questionnaire", "questionnaire phase: watchdog armed");
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "awaiting_confirmation" }, t10);
assert(r.ok === false && store.current.phase === "questionnaire" && alarm !== null, "awaiting_confirmation without a step is refused (S2): " + r.error);
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "awaiting_confirmation", awaiting: "later" }, t10);
assert(r.ok === false && store.current.phase === "questionnaire", "awaiting_confirmation with an unknown step is refused (S2)");
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "awaiting_confirmation", awaiting: "next" }, t10);
assert(r.ok === true && store.current.phase === "awaiting_confirmation" && store.current.awaiting === "next" && store.queue[0].awaiting === "next", "awaiting_confirmation(next): phase and step on the current record and the job (S2)");
assert(alarm === null, "the watchdog alarm is cleared while the job waits for confirmation (S2)");
assert(store.log.some((l) => /job 0: waiting for your confirmation before Next \(watchdog paused\)/.test(l.msg)), "the pause was logged (S2)");
for (const f of listeners.alarm) f({ name: K.WATCHDOG_ALARM }); await settle();
assert(store.queue[0].status === "running" && store.current.phase === "awaiting_confirmation", "a stale watchdog alarm firing during the wait does not end the job (S2)");
listenersBefore = listeners.message.length;
const midJobLogsBefore = store.log.filter((l) => /restarted mid-job/.test(l.msg)).length;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=6"); await settle(); await settle();
assert(listeners.message.length === listenersBefore + 1 && store.running === true && store.current.phase === "awaiting_confirmation" && store.queue[0].status === "running" && alarm === null, "a fresh worker instance (no alarm, job waiting) keeps waiting instead of stopping the run (S2)");
assert(store.log.filter((l) => /restarted mid-job/.test(l.msg)).length === midJobLogsBefore, "nothing logged about a missing watchdog for the waiting job");
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "questionnaire" }, t10);
assert(r.ok === true && store.current.phase === "questionnaire" && store.current.awaiting === null && store.queue[0].awaiting === null, "Continue (the page's phase again) clears the step (S2)");
assert(alarm !== null && alarm.delayInMinutes === K.WATCHDOG_MINUTES, "and re-arms the watchdog with the full budget (S2)");
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R10, jobIndex: 0, fields: { confirmed: { step: "next", at: 1 }, agreeClickedByUser: true, awaiting: "agree" } }, t10);
assert(r.ok === true && !("confirmed" in store.queue[0]) && store.queue[0].agreeClickedByUser === true && store.queue[0].awaiting === null, "agreeClickedByUser is a whitelisted job update; confirmed (dropped in 0.3.0) and awaiting are not (only SET_PHASE sets awaiting)");
assert(store.log.some((l) => /job 0: you clicked the console's Agree yourself; recorded/.test(l.msg)), "the user's Agree record was logged");
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "awaiting_confirmation", awaiting: "next-job" }, t10);
assert(r.ok === true && store.current.awaiting === "next-job" && alarm === null && store.log.some((l) => /waiting for your confirmation before Next job \(watchdog paused\)/.test(l.msg)), "awaiting_confirmation(next-job), the dry-run end panel, is a known step and pauses the watchdog");
r = await msg({ type: K.MSG.SET_PHASE, runId: R10, jobIndex: 0, phase: "awaiting_confirmation", awaiting: "agree" }, t10);
assert(r.ok === true && store.current.awaiting === "agree" && alarm === null, "awaiting_confirmation(agree) pauses the watchdog again");
r = await msg({ type: K.MSG.STOP }); await settle();
assert(store.running === false && store.queue[0].status === "stopped" && store.current === null, "Stop while a job waits for confirmation ends the run with the job stopped");
store.settings.step_by_step = true;
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(r.ok === true && store.log.some((l) => /mode DRY RUN, step-by-step confirmation on$/.test(l.msg)), "a run started with step-by-step on says so in the log");
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.step_by_step = false;

// 19. (S4) a waiting job whose worker tab no longer exists: a fresh worker instance stops the run with a clear result
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t11 = store.tab_id; const R11 = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R11, jobIndex: 0, phase: "awaiting_confirmation", awaiting: "agree" }, t11);
assert(r.ok === true && alarm === null && store.current.phase === "awaiting_confirmation", "job 0 waits for confirmation (no alarm)");
listenersBefore = listeners.message.length;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=7"); await settle(); await settle();
assert(listeners.message.length === listenersBefore + 1 && store.running === true && store.current.phase === "awaiting_confirmation", "control: with the tab alive a fresh instance keeps the waiting job waiting (S4)");
tabs.delete(t11); // closed while the extension was disabled: no onRemoved event
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=8"); await settle(); await settle();
assert(store.running === false && store.current === null && store.tab_id === null, "with the tab gone a fresh instance stops the run (S4)");
assert(store.queue[0].status === "stopped" && /worker tab is gone while the job waited for your confirmation/.test(store.queue[0].message) && store.queue[1].status === "pending", "the waiting job is marked stopped with the reason; later jobs untouched (S4): " + store.queue[0].message);
assert(store.run.runId === R11 && /worker tab is gone/.test(store.run.reason) && store.log.some((l) => /tab no longer exists; run stopped/.test(l.msg)), "run record and log carry the reason (S4)");

// 20. (S3) a result with stopAfter: the job ends with that result and the run stops instead of advancing
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t12 = store.tab_id; const R12 = runId();
r = await msg({ type: K.MSG.JOB_RESULT, runId: R12, jobIndex: 0, status: "dry-run", message: "dry run: checkbox ticked; you stopped the run here", stopAfter: true }, t12); await settle();
assert(r.ok === true && store.queue[0].status === "dry-run" && /you stopped the run here/.test(store.queue[0].message), "the job carries the dry-run result (S3)");
assert(store.running === false && store.current === null && store.queue[1].status === "pending" && store.run.reason === "stopped by user", "the run stopped after that job; the next job stays pending; tab not navigated (S3): " + store.run.reason);
assert(tabs.get(t12) === K.modelUrl("proj-one", "claude-haiku-4-5"), "the tab was not navigated to the next job (S3)");
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
r = await msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x", stopAfter: "yes" }, store.tab_id); await settle();
assert(store.running === false && store.run.reason === "all jobs processed", "control: stopAfter that is not exactly true is ignored; the run advanced to its end");

console.log(`ALL WORKER CHECKS PASSED (${n} passed)`);
