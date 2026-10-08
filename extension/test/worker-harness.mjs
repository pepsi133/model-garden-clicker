// Fake chrome API (and a fake IndexedDB for the per-run logs), then drive the service worker through a run.
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import path from "node:path";
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fakeIDB = createRequire(import.meta.url)("./lib/fake-idb.cjs");
globalThis.indexedDB = fakeIDB;
globalThis.IDBKeyRange = fakeIDB.IDBKeyRange;
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
    update: async (id, props) => { if (!tabs.has(id)) throw new Error("no tab"); tabs.set(id, props.url); events.push(["tabs.update", id, props.url, props]); return { id }; },
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
    // getURL names an origin fetch() cannot load here: modelNames() must cope without models.json
    getURL: (p) => "chrome-extension://x/" + p,
  },
};
await import(path.join(EXT, "common/constants.js"));
const K = globalThis.MGC;
K.RECOVER_DELAY_MS = 0;
const SETTLE_MS = K.JOB_SETTLE_MS;
K.JOB_SETTLE_MS = 0; // instant advance for the checks below; check 13 restores it
await import(path.join(EXT, "background/service-worker.js"));
/** Deliver a message; tabId makes it a content script's (sender.tab), `sender` overrides the whole sender. */
function msg(m, tabId, sender) {
  const s = sender || (tabId ? { tab: { id: tabId }, url: "https://console.cloud.google.com/agent-platform/model-garden" } : {});
  return new Promise((res) => listeners.message[listeners.message.length - 1](m, s, res));
}
/** The popup opened in a tab: an extension page with sender.tab set, under the extension's origin. */
const TAB_PAGE = (id) => ({ tab: { id }, url: "chrome-extension://x/popup/popup.html?tab=1" });
const settle = () => new Promise((r) => setTimeout(r, 10));
let n = 0;
let finished = false;
// A stalled await (a transaction that never completes, say) must not read as a pass: node would exit 0 with no summary line.
process.on("exit", (code) => { if (!finished && code === 0) { console.log(`FAIL the worker harness ended without its summary line after ${n} checks; an await never resolved`); process.exitCode = 1; } });
function assert(c, m) { if (!c) { console.error("FAIL:", m, JSON.stringify(store, null, 1)); process.exit(1); } n++; console.log("ok  ", m); }
const runId = () => store.run && store.run.runId;
/** A START message as the popup sends it: with the mode it showed (the stored setting unless overridden). */
// includeDone defaults to true here so the cross-run double-purchase guard
// (tested on its own in section 24) does not reach back into the records the
// earlier sections leave behind and skip a pair they expect to run.
const START = (projects, models, live, includeDone) => ({ type: K.MSG.START, projects, models, live: live === undefined ? !!(store.settings && store.settings.live_mode === true) : live, includeDone: includeDone === undefined ? true : includeDone });

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

// 16c. (S2) a reload (onInstalled) with Agree already clicked: the job ends unverified with the reason, never stopped
const lastInstalled = () => listeners.installed[listeners.installed.length - 1]();
const lastStartup = () => listeners.startup[listeners.startup.length - 1]();
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const t7b = store.tab_id; const R7b = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R7b, jobIndex: 0, phase: "agreements" }, t7b);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R7b, jobIndex: 0, fields: { agreeClicked: true } }, t7b);
lastInstalled(); await settle(); await settle();
assert(store.running === false && store.current === null && store.queue[0].status === "unverified" && store.queue[0].message === "Agree was clicked but the extension was reloaded; no confirmation observed; check manually" && store.queue[1].status === "pending" && store.run.runId === R7b && store.run.reason === "extension was reloaded",
  "a reload (onInstalled) after a recorded Agree click: job unverified with the reason, later jobs pending, run closed with the reason (S2): " + store.queue[0].message);
assert(tabs.get(t7b) === K.modelUrl("proj-one", "claude-haiku-4-5"), "the tab was not navigated to the next job after the reload (S2)");
// 16d. the same on a browser restart (onStartup)
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t7c = store.tab_id; const R7c = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R7c, jobIndex: 0, phase: "agreements" }, t7c);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R7c, jobIndex: 0, fields: { agreeClicked: true } }, t7c);
lastStartup(); await settle(); await settle();
assert(store.running === false && store.queue[0].status === "unverified" && store.queue[0].message === "Agree was clicked but the browser was restarted; no confirmation observed; check manually" && store.run.reason === "browser was restarted",
  "a browser restart (onStartup) after a recorded Agree click: job unverified with the reason, run stopped (S2): " + store.queue[0].message);
// 16e. control: a reload with no click on record still marks the job stopped
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t7d = store.tab_id; const R7d = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R7d, jobIndex: 0, phase: "agreements" }, t7d);
lastInstalled(); await settle(); await settle();
assert(store.running === false && store.queue[0].status === "stopped" && store.queue[0].message === "extension was reloaded" && store.queue[0].agreeClicked === false, "control: a reload with no Agree click on record marks the job stopped (S2)");
// 16f. Stop (the popup) after a recorded click: unverified too; the content script's late result is dropped with the run
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const t7e = store.tab_id; const R7e = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: R7e, jobIndex: 0, phase: "agreements" }, t7e);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: R7e, jobIndex: 0, fields: { agreeClicked: true } }, t7e);
r = await msg({ type: K.MSG.STOP }); await settle();
assert(store.running === false && store.queue[0].status === "unverified" && store.queue[0].message === "Agree was clicked but the run was stopped by user; no confirmation observed; check manually", "Stop after a recorded Agree click: the job is unverified, not stopped (S2): " + store.queue[0].message);
r = await msg({ type: K.MSG.JOB_RESULT, runId: R7e, jobIndex: 0, status: "done", message: "late" }, t7e); await settle();
assert(r.ok === false && store.queue[0].status === "unverified", "a result for that job after the run ended is refused; the job stays unverified (S2)");

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

// 21. (N4) a late stopAfter result for a job that is no longer current is ignored together with its stop request
r = await msg(START(["proj-one", "proj-two", "proj-three"], ["claude-haiku-4-5"])); await settle();
const t13 = store.tab_id; const R13 = runId();
r = await msg({ type: K.MSG.JOB_RESULT, runId: R13, jobIndex: 0, status: "dry-run", message: "x" }, t13); await settle();
assert(store.current.jobIndex === 1 && store.stop_requested === false, "job 0 done normally, job 1 current, no stop requested");
r = await msg({ type: K.MSG.JOB_RESULT, runId: R13, jobIndex: 0, status: "dry-run", message: "late panel stop", stopAfter: true }, t13); await settle();
assert(store.stop_requested === false && store.running === true && store.current.jobIndex === 1 && store.queue[1].status === "running" && store.queue[0].message === "x", "a late stopAfter result for job 0 while job 1 runs: ignored, the stop flag stays false (N4)");
assert(store.log.some((l) => /ignored result for job 0 \(current is 1\); its stop request is ignored with it/.test(l.msg)), "the ignored stop request was logged (N4)");
r = await msg({ type: K.MSG.JOB_RESULT, runId: R13, jobIndex: 1, status: "dry-run", message: "y" }, t13); await settle();
assert(store.running === true && store.current.jobIndex === 2 && store.queue[2].status === "running", "job 1's plain result advanced to job 2 instead of stopping the run (N4)");
r = await msg({ type: K.MSG.JOB_RESULT, runId: R13, jobIndex: 2, status: "dry-run", message: "z", stopAfter: true }, t13); await settle();
assert(store.running === false && store.run.reason === "stopped by user" && store.queue[2].status === "dry-run" && store.log.some((l) => /job 2: dry-run - z \(the run stops after this job\)/.test(l.msg)), "control: stopAfter on the current job still stops the run after it, and says so in the job's log line (N4)");

// 22. the end-of-run summary record: written when a run ends with the run id and the tab, acknowledged by OK, cleared by Start;
//     the worker tab is navigated without activating it
assert(store.summary_ack && store.summary_ack.runId === R13 && store.summary_ack.tabId === t13 && store.summary_ack.ack === false && store.summary_ack.reason === "stopped by user", "run end writes summary_ack { runId, tabId, reason, ack: false }: " + JSON.stringify(store.summary_ack));
r = await msg({ type: K.MSG.WHOAMI }, t13); assert(r.showsSummary === true && r.isWorkerTab === false, "WHOAMI from the tab the run used: showsSummary true (not the worker tab any more)");
r = await msg({ type: K.MSG.WHOAMI }, 999); assert(r.showsSummary === false, "WHOAMI from another tab: showsSummary false");
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: "other" }); assert(r.ok === false && store.summary_ack.ack === false, "OK with another run id is refused");
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: R13 }, 999); assert(r.ok === false && /not the tab the run used/.test(r.error) && store.summary_ack.ack === false, "OK from a content script of another console tab is refused");
// (M1) the popup opened in a tab is an extension page in a normal tab: Chrome sets sender.tab, its url is the extension's own origin. It is UI, not a worker tab.
r = await msg({ type: K.MSG.SET_PHASE, runId: R13, jobIndex: 0, phase: "model" }, null, TAB_PAGE(t13)); assert(r.ok === false && /not the worker tab/.test(r.error), "(M1) a job message from an extension page whose tab id is the worker tab's is refused like any UI message");
r = await msg({ type: K.MSG.LOG, level: "info", msg: "from the tab page" }, null, TAB_PAGE(555)); assert(r.ok === true && store.log[store.log.length - 1].src === "ui", "(M1) MSG.LOG from the popup in a tab is labelled ui: " + store.log[store.log.length - 1].src);
r = await msg({ type: K.MSG.LOG, level: "info", msg: "from a content script" }, 555); assert(store.log[store.log.length - 1].src === "content", "control: MSG.LOG from a content script is labelled content");
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: R13 }, null, TAB_PAGE(555)); assert(r.ok === true && store.summary_ack.ack === true && store.summary_ack.runId === R13, "(M1) OK from popup.html?tab=1 (sender.tab 555, extension url) is accepted: ack true (the record stays, keyed by the run id)");
r = await msg({ type: K.MSG.WHOAMI }, t13); assert(r.showsSummary === false, "after OK the tab the run used no longer shows the summary");
assert(store.log.some((l) => /end-of-run summary acknowledged/.test(l.msg)), "the OK was logged");
assert(!("at" in store.summary_ack) && !("ackAt" in store.summary_ack) && Object.keys(store.summary_ack).sort().join() === "ack,reason,runId,tabId", "the summary record carries runId, tabId, reason and ack only: " + Object.keys(store.summary_ack).sort().join());
r = await msg({ type: K.MSG.WHOAMI }, t13); assert(Object.keys(r).sort().join() === "isWorkerTab,showsSummary", "WHOAMI answers isWorkerTab and showsSummary only: " + Object.keys(r).sort().join());
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
assert(store.summary_ack === null, "Start clears summary_ack");
const t14 = store.tab_id;
r = await msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, t14); await settle();
const navs = events.filter((e) => e[0] === "tabs.update" && e[1] === t14);
assert(navs.length >= 1 && navs.every((e) => !("active" in e[3]) && Object.keys(e[3]).join() === "url"), "a later job's navigation is tabs.update({ url }) with no active flag: " + JSON.stringify(navs[navs.length - 1][3]));
r = await msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 1, status: "skipped", message: "y" }, t14); await settle();
assert(store.running === false && store.summary_ack && store.summary_ack.runId === runId() && store.summary_ack.reason === "all jobs processed" && store.summary_ack.tabId === t14 && store.summary_ack.ack === false, "all jobs processed writes the summary record too");
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: runId() }, t14); assert(r.ok === true && store.summary_ack.ack === true, "OK from the content script of the tab the run used acknowledges it");
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: runId() }); assert(r.ok === true && r.note === "already acknowledged", "a second OK is a no-op");
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
r = await msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "skipped", message: "z" }, store.tab_id); await settle();
r = await msg({ type: K.MSG.SUMMARY_ACK, runId: runId() }); assert(r.ok === true && store.summary_ack.ack === true, "OK from the action popup (no sender.tab) acknowledges it");

// 23. (L1) the full per-run log in IndexedDB: one record per run, written by the worker only, with the metadata,
//     the job list, the results and every log line (uncapped); the storage log and its cap are untouched
const RL = globalThis.MGC_RUNLOG;
const records = () => fakeIDB.dump(RL.DB_NAME, RL.STORE).sort((a, b) => b.startedAt - a.startedAt);
// Schema v2: log lines live in their own store, keyed [runId, seq]. Read a
// run's lines straight from the fake for the assertions below.
const lineRecs = (rid) => fakeIDB.dump(RL.DB_NAME, RL.LINES).filter((l) => l.runId === rid).sort((a, b) => a.seq - b.seq);
const RLAST = runId();
let rec = records().find((x) => x.runId === RLAST);
assert(RL && RL.DB_NAME === "mgc-runs" && RL.STORE === "runs" && RL.LINES === "lines", "common/runlog.js is loaded by the worker: database mgc-runs, stores runs and lines (schema v2)");
assert(!!rec && rec.runId === RLAST && rec.startedAt === store.run.startedAt && rec.finishedAt === store.run.finishedAt && rec.reason === "all jobs processed" && rec.live === false && rec.stepByStep === false, "the finished run has a record with its id, start, end, reason and mode snapshot (L1): " + JSON.stringify(rec && { runId: rec.runId, reason: rec.reason, live: rec.live }));
assert(Array.isArray(rec.jobs) && rec.jobs.length === 1 && rec.jobs[0].projectId === "proj-one" && rec.jobs[0].modelSlug === "claude-haiku-4-5" && Object.keys(rec.jobs[0]).sort().join() === "modelName,modelSlug,projectId", "the record carries the job list (project, model, name only)");
assert(Array.isArray(rec.results) && rec.results.length === 1 && rec.results[0].status === "skipped" && rec.results[0].message === "z" && rec.results[0].finishedAt > 0 && !("phase" in rec.results[0]) && !("step" in rec.results[0]), "the record carries the per-job results (status, message, times; no phase or step fields): " + JSON.stringify(rec.results[0]));
const lastLines = lineRecs(RLAST);
const recLines = lastLines.map((l) => l.msg);
assert(recLines.length >= 5 && /^run .* started: 1 project\(s\)/.test(recLines[0]) && /^cross-run guard off for this run \("Include pairs already done in earlier runs" ticked\): pairs done in earlier runs are processed again$/.test(recLines[1]) && /^job 0: navigating/.test(recLines[2]) && /^job 0: skipped - z$/.test(recLines[3]) && recLines[recLines.length - 1] === "run finished: all jobs processed", "the record's lines run from the start line, through the guard-off note (P2: the box was ticked, logged once the record exists) to the 'run finished' line (written after RUNNING went false): " + JSON.stringify(recLines));
assert(rec.lineCount === lastLines.length && lastLines.every((l, i) => l.seq === i) && typeof rec.byteCount === "number" && rec.byteCount > 0, "the record's counters match the line store: lineCount equals the number of line records (seq 0..n-1) and byteCount is set (L1 v2): " + JSON.stringify({ lineCount: rec.lineCount, byteCount: rec.byteCount, stored: lastLines.length }));
assert(lastLines.every((l) => typeof l.t === "number" && typeof l.level === "string" && typeof l.src === "string" && typeof l.msg === "string") && lastLines.every((l) => l.src === "worker"), "every line has t, level, src and msg; these are the worker's");
assert(!lastLines.some((l) => /summary acknowledged/.test(l.msg)), "a line logged after the run ended (the summary OK) is not in the record");
assert(store.log.length === K.LOG_CAP && store.log.some((l) => /summary acknowledged/.test(l.msg)), "the storage log is still the capped one and still receives every line");
assert(fakeIDB.openCount > 0 && fakeIDB.openCount === fakeIDB.closeCount, `no long-lived database handle: every open was closed (${fakeIDB.openCount} opens, ${fakeIDB.closeCount} closes)`);
r = await msg({ type: K.MSG.LOG, level: "warn", msg: "ui line after the run" }, null, TAB_PAGE(556));
assert(!lineRecs(RLAST).some((l) => /ui line after the run/.test(l.msg)), "MSG.LOG with no run in progress goes to the storage log only");

// 23b. content and ui lines land in the record with their source; a fresh worker instance (restart mid-settle) keeps
//      appending to the same record, and the results follow every job
K.JOB_SETTLE_MS = 5000;
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const R23 = runId(); const t23 = store.tab_id;
r = await msg({ type: K.MSG.LOG, level: "info", msg: "model page detected +1200ms" }, t23);
r = await msg({ type: K.MSG.LOG, level: "debug", msg: "popup says hi" }, null, TAB_PAGE(557));
rec = records().find((x) => x.runId === R23);
assert(!!rec && rec.finishedAt === null && rec.reason === null && rec.results.length === 2 && rec.results.every((j) => j.status === "running" || j.status === "pending"), "a run in progress has an open record (no end, no reason) with the results as they stand");
assert(lineRecs(R23).some((l) => l.src === "content" && l.level === "info" && l.msg === "model page detected +1200ms") && lineRecs(R23).some((l) => l.src === "ui" && l.msg === "popup says hi"), "content and ui lines are appended with their source and level");
pending = msg({ type: K.MSG.JOB_RESULT, runId: R23, jobIndex: 0, status: "dry-run", message: "checkbox ticked" }, t23); await settle();
rec = records().find((x) => x.runId === R23);
assert(rec.results[0].status === "dry-run" && rec.results[0].message === "checkbox ticked" && rec.results[1].status === "pending", "a job result is written to the record's results at once (before the next job starts)");
const linesBeforeRestart = lineRecs(R23).length;
await import(pathToFileURL(path.join(EXT, "background/service-worker.js")).href + "?instance=9"); await settle(); await settle();
rec = records().find((x) => x.runId === R23);
assert(store.current.jobIndex === 1 && lineRecs(R23).length > linesBeforeRestart && rec.lineCount === lineRecs(R23).length && lineRecs(R23).some((l) => /worker restarted between jobs; advancing/.test(l.msg)) && lineRecs(R23).some((l) => /job 1: navigating/.test(l.msg)), "a fresh worker instance appends to the same record (no handle survived; the database is opened per write) (L1)");
K.JOB_SETTLE_MS = 0;
await pending; await settle();
r = await msg({ type: K.MSG.JOB_RESULT, runId: R23, jobIndex: 1, status: "skipped", message: "already enabled" }, t23); await settle();
rec = records().find((x) => x.runId === R23);
assert(store.running === false && rec.finishedAt > 0 && rec.reason === "all jobs processed" && rec.results.map((j) => j.status).join() === "dry-run,skipped" && lineRecs(R23).slice(-1)[0].msg === "run finished: all jobs processed", "the record is closed with the end, the reason, both results and the final line");
assert(records().filter((x) => x.runId === R23).length === 1 && records().filter((x) => x.runId === RLAST).length === 1, "records accumulate, one per run, the earlier one untouched");
assert(fakeIDB.openCount === fakeIDB.closeCount, "still no open handle after the restart and the second run");

// 23c. (L2) a quota error on the full log never fails a job: one warning line in the storage log, the run goes on
r = await msg(START(["proj-one", "proj-two"], ["claude-haiku-4-5"])); await settle();
const R23c = runId(); const t23c = store.tab_id;
assert(!!records().find((x) => x.runId === R23c), "control: the run's record was created while the database had room");
fakeIDB.quota = true;
const warnsBefore = store.log.filter((l) => /full run log: could not/.test(l.msg)).length;
r = await msg({ type: K.MSG.JOB_RESULT, runId: R23c, jobIndex: 0, status: "dry-run", message: "ticked under quota" }, t23c); await settle();
assert(r.ok === true && store.queue[0].status === "dry-run" && store.queue[0].message === "ticked under quota" && store.current.jobIndex === 1 && store.running === true, "with the database full the job result is recorded in storage and the run advances to job 1 (L2)");
const quotaWarnings = store.log.filter((l) => /full run log: could not .* \(QuotaExceededError/.test(l.msg));
assert(quotaWarnings.length === warnsBefore + 1 && /the run continues/.test(quotaWarnings[quotaWarnings.length - 1].msg), "exactly one warning line about the quota in the storage log: " + (quotaWarnings[quotaWarnings.length - 1] || {}).msg);
r = await msg({ type: K.MSG.LOG, level: "info", msg: "line while full" }, t23c);
r = await msg({ type: K.MSG.JOB_RESULT, runId: R23c, jobIndex: 1, status: "skipped", message: "y" }, t23c); await settle();
assert(store.running === false && store.run.reason === "all jobs processed" && store.queue[1].status === "skipped" && store.log.filter((l) => /full run log: could not/.test(l.msg)).length === warnsBefore + 1, "later failures are silent (still one warning); the run finished normally");
rec = records().find((x) => x.runId === R23c);
assert(!!rec && rec.finishedAt === null && !lineRecs(R23c).some((l) => /line while full/.test(l.msg)) && rec.results[0].status !== "dry-run", "the record stayed as it was before the quota hit (not closed, no later lines)");
fakeIDB.quota = false;
fakeIDB.openError = "database cannot be opened";
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(r.ok === true && store.running === true && store.log.filter((l) => /full run log: could not create the run record \(UnknownError/.test(l.msg)).length === 1, "a database that cannot be opened at Start: the run starts anyway, one warning line (L2)");
r = await msg({ type: K.MSG.JOB_RESULT, runId: runId(), jobIndex: 0, status: "dry-run", message: "x" }, store.tab_id); await settle();
assert(store.running === false && store.queue[0].status === "dry-run" && store.log.filter((l) => /full run log: could not/.test(l.msg)).length === warnsBefore + 2, "that run finished with its result and no further warning");
fakeIDB.openError = null;
assert(fakeIDB.openCount === fakeIDB.closeCount, "no handle left open by the failed writes");

// 23d. (L3) retention: when a run starts, the oldest records beyond KEYS.RUNS_KEEP (default 50, bounds 1-500) are deleted
assert(K.RUNS_KEEP_DEFAULT === 50 && K.RUNS_KEEP_BOUNDS[0] === 1 && K.RUNS_KEEP_BOUNDS[1] === 500 && K.runsKeepFrom(undefined) === 50 && K.runsKeepFrom(0) === 50 && K.runsKeepFrom(501) === 50 && K.runsKeepFrom(2.5) === 50 && K.runsKeepFrom("7") === 50 && K.runsKeepFrom(7) === 7 && K.runsKeepFrom(500) === 500, "runsKeepFrom: default 50, integers within 1-500 only");
assert(K.KEYS.RUNS_KEEP === "runs_keep", "KEYS.RUNS_KEEP is runs_keep");
store.runs_keep = 3;
const beforePrune = records().length;
assert(beforePrune >= 4, `control: ${beforePrune} records exist before the pruning run`);
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const R23d = runId();
let kept = records();
assert(kept.length === 3 && kept[0].runId === R23d && kept.every((x, i) => i === 0 || x.startedAt <= kept[i - 1].startedAt), "with runs_keep 3 a new Start keeps the 3 newest records, the new run included (L3): " + kept.map((x) => x.runId).join(","));
r = await msg({ type: K.MSG.JOB_RESULT, runId: R23d, jobIndex: 0, status: "dry-run", message: "x" }, store.tab_id); await settle();
store.runs_keep = "lots";
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
assert(records().length === 4, "an invalid runs_keep falls back to the default (50): nothing pruned at 4 records");
r = await msg({ type: K.MSG.STOP }); await settle();
delete store.runs_keep;

// 23e. (L4) delete and purge: from the extension's own pages only, never the run in progress; all through the worker
r = await msg(START(["proj-one"], ["claude-haiku-4-5"])); await settle();
const R23e = runId(); const t23e = store.tab_id;
const older = records().find((x) => x.runId !== R23e).runId;
r = await msg({ type: K.MSG.RUNS_DELETE, runId: older }, t23e);
assert(r.ok === false && /own pages/.test(r.error) && records().some((x) => x.runId === older), "RUNS_DELETE from a content script is refused (L4)");
r = await msg({ type: K.MSG.RUNS_DELETE, runId: R23e }, null, TAB_PAGE(558));
assert(r.ok === false && /in progress/.test(r.error) && records().some((x) => x.runId === R23e), "RUNS_DELETE of the run in progress is refused (L4)");
const olderLinesBefore = lineRecs(older).length;
r = await msg({ type: K.MSG.RUNS_DELETE, runId: older }, null, TAB_PAGE(558));
assert(r.ok === true && !records().some((x) => x.runId === older) && olderLinesBefore > 0 && lineRecs(older).length === 0, "RUNS_DELETE of an older run from the runs page deletes its record and its lines (L4 v2)");
r = await msg({ type: K.MSG.RUNS_DELETE, runId: older });
assert(r.ok === false && /no log/.test(r.error), "deleting it again: no log for that run");
r = await msg({ type: K.MSG.RUNS_DELETE });
assert(r.ok === false && /no run id/.test(r.error), "RUNS_DELETE without an id is refused");
r = await msg({ type: K.MSG.RUNS_PURGE }, t23e);
assert(r.ok === false && records().length >= 2, "RUNS_PURGE from a content script is refused");
const nBefore = records().length;
r = await msg({ type: K.MSG.RUNS_PURGE });
const linesByRunAfterPurge = new Set(fakeIDB.dump(RL.DB_NAME, RL.LINES).map((l) => l.runId));
assert(r.ok === true && r.deleted === nBefore - 1 && r.kept === 1 && records().length === 1 && records()[0].runId === R23e && linesByRunAfterPurge.size <= 1 && (linesByRunAfterPurge.size === 0 || linesByRunAfterPurge.has(R23e)), "RUNS_PURGE during a run deletes every other record (and their lines) and keeps the run in progress (L4 v2): " + JSON.stringify(r));
assert(lineRecs(records()[0].runId).some((l) => /full run logs purged: \d+ deleted, the run in progress kept/.test(l.msg)), "the purge is logged into the run in progress");
r = await msg({ type: K.MSG.STOP }); await settle();
r = await msg({ type: K.MSG.RUNS_PURGE }, null, TAB_PAGE(559));
assert(r.ok === true && r.deleted === 1 && r.kept === 0 && records().length === 0, "RUNS_PURGE with no run in progress deletes everything (L4)");
r = await msg({ type: K.MSG.RUNS_PURGE });
assert(r.ok === true && r.deleted === 0, "purging an empty database is ok with 0 deleted");
assert(fakeIDB.openCount === fakeIDB.closeCount, "every open closed after delete and purge");
r = await msg({ type: K.MSG.VERSION });
assert(r.messages.includes("mgc:runs-delete") && r.messages.includes("mgc:runs-purge") && r.keys.includes("runs_keep"), "VERSION reports the new message types and the runs_keep key");

// 24. (U10) the cross-run double-purchase guard at Start: a (project, model)
//     pair recorded done in an earlier run, or unverified with Agree on
//     record, is skipped in the new queue unless includeDone is true; a pair
//     that was only dry-run (or unverified without a click) is not skipped.
fakeIDB.reset();
const GSTAMP = Date.UTC(2026, 9, 8, 9, 0, 0);
await RL.create({ runId: "g-prev", startedAt: GSTAMP, live: true }, [], false);
await RL.update("g-prev", { finishedAt: GSTAMP + 1000, reason: "all jobs processed", results: [
  { projectId: "guard-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true },
  { projectId: "guard-dry", modelSlug: "claude-haiku-4-5", status: "dry-run", agreeClicked: false },
  { projectId: "guard-unv-click", modelSlug: "claude-haiku-4-5", status: "unverified", agreeClicked: true },
  { projectId: "guard-unv-noclick", modelSlug: "claude-haiku-4-5", status: "unverified", agreeClicked: false }
] });
const guardStamp = RL.stamp(GSTAMP);
// 24a. default (includeDone false, as the popup sends with the box unchecked):
//      done and unverified-with-click are skipped; dry-run and unverified-no-click run.
r = await msg(START(["guard-done", "guard-dry", "guard-unv-click", "guard-unv-noclick"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${guardStamp} (done)` && store.queue[0].phase === "finished", "24a a pair done in an earlier run is created skipped with a 'done in run <stamp> (done)' message (U10): " + store.queue[0].message);
assert(store.queue[2].status === "skipped" && store.queue[2].message === `done in run ${guardStamp} (unverified)`, "24a a pair unverified with Agree on record is skipped too (reason 'unverified'): " + store.queue[2].message);
assert(store.queue[1].status !== "skipped" && store.queue[3].status !== "skipped", "24a a dry-run pair and an unverified-without-a-click pair are NOT skipped (a dry run is not 'done')");
assert(store.log.some((l) => /cross-run guard: 2 job\(s\) skipped/.test(l.msg)), "24a the guard logs how many it skipped and how to override it");
const g1 = runId();
assert(RL.counts(records().find((x) => x.runId === g1)).skipped === 2, "24a the run record's results carry the two skipped jobs");
assert(!lineRecs(g1).some((l) => /cross-run guard off/.test(l.msg)) && lineRecs(g1).some((l) => /cross-run guard: 2 job\(s\) skipped/.test(l.msg)), "24a (P2) no guard-off line when the box is not ticked; the skipped-count line is in the run record");
r = await msg({ type: K.MSG.STOP }); await settle();
// 24b. includeDone true: the guard is off, nothing is skipped for the same pairs.
r = await msg(START(["guard-done", "guard-unv-click"], ["claude-haiku-4-5"], false, true)); await settle();
assert(r.ok === true && store.queue[0].status !== "skipped" && store.queue[1].status !== "skipped", "24b with includeDone the guard is off: neither already-done pair is skipped (U10)");
assert(lineRecs(runId()).filter((l) => l.level === "info" && /^cross-run guard off for this run \("Include pairs already done in earlier runs" ticked\)/.test(l.msg)).length === 1 && store.log.some((l) => /cross-run guard off for this run/.test(l.msg)), "24b (P2) the worker logs one info line that the guard is off because the box was ticked, in the run record and the capped log");
r = await msg({ type: K.MSG.STOP }); await settle();
// 24c. a queue whose every pair is already done finishes at Start with no tab navigation.
const tabsBefore = tabs.size;
r = await msg(START(["guard-done", "guard-unv-click"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.running === false && store.current === null && tabs.size === tabsBefore, "24c a queue of only already-done pairs finishes at Start with no console navigation (U10)");
assert(store.queue.every((j) => j.status === "skipped"), "24c every job of that run is skipped");
r = await msg({ type: K.MSG.STOP }); await settle();
// 24d. (N4) a malformed run record (a null entry, a missing-field entry) must
//      not throw at Start: the guard skips the bad entries with one warning
//      and the valid pairs still work. The good "guard-done" pair is still
//      skipped from the well-formed entry alongside the malformed ones.
//      RL.update's resultOf sanitiser would turn a null into {}, so the raw
//      null is written straight into the store (a corrupted record: devtools,
//      or a future schema).
fakeIDB.reset();
await RL.create({ runId: "g-bad", startedAt: GSTAMP, live: true }, [], false);
await new Promise((resolve, reject) => {
  const req = fakeIDB.open(RL.DB_NAME, RL.DB_VERSION);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction(RL.STORE, "readwrite");
    const st = tx.objectStore(RL.STORE);
    const g = st.get("g-bad");
    g.onsuccess = () => {
      const rec = g.result;
      rec.finishedAt = GSTAMP + 1000; rec.reason = "all jobs processed";
      rec.results = [
        null,
        { status: "done" }, // missing projectId/modelSlug: tolerated, matches nothing real
        { projectId: "guard-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true }
      ];
      st.put(rec);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
});
r = await msg(START(["guard-done", "guard-fresh"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true, "24d Start does not throw on a record whose results hold a null entry (N4): " + JSON.stringify(r));
assert(store.queue[0].status === "skipped" && store.queue[1].status !== "skipped", "24d the well-formed done pair is still skipped; a fresh pair runs (N4)");
assert(store.log.filter((l) => /malformed run record/.test(l.msg)).length === 1, "24d exactly one warning line names the malformed entries (N4)");
assert(lineRecs(runId()).filter((l) => l.level === "warn" && /skipped 1 malformed run record entry while checking/.test(l.msg)).length === 1, "24d (P6) the warning is in the run record too (logged once the record exists), counting the null entry (the object without fields is tolerated, not counted)");
r = await msg({ type: K.MSG.STOP }); await settle();
// 24e. (N3) model slugs compare case-insensitively, the same way
//      isValidModelSlug accepts them: a pair recorded under the lower-case
//      slug is skipped when queued as the mixed-case "Claude-Haiku-4-5".
fakeIDB.reset();
await RL.create({ runId: "g-case", startedAt: GSTAMP, live: true }, [], false);
await RL.update("g-case", { finishedAt: GSTAMP + 1000, reason: "all jobs processed", results: [
  { projectId: "guard-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true }
] });
r = await msg(START(["guard-done"], ["Claude-Haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped", "24e a pair recorded under the lower-case slug is skipped when queued mixed-case Claude-Haiku-4-5 (N3): " + store.queue[0].status);
r = await msg({ type: K.MSG.STOP }); await settle();

// 24f. (N2) the previous run's queue in chrome.storage is the guard's second
//      source: with no run record at all (a wiped database) a pair that
//      queue holds as done is still skipped, the message names that run's
//      start, and a dry-run pair in it is not skipped.
fakeIDB.reset();
const PREV_START = Date.UTC(2026, 9, 8, 10, 30, 0);
store.queue = [
  { projectId: "queue-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true, message: "enabled" },
  { projectId: "queue-dry", modelSlug: "claude-haiku-4-5", status: "dry-run", agreeClicked: false, message: "x" },
  { projectId: "queue-unv", modelSlug: "claude-haiku-4-5", status: "unverified", agreeClicked: true, message: "x" },
  null
];
store.run = { runId: "prev-run", live: true, startedAt: PREV_START, finishedAt: PREV_START + 5000, reason: "all jobs processed" };
r = await msg(START(["queue-done", "queue-dry", "queue-unv", "queue-fresh"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${RL.stamp(PREV_START)} (done)`, "24f (N2) a pair done in the previous run's queue is skipped with that run's stamp, with no run record at all: " + store.queue[0].message);
assert(store.queue[2].status === "skipped" && store.queue[2].message === `done in run ${RL.stamp(PREV_START)} (unverified)`, "24f (N2) a pair unverified with Agree on record in that queue is skipped too");
assert(store.queue[1].status !== "skipped" && store.queue[3].status !== "skipped", "24f (N2) a dry-run pair in the previous queue and a fresh pair are not skipped");
assert(records().length === 1 && lineRecs(runId()).some((l) => l.level === "warn" && /skipped 1 malformed run record entry/.test(l.msg)), "24f (N2) control: the only record is the new run's (the queue alone decided); the null queue entry counted as one malformed entry");
r = await msg({ type: K.MSG.STOP }); await settle();
// With the previous queue cleared (the popup's "clear"), only the records decide.
store.queue = []; store.run = null;
await RL.create({ runId: "g-older", startedAt: GSTAMP, live: true }, [], false);
await RL.update("g-older", { finishedAt: GSTAMP + 1000, reason: "all jobs processed", results: [{ projectId: "rec-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true }] });
r = await msg(START(["rec-done", "queue-done"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${guardStamp} (done)` && store.queue[1].status !== "skipped", "24f (N2) with the previous queue cleared only the run records decide: rec-done skipped, queue-done runs");
r = await msg({ type: K.MSG.STOP }); await settle();

// 24g. (N2) the run-record database cannot be opened: a FULL RUN is refused
//      with a clear message and nothing is written (box ticked or not); a
//      DRY RUN starts with a warning line and the previous queue still guards.
fakeIDB.reset(); fakeIDB.openError = "database cannot be opened";
store.queue = [{ projectId: "queue-done", modelSlug: "claude-haiku-4-5", status: "done", agreeClicked: true }];
store.run = { runId: "prev-run-2", live: true, startedAt: PREV_START, finishedAt: PREV_START + 1, reason: "all jobs processed" };
store.settings.live_mode = true;
const tabsBefore24g = tabs.size;
r = await msg(START(["queue-done", "queue-fresh"], ["claude-haiku-4-5"], true, false)); await settle();
assert(r.ok === false && /^full run refused: the run-record database could not be opened \(UnknownError: database cannot be opened\), so the cross-run double-purchase guard cannot check earlier runs and this run's record could not be kept; open the Runs page to see the database error, or start a dry run$/.test(r.error), "24g (N2) a full run with the database unopenable is refused with the reason: " + r.error);
assert(store.running !== true && tabs.size === tabsBefore24g && store.run.runId === "prev-run-2" && store.queue.length === 1 && store.queue[0].status === "done", "24g (N2) nothing was written: no run, no tab, the previous run and queue untouched");
r = await msg(START(["queue-fresh"], ["claude-haiku-4-5"], true, true)); await settle();
assert(r.ok === false && /^full run refused: the run-record database could not be opened/.test(r.error) && store.running !== true && tabs.size === tabsBefore24g, "24g (N2) the Include-pairs box does not bypass the refusal");
store.settings.live_mode = false;
r = await msg(START(["queue-done", "queue-fresh"], ["claude-haiku-4-5"], false, false)); await settle();
assert(r.ok === true && store.running === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${RL.stamp(PREV_START)} (done)` && store.queue[1].status === "running", "24g (N2) a dry run starts with the database unopenable, and the previous queue still skips the done pair");
assert(store.log.some((l) => l.level === "warn" && /^cross-run guard: could not read the run records \(UnknownError: database cannot be opened\); the previous run's results in storage are the only earlier-run memory this run, and the model page's enabled-state check still runs$/.test(l.msg)), "24g (N2) the dry run says so with one warning line in the capped log");
r = await msg({ type: K.MSG.STOP }); await settle();
fakeIDB.openError = null;

// 24h. (N12) the guard against a queue the real flow wrote: a full run
//      reaches the Agreements phase and records the Agree click, the
//      extension is reloaded (onInstalled ends the job unverified with the
//      click on record), then the same pair is started again in a full run:
//      skipped from the run record, and skipped from the previous queue
//      alone once the records are wiped; no tab is navigated either time.
fakeIDB.reset(); store.queue = []; store.run = null;
store.settings.live_mode = true;
r = await msg(START(["flow-proj"], ["claude-haiku-4-5"], true, false)); await settle();
const tFlow = store.tab_id; const RFlow = runId();
r = await msg({ type: K.MSG.SET_PHASE, runId: RFlow, jobIndex: 0, phase: "agreements" }, tFlow);
r = await msg({ type: K.MSG.JOB_UPDATE, runId: RFlow, jobIndex: 0, fields: { agreeClicked: true } }, tFlow);
lastInstalled(); await settle(); await settle();
assert(store.running === false && store.queue[0].status === "unverified" && store.queue[0].agreeClicked === true && store.run.runId === RFlow, "24h (N12) the reload ended the live job unverified with Agree on record");
const recFlow = records().find((x) => x.runId === RFlow);
assert(!!recFlow && recFlow.results[0].status === "unverified" && recFlow.results[0].agreeClicked === true, "24h (N12) the run record carries the unverified result with the click");
let tabsBefore24h = tabs.size; let navsBefore24h = events.filter((e) => e[0] === "tabs.update").length;
r = await msg(START(["flow-proj"], ["claude-haiku-4-5"], true, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${RL.stamp(recFlow.startedAt)} (unverified)` && store.running === false && store.run.reason === "all jobs processed", "24h (N12) Start again, full run: the pair is skipped as unverified-with-click from the record, the run finishes at Start: " + store.queue[0].message);
assert(tabs.size === tabsBefore24h && events.filter((e) => e[0] === "tabs.update").length === navsBefore24h, "24h (N12) no tab was created or navigated for it");
// The second source alone: restore the flow's queue, wipe the records.
store.queue = [{ projectId: "flow-proj", modelSlug: "claude-haiku-4-5", status: "unverified", agreeClicked: true, message: "Agree was clicked but the extension was reloaded" }];
store.run = { runId: RFlow, live: true, startedAt: recFlow.startedAt, finishedAt: recFlow.startedAt + 1, reason: "extension was reloaded" };
fakeIDB.reset();
tabsBefore24h = tabs.size; navsBefore24h = events.filter((e) => e[0] === "tabs.update").length;
r = await msg(START(["flow-proj"], ["claude-haiku-4-5"], true, false)); await settle();
assert(r.ok === true && store.queue[0].status === "skipped" && store.queue[0].message === `done in run ${RL.stamp(recFlow.startedAt)} (unverified)` && store.running === false && tabs.size === tabsBefore24h && events.filter((e) => e[0] === "tabs.update").length === navsBefore24h, "24h (N12) with every record wiped the previous queue alone skips the pair, no tab: " + store.queue[0].message);
// Control: the queue source remembers one run back only (that run's queue is now all skipped, not done).
r = await msg(START(["flow-proj"], ["claude-haiku-4-5"], true, false)); await settle();
assert(r.ok === true && store.running === true && store.queue[0].status === "running", "24h control: a third Start, records still wiped and the previous queue holding only the skipped entry, runs the pair (the queue source remembers one run back)");
r = await msg({ type: K.MSG.STOP }); await settle();
store.settings.live_mode = false;
store.queue = []; store.run = null;

// 25. (U5) prune never deletes the run in progress, and an append to a
//     missing record warns once in the capped log.
fakeIDB.reset();
store.runs_keep = 1;
// An older record with a LATER startedAt (a clock that went backwards): a
// prune by start time alone would keep it and drop the new run's own record.
await RL.create({ runId: "skew-future", startedAt: Date.now() + 600000, live: false }, [], false);
r = await msg(START(["proj-skew"], ["claude-haiku-4-5"], false, true)); await settle();
const gskew = runId();
assert(records().some((x) => x.runId === gskew), "25a prune at Start keeps the run in progress even under a backwards clock (runs_keep 1, an older record dated in the future) (U5)");
r = await msg({ type: K.MSG.JOB_RESULT, runId: gskew, jobIndex: 0, status: "dry-run", message: "ok" }, store.tab_id); await settle();
assert(lineRecs(gskew).some((l) => /job 0: dry-run/.test(l.msg)), "25a the kept record still takes appends (its full log is not lost)");
delete store.runs_keep;
// 25b. a run whose record vanished mid-run (a wiped database, say): the next
//      append resolves false and the worker warns once in the capped log.
r = await msg(START(["proj-orphan"], ["claude-haiku-4-5"], false, true)); await settle();
const gorphan = runId();
await RL.delete(gorphan); // drop the record out from under the run in progress
const orphanWarnsBefore = store.log.filter((l) => /no record for the run in progress/.test(l.msg)).length;
r = await msg({ type: K.MSG.LOG, level: "info", msg: "orphan line one" }, store.tab_id);
r = await msg({ type: K.MSG.LOG, level: "info", msg: "orphan line two" }, store.tab_id);
const orphanWarns = store.log.filter((l) => /no record for the run in progress/.test(l.msg));
assert(orphanWarns.length === orphanWarnsBefore + 1, "25b append to a missing record warns exactly once in the capped log (U5): " + orphanWarns.length);
assert(store.log.some((l) => l.msg === "orphan line one") && store.log.some((l) => l.msg === "orphan line two"), "25b the lines still reach the capped storage log");
r = await msg({ type: K.MSG.STOP }); await settle();

// 26. (N8) RUNS_DELETE of a 10,000-line run while another run is in
//     progress: the lines go with one ranged delete request (the fake
//     counts request round trips; a cursor would take one per line), the
//     serialized chain hands the next message on at once, and the run in
//     progress keeps its lines.
fakeIDB.reset(); store.queue = []; store.run = null;
await RL.create({ runId: "big-run", startedAt: GSTAMP, live: false }, [], false);
await new Promise((resolve, reject) => {
  const req = fakeIDB.open(RL.DB_NAME, RL.DB_VERSION);
  req.onsuccess = () => {
    const db = req.result;
    const tx = db.transaction([RL.STORE, RL.LINES], "readwrite");
    const ls = tx.objectStore(RL.LINES);
    for (let i = 0; i < 10000; i++) ls.put({ runId: "big-run", seq: i, t: GSTAMP + i, level: "info", src: "worker", msg: "line " + i });
    const g = tx.objectStore(RL.STORE).get("big-run");
    g.onsuccess = () => { const rec = g.result; rec.lineCount = 10000; rec.finishedAt = GSTAMP + 10000; rec.reason = "all jobs processed"; tx.objectStore(RL.STORE).put(rec); };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
  req.onerror = () => reject(req.error);
});
assert(lineRecs("big-run").length === 10000, "26 control: 10,000 line records exist for the old run");
r = await msg(START(["proj-during-delete"], ["claude-haiku-4-5"], false, true)); await settle();
const R26 = runId(); const t26 = store.tab_id;
const linesInProgressBefore = lineRecs(R26).length;
const requestsBefore = fakeIDB.requests;
const t26start = Date.now();
const delP = msg({ type: K.MSG.RUNS_DELETE, runId: "big-run" }, null, TAB_PAGE(560));
const logP = msg({ type: K.MSG.LOG, level: "info", msg: "appended behind the delete" }, t26);
const [delR] = await Promise.all([delP, logP]);
const elapsed26 = Date.now() - t26start;
const requestsUsed = fakeIDB.requests - requestsBefore;
assert(delR.ok === true && lineRecs("big-run").length === 0 && !records().some((x) => x.runId === "big-run"), "26 (N8) the 10,000-line run and every one of its lines are gone");
assert(requestsUsed < 20, `26 (N8) the delete, and the line appended behind it, took ${requestsUsed} request round trips in all (a cursor per row would take over 10,000): one ranged delete`);
assert(elapsed26 < 2000, `26 (N8) both completed in ${elapsed26} ms`);
assert(lineRecs(R26).length === linesInProgressBefore + 1 && lineRecs(R26).some((l) => l.msg === "appended behind the delete") && store.running === true, "26 (N8) the run in progress kept its lines and took the append queued behind the delete");
r = await msg({ type: K.MSG.STOP }); await settle();

finished = true;
console.log(`ALL WORKER CHECKS PASSED (${n} passed, 0 failed, 0 skipped)`);
