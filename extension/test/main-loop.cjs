/*
 * The content script's page loop (content/main.js) end to end, with a fake
 * `chrome` on the jsdom window: storage reads come from a state object and
 * runtime messages are answered the way the worker would. The page is a
 * minimal model page; the model handler is replaced per scenario so the
 * loop's own logic is what is exercised:
 *   - assertMayAct() refuses after Stop, after the run was replaced and when
 *     the tab's ?project= is not the job's, and the loop reports stopped /
 *     stopped / failed;
 *   - the tick-level project check reports failed before any handler runs;
 *   - a cleared "Enable APIs" dialog resets `handled` so the page handler
 *     runs again;
 *   - a handler that keeps failing is given MAX_ATTEMPTS_PER_PAGE attempts,
 *     then the job fails naming the page and the last error; a fatal error
 *     ends the job at once;
 *   - a tab that is not the worker tab never runs a handler;
 *   - an idle tab (no run) reads storage once at load and then not at all
 *     until storage.onChanged reports a run; a tab whose run ended stops
 *     polling;
 *   - advanced timing stored under KEYS.TIMING is applied to the constants,
 *     the "page detected" / "action" marks carry +ms since the job started,
 *     the badge shows job, project, model, step with its timeout, plan and
 *     the next job, and the step line is mirrored into the job record.
 * With the real ticked Agreements dump present (run A), the loop is also
 * run live on it: one Agree click and an unverified result (no dialog can
 * appear in a dump), and no click when the console stripped ?project=.
 * With step-by-step on, on the same dump: the "Enable APIs" dialog that
 * opens during the wait is cleared and a trusted Continue then clicks
 * Agree once (not a failed job); an error dialog disables Continue and a
 * Stop written to storage ends the loop with stopped; in a dry run the
 * Next job / Stop panel ends the job dry-run (Stop with stopAfter).
 */
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const E = require("./lib/env.cjs");
const { ok, skip } = E;

const MODEL_URL = "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one";
const MODEL_HTML = '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack>' +
  '<vertex-ai-request-access-button><button> Enable </button></vertex-ai-request-access-button></vai-model-garden-call-to-action-button-stack></body></html>';
const API_DIALOG = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1>' +
  '<div matdialogcontent>The Agent Platform API must be enabled to use this page.</div><div matdialogactions><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (fn()) return true; await sleep(20); }
  return fn();
}

/**
 * Build a window at `url` with the fake chrome, replace the model handler
 * with `handler` (null keeps the real one), load badge.js + main.js and
 * return { env, state, results, logs, stop }.
 */
function boot(opts) {
  const env = E.makeEnv({ html: opts.html || MODEL_HTML, url: opts.url || MODEL_URL });
  if (opts.forms) E.rehydrate(env.document, opts.forms);
  const live = opts.live === true;
  const state = {
    settings: { business_name: "b", business_website: "https://b.example", contact_email: "a@b.example", headquarters: "x", industry: "x", intended_users: "x", use_cases: "x", aup_additional_requirements: "no", aup_details: "", live_mode: live, step_by_step: opts.stepByStep === true },
    queue: opts.queue || [Object.assign({ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", status: "running", phase: "navigate", productId: null, agreeClicked: false }, opts.job)].concat(opts.moreJobs || []),
    current: opts.current === null ? null : (opts.current || { jobIndex: 0, phase: "navigate" }),
    run: opts.run || { runId: "r1", live },
    running: true,
    stop_requested: false,
    timing: opts.timing || null,
    summary_ack: opts.summary || null
  };
  if (opts.running === false) state.running = false;
  const results = [], logs = [], phases = [], updates = [], listeners = [], acks = [];
  let gets = 0;
  let isWorkerTab = opts.workerTab !== false;
  env.win.chrome = {
    storage: {
      local: { get: async (keys) => { gets += 1; const o = {}; for (const k of keys) o[k] = JSON.parse(JSON.stringify(state[k] === undefined ? null : state[k])); return o; } },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    },
    runtime: {
      lastError: undefined,
      sendMessage: (m, cb) => {
        let reply = { ok: true };
        if (m.type === env.K.MSG.WHOAMI) reply = { isWorkerTab, showsSummary: isWorkerTab && !!state.summary_ack && state.summary_ack.ack !== true };
        else if (m.type === env.K.MSG.SUMMARY_ACK) { acks.push(m); if (state.summary_ack && state.summary_ack.runId === m.runId) state.summary_ack.ack = true; }
        else if (m.type === env.K.MSG.SET_PHASE) { phases.push(m.awaiting ? `${m.phase}(${m.awaiting})` : m.phase); state.current.phase = m.phase; state.current.awaiting = m.awaiting || null; state.queue[0].phase = m.phase; }
        else if (m.type === env.K.MSG.JOB_UPDATE) { updates.push(m.fields); Object.assign(state.queue[0], m.fields); }
        else if (m.type === env.K.MSG.JOB_RESULT) { results.push(m); state.current.phase = "finished"; if (m.stopAfter === true) state.stop_requested = true; }
        else if (m.type === env.K.MSG.STOP) { state.stop_requested = true; state.running = false; }
        else if (m.type === env.K.MSG.LOG) logs.push(m.msg);
        setTimeout(() => cb(reply), 1);
      }
    }
  };
  env.K.URL_POLL_MS = 20;
  env.K.TIMEOUTS.CONFIRM = 300; env.K.TIMEOUTS.AGREEMENTS_READY = 300; env.K.TIMEOUTS.MODEL_READY = opts.modelReady || 300; env.K.TIMEOUTS.NAV = 300;
  if (opts.handler) env.A.handleModelPage = opts.handler;
  if (opts.agreementsHandler) env.A.handleAgreements = opts.agreementsHandler; // before main.js captures the handlers
  const ctx = env.dom.getInternalVMContext();
  for (const f of ["content/badge.js", "content/main.js"]) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
  return {
    env, state, results, logs, phases, updates, acks, gets: () => gets,
    fire: (changes) => { for (const fn of listeners) fn(changes, "local"); },
    badge: () => { const b = env.document.getElementById("mgc-badge"); return b ? b.textContent : null; },
    badgeVisible: () => { const b = env.document.getElementById("mgc-badge"); return !!b && b.style.display !== "none"; },
    summary: () => env.document.getElementById("mgc-summary"),
    stop: () => env.win.close()
  };
}

(async () => {
  console.log("--- assertMayAct() inside a handler, before its click");
  {
    let calls = 0, clicks = 0;
    const t = boot({ handler: async (ctx) => { calls += 1; t.state.stop_requested = true; await ctx.assertMayAct(); clicks += 1; return { status: "done", message: "x" }; } });
    await until(() => t.results.length > 0, 2000);
    const r = t.results[0];
    ok(calls === 1 && clicks === 0 && r && r.status === "stopped" && r.runId === "r1", "stop requested before the click: handler refused, job reported stopped, no click", JSON.stringify(r));
    t.stop();
  }
  {
    let clicks = 0;
    const t = boot({ handler: async (ctx) => { t.state.run = { runId: "r2", live: false }; await ctx.assertMayAct(); clicks += 1; return { status: "done", message: "x" }; } });
    await until(() => t.results.length > 0, 2000);
    const r = t.results[0];
    ok(clicks === 0 && r && r.status === "stopped" && r.runId === "r1", "run replaced before the click: handler refused (StoppedError), reported under the old run id, no click", JSON.stringify(r));
    t.stop();
  }
  {
    let clicks = 0;
    const t = boot({ handler: async (ctx) => { t.env.dom.reconfigure({ url: MODEL_URL.replace("proj-one", "someone-else") }); await ctx.assertMayAct(); clicks += 1; return { status: "done", message: "x" }; } });
    await until(() => t.results.length > 0, 2000);
    const r = t.results[0];
    ok(clicks === 0 && r && r.status === "failed" && /tab shows project "someone-else" instead of the job's project "proj-one"/.test(r.message), "page project changed before the click: fatal, job failed naming both projects, no click", JSON.stringify(r));
    t.stop();
  }

  console.log("--- tick-level checks");
  {
    let calls = 0;
    const t = boot({ url: MODEL_URL.replace("proj-one", "someone-else"), handler: async () => { calls += 1; return null; } });
    await until(() => t.results.length > 0, 2000);
    const r = t.results[0];
    ok(calls === 0 && r && r.status === "failed" && /instead of the job's project/.test(r.message), "tab at another project (a fresh document, phase navigate): failed before any handler ran", JSON.stringify(r));
    t.stop();
  }

  console.log("--- (H1) one document, one job: a document that reported a job never acts for another, whatever its URL says");
  const STUDIO_HTML = '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack><vertex-ai-open-generation-ai-studio-button><a> Open in Agent Studio </a></vertex-ai-open-generation-ai-studio-button></vai-model-garden-call-to-action-button-stack></body></html>';
  const pending = (projectId, modelSlug) => ({ projectId, modelSlug, status: "pending", phase: null, productId: null, agreeClicked: false });
  /** The worker's advance: job 1 becomes current in phase navigate while the tab is still on job 0's page. */
  const advance = (t) => {
    t.state.queue[1] = Object.assign({}, t.state.queue[1], { status: "running", phase: "navigate", startedAt: Date.now() });
    t.state.current = { jobIndex: 1, phase: "navigate" };
    t.fire({ current: { newValue: t.state.current } });
  };
  {
    // (i) the stale ENABLED model page (job 0 skipped) ticks against job 1 of the SAME project, another model:
    // the real handler must not report job 1 skipped from this page.
    const t = boot({ html: STUDIO_HTML, moreJobs: [pending("proj-one", "claude-sonnet-4-6")], modelReady: 2000 });
    await until(() => t.results.length === 1, 3000);
    ok(t.results[0] && t.results[0].jobIndex === 0 && t.results[0].status === "skipped", "job 0 (enabled page): skipped, reported from this document", JSON.stringify(t.results[0]));
    const phasesBefore = t.phases.length;
    advance(t);
    await sleep(1000);
    ok(t.results.length === 1 && t.phases.length === phasesBefore, "job 1 (same project, other model) in phase navigate: no second result within 1 s, no phase set (the stale page is not judged for it)", JSON.stringify(t.results));
    ok(/job 2\/2 · proj-one · claude-sonnet-4-6/.test(t.badge() || "") && /finished, waiting for the next job's page/.test(t.badge() || ""), "the badge names job 2 and says it waits for the next job's page", t.badge());
    // Even a phase past navigate on this document (which the worker never sets without a navigation) does not make it act.
    t.state.current = { jobIndex: 1, phase: "model" };
    t.fire({ current: { newValue: t.state.current } });
    await sleep(500);
    ok(t.results.length === 1 && t.phases.length === phasesBefore, "still nothing after the phase moved on: one document, one job", JSON.stringify(t.results));
    t.stop();
  }
  {
    // (ii) the stale model page where job 0 FAILED after its Enable click (the questionnaire never opened):
    // the handler must not click Enable on this page for job 1.
    const t = boot({ moreJobs: [pending("proj-one", "claude-sonnet-4-6")] });
    let clicks = 0; t.env.S.model.enableButton().addEventListener("click", () => { clicks += 1; });
    await until(() => t.results.length === 1, 3000);
    ok(clicks === 1 && t.results[0].status === "failed" && /Enable was clicked but the questionnaire did not open/.test(t.results[0].message), "job 0: Enable clicked once, failed (no page change in jsdom)", JSON.stringify(t.results[0]) + " clicks=" + clicks);
    advance(t);
    await sleep(1000);
    ok(clicks === 1 && t.results.length === 1, "job 1 (same project) in phase navigate: Enable is not clicked again for it, no result", `clicks=${clicks} ${JSON.stringify(t.results)}`);
    t.stop();
  }
  {
    // (iii) the real ticked Agreements page (run A) after job 0 ended dry-run: job 1 of the same project gets neither
    // a result ("no Marketplace product id") nor a phase from this document.
    const snapA = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!snapA) skip("(H1) stale Agreements page against the next job", "recon dump not present");
    else {
      const project = new URL(snapA.url).searchParams.get("project");
      const t = boot({ html: snapA.html, forms: snapA.forms, url: snapA.url, job: { projectId: project, productId: "anthropic/anthropic-867.cloudpartnerservices.goog" }, moreJobs: [pending(project, "claude-sonnet-4-6")] });
      await until(() => t.results.length === 1, 4000);
      ok(t.results[0] && t.results[0].status === "dry-run", "job 0: dry-run on the ticked Agreements page", JSON.stringify(t.results[0]));
      const phasesBefore = t.phases.length;
      advance(t);
      await sleep(1000);
      ok(t.results.length === 1 && t.phases.length === phasesBefore, "job 1 (same project) in phase navigate: no result and no SET_PHASE from the stale Agreements page", JSON.stringify(t.results));
      ok(!t.logs.some((m) => /no Marketplace product id/.test(m)), "the stale page never judged the Agreements page for job 1", t.logs.filter((m) => /job 1/.test(m)).join(" | "));
      t.stop();
    }
  }
  {
    // (iv) control: a FRESH document (the navigation landed) for job 1 acts at once, with nothing reported before.
    let calls = 0;
    const t = boot({
      url: MODEL_URL.replace("claude-haiku-4-5", "claude-sonnet-4-6"),
      queue: [Object.assign(pending("proj-one", "claude-haiku-4-5"), { status: "skipped", phase: "finished", message: "skipped: already enabled" }), Object.assign(pending("proj-one", "claude-sonnet-4-6"), { status: "running", phase: "navigate", startedAt: Date.now() })],
      current: { jobIndex: 1, phase: "navigate" },
      handler: async () => { calls += 1; return { status: "dry-run", message: "x" }; }
    });
    await until(() => t.results.length === 1, 2000);
    ok(calls === 1 && t.results[0] && t.results[0].jobIndex === 1 && t.results[0].status === "dry-run", "control: the fresh document runs the handler for job 1 and reports it", JSON.stringify(t.results));
    t.stop();
  }
  {
    // (v) control: a fresh document at ANOTHER project than the job's (phase navigate, nothing reported) still fails the job.
    let calls = 0;
    const t = boot({ url: MODEL_URL.replace("proj-one", "proj-two"), moreJobs: [pending("proj-two", "claude-haiku-4-5")], handler: async () => { calls += 1; return null; } });
    await until(() => t.results.length === 1, 2000);
    ok(calls === 0 && t.results[0] && t.results[0].jobIndex === 0 && /tab shows project "proj-two" instead of the job's project/.test(t.results[0].message), "control: a fresh document on the wrong project fails the job as before", JSON.stringify(t.results));
    t.stop();
  }
  {
    let calls = 0;
    const t = boot({ workerTab: false, handler: async () => { calls += 1; return null; } });
    await sleep(300);
    ok(calls === 0 && t.results.length === 0 && t.badge() === null, "not the worker tab: no handler call, no result, no badge");
    t.stop();
  }

  console.log("--- (T3) a document is tied to the job it first saw: it never acts for a later job, even when it reported nothing");
  {
    // The model handler returns null (the flow continues on the next page) but the page never changes, so this
    // document reports nothing for job 0: the worker's watchdog ends it and advances to job 1 of the SAME project.
    // Before 0.5.0 the H1 guard looked only at jobs this document had reported, so this stale page ran job 1's
    // handler on job 0's page (the 0.4.0 review's probe); now the document acts only for the job it was created for.
    let calls = 0; const jobsSeen = [];
    const t = boot({ moreJobs: [pending("proj-one", "claude-sonnet-4-6")], handler: async (ctx) => { calls += 1; jobsSeen.push(ctx.jobIndex); return null; } });
    await until(() => calls === 1, 2000);
    await sleep(200);
    ok(calls === 1 && jobsSeen[0] === 0 && t.results.length === 0, "job 0: the handler ran once and returned null; nothing reported (the job waits for the watchdog)", `calls=${calls} ${JSON.stringify(t.results)}`);
    const phasesBefore = t.phases.length;
    t.state.queue[0] = Object.assign({}, t.state.queue[0], { status: "failed", phase: "finished", message: "timeout: no result within 10 minutes in phase model" });
    advance(t);
    await sleep(600);
    ok(calls === 1 && t.results.length === 0 && t.phases.length === phasesBefore, "job 1 (same project, other model) in phase navigate, this document never reported job 0: no handler call, no phase, no result for job 1", `calls=${calls} jobs=${JSON.stringify(jobsSeen)} ${JSON.stringify(t.results)}`);
    ok(/job 2\/2 · proj-one · claude-sonnet-4-6/.test(t.badge() || "") && /finished, waiting for the next job's page/.test(t.badge() || ""), "the badge names job 2 and says it waits for the next job's page", t.badge());
    t.state.current = { jobIndex: 1, phase: "model" };
    t.fire({ current: { newValue: t.state.current } });
    await sleep(300);
    ok(calls === 1 && t.results.length === 0, "still nothing after the phase moved on: the document stays tied to job 0", `calls=${calls}`);
    t.stop();
  }
  {
    // the same on the real ticked Agreements page (run A): job 0 is left unreported in a live run whose
    // Agreements handler is replaced by one that never reports; job 1 of the same project must get neither
    // a result ("no Marketplace product id") nor a phase nor an Agree click from it.
    const snapT3 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!snapT3) skip("(T3) stale unreported Agreements page against the next job", "recon dump not present");
    else {
      const project = new URL(snapT3.url).searchParams.get("project");
      let agreeCalls = 0; const jobsSeen = [];
      const t = boot({ html: snapT3.html, forms: snapT3.forms, url: snapT3.url, live: true, job: { projectId: project, productId: "anthropic/anthropic-867.cloudpartnerservices.goog" }, moreJobs: [pending(project, "claude-sonnet-4-6")],
        agreementsHandler: async (ctx) => { agreeCalls += 1; jobsSeen.push(ctx.jobIndex); return null; } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => agreeCalls === 1, 3000);
      await sleep(200);
      ok(agreeCalls === 1 && jobsSeen[0] === 0 && t.results.length === 0 && clicks === 0, "job 0: the (stubbed) Agreements handler ran once and reported nothing", `calls=${agreeCalls}`);
      const phasesBefore = t.phases.length;
      t.state.queue[0] = Object.assign({}, t.state.queue[0], { status: "failed", phase: "finished", message: "timeout: no result within 10 minutes in phase agreements" });
      advance(t);
      await sleep(1000);
      ok(agreeCalls === 1 && t.results.length === 0 && t.phases.length === phasesBefore && clicks === 0 && !t.logs.some((m) => /job 1:.*(Marketplace product id|model page is for)/.test(m)),
        "job 1 (same project) in phase navigate, LIVE: the stale unreported page runs no handler for it and gives it no result, no phase and no click (the 0.4.0 review's probe (a))", `calls=${agreeCalls} jobs=${JSON.stringify(jobsSeen)} ${JSON.stringify(t.results)} clicks=${clicks} ${t.logs.filter((m) => /job 1/.test(m)).join(" | ")}`);
      t.stop();
    }
  }

  console.log("--- (T4) a project that never renders a model page fails after the model-page wait, naming the project");
  {
    // The console left the model page's URL for a page the extension does not know (an error page, a dropped
    // route): in phase navigate the job fails after model_ready_ms instead of waiting for the ten-minute watchdog.
    const t = boot({ url: "https://console.cloud.google.com/welcome?project=proj-one", html: "<!doctype html><html><head></head><body><h1>Welcome</h1></body></html>", modelReady: 600 });
    const t0 = Date.now();
    await until(() => t.results.length > 0, 3000);
    const r = t.results[0]; const ms = Date.now() - t0;
    ok(r && r.jobIndex === 0 && r.status === "failed" && ms >= 600 && ms < 2500 && /the console did not show a model page for project "proj-one" within 1 s of the navigation \(the tab shows \/welcome\): the project may not exist, you may lack access to it, or the ID may be misspelt/.test(r.message),
      "unknown console page in phase navigate: failed after model_ready_ms with a message naming the project and the path", `${JSON.stringify(r)} ${ms} ms`);
    ok(t.phases.length === 0, "no phase was set (no handler ran)", JSON.stringify(t.phases));
    t.stop();
  }
  {
    // control: an unknown page in a later phase (the flow already started on this document) is left to the
    // handlers' own waits and the watchdog, as before.
    const t = boot({ url: "https://console.cloud.google.com/welcome?project=proj-one", html: "<!doctype html><html><head></head><body><h1>Welcome</h1></body></html>", modelReady: 300, current: { jobIndex: 0, phase: "questionnaire" } });
    await sleep(900);
    ok(t.results.length === 0, "control: an unknown page in phase questionnaire reports nothing (not a navigation that never landed)", JSON.stringify(t.results));
    t.stop();
  }
  {
    // The URL stays the model page's but nothing of the model page renders (the console's error page at the same
    // URL): the real handler's wait names the project; retried like any timeout, so the job ends with "gave up".
    const t = boot({ html: "<!doctype html><html><head></head><body><h1>You don't have permission to access this resource</h1></body></html>", modelReady: 500 });
    await until(() => t.results.length > 0, 5000);
    const r = t.results[0];
    ok(r && r.status === "failed" && /gave up on model page after 3 attempts: the model page for project "proj-one" showed neither an Enable button nor the enabled state within 1 s and rendered no model page content at all: the project may not exist, you may lack access to it, or the ID may be misspelt/.test(r.message),
      "model URL with no model page content: after three model-page waits the job fails naming the project (not the bare timeout text)", JSON.stringify(r));
    t.stop();
  }
  {
    // control: the plain model page (the Enable button present) keeps the bare timeout wording when the click
    // leads nowhere, and an enabled page is skipped as before (covered above); here only the wording.
    const t = boot({ html: '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack></vai-model-garden-call-to-action-button-stack></body></html>', modelReady: 300 });
    await until(() => t.results.length > 0, 4000);
    const r = t.results[0];
    ok(r && r.status === "failed" && /gave up on model page after 3 attempts: timed out after 300 ms waiting for Enable button \(enabled, no dialog\) or enabled state/.test(r.message),
      "control: the model page's stack present but no Enable button yet: the bare timeout wording (a slow page, not an unreachable project)", JSON.stringify(r));
    t.stop();
  }

  console.log("--- an idle tab does not poll storage; storage.onChanged wakes it");
  {
    let calls = 0;
    const t = boot({ running: false, handler: async () => { calls += 1; return null; } });
    await sleep(300);
    const idle = t.gets();
    ok(idle === 1 && calls === 0 && t.badge() === null, "no run: one storage read at load, then none in 300 ms at a 20 ms poll (no handler, no badge)", `gets=${idle}`);
    t.state.running = true;
    t.fire({ running: { oldValue: false, newValue: true } });
    await until(() => calls === 1, 2000);
    await sleep(200);
    const active = t.gets();
    ok(calls === 1 && active > idle + 3, "onChanged(running) wakes the tab: the handler runs and polling resumes", `gets=${active}`);
    t.state.running = false;
    await sleep(200);
    const stopped = t.gets();
    await sleep(300);
    ok(t.gets() === stopped && stopped - active < 30, "once the run is over the polling stops again", `gets after stop=${stopped}, 300 ms later=${t.gets()}`);
    t.stop();
  }
  {
    const t = boot({ workerTab: false, handler: async () => null });
    await sleep(300);
    ok(t.gets() === 1, "a run in another tab: this tab reads storage once (WHOAMI says no) and does not poll", `gets=${t.gets()}`);
    t.stop();
  }

  console.log("--- the end-of-run summary in the badge: shown after a finished run until OK, keyed by the run id");
  {
    const jobs = (n) => Array.from({ length: n }, (_, i) => ({ projectId: `proj-${i + 1}`, modelSlug: "claude-haiku-4-5", status: i === 0 ? "dry-run" : i === 1 ? "skipped" : "failed", message: i === 0 ? "dry run: stopped on the Agreements page" : i === 1 ? "skipped: already enabled" : "boom" }));
    const finished = (n, ack) => ({ running: false, current: null, queue: jobs(n), run: { runId: "r1", live: false, finishedAt: 1, reason: "all jobs processed" }, summary: { runId: "r1", tabId: 100, reason: "all jobs processed", ack }, handler: async () => null });
    // (a) a finished run with 14 jobs: the summary panel renders in the badge with counts, 12 lines, "and 2 more" and OK.
    let t = boot(finished(14, false));
    t.fire({ running: { oldValue: true, newValue: false } });
    await until(() => t.summary() !== null, 2000);
    const badge = t.badge() || "";
    ok(t.summary() !== null && t.badgeVisible(), "the summary panel is in the badge after a finished run (no run active)");
    ok(/^MG Clicker: run all jobs processed · 14 job\(s\)\ndone 0 · dry-run 1 · skipped 1 · failed 12 · unverified 0 · stopped 0/.test(badge), "the badge text carries the reason, the job count and the six counts", badge);
    const lines = Array.from(t.env.document.querySelectorAll("#mgc-summary .mgc-summary-line")).map((l) => l.textContent);
    ok(lines.length === 12 && t.env.document.querySelector("#mgc-summary .mgc-summary-more").textContent === "and 2 more", "twelve per-job lines, then \"and 2 more\"", `${lines.length}`);
    ok(lines[0] === "proj-1 · claude-haiku-4-5 · dry-run · dry run: stopped on the Agreements page" && lines[1] === "proj-2 · claude-haiku-4-5 · skipped · skipped: already enabled", "each line: project, model, status, message", lines.slice(0, 2).join(" | "));
    const okBtn = t.env.document.querySelector('#mgc-summary button[data-action="ok"]');
    ok(okBtn && okBtn.textContent === "OK" && t.env.document.getElementById("mgc-summary").style.pointerEvents === "auto", "an OK button; the summary takes pointer events");
    // (b) a storage change that keeps the record pending (a route change's tick) re-renders without duplicating or hiding it.
    t.fire({ current: { newValue: null } });
    await sleep(100);
    ok(t.env.document.querySelectorAll("#mgc-summary").length === 1 && t.summary() !== null, "another tick keeps one summary panel (idempotent)");
    // (c) OK: the content script sends mgc:summary-ack with the run id; once storage says ack, the badge hides.
    okBtn.click();
    await until(() => t.acks.length === 1, 1000);
    ok(t.acks.length === 1 && t.acks[0].runId === "r1" && t.summary() === null, "OK sends mgc:summary-ack { runId } and closes the panel", JSON.stringify(t.acks));
    t.fire({ summary_ack: { newValue: t.state.summary_ack } });
    await sleep(100);
    ok(t.summary() === null && !t.badgeVisible(), "with ack true in storage the badge is hidden and stays hidden");
    t.stop();
    // (d) the flag survives a reload: a fresh document (this script loaded again) with the record still pending shows it at its first tick.
    t = boot(finished(2, false));
    await until(() => t.summary() !== null, 2000);
    ok(t.summary() !== null && /2 job\(s\)/.test(t.badge() || "") && t.env.document.querySelectorAll("#mgc-summary .mgc-summary-line").length === 2 && !t.env.document.querySelector("#mgc-summary .mgc-summary-more"), "a fresh document with the record pending shows the summary at load (two lines, no \"more\")", t.badge());
    // (e) Start: the worker clears the record and a new run begins; the summary is gone, the running badge replaces it.
    t.state.summary_ack = null;
    t.state.running = true; t.state.run = { runId: "r2", live: false }; t.state.current = { jobIndex: 0, phase: "navigate" };
    t.state.queue = [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "navigate" }];
    t.fire({ running: { newValue: true } });
    await until(() => t.summary() === null && /job 1\/1/.test(t.badge() || ""), 2000);
    ok(t.summary() === null && /MG Clicker \[DRY RUN\] job 1\/1/.test(t.badge() || ""), "Start cleared the record: the summary is gone and the running badge shows", t.badge());
    t.stop();
    // (f) controls: an acknowledged record, a record for another run, or a tab that is not the one the run used: no summary.
    t = boot(finished(2, true)); await sleep(250);
    ok(t.summary() === null && !t.badgeVisible(), "control: an acknowledged record shows nothing");
    t.stop();
    t = boot(Object.assign(finished(2, false), { summary: { runId: "other", tabId: 100, ack: false } })); await sleep(250);
    ok(t.summary() === null, "control: a record for another run id shows nothing");
    t.stop();
    t = boot(Object.assign(finished(2, false), { workerTab: false })); await sleep(250);
    ok(t.summary() === null && !t.badgeVisible(), "control: a tab the worker does not name shows nothing");
    t.stop();
  }

  console.log("--- a cleared Enable APIs dialog resets `handled` so the page handler runs again");
  {
    let calls = 0, dialogClicks = 0;
    const t = boot({ handler: async () => { calls += 1; return null; } });
    await until(() => calls === 1, 2000);
    await sleep(150);
    ok(calls === 1, "handler ran once and is then skipped on later ticks (handled)", calls);
    t.env.document.body.insertAdjacentHTML("beforeend", API_DIALOG);
    for (const b of t.env.D.qa("mat-dialog-container button")) b.addEventListener("click", () => { dialogClicks += 1; t.env.D.q(".cdk-overlay-container").remove(); });
    await until(() => calls === 2, 2000);
    ok(dialogClicks === 1 && calls === 2, "dialog cleared with one Enable click, then the handler ran again", `dialogClicks=${dialogClicks} calls=${calls}`);
    ok(t.logs.some((m) => /"Enable APIs" dialog closed/.test(m)), "dialog handling was logged");
    ok(t.results.length === 0, "no result reported (the flow continues)");
    t.stop();
  }

  console.log("--- attempts and error routing");
  {
    let calls = 0;
    const t = boot({ handler: async () => { calls += 1; throw new Error(`boom ${calls}`); } });
    await until(() => t.results.length > 0, 3000);
    const r = t.results[0];
    ok(calls === t.env.K.MAX_ATTEMPTS_PER_PAGE && r && r.status === "failed" && new RegExp(`gave up on model page after ${t.env.K.MAX_ATTEMPTS_PER_PAGE} attempts: boom ${calls}`).test(r.message),
      `non-fatal errors: ${t.env.K.MAX_ATTEMPTS_PER_PAGE} attempts, then failed naming the page and the last error`, JSON.stringify(r) + " calls=" + calls);
    ok(t.logs.filter((m) => /model attempt \d+ failed: boom/.test(m)).length === calls, "each failed attempt was logged with its error");
    t.stop();
  }
  {
    let calls = 0;
    const t = boot({ handler: async () => { calls += 1; throw new t.env.D.FatalError("cannot continue"); } });
    await until(() => t.results.length > 0, 2000);
    await sleep(100);
    const r = t.results[0];
    ok(calls === 1 && r && r.status === "failed" && r.message === "cannot continue" && t.results.length === 1, "a fatal error ends the job at once with its message, no retry, reported once", JSON.stringify(t.results) + " calls=" + calls);
    t.stop();
  }
  {
    const t = boot({ handler: async () => ({ status: "skipped", message: "skipped: already enabled" }) });
    await until(() => t.results.length > 0, 2000);
    await sleep(100);
    ok(t.results.length === 1 && t.results[0].status === "skipped" && t.results[0].jobIndex === 0, "a handler result is reported exactly once (reported dedupe)", JSON.stringify(t.results));
    ok(/finished, waiting for next job/.test(t.badge() || ""), "badge shows the finished state", t.badge());
    t.stop();
  }

  console.log("--- timing from storage, timing marks, badge and the mirrored step line");
  {
    const t = boot({
      timing: { model_ready_ms: 1500, poll_ms: 60, confirm_ms: 2000 },
      job: { startedAt: Date.now() - 5000 },
      moreJobs: [{ projectId: "proj-two", modelSlug: "claude-opus-4-6", status: "pending", phase: null }],
      handler: async (ctx) => { ctx.mark("action started: pretend"); await t.env.D.waitFor(() => false, { timeout: 250, what: "a thing that never comes" }).catch(() => {}); ctx.step("doing the thing"); return null; }
    });
    await until(() => t.logs.some((m) => /model page detected/.test(m)), 2000);
    ok(t.env.K.TIMEOUTS.MODEL_READY === 1500 && t.env.K.URL_POLL_MS === 60 && t.env.K.TIMEOUTS.CONFIRM === 2000, "stored timing applied to the live constants (model_ready_ms, poll_ms, confirm_ms)", JSON.stringify([t.env.K.TIMEOUTS.MODEL_READY, t.env.K.URL_POLL_MS]));
    ok(t.env.K.TIMEOUTS.NAV === t.env.K.TIMING_DEFAULTS.nav_ms && t.env.K.TIMING_DEFAULTS.nav_ms === 45000, "a key missing from the stored timing takes the constant's default (nav_ms 45000)", t.env.K.TIMEOUTS.NAV);
    const detected = t.logs.find((m) => /model page detected/.test(m));
    ok(/^job 0: model page detected at \+\d+ ms$/.test(detected) && parseInt(detected.match(/\+(\d+) ms/)[1], 10) >= 5000, "page detected mark carries +ms since the job started", detected);
    await until(() => t.updates.some((u) => /waiting for a thing that never comes/.test(u.step || "")), 1000);
    const badge = t.badge() || "";
    ok(/MG Clicker \[DRY RUN\] job 1\/2 · proj-one · claude-haiku-4-5 · 00:0\d/.test(badge), "badge line 1: mode, job N of M, project, model, elapsed", badge);
    ok(/step: waiting for a thing that never comes · \d s \/ 0 s/.test(badge), "badge line 2: the current step with elapsed / timeout, rendered the instant the wait started", badge);
    ok(/then: click Enable, then the questionnaire · next job: proj-two · claude-opus-4-6/.test(badge), "badge line 3: the plan and the next job", badge);
    ok(t.updates.some((u) => u.step === "waiting for a thing that never comes"), "the wait was mirrored into the job record as its step", JSON.stringify(t.updates));
    await until(() => t.updates.some((u) => u.step === "doing the thing"), 1000);
    ok(t.updates.some((u) => u.step === "doing the thing"), "a named action is mirrored too", JSON.stringify(t.updates));
    ok(t.logs.some((m) => /^job 0: action started: pretend at \+\d+ ms$/.test(m)), "action marks are stamped with +ms", t.logs.join(" | "));
    t.stop();
  }
  {
    const t = boot({ handler: async () => null });
    await until(() => t.logs.some((m) => /model page detected/.test(m)), 2000);
    ok(t.env.K.TIMEOUTS.MODEL_READY === 300, "no stored timing: the constants stay as they are", t.env.K.TIMEOUTS.MODEL_READY);
    t.stop();
  }

  console.log("--- the real ticked Agreements page through the loop (run A, 05-agreements-checked)");
  const snap = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
  if (!snap) skip("loop on 05-agreements-checked", "recon dump not present");
  else {
    const project = new URL(snap.url).searchParams.get("project");
    const PRODUCT = "anthropic/anthropic-867.cloudpartnerservices.goog";
    {
      const t = boot({ html: snap.html, forms: snap.forms, url: snap.url, live: true, job: { projectId: project, productId: PRODUCT } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => t.results.length > 0, 4000);
      const r = t.results[0];
      ok(clicks === 1 && t.updates.some((u) => u.agreeClicked === true) && r && r.status === "unverified" && /Agree clicked but no confirmation/.test(r.message), "live, every condition met: one Agree click, recorded first, unverified (no dialog in a dump)", JSON.stringify(r) + " clicks=" + clicks);
      ok(t.phases.join() === "agreements" && t.logs.some((m) => /LIVE: clicking Agree/.test(m)), "phase set and the click logged as LIVE");
      t.stop();
    }
    {
      const t = boot({ html: snap.html, forms: snap.forms, url: snap.url.replace(/\?project=.*$/, ""), live: true, job: { projectId: project, productId: PRODUCT } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => t.results.length > 0, 4000);
      const r = t.results[0];
      ok(clicks === 0 && r && r.status === "failed" && /not the job's Agreements page/.test(r.message) && /not the job's project/.test(r.message), "live, console stripped ?project=: no click, failed with the reason", JSON.stringify(r) + " clicks=" + clicks);
      t.stop();
    }
  }

  console.log("--- (S2/S9) the page loop with step-by-step on, on the real ticked Agreements page (run A, 05-agreements-checked)");
  if (!snap) skip("step-by-step loop on 05-agreements-checked", "recon dump not present");
  else {
    const project = new URL(snap.url).searchParams.get("project");
    const PRODUCT = "anthropic/anthropic-867.cloudpartnerservices.goog";
    const API_OPEN = '<div class="cdk-overlay-container" id="api"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div><div matdialogactions><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>';
    const ERROR_OPEN = '<div class="cdk-overlay-container" id="err"><mat-dialog-container role="dialog" aria-label="Error dialog"><h1 matdialogtitle>Something went wrong</h1><div matdialogcontent>Could not load billing accounts.</div></mat-dialog-container></div>';
    const panel = (t) => t.env.document.getElementById("mgc-panel");
    const cont = (t) => t.env.document.querySelector('#mgc-panel button[data-action="continue"]');
    {
      // (S2) the "Enable APIs" dialog opens during the wait, then a trusted Continue: cleared, one Agree click, not failed.
      const t = boot({ html: snap.html, forms: snap.forms, url: snap.url, live: true, stepByStep: true, job: { projectId: project, productId: PRODUCT } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => panel(t) !== null, 4000);
      ok(panel(t) !== null && cont(t) !== null && t.phases.join() === "agreements,awaiting_confirmation(agree)" && t.results.length === 0, "live + step-by-step: the loop shows the Agree panel and sets awaiting_confirmation(agree)", t.phases.join());
      ok(/waiting for your confirmation before Agree/.test(t.badge() || "") && t.updates.some((u) => u.step === "waiting for your confirmation before Agree"), "the badge and the mirrored step say it waits", t.badge());
      t.env.document.body.insertAdjacentHTML("beforeend", API_OPEN);
      let enableClicks = 0;
      for (const b of t.env.D.qa("#api button")) b.addEventListener("click", () => { if (t.env.D.text(b) === "Enable") { enableClicks += 1; t.env.document.getElementById("api").remove(); } });
      await until(() => enableClicks === 1 && !t.env.document.getElementById("api"), 2000);
      await sleep(100);
      ok(enableClicks === 1 && panel(t) !== null && cont(t) && cont(t).disabled === false && t.results.length === 0, 'the "Enable APIs" dialog during the wait: cleared from the wait (one Enable click), panel re-shown with Continue enabled, job not failed', `enableClicks=${enableClicks} results=${JSON.stringify(t.results)}`);
      ok(t.logs.some((m) => /"Enable APIs" dialog opened while waiting for your confirmation; clearing it/.test(m)) && t.logs.some((m) => /confirmation panel shown again before Agree/.test(m)), "both steps logged", t.logs.join(" | "));
      E.trustedClick(cont(t));
      await until(() => t.results.length > 0, 4000);
      const r = t.results[0];
      ok(clicks === 1 && r && r.status === "unverified" && /Agree clicked but no confirmation/.test(r.message) && t.updates.some((u) => u.agreeClicked === true), "a trusted Continue after the cleared dialog: one Agree click, recorded, unverified (no dialog in a dump)", JSON.stringify(r) + " clicks=" + clicks);
      ok(t.phases.join() === "agreements,awaiting_confirmation(agree),agreements" && t.logs.some((m) => /LIVE: clicking Agree/.test(m)), "phase set back before the click, click logged as LIVE", t.phases.join());
      t.stop();
    }
    {
      // (S2/S9) an error dialog opens during the wait: Continue disabled, the job keeps waiting; a Stop in storage ends the loop with stopped.
      const t = boot({ html: snap.html, forms: snap.forms, url: snap.url, live: true, stepByStep: true, job: { projectId: project, productId: PRODUCT } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => panel(t) !== null, 4000);
      t.env.document.body.insertAdjacentHTML("beforeend", ERROR_OPEN);
      await until(() => cont(t) && cont(t).disabled === true, 2000);
      const note = t.env.document.querySelector("#mgc-panel .mgc-panel-note");
      ok(cont(t).disabled === true && note && /A console dialog is open: Something went wrong: Could not load billing accounts\./.test(note.textContent) && t.results.length === 0, "an error dialog during the wait: Continue disabled, dialog named in the panel, job still waiting (not failed)", note && note.textContent);
      E.trustedClick(cont(t));
      await sleep(150);
      ok(t.results.length === 0 && clicks === 0 && !t.updates.some((u) => u.agreeClicked), "a trusted Continue while the dialog is open reaches no guard: no click, no record, no result", JSON.stringify(t.results));
      t.state.stop_requested = true;
      t.fire({ stop_requested: { oldValue: false, newValue: true } });
      await until(() => t.results.length > 0, 4000);
      ok(t.results.length === 1 && t.results[0].status === "stopped" && clicks === 0 && panel(t) === null, "Stop written to storage during the wait: the loop reports stopped, no click, panel closed", JSON.stringify(t.results));
      t.stop();
    }
    {
      // (S3) dry run with step-by-step: the Next job / Stop panel; Stop ends the job dry-run with stopAfter.
      const t = boot({ html: snap.html, forms: snap.forms, url: snap.url, live: false, stepByStep: true, job: { projectId: project, productId: PRODUCT } });
      let clicks = 0; t.env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      await until(() => panel(t) !== null, 4000);
      const names = Array.from(t.env.document.querySelectorAll("#mgc-panel button")).map((b) => b.textContent);
      ok(names.join("/") === "Next job/Stop" && t.phases.join() === "agreements,awaiting_confirmation(next-job)" && t.results.length === 0, "dry run + step-by-step: the loop shows the Next job / Stop panel and the job waits", names.join("/") + " " + t.phases.join());
      ok(/then: tick the terms checkbox, then wait for your Next job or Stop \(dry run\)/.test(t.badge() || ""), "the badge plan names the wait", t.badge());
      t.env.document.querySelector('#mgc-panel button[data-action="stop"]').click();
      await until(() => t.results.length > 0, 4000);
      const r = t.results[0];
      ok(r && r.status === "dry-run" && /checkbox ticked; Agree was not clicked; you stopped the run here/.test(r.message) && r.stopAfter === true && clicks === 0, "Stop on the dry-run panel: the job is reported dry-run with stopAfter, Agree never clicked", JSON.stringify(r));
      ok(t.logs.some((m) => /job 0 -> dry-run: .* \(run stops after this job\)/.test(m)), "the report log says the run stops after this job", t.logs.join(" | "));
      t.stop();
    }
  }

  E.finish("main loop");
  process.exit(0);
})();
