/*
 * The "Enable APIs" dialog step (actions.clearBlockingDialog), driven on the
 * real dialog dump when present (run B, see lib/env.cjs): the first
 * appearance for a job clicks the dialog's own Enable and waits for it to
 * close, a second appearance for the same job fails the job without a
 * click, another job starts fresh, and a button whose text is not exactly
 * "Enable" is refused. The API-enablement policy (synthetic markup):
 * never fails naming the API with no click, ask shows Enable the API / Skip
 * / Stop around an awaiting_confirmation(api-enable) phase, overrides win
 * over the default and match the project case-insensitively.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

(async () => {
  let env = E.envFromSnapshot("B", "01-model-page-api-dialog");
  let real = true;
  if (!env) {
    skip("real Enable APIs dialog dump", "recon dump not present; using synthetic markup");
    real = false;
    env = E.makeEnv({ url: "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=p" });
    env.document.body.innerHTML = `<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler>` +
      `<h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div>` +
      `<div matdialogactions><button> Send feedback </button><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>`;
  }
  const { D, S, A, jsdomErrors } = env;
  console.log(`--- clearBlockingDialog on ${real ? "the real dialog dump" : "synthetic markup"}`);

  const found = S.dialogs.findApiEnableDialog();
  ok(!!found && D.text(found.enableButton) === "Enable", "dialog found with its Enable button");
  const container = found.dialog;
  const keep = container.cloneNode(true);
  const parent = container.parentNode;
  let clicks = [];
  const arm = (dlg) => {
    for (const b of D.qa("button", dlg)) b.addEventListener("click", () => { clicks.push(D.text(b)); dlg.remove(); });
  };
  arm(container);

  const logs = [];
  const flags = { running: true, stopRequested: false, run: { runId: "run-1", live: false } };
  const mk = (jobIndex) => ({ runId: "run-1", jobIndex: jobIndex || 0, log: (m) => logs.push(m), assertMayAct: async () => {}, refresh: async () => Object.assign({}, flags) });

  let r = await A.clearBlockingDialog(mk());
  ok(r === "cleared", "appearance 1 -> cleared", r);
  ok(clicks.join() === "Enable", 'appearance 1 clicked exactly the dialog "Enable"', clicks.join());
  ok(logs.some((m) => /^API policy for \(unknown project\): enable \(default\); the console asks to enable \S/.test(m)), "(api policy) no settings: the default policy enable is logged with its source and the API, and Enable is clicked", logs.join(" | "));
  ok(S.dialogs.findApiEnableDialog() === null, "dialog gone after the click");
  ok(S.model.enableButton() === null || !S.model.enableButton().closest("mat-dialog-container"), "model Enable button lookup never returned the dialog button");

  const again = keep.cloneNode(true);
  parent.appendChild(again);
  arm(again);
  r = await A.clearBlockingDialog(mk());
  ok(r && r.status === "failed" && /reappeared/.test(r.message), "appearance 2 for the same job -> failed result, no reload", JSON.stringify(r));
  ok(clicks.length === 1, "appearance 2 made no click", clicks.join());
  ok(!jsdomErrors.some((m) => /navigation|reload/i.test(m)), "no location.reload() was attempted", jsdomErrors.join(" | "));

  r = await A.clearBlockingDialog(mk(1));
  ok(r === "cleared", "the same dialog for the next job -> cleared again", r);
  ok(clicks.length === 2, "the next job clicked Enable once", clicks.join());

  r = await A.clearBlockingDialog(mk(1));
  ok(r === "none", "no dialog -> none", r);

  // A button whose text is not exactly "Enable" is refused before any click.
  const bad = keep.cloneNode(true);
  parent.appendChild(bad);
  const badBtn = D.qa("button", bad).find((b) => D.text(b) === "Enable");
  (badBtn.querySelector(".mdc-button__label, span") || badBtn).textContent = " Agree "; // the synthetic button has no label span
  let badClicks = 0;
  badBtn.addEventListener("click", () => { badClicks += 1; });
  S.dialogs.findApiEnableDialog = () => ({ dialog: bad, enableButton: badBtn });
  try { await A.clearBlockingDialog(mk(2)); ok(false, "did not throw for a non-Enable button"); }
  catch (e) { ok(/exactly "Enable"/.test(e.message), `button text "Agree" refused -> ${e.message.slice(0, 70)}`, e.message); }
  ok(badClicks === 0, "the refused button received no click");

  // (N5) a Stop (or a replaced run) during the close wait ends it at the next poll, not after api_dialog_close_ms.
  console.log("--- (N5) Stop during the dialog's close wait");
  env.K.TIMEOUTS.API_DIALOG_CLOSE = 5000; env.K.URL_POLL_MS = 20;
  const stays = keep.cloneNode(true); // its Enable does nothing: the dialog never closes
  parent.appendChild(stays);
  const stayBtn = D.qa("button", stays).find((b) => D.text(b) === "Enable");
  S.dialogs.findApiEnableDialog = () => ({ dialog: stays, enableButton: stayBtn });
  const closedLines = () => logs.filter((m) => /dialog closed/.test(m)).length;
  const closedBefore = closedLines();
  let t0 = Date.now();
  let p = A.clearBlockingDialog(mk(3));
  setTimeout(() => { flags.stopRequested = true; }, 100);
  let err = null;
  try { await p; } catch (e) { err = e; }
  let ms = Date.now() - t0;
  ok(err && err.name === "StoppedError" && ms >= 100 && ms < 1000, `stop requested 100 ms into the close wait: StoppedError after ${ms} ms (not 5000)`, err ? `${err.name} ${ms} ms` : "resolved");
  ok(closedLines() === closedBefore, "no 'dialog closed' line was logged for the stopped wait");
  flags.stopRequested = false;
  t0 = Date.now();
  p = A.clearBlockingDialog(mk(4));
  setTimeout(() => { flags.run = { runId: "run-2", live: false }; }, 100);
  err = null;
  try { await p; } catch (e) { err = e; }
  ms = Date.now() - t0;
  ok(err && err.name === "StoppedError" && /no longer the current run/.test(err.message) && ms < 1000, `a replaced run during the close wait: StoppedError after ${ms} ms`, err ? `${err.name}: ${err.message} ${ms} ms` : "resolved");
  flags.run = { runId: "run-1", live: false };
  // control: with the flags untouched the wait still runs to its timeout
  env.K.TIMEOUTS.API_DIALOG_CLOSE = 150;
  err = null;
  try { await A.clearBlockingDialog(mk(5)); } catch (e) { err = e; }
  ok(err && err.name === "TimeoutError" && /dialog to close/.test(err.message), "control: no stop, the close wait times out as before", err && err.message);


  // (0.8.0) the recorded "Enable APIs" dialog plus a permission banner on the page: its Enable is never clicked.
  {
    const dump = E.envFromSnapshot("B", "01-model-page-api-dialog");
    if (!dump) skip("Enable APIs dialog with a permission banner", "recon dump not present");
    else {
      console.log("--- (0.8.0) the recorded Enable APIs dialog with a permission banner on the page: no click, failed as missing permission");
      let dialogClicks = 0;
      for (const b of dump.D.qa("mat-dialog-container button")) b.addEventListener("click", () => { dialogClicks += 1; });
      dump.document.body.insertAdjacentHTML("beforeend", '<div role="alert">You do not have permission to enable services in this project.</div>');
      let err = null, r = null;
      try { r = await dump.A.clearBlockingDialog({ runId: "run-m1", jobIndex: 0, job: {}, log: () => {}, assertMayAct: async () => {}, refresh: async () => ({ running: true, stopRequested: false, run: { runId: "run-m1" } }) }); } catch (e) { err = e; }
      ok(dialogClicks === 0 && !r && err && err.name === "BlockedError" && err.message === "missing permission: You do not have permission to enable services in this project.",
        "clearBlockingDialog: BlockedError \"missing permission: ...\", the dialog's Enable never clicked (clicks 0)", err ? `${err.name}: ${err.message} clicks=${dialogClicks}` : `${r} clicks=${dialogClicks}`);
      dump.win.close();
    }
  }
  env.win.close();

  /* ------------------------------------------------ API-enablement policy */
  {
    const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
    const API_TEXT = "The Agent Platform API must be enabled to use this page.";
    const DLG = '<div class="cdk-overlay-container" id="api"><mat-dialog-container role="dialog"><apis-enabler>' +
      `<h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>${API_TEXT}</div>` +
      '<div matdialogactions><button> Send feedback </button><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>';
    /** A fresh page with the dialog (its Enable closes it) and a ctx over a run state; phases are recorded as "phase(awaiting)". */
    const setup = (settings, current) => {
      const pe = E.makeEnv({ url: "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one" });
      pe.K.URL_POLL_MS = 20;
      pe.K.TIMEOUTS.API_DIALOG_CLOSE = 2000;
      pe.document.body.insertAdjacentHTML("beforeend", DLG);
      const rec = { clicks: [], logs: [], phases: [], stops: 0 };
      for (const b of pe.D.qa("#api button")) b.addEventListener("click", () => { rec.clicks.push(pe.D.text(b)); if (pe.D.text(b) === "Enable") pe.document.getElementById("api").remove(); });
      const state = { running: true, stopRequested: false, run: { runId: "run-p" }, current: Object.assign({ jobIndex: 0, phase: "model", awaiting: null }, current || {}) };
      const ctx = {
        runId: "run-p", jobIndex: 0, job: { projectId: "proj-one", modelSlug: "claude-haiku-4-5" }, settings,
        log: (m) => rec.logs.push(m), mark: () => {}, step: () => {},
        setPhase: async (p, a) => { rec.phases.push(a ? `${p}(${a})` : p); state.current.phase = p; state.current.awaiting = a || null; },
        assertMayAct: async () => {},
        refresh: async () => JSON.parse(JSON.stringify(state)),
        requestStop: async () => { rec.stops += 1; state.stopRequested = true; }
      };
      return { pe, rec, state, ctx };
    };
    const panelButtons = (pe) => Array.from(pe.document.querySelectorAll("#mgc-panel button")).map((b) => b.textContent);
    const panelBtn = (pe, action) => pe.document.querySelector(`#mgc-panel button[data-action="${action}"]`);

    console.log("--- (api policy) never: the job fails naming the API and the project, nothing is clicked");
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "never" });
      const r = await pe.A.clearBlockingDialog(ctx);
      ok(r && r.status === "failed" && r.message === `API enablement required outside the extension: the console asks to enable ${API_TEXT} in proj-one and this project's policy is never, so the dialog's Enable was not clicked; enable the API with your own tooling, then run the pair again`, "policy never: failed, the message names the API and the project", JSON.stringify(r));
      ok(rec.clicks.length === 0 && !!pe.document.getElementById("api"), "policy never: zero clicks, the dialog stays", rec.clicks.join());
      ok(rec.logs.includes(`API policy for proj-one: never (default); the console asks to enable ${API_TEXT}`), "policy never: the log line names the policy and its source", rec.logs.join(" | "));
      pe.win.close();
    }
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "enable" });
      const r = await pe.A.clearBlockingDialog(ctx);
      ok(r === "cleared" && rec.clicks.join() === "Enable" && rec.logs.includes(`API policy for proj-one: enable (default); the console asks to enable ${API_TEXT}`), "control: policy enable on the same page clicks the dialog's Enable once", `${r} ${rec.clicks.join()}`);
      pe.win.close();
    }

    console.log("--- (api policy) ask: the panel, then Enable the API clicks the dialog's Enable once");
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "ask" }, { phase: "questionnaire" });
      let settled = null;
      const p = pe.A.clearBlockingDialog(ctx).then((v) => { settled = v; }, (e) => { settled = e; });
      await sleep(100);
      const title = pe.document.querySelector("#mgc-panel .mgc-panel-title");
      const summary = pe.document.querySelector("#mgc-panel .mgc-panel-summary");
      ok(panelButtons(pe).join("/") === "Enable the API/Skip/Stop", "policy ask: the panel offers Enable the API / Skip / Stop", panelButtons(pe).join("/"));
      ok(title && title.textContent === "The console asks to enable an API" && summary && summary.textContent.includes(API_TEXT) && summary.textContent.includes("proj-one") && /changes the project's service configuration/.test(summary.textContent), "policy ask: the title, and the summary names the API, the project and the change", summary && summary.textContent);
      ok(panelBtn(pe, "api-enable").disabled === false, "policy ask: the Enable APIs dialog does not disable Enable the API");
      ok(rec.phases.join() === "awaiting_confirmation(api-enable)", "policy ask: the phase is awaiting_confirmation(api-enable) during the wait", rec.phases.join());
      panelBtn(pe, "api-enable").click(); // untrusted
      await sleep(80);
      ok(settled === null && rec.clicks.length === 0, "control: a script click on Enable the API clicks nothing, the wait goes on", rec.clicks.join());
      E.trustedClick(panelBtn(pe, "api-enable"));
      await p;
      ok(settled === "cleared" && rec.clicks.join() === "Enable", "policy ask: a trusted Enable the API clicks the dialog's Enable exactly once and the close wait ends cleared", `${settled} ${rec.clicks.join()}`);
      ok(rec.logs.includes('you confirmed the API enablement: clicking Enable in the "Enable APIs" dialog for proj-one') && rec.logs.some((m) => /"Enable APIs" dialog closed/.test(m)), "policy ask: the confirmation and the close are logged", rec.logs.join(" | "));
      ok(rec.phases.join() === "awaiting_confirmation(api-enable),questionnaire", "policy ask: the earlier phase is set again after the wait", rec.phases.join());
      pe.win.close();
    }

    console.log("--- (api policy) ask: Skip, Stop, and the dialog closing by itself");
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "ask" }, { phase: "navigate" });
      const p = pe.A.clearBlockingDialog(ctx);
      await sleep(100);
      panelBtn(pe, "skip").click(); // Skip takes any click: it clicks nothing
      const r = await p;
      ok(r && r.status === "skipped-by-you" && r.message === 'skipped by you at the "Enable APIs" dialog for proj-one: nothing was clicked' && rec.clicks.length === 0, "policy ask: Skip resolves skipped-by-you with zero clicks", JSON.stringify(r));
      ok(rec.phases.join() === "awaiting_confirmation(api-enable),model", "policy ask: from phase navigate the model phase is set after the wait", rec.phases.join());
      pe.win.close();
    }
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "ask" });
      const p = pe.A.clearBlockingDialog(ctx);
      await sleep(100);
      panelBtn(pe, "stop").click();
      let err = null;
      try { await p; } catch (e) { err = e; }
      ok(err && err.name === "StoppedError" && rec.stops === 1 && rec.clicks.length === 0, "policy ask: Stop ends the wait with StoppedError, zero clicks", err ? err.name : "resolved");
      pe.win.close();
    }
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "ask" }, { phase: "awaiting_confirmation", awaiting: "next" });
      const p = pe.A.clearBlockingDialog(ctx);
      await sleep(100);
      pe.document.getElementById("api").remove(); // your own Cancel in the console
      const r = await p;
      ok(r === "cleared" && rec.clicks.length === 0 && rec.logs.some((m) => /no longer visible \(you clicked Enable or Cancel in the console yourself\)/.test(m)), "policy ask: the dialog closing by itself returns cleared with no click", `${r} ${rec.clicks.join()}`);
      ok(rec.phases.join() === "awaiting_confirmation(api-enable),awaiting_confirmation(next)", "policy ask: opened inside another wait, that wait's awaiting step is set again", rec.phases.join());
      pe.win.close();
    }

    console.log("--- (api policy) overrides: an override wins over the default, compared case-insensitively");
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "ask", api_enable_overrides: "other-proj: enable\n\nPROJ-ONE : never" });
      const r = await pe.A.clearBlockingDialog(ctx);
      ok(r && r.status === "failed" && /policy is never/.test(r.message) && rec.clicks.length === 0 && !pe.document.getElementById("mgc-panel"), "override never (PROJ-ONE) beats the default ask: failed, no panel, zero clicks", JSON.stringify(r));
      ok(rec.logs.includes(`API policy for proj-one: never (override); the console asks to enable ${API_TEXT}`), "the log names the override as the source", rec.logs.join(" | "));
      pe.win.close();
    }
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "never", api_enable_overrides: "Proj-One: enable" });
      const r = await pe.A.clearBlockingDialog(ctx);
      ok(r === "cleared" && rec.clicks.join() === "Enable" && rec.logs.some((m) => /: enable \(override\)/.test(m)), "default never with an override enable for the project: Enable clicked once", `${r} ${rec.clicks.join()}`);
      pe.win.close();
    }
    {
      const { pe, rec, ctx } = setup({ api_enable_policy: "never", api_enable_overrides: "other-proj: enable" });
      const r = await pe.A.clearBlockingDialog(ctx);
      ok(r && r.status === "failed" && rec.clicks.length === 0, "control: an override for another project leaves the default never", JSON.stringify(r));
      pe.win.close();
    }
  }
  E.finish("dialog step");
})();
