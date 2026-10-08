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
    queue: [Object.assign({ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", status: "running", phase: "navigate", productId: null, agreeClicked: false }, opts.job)].concat(opts.moreJobs || []),
    current: { jobIndex: 0, phase: "navigate" },
    run: { runId: "r1", live },
    running: true,
    stop_requested: false,
    timing: opts.timing || null
  };
  if (opts.running === false) state.running = false;
  const results = [], logs = [], phases = [], updates = [], listeners = [];
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
        if (m.type === env.K.MSG.WHOAMI) reply = { isWorkerTab };
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
  env.K.TIMEOUTS.CONFIRM = 300; env.K.TIMEOUTS.AGREEMENTS_READY = 300; env.K.TIMEOUTS.MODEL_READY = 300; env.K.TIMEOUTS.NAV = 300;
  if (opts.handler) env.A.handleModelPage = opts.handler;
  const ctx = env.dom.getInternalVMContext();
  for (const f of ["content/badge.js", "content/main.js"]) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
  return {
    env, state, results, logs, phases, updates, gets: () => gets,
    fire: (changes) => { for (const fn of listeners) fn(changes, "local"); },
    badge: () => { const b = env.document.getElementById("mgc-badge"); return b ? b.textContent : null; },
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
    ok(calls === 0 && r && r.status === "failed" && /instead of the job's project/.test(r.message), "tab at another project: failed before any handler ran", JSON.stringify(r));
    t.stop();
  }
  {
    let calls = 0;
    const t = boot({ workerTab: false, handler: async () => { calls += 1; return null; } });
    await sleep(300);
    ok(calls === 0 && t.results.length === 0 && t.badge() === null, "not the worker tab: no handler call, no result, no badge");
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
