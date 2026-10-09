/*
 * Step-by-step confirmation (settings.step_by_step):
 *   - awaitConfirmation() turns the badge into a panel with the step's
 *     title, a summary and Continue / Stop buttons (Stop only when asked);
 *     the panel takes pointer events, the text block does not;
 *   - a click dispatched by script (event.isTrusted false: element.click(),
 *     dispatchEvent) on Continue is ignored and logged, the wait goes on;
 *     a trusted click (jsdom's own event dispatch, isTrusted true, see
 *     lib/env.cjs trustedClick, which fails the file when jsdom's internals
 *     move) resolves it and the Continue is recorded for the guard;
 *   - while a console dialog is open Continue is disabled and the dialog is
 *     named in the panel; a Continue that lands anyway is dropped; the
 *     "Enable APIs" dialog is cleared from the wait and the panel re-shown;
 *   - the user's own console Next is seen through the caller's URL check,
 *     the user's own Agree through a capture-phase listener on the Agree
 *     node (a trusted click only, which is also what the browser fires for
 *     Enter or Space on the focused button; key events alone never count,
 *     so a keydown with its keyup and no click locks nothing), never
 *     inferred from a dialog;
 *   - (L2) a refusal during the guard's record round trip that is neither
 *     the user's click nor a dialog (the button hidden by a re-render)
 *     undoes the record and the panel asks again;
 *   - handleQuestionnaire on the real filled form (run A, 03-form-filled)
 *     sets awaiting_confirmation(next) before Next, does not click Next
 *     when the user did, clicks it once after a trusted Continue;
 *   - handleAgreements in a dry run waits on a "Next job" / "Stop" panel
 *     and ends dry-run on either (Stop also stops the run); in a full run
 *     it waits before Agree, a success dialog with no user activation ends
 *     the job unverified without recording a click, an error dialog keeps
 *     the wait going, a user activation (click or keyboard) is recorded as
 *     agreeClickedByUser and judged by the dialog, a Continue after the
 *     user's Agree is ignored, and a trusted Continue clicks Agree once.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip, trustedClick, trustedKeydown, trustedKeyup } = E;

const RUN_ID = "run-s";
const PRODUCT = "anthropic/anthropic-867.cloudpartnerservices.goog";
const AGREEMENTS_URL = `https://console.cloud.google.com/marketplace/agreements/${PRODUCT}?project=proj-one`;
// The rendered Agreements page as the 04/05 dumps shape it (the body component, em-dash SKU rows, the hooked checkbox, the Agree button with its label span).
const RENDERED = '<h1>Agreements</h1><billing-integrated-ai-agreements-body><h2>Purchase summary</h2>' +
  '<button class="cfc-tiered-table-entry">Claude Haiku 4 5 — Input Tokens — global — Context Window Size from 0 to 200000 Tokens</button>' +
  '<mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox"><label><input type="checkbox"><mp-agreements-tos><p>By purchasing you agree to the terms.</p></mp-agreements-tos></label></mat-checkbox>' +
  '<button data-prober="cloud-marketplace-request-product" aria-label="Agree to the terms and agreements before continuing"><span class="mdc-button__label"> Agree </span></button></billing-integrated-ai-agreements-body>';
const SUCCESS = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><mp-consent-complete-dialog><h1 matdialogtitle>Successfully purchased Claude Haiku 4.5</h1></mp-consent-complete-dialog></mat-dialog-container></div>';
const ERROR_DIALOG = '<div class="cdk-overlay-container" id="err"><mat-dialog-container role="dialog" aria-label="Error dialog"><h1 matdialogtitle>Something went wrong</h1><div matdialogcontent>Could not load billing accounts. Try again.</div></mat-dialog-container></div>';
// The console's refusal after Agree (docs/dom-map.md): the behavior-failure-dialog shape. ERROR_DIALOG above is a
// bare container, which the post-Agree wait no longer takes as the outcome (content-guard.cjs, T1).
const REFUSAL_DIALOG = '<div class="cdk-overlay-container" id="refusal"><mat-dialog-container role="dialog" aria-label="Error dialog"><behavior-failure-dialog><h1 matdialogtitle>Action Required: Choose Different Billing Account</h1><div matdialogcontent>This billing account cannot buy.</div></behavior-failure-dialog></mat-dialog-container></div>';
const API_DIALOG = '<div class="cdk-overlay-container" id="api"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div><button> Cancel </button><button> Enable </button></apis-enabler></mat-dialog-container></div>';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A content-script style ctx over `state`; setPhase records (phase, awaiting) pairs. */
function ctxFor(env, state, extra) {
  const rec = { phases: [], updates: [], logs: [], marks: [], steps: [], stops: 0 };
  const ctx = Object.assign({
    runId: RUN_ID, jobIndex: 0, job: state.queue[0], settings: state.settings, rec,
    log: (m) => rec.logs.push(m), mark: (m) => rec.marks.push(m), step: (t) => rec.steps.push(t),
    setPhase: async (p, a) => { rec.phases.push(a ? `${p}(${a})` : p); state.current.phase = p; },
    updateJob: async (f) => { rec.updates.push(f); Object.assign(state.queue[0], f); return { ok: true }; },
    assertMayAct: async () => {},
    refresh: async () => state,
    requestStop: async () => { rec.stops += 1; state.stopRequested = true; }
  }, extra);
  return ctx;
}

function stateFor(opts) {
  const o = opts || {};
  return {
    running: true, stopRequested: false,
    settings: { live_mode: o.live === true, step_by_step: true },
    run: { runId: RUN_ID, live: o.live === true },
    current: { jobIndex: 0, phase: "agreements" },
    queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", productId: PRODUCT, agreeClicked: false, startedAt: Date.now() }]
      .concat(o.more ? [{ projectId: "proj-two", modelSlug: "claude-haiku-4-5", status: "pending" }] : [])
  };
}

const panelOf = (env) => env.document.getElementById("mgc-panel");
const buttonsOf = (env) => Array.from(env.document.querySelectorAll("#mgc-panel button")).map((b) => b.textContent);
const noteOf = (env) => { const n = env.document.querySelector("#mgc-panel .mgc-panel-note"); return n && n.style.display !== "none" ? n.textContent : ""; };
const contOf = (env) => env.document.querySelector('#mgc-panel button[data-action="continue"]');

(async () => {
  console.log("--- awaitConfirmation: the panel");
  {
    const env = E.makeEnv({ url: AGREEMENTS_URL });
    env.K.URL_POLL_MS = 20;
    const state = stateFor();
    const ctx = ctxFor(env, state);
    env.B.update({ mode: "DRY RUN", jobIndex: 0, total: 1, projectId: "proj-one", modelSlug: "claude-haiku-4-5", jobStartedAt: Date.now(), plan: "x", nextJob: null, note: "n" });
    let settled = null;
    const p = env.A.awaitConfirmation(ctx, "next", { summary: "The form is filled.", userActed: () => false }).then((v) => { settled = v; return v; }, (e) => { settled = e; throw e; });
    await sleep(60);
    const badge = env.document.getElementById("mgc-badge");
    const panel = panelOf(env);
    ok(badge && panel && panel.parentNode === badge, "the panel is rendered inside the badge", !!panel);
    ok(panel.querySelector(".mgc-panel-title").textContent === "Step-by-step: Next" && panel.querySelector(".mgc-panel-summary").textContent === "The form is filled.", "panel title names the step, the summary is the caller's", panel.textContent);
    ok(buttonsOf(env).join("/") === "Continue/Stop", "two buttons: Continue and Stop", buttonsOf(env).join("/"));
    ok(badge.style.pointerEvents === "none" && panel.style.pointerEvents === "auto", "the badge text takes no pointer events, the panel does");
    ok(badge.style.maxWidth === "min(520px, 40vw)" && badge.style.right === "12px" && badge.style.bottom === "12px", "the badge sits bottom-right at most 40 % of the viewport wide (clear of the console's bottom-left Next and Agree from 880 px up)", badge.style.maxWidth);
    ok(typeof env.B.panelElement === "undefined", "B.panelElement (no callers) is gone");
    ok(ctx.rec.logs.some((m) => m === "confirmation panel shown before Next: Continue / Stop"), "the panel was logged", ctx.rec.logs.join(" | "));
    ok(ctx.rec.steps.includes("waiting for your confirmation before Next"), "the step line says it waits", ctx.rec.steps.join(" | "));

    console.log("--- Continue ignores untrusted clicks");
    const cont = contOf(env);
    cont.click();
    cont.dispatchEvent(new env.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    cont.dispatchEvent(new env.win.Event("click", { bubbles: true }));
    await sleep(120);
    ok(settled === null, "three script-dispatched clicks on Continue: the wait is still pending", settled);
    ok(ctx.rec.logs.filter((m) => m === "ignored an untrusted Continue click before Next").length === 3, "each untrusted click was logged as ignored", ctx.rec.logs.join(" | "));
    ok(env.A.continueAge(RUN_ID, 0, "next") === null && ctx.rec.updates.length === 0, "nothing was recorded for the guard or on the job");
    ok(panelOf(env) === panel, "the panel is still open (same node)");

    console.log("--- a trusted click on Continue resolves the wait and is recorded");
    trustedClick(cont);
    await sleep(120);
    ok(settled === "continue", "the wait resolved with \"continue\"", settled);
    ok(typeof env.A.continueAge(RUN_ID, 0, "next") === "number" && env.A.continueAge(RUN_ID, 0, "next") < 5000, "the trusted Continue is recorded for the guard (job, step)");
    ok(ctx.rec.updates.length === 0, "nothing is written to the job record for a Continue (the unread `confirmed` copy is gone)", JSON.stringify(ctx.rec.updates));
    ok(ctx.rec.logs.some((m) => m === "Continue clicked (trusted); proceeding with Next"), "the trusted Continue was logged");
    ok(panelOf(env) === null, "the panel closed");
    await p.catch(() => {});
    env.win.close();
  }

  console.log("--- the user's own console click is detected; Stop ends the wait");
  {
    const env = E.makeEnv({ url: AGREEMENTS_URL });
    env.K.URL_POLL_MS = 20;
    const state = stateFor();
    const ctx = ctxFor(env, state);
    let acted = false;
    const p = env.A.awaitConfirmation(ctx, "next", { summary: "s", userActed: () => acted });
    await sleep(60);
    ok(panelOf(env) !== null, "panel open while nothing happened");
    acted = true;
    const how = await p;
    ok(how === "user" && ctx.rec.logs.some((m) => m === "you activated the console's Next yourself; continuing"), "userActed() true resolves \"user\" and is logged", how);
    ok(env.A.continueAge(RUN_ID, 0, "next") === null, "no Continue is recorded when the user acted in the console");
    ok(panelOf(env) === null, "the panel closed");

    const state2 = stateFor();
    const ctx2 = ctxFor(env, state2);
    const p2 = env.A.awaitConfirmation(ctx2, "agree", { summary: "s", userActed: () => false });
    await sleep(60);
    env.document.querySelector('#mgc-panel button[data-action="stop"]').click();
    let err = null;
    try { await p2; } catch (e) { err = e; }
    ok(ctx2.rec.stops === 1 && err && err.name === "StoppedError", "Stop (any click) asks the worker to stop; the wait ends with StoppedError once storage says so", err && err.name);

    const state3 = stateFor();
    const ctx3 = ctxFor(env, state3);
    const p3 = env.A.awaitConfirmation(ctx3, "agree", { summary: "s" });
    await sleep(60);
    ok(buttonsOf(env).join("/") === "Continue/Stop", "every panel offers Continue and Stop (no Stop-only option exists)", buttonsOf(env).join("/"));
    state3.run = { runId: "another", live: false };
    err = null;
    try { await p3; } catch (e) { err = e; }
    ok(err && err.name === "StoppedError" && /no longer the current run/.test(err.message), "a replaced run ends the wait with StoppedError");

    console.log("--- (S2) a console dialog during the wait disables Continue and names the dialog; the Enable APIs dialog is cleared");
    const state4 = stateFor();
    const ctx4 = ctxFor(env, state4);
    let settled4 = null;
    const p4 = env.A.awaitConfirmation(ctx4, "agree", { summary: "s", userActed: () => false }).then((v) => { settled4 = v; }, (e) => { settled4 = e; });
    await sleep(60);
    env.document.body.insertAdjacentHTML("beforeend", ERROR_DIALOG);
    await sleep(80);
    let cont = contOf(env);
    ok(cont.disabled === true && /A console dialog is open: Something went wrong: Could not load billing accounts\. Try again\./.test(noteOf(env)) && /Continue is disabled meanwhile/.test(noteOf(env)), "an error dialog opens: Continue disabled, the panel names the dialog", noteOf(env));
    ok(ctx4.rec.logs.some((m) => /a console dialog is open while waiting for your confirmation: Something went wrong.*\(element mat-dialog-container\); Continue disabled until it closes/.test(m)), "the dialog was logged once, naming the element it was matched by (T6)", ctx4.rec.logs.join(" | "));
    trustedClick(cont);
    await sleep(80);
    ok(settled4 === null && env.A.continueAge(RUN_ID, 0, "agree") === null, "a trusted Continue while the dialog is open is ignored and not recorded", settled4);
    env.document.getElementById("err").remove();
    await sleep(80);
    cont = contOf(env);
    ok(cont.disabled === false && noteOf(env) === "" && ctx4.rec.logs.some((m) => m === "the console dialog closed; Continue is enabled again"), "the dialog closes: Continue enabled, note gone, logged");
    env.document.body.insertAdjacentHTML("beforeend", API_DIALOG);
    let enableClicks = 0;
    for (const b of env.D.qa("#api button")) b.addEventListener("click", () => { if (env.D.text(b) === "Enable") { enableClicks += 1; env.document.getElementById("api").remove(); } });
    await sleep(120);
    ok(enableClicks === 1 && !env.document.getElementById("api"), 'the "Enable APIs" dialog during the wait: its Enable clicked once by clearBlockingDialog, dialog gone', enableClicks);
    ok(panelOf(env) !== null && panelOf(env) !== null && ctx4.rec.logs.some((m) => m === "confirmation panel shown again before Agree") && ctx4.rec.logs.some((m) => /"Enable APIs" dialog closed/.test(m)), "the panel was re-shown after the dialog and both were logged", ctx4.rec.logs.join(" | "));
    ok(settled4 === null, "the wait is still pending");
    trustedClick(contOf(env));
    await sleep(80);
    ok(settled4 === "continue", "a trusted Continue on the re-shown panel resolves the wait", settled4);
    await p4;
    env.win.close();
  }

  console.log("--- handleQuestionnaire with step-by-step on the real filled form (run A, 03-form-filled)");
  const run = E.findRun("A");
  const snap = run && E.readSnapshot(run, "03-form-filled");
  if (!snap) skip("handleQuestionnaire step-by-step on 03-form-filled", "recon dump not present");
  else {
    const SLUG = (new URL(snap.url).searchParams.get("model") || "").split("/").pop();
    const serve = () => { const env = E.makeEnv(snap); E.rehydrate(env.document, snap.forms); env.K.TIMEOUTS.NAV = 150; env.K.TIMEOUTS.FORM_VALID = 300; env.K.URL_POLL_MS = 20; return env; };
    const settingsFrom = (env) => {
      const q = env.S.questionnaire;
      const radio = env.D.q('input[type="radio"]:checked', q.aupRadioGroup());
      return { business_name: q.businessName().value, business_website: q.businessWebsite().value, contact_email: q.contactEmail().value,
        headquarters: env.D.selectValueText(q.headquarters()), industry: env.D.selectValueText(q.industry()), intended_users: env.D.selectValueText(q.intendedUsers()),
        use_cases: q.useCases().value, aup_additional_requirements: radio && radio.value === "Yes" ? "yes" : "no", aup_details: "", live_mode: false, step_by_step: true };
    };
    const qctx = (env, state) => {
      state.queue[0] = { projectId: new URL(snap.url).searchParams.get("project"), modelSlug: SLUG };
      const ctx = ctxFor(env, state);
      ctx.settings = settingsFrom(env);
      ctx.job = state.queue[0];
      return ctx;
    };

    // (a) the user clicks Next: the route leaves the questionnaire while the panel waits.
    let env = serve();
    let state = stateFor();
    let ctx = qctx(env, state);
    let nextClicks = 0; env.S.questionnaire.nextButton().addEventListener("click", () => { nextClicks += 1; });
    let done = null;
    const pa = env.A.handleQuestionnaire(ctx).then((r) => { done = { r }; }, (e) => { done = { e }; });
    await sleep(500);
    ok(done === null && panelOf(env) !== null && ctx.rec.phases.join() === "questionnaire,awaiting_confirmation(next)", "form filled: the panel is up and the phase is awaiting_confirmation(next)", ctx.rec.phases.join());
    ok(/Continue clicks Next/.test(env.document.querySelector("#mgc-panel .mgc-panel-summary").textContent), "the summary says what Continue does", env.document.querySelector("#mgc-panel .mgc-panel-summary").textContent);
    env.dom.reconfigure({ url: AGREEMENTS_URL.replace("proj-one", ctx.job.projectId) });
    await pa;
    ok(done && !done.e && done.r === null, "after the URL left the questionnaire the handler returned null (flow continues on the next page)", done && done.e ? done.e.message : JSON.stringify(done));
    ok(nextClicks === 0, "Next received no click from the extension (the user clicked it)", nextClicks);
    ok(ctx.rec.phases.join() === "questionnaire,awaiting_confirmation(next),questionnaire", "the page's phase was set again after the wait (re-arms the watchdog)", ctx.rec.phases.join());
    ok(ctx.rec.logs.some((m) => m === "you activated the console's Next yourself; continuing") && ctx.rec.marks.some((m) => /left the questionnaire \(Next clicked by you\)/.test(m)), "the user's click was logged and marked", ctx.rec.marks.join(" | "));
    env.win.close();

    // (b) a trusted Continue: Next is clicked exactly once by the extension.
    env = serve();
    state = stateFor();
    ctx = qctx(env, state);
    nextClicks = 0; env.S.questionnaire.nextButton().addEventListener("click", () => { nextClicks += 1; });
    done = null;
    const pb = env.A.handleQuestionnaire(ctx).then((r) => { done = { r }; }, (e) => { done = { e }; });
    await sleep(500);
    const cont = contOf(env);
    ok(!!cont && done === null && nextClicks === 0, "panel up with Continue, nothing clicked yet");
    trustedClick(cont);
    await pb;
    ok(nextClicks === 1, "Next clicked exactly once after the trusted Continue", nextClicks);
    ok(done && done.e && done.e.name === "TimeoutError" && /page change away from questionnaire/.test(done.e.message), "then the handler waited for the page change (times out in jsdom)", done && (done.e ? done.e.message : JSON.stringify(done.r)));
    ok(ctx.rec.updates.every((u) => !("confirmed" in u)), "no `confirmed` copy is written to the job", JSON.stringify(ctx.rec.updates));
    env.win.close();

    // (c) control: with step-by-step off the handler clicks Next without any panel or awaiting phase.
    env = serve();
    state = stateFor();
    ctx = qctx(env, state);
    ctx.settings.step_by_step = false;
    nextClicks = 0; env.S.questionnaire.nextButton().addEventListener("click", () => { nextClicks += 1; });
    let err = null;
    try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
    ok(nextClicks === 1 && err && err.name === "TimeoutError" && ctx.rec.phases.join() === "questionnaire" && panelOf(env) === null, "control: step-by-step off, Next clicked once, no panel, no awaiting phase", ctx.rec.phases.join());
    env.win.close();

    // (d) (0.8.0) an extra consent dialog opens while the panel waits before Next: the job ends at once
    // as failed naming the dialog; Next is not clicked, nothing in the dialog is clicked or ticked.
    env = serve();
    state = stateFor();
    ctx = qctx(env, state);
    nextClicks = 0; env.S.questionnaire.nextButton().addEventListener("click", () => { nextClicks += 1; });
    done = null;
    const pd = env.A.handleQuestionnaire(ctx).then((r) => { done = { r }; }, (e) => { done = { e }; });
    await sleep(500);
    ok(done === null && panelOf(env) !== null, "(d) the panel waits before Next");
    env.document.body.insertAdjacentHTML("beforeend", '<div class="cdk-overlay-container" id="consent"><mat-dialog-container role="dialog"><h1 matdialogtitle>Additional terms</h1><div matdialogcontent>Accept the terms of service for this model.</div><mat-checkbox><label><input type="checkbox"> I accept the terms of service</label></mat-checkbox><button> Accept </button></mat-dialog-container></div>');
    let dialogClicks = 0; for (const b of env.D.qa("#consent button, #consent input")) b.addEventListener("click", () => { dialogClicks += 1; });
    const t0d = Date.now();
    await pd;
    ok(done && !done.e && done.r && done.r.status === "failed" && /^extra consent required, not supported \(mat-dialog-container\): "Additional terms": .*terms of service/.test(done.r.message) && Date.now() - t0d < 600,
      "(d) (0.8.0) the consent dialog ends the job at once: failed, naming the dialog's title and text", done && (done.e ? done.e.message : JSON.stringify(done.r)));
    ok(nextClicks === 0 && dialogClicks === 0 && !env.D.q("#consent input").checked && panelOf(env) === null, "(d) Next not clicked, nothing in the dialog clicked or ticked, the panel closed", `next ${nextClicks} dialog ${dialogClicks}`);
    env.win.close();
  }

  console.log("--- handleAgreements with step-by-step: dry run (Next job / Stop)");
  const serve = (html) => { const env = E.makeEnv({ html: `<!doctype html><html><body>${html}</body></html>`, url: AGREEMENTS_URL }); env.K.TIMEOUTS.CONFIRM = 400; env.K.TIMEOUTS.AGREEMENTS_READY = 600; env.K.URL_POLL_MS = 20; return env; };
  const arm = (env) => { let n = 0; env.S.agreements.agreeButton().addEventListener("click", () => { n += 1; }); return () => n; };
  const agreeNode = (env) => env.document.querySelector('button[data-prober="cloud-marketplace-request-product"]');
  {
    // (S3) Next job: the job ends dry-run and the run goes on.
    let env = serve(RENDERED);
    let state = stateFor({ live: false, more: true });
    let ctx = ctxFor(env, state);
    let clicks = arm(env);
    let done = null;
    const pd = env.A.handleAgreements(ctx).then((x) => { done = { r: x }; }, (e) => { done = { e }; });
    await sleep(300);
    let panel = panelOf(env);
    ok(done === null && panel && buttonsOf(env).join("/") === "Next job/Stop", "dry run: the panel waits with Next job and Stop (the job does not end by itself)", `${buttonsOf(env).join("/")} done=${JSON.stringify(done)}`);
    ok(/dry run ends here \(Agree not clicked\)/.test(panel.querySelector(".mgc-panel-title").textContent) && /Agree was not clicked/.test(panel.querySelector(".mgc-panel-summary").textContent) && /moves to the next job/.test(panel.querySelector(".mgc-panel-summary").textContent), "title and summary carry the dry-run message and what Next job does", panel.textContent);
    ok(ctx.rec.phases.join() === "agreements,awaiting_confirmation(next-job)", "phase awaiting_confirmation(next-job) while it waits", ctx.rec.phases.join());
    ok(env.D.isCheckboxChecked(env.S.agreements.termsCheckbox()) && clicks() === 0, "box ticked, Agree never clicked");
    ok(ctx.rec.logs.some((m) => m === "confirmation panel shown before Next job: Next job / Stop"), "the panel was logged");
    const nextJob = env.document.querySelector('#mgc-panel button[data-action="next-job"]');
    nextJob.click();
    await sleep(80);
    ok(done === null && ctx.rec.logs.some((m) => m === "ignored an untrusted Next job click before Next job"), "an untrusted Next job click is ignored");
    trustedClick(nextJob);
    await pd;
    ok(done && !done.e && done.r.status === "dry-run" && /checkbox ticked; Agree was not clicked/.test(done.r.message) && done.r.stopAfter !== true, "trusted Next job: the job ends dry-run, the run goes on", done && (done.e ? done.e.message : JSON.stringify(done.r)));
    ok(ctx.rec.phases.join() === "agreements,awaiting_confirmation(next-job),agreements" && clicks() === 0 && panelOf(env) === null, "phase set back, no click, panel closed", ctx.rec.phases.join());
    env.win.close();

    // (S3) Stop: the job still ends dry-run; the result asks the worker to stop after it.
    env = serve(RENDERED);
    state = stateFor({ live: false });
    ctx = ctxFor(env, state);
    clicks = arm(env);
    done = null;
    const ps = env.A.handleAgreements(ctx).then((x) => { done = { r: x }; }, (e) => { done = { e }; });
    await sleep(300);
    ok(done === null && /last job, so the run finishes/.test(panelOf(env).querySelector(".mgc-panel-summary").textContent), "the last job's summary says the run finishes after it", panelOf(env) && panelOf(env).textContent);
    env.document.querySelector('#mgc-panel button[data-action="stop"]').click();
    await ps;
    ok(done && !done.e && done.r.status === "dry-run" && /checkbox ticked; Agree was not clicked; you stopped the run here/.test(done.r.message) && done.r.stopAfter === true, "Stop on the dry-run panel: the job ends dry-run with stopAfter for the worker", done && (done.e ? done.e.message : JSON.stringify(done.r)));
    ok(ctx.rec.stops === 0 && clicks() === 0 && ctx.rec.logs.some((m) => m === "Stop clicked on the panel; the job ends here and the run stops"), "no stop request sent from the content script (the result carries it), no click, logged");
    env.win.close();

    // control: step-by-step off ends dry-run at once with no panel.
    env = serve(RENDERED);
    state = stateFor({ live: false });
    state.settings.step_by_step = false;
    ctx = ctxFor(env, state);
    const r0 = await env.A.handleAgreements(ctx);
    ok(r0 && r0.status === "dry-run" && panelOf(env) === null && ctx.rec.phases.join() === "agreements", "control: step-by-step off, dry-run at once, no panel");
    env.win.close();

    // (0.8.0) while the dry-run panel waits, the user's own click on the console's Agree, or a purchase
    // confirmation, ends the job unverified with purchaseObserved recorded (the extension clicks nothing).
    for (const [label, act, wording] of [
      ["the user's trusted click on the console's Agree", (e) => trustedClick(agreeNode(e).querySelector("span")), /^unverified: you clicked the console's Agree during a dry run; check manually$/],
      ["a purchase confirmation", (e) => e.document.body.insertAdjacentHTML("beforeend", SUCCESS), /^unverified: the console reported a purchase while waiting for confirmation; check manually$/]
    ]) {
      env = serve(RENDERED);
      state = stateFor({ live: false });
      ctx = ctxFor(env, state);
      clicks = arm(env);
      done = null;
      const pu = env.A.handleAgreements(ctx).then((x) => { done = { r: x }; }, (e) => { done = { e }; });
      await sleep(300);
      act(env);
      await pu;
      const userClicks = label.startsWith("the user's") ? 1 : 0;
      ok(done && !done.e && done.r.status === "unverified" && wording.test(done.r.message) && ctx.rec.updates.some((u) => u.purchaseObserved === true) && !ctx.rec.updates.some((u) => u.agreeClicked) && clicks() === userClicks && panelOf(env) === null,
        `(0.8.0) dry run, ${label} while the panel waits: unverified, purchaseObserved recorded, the extension clicked nothing`, done && (done.e ? done.e.message : JSON.stringify(done.r)) + " " + JSON.stringify(ctx.rec.updates));
      env.win.close();
    }

    // (0.8.0) the terms node is resolved again after the await and must be the same node: a re-render in
    // between ends the job with the locators message, and nothing is ticked.
    env = serve(RENDERED);
    state = stateFor({ live: false });
    state.settings.step_by_step = false;
    ctx = ctxFor(env, state, { assertMayAct: async () => { const old = env.document.querySelector("mat-checkbox"); old.replaceWith(old.cloneNode(true)); } });
    let rerr = null;
    try { await env.A.handleAgreements(ctx); } catch (e) { rerr = e; }
    ok(rerr && env.D.isFatal(rerr) && /the terms checkbox \(mat-checkbox\.p6ntest-mp-agreements-body-tos-checkbox or mp-agreements-tos\) was not found again before the tick/.test(rerr.message) && !env.document.querySelector('mat-checkbox input').checked,
      "(0.8.0) the terms box re-rendered between the wait and the tick: fatal with the locators message, nothing ticked", rerr && rerr.message);
    env.win.close();
  }

  console.log("--- handleAgreements with step-by-step: full run (Continue before Agree)");
  {
    const start = (env, state) => {
      const ctx = ctxFor(env, state);
      const out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      return out;
    };
    const says = (out) => out.done && (out.done.e ? out.done.e.message : JSON.stringify(out.done.r));
    const recordedClick = (out) => out.ctx.rec.updates.some((u) => u.agreeClicked === true);

    // (S1) a success dialog opens while nobody activated Agree: unverified, nothing recorded, no lock.
    let env = serve(RENDERED);
    let clicks = arm(env);
    let out = start(env, stateFor({ live: true }));
    await sleep(300);
    let panel = panelOf(env);
    ok(out.done === null && panel && /FULL RUN: Continue clicks Agree/.test(panel.querySelector(".mgc-panel-summary").textContent) && buttonsOf(env).join("/") === "Continue/Stop",
      "full run: the panel waits before Agree with Continue and Stop and names the purchase", panel && panel.textContent);
    ok(out.ctx.rec.phases.join() === "agreements,awaiting_confirmation(agree)", "phase awaiting_confirmation(agree)", out.ctx.rec.phases.join());
    env.document.body.insertAdjacentHTML("beforeend", SUCCESS);
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "unverified" && out.done.r.message === "unverified: the console reported a purchase while waiting for confirmation; check manually", "(S1) a success dialog with no Agree activation seen: unverified with that message", says(out));
    ok(clicks() === 0 && !recordedClick(out) && !out.ctx.rec.updates.some((u) => u.agreeClickedByUser), "no click, agreeClicked not recorded (no retry lock), agreeClickedByUser not set", JSON.stringify(out.ctx.rec.updates));
    ok(out.ctx.rec.updates.some((u) => u.purchaseObserved === true), "(0.8.0) the observed purchase is recorded on the job (purchaseObserved), so the next run's cross-run guard counts the pair as done", JSON.stringify(out.ctx.rec.updates));
    ok(out.ctx.rec.logs.some((m) => /a purchase confirmation opened while waiting for your Continue and no Agree activation by you was seen: "Successfully purchased Claude Haiku 4\.5"/.test(m)), "it was logged", out.ctx.rec.logs.join(" | "));
    env.win.close();

    // (0.8.0) a permission error appears while the panel waits before Agree: failed at once, no Agree click, nothing recorded.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    env.document.body.insertAdjacentHTML("beforeend", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>You don\'t have permission to purchase this product. Contact your administrator.</simple-snack-bar></mat-snack-bar-container></div>');
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "failed" && out.done.r.message === "missing permission: You don't have permission to purchase this product. Contact your administrator." && clicks() === 0 && !recordedClick(out),
      "(0.8.0) full run, panel before Agree: a permission snackbar ends the job failed with \"missing permission: <excerpt>\"; Agree never clicked, nothing recorded", says(out));
    env.win.close();

    // (S1) an error dialog opens while nobody activated Agree: the wait goes on with Continue disabled; nothing is judged.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    env.document.body.insertAdjacentHTML("beforeend", ERROR_DIALOG);
    await sleep(120);
    ok(out.done === null && contOf(env) && contOf(env).disabled === true && /Something went wrong/.test(noteOf(env)), "(S1) an error dialog with no Agree activation: still waiting, Continue disabled, dialog named", `${says(out)} ${noteOf(env)}`);
    ok(!recordedClick(out) && !out.ctx.rec.updates.some((u) => u.agreeClickedByUser) && out.ctx.rec.phases.join() === "agreements,awaiting_confirmation(agree)", "nothing recorded on the job, still in the awaiting phase", JSON.stringify(out.ctx.rec.updates));
    env.document.getElementById("err").remove();
    await sleep(80);
    ok(contOf(env).disabled === false && noteOf(env) === "", "dialog dismissed: Continue enabled again");
    out.ctx.rec.logs.length = 0;
    agreeNode(env).click(); // a script click on the console's Agree: not trusted, not the user
    await sleep(80);
    ok(out.done === null && !out.ctx.rec.logs.some((m) => /activated the console's Agree/.test(m)) && clicks() === 1, "control: an untrusted click on the Agree node is not taken for the user's", out.ctx.rec.logs.join(" | "));
    env.S.detectPage = () => "agreements";
    out.ctx.requestStop();
    await out.p.catch(() => {});
    ok(out.done && out.done.e && out.done.e.name === "StoppedError", "Stop ends it (StoppedError)", says(out));
    env.win.close();

    // (S1) the user clicks the console's Agree (trusted click on the node): detected by the listener, judged by the dialog.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    trustedClick(agreeNode(env).querySelector("span"));
    await sleep(80);
    ok(out.done === null && out.ctx.rec.logs.some((m) => m === "you activated the console's Agree yourself; continuing") && out.ctx.rec.marks.some((m) => /Agree activated by you \(click\); judging its outcome/.test(m)), "a trusted click on the Agree node (on its inner span): seen as the user's, logged and marked", out.ctx.rec.logs.join(" | "));
    ok(out.ctx.rec.updates.some((u) => u.agreeClickedByUser === true && u.agreeClicked === true), "agreeClickedByUser and agreeClicked recorded", JSON.stringify(out.ctx.rec.updates));
    ok(out.ctx.rec.phases.join() === "agreements,awaiting_confirmation(agree),agreements", "the agreements phase was set again (watchdog re-armed) before judging the dialog", out.ctx.rec.phases.join());
    env.document.body.insertAdjacentHTML("beforeend", SUCCESS);
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "done" && /enabled: Agree clicked by you and confirmation observed/.test(out.done.r.message) && clicks() === 1, "then the success dialog: done, worded as the user's click; the extension clicked nothing itself", says(out) + " clicks=" + clicks());
    env.win.close();

    // (S1/N3/L1) keyboard activation is seen through the click the browser fires for Enter or Space on the
    // focused button; key events alone (a keydown, or a keydown with its keyup and no click, as when a page
    // prevented the key's default) never count, so they never lock the job as clicked.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    ok(env.S.agreements.KEY_ACTIVATION_MS === undefined, "(L1) no key window is left in the listener: only a trusted click counts");
    trustedKeydown(agreeNode(env), "Enter");
    await sleep(80);
    ok(out.done === null && !out.ctx.rec.marks.some((m) => /Agree activated by you/.test(m)) && !out.ctx.rec.updates.some((u) => u.agreeClickedByUser) && panelOf(env) !== null, "(N3) a trusted Enter keydown alone is not an activation: the wait goes on, nothing recorded", out.ctx.rec.marks.join(" | "));
    trustedKeyup(agreeNode(env), "Enter");
    await sleep(80);
    ok(out.done === null && !out.ctx.rec.marks.some((m) => /Agree activated by you/.test(m)) && !out.ctx.rec.updates.some((u) => u.agreeClicked || u.agreeClickedByUser) && panelOf(env) !== null && clicks() === 0, "(L1) its keyup with no click (the page prevented the key's default) is not one either: nothing recorded, the job is not locked, still waiting", JSON.stringify(out.ctx.rec.updates));
    trustedClick(agreeNode(env).querySelector("span")); // the click the browser fires for the key
    await sleep(80);
    ok(out.done === null && out.ctx.rec.marks.some((m) => /Agree activated by you \(click\)/.test(m)) && clicks() === 1, "the browser's click for the key is the activation: seen as the user's click", out.ctx.rec.marks.join(" | "));
    env.document.body.insertAdjacentHTML("beforeend", REFUSAL_DIALOG);
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "failed" && /Agree refused by the console: Action Required: Choose Different Billing Account: This billing account cannot buy/.test(out.done.r.message) && clicks() === 1, "the console's refusal dialog after the user's activation is that click's outcome: failed with the console's text (T1: a bare error container would not be)", says(out));
    env.win.close();

    // (N3/L1) Space: a keydown with no keyup (focus moved), a keyup of another key, a keydown with its keyup
    // and no click: all ignored; a keydown completed by the browser's click counts, as a click.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    trustedKeydown(agreeNode(env), " ");
    trustedKeyup(agreeNode(env), "Enter"); // another key's keyup
    await sleep(80);
    ok(out.done === null && !out.ctx.rec.marks.some((m) => /Agree activated by you/.test(m)), "(N3) a Space keydown followed by an Enter keyup is ignored", out.ctx.rec.marks.join(" | "));
    trustedKeydown(agreeNode(env), " ");
    trustedKeyup(agreeNode(env), " ");
    await sleep(80);
    ok(out.done === null && !out.ctx.rec.marks.some((m) => /Agree activated by you/.test(m)) && !out.ctx.rec.updates.some((u) => u.agreeClicked || u.agreeClickedByUser) && clicks() === 0, "(L1) a Space keydown and keyup on Agree with no click: nothing recorded, the job is not locked, no click", JSON.stringify(out.ctx.rec.updates));
    trustedKeydown(agreeNode(env), " ");
    trustedClick(agreeNode(env).querySelector("span")); // the click the browser fires for Space on keyup
    await sleep(80);
    ok(out.done === null && out.ctx.rec.marks.some((m) => /Agree activated by you \(click\)/.test(m)) && clicks() === 1, "(N3) control: a keydown completed by the trusted click the browser fires counts, as a click", out.ctx.rec.marks.join(" | "));
    env.document.body.insertAdjacentHTML("beforeend", SUCCESS);
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "done" && /Agree clicked by you/.test(out.done.r.message) && clicks() === 1, "then the success dialog: done through the user's click", says(out));
    env.win.close();

    // (S10) the user clicks Agree and then Continue: the Continue is ignored, the click's outcome is judged.
    env = serve(RENDERED);
    clicks = arm(env);
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    const btn = agreeNode(env);
    btn.addEventListener("click", (ev) => { if (ev.isTrusted) { btn.style.display = "none"; setTimeout(() => env.document.body.insertAdjacentHTML("beforeend", SUCCESS), 150); } });
    trustedClick(btn);
    trustedClick(contOf(env));
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "done" && /Agree clicked by you/.test(out.done.r.message) && clicks() === 1, "(S10) Agree by the user, then Continue within the same poll: done through the user's click, the extension did not click", says(out) + " clicks=" + clicks());
    ok(out.ctx.rec.logs.some((m) => m === "ignored Continue: you already activated the console's Agree yourself") && env.A.continueAge(RUN_ID, 0, "agree") === null, "the Continue was ignored and not recorded", out.ctx.rec.logs.join(" | "));
    env.win.close();

    // (S10) Continue first, the user's Agree a moment later, before the guard: the guard refuses (button gone), the click's outcome is judged.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      // assertMayAct is called before the tick, before the wait and between
      // the wait and the guard; the third call is the window this tests.
      let calls = 0;
      ctx.assertMayAct = async () => {
        if (++calls !== 3) return;
        const b = agreeNode(env);
        b.addEventListener("click", (ev) => { if (ev.isTrusted) { b.style.display = "none"; setTimeout(() => env.document.body.insertAdjacentHTML("beforeend", SUCCESS), 150); } });
        trustedClick(b);
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && /Agree clicked by you/.test(out.done.r.message) && clicks() === 1, "(S10) Continue, then the user's Agree before the guard ran: the guard's refusal is not a failure, done through the user's click", says(out) + " clicks=" + clicks());
      // (0.8.0) the user's Agree is checked before the pre-click checks, so the guard is never called: no refusal, no record of the extension's own click.
      ok(!out.ctx.rec.logs.some((m) => /the guard refused|LIVE: clicking Agree/.test(m)) && out.ctx.rec.updates.some((u) => u.agreeClickedByUser === true) && !out.ctx.rec.updates.some((u) => u.agreeClicked === true && !u.agreeClickedByUser), "the user's activation is seen before the guard is called (no guard call, no refusal) and the user's click is recorded", out.ctx.rec.logs.join(" | "));
    }
    env.win.close();

    // (0.8.0) Continue, then the user's own Agree together with a permission alert, before the pre-click check: the
    // user's click is judged (it happened), not failed by the blocker.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let calls = 0;
      ctx.assertMayAct = async () => {
        if (++calls !== 3) return;
        const b = agreeNode(env);
        b.addEventListener("click", (ev) => { if (ev.isTrusted) { b.style.display = "none"; setTimeout(() => env.document.body.insertAdjacentHTML("beforeend", SUCCESS), 150); } });
        env.document.body.insertAdjacentHTML("beforeend", '<div role="alert" id="perm">Permission denied: billing.accounts.get</div>');
        trustedClick(b);
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && /Agree clicked by you/.test(out.done.r.message) && clicks() === 1 && out.ctx.rec.updates.some((u) => u.agreeClickedByUser === true),
        "(0.8.0) Continue, then the user's Agree with a permission alert on the page: the user's click is judged (done), not failed by the blocker", says(out));
    }
    env.win.close();

    // (0.8.0) a guard refusal while a blocker shows (a permission alert that appears during the record round trip):
    // the job ends with the blocker, the panel does not ask for Continue again, Agree is never clicked.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      const update = ctx.updateJob;
      ctx.updateJob = async (f) => {
        if (f.agreeClicked === true) env.document.body.insertAdjacentHTML("beforeend", '<div role="alert">Permission denied: you cannot purchase in this billing account.</div>');
        return update(f);
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && out.done.e && out.done.e.name === "BlockedError" && /^missing permission: Permission denied: you cannot purchase/.test(out.done.e.message) && clicks() === 0 && state.queue[0].agreeClicked === false
        && !out.ctx.rec.logs.some((m) => /asking for your confirmation again/.test(m)),
        "(0.8.0) a guard refusal while a blocker shows: BlockedError naming it, no second Continue asked, no click, the record undone", says(out) + " | " + out.ctx.rec.logs.join(" | "));
    }
    env.win.close();

    // (N1) Continue, then the user's Agree during the guard's record round trip while the button stays
    // visible: the guard refuses (one click total, the user's), undoes its record, the click is judged.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let records = 0;
      ctx.updateJob = async (f) => {
        ctx.rec.updates.push(f); Object.assign(state.queue[0], f);
        // The guard's own record (agreeClicked alone) is in flight: the user clicks the console's Agree.
        if (f.agreeClicked === true && !f.agreeClickedByUser && ++records === 1) trustedClick(agreeNode(env).querySelector("span"));
        return { ok: true };
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await sleep(150);
      env.document.body.insertAdjacentHTML("beforeend", SUCCESS);
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && /enabled: Agree clicked by you and confirmation observed/.test(out.done.r.message) && clicks() === 1, "(N1) Continue, then the user's Agree while the record was in flight and the button still visible: the extension did not click (one click total, the user's), done on the user's click", says(out) + " clicks=" + clicks());
      ok(out.ctx.rec.logs.some((m) => /the guard refused \(refused to click: you activated the console's Agree yourself\) after you activated the console's Agree yourself/.test(m)), "the guard's refusal names the user's activation", out.ctx.rec.logs.join(" | "));
      const u = out.ctx.rec.updates;
      ok(JSON.stringify(u) === JSON.stringify([{ agreeClicked: true }, { agreeClicked: false }, { agreeClicked: true, agreeClickedByUser: true }]), "the guard's record was undone (no click was made) and the user's activation recorded instead", JSON.stringify(u));
      ok(out.ctx.rec.logs.some((m) => /the Agree click record was cleared: no click was made/.test(m)), "the undo was logged", out.ctx.rec.logs.join(" | "));
    }
    env.win.close();

    // (N2) a dialog that opens during the guard's record round trip (after agreeClicked was recorded,
    // before the second check): the guard undoes the record and the panel asks again instead of failing.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let records = 0;
      ctx.updateJob = async (f) => {
        ctx.rec.updates.push(f); Object.assign(state.queue[0], f);
        if (f.agreeClicked === true && ++records === 1) env.document.body.insertAdjacentHTML("beforeend", ERROR_DIALOG);
        return { ok: true };
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await sleep(300);
      ok(out.done === null && panelOf(env) !== null && contOf(env).disabled === true && /Something went wrong/.test(noteOf(env)), "(N2) a dialog during the record round trip: the panel is up again with the dialog named, the job did not fail", `${says(out)} note=${noteOf(env)}`);
      ok(state.queue[0].agreeClicked === false && JSON.stringify(out.ctx.rec.updates) === JSON.stringify([{ agreeClicked: true }, { agreeClicked: false }]) && clicks() === 0, "(N2) agreeClicked is unset again in storage (recorded, then cleared), no click", JSON.stringify(out.ctx.rec.updates));
      ok(out.ctx.rec.logs.some((m) => /refused to click: a console dialog is open: Something went wrong.*; the Agree click record was cleared: no click was made/.test(m)) && out.ctx.rec.logs.some((m) => /a console dialog is open: Something went wrong.*; asking for your confirmation again/.test(m)), "logged: the record cleared, then the re-ask", out.ctx.rec.logs.join(" | "));
      ok(env.A.continueAge(RUN_ID, 0, "agree") === null, "(N2) the spent Continue record was cleared on the re-ask (a fresh trusted Continue is needed)");
      ok(out.ctx.rec.phases.join() === "agreements,awaiting_confirmation(agree),agreements,awaiting_confirmation(agree)", "the awaiting phase was set again", out.ctx.rec.phases.join());
      env.document.getElementById("err").remove();
      await sleep(80);
      agreeNode(env).addEventListener("click", () => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS); });
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && out.done.r.message === "enabled: Agree clicked and confirmation observed" && clicks() === 1 && state.queue[0].agreeClicked === true, "after the dialog closed a trusted Continue clicks Agree once: done, recorded", says(out) + " clicks=" + clicks());
    }
    env.win.close();

    // (L2) the Agree button hidden by a console re-render during the record round trip (no user click, no
    // dialog): the guard refuses, the record is undone, the panel asks again; once the button is back a fresh
    // Continue clicks once.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let records = 0;
      ctx.updateJob = async (f) => {
        ctx.rec.updates.push(f); Object.assign(state.queue[0], f);
        if (f.agreeClicked === true && ++records === 1) agreeNode(env).style.display = "none";
        return { ok: true };
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await sleep(300);
      ok(out.done === null && panelOf(env) !== null && contOf(env) && contOf(env).disabled === false, "(L2) the button hidden during the record round trip: the panel is up again, the job did not fail", says(out));
      ok(state.queue[0].agreeClicked === false && JSON.stringify(out.ctx.rec.updates) === JSON.stringify([{ agreeClicked: true }, { agreeClicked: false }]) && clicks() === 0, "(L2) the record was undone (true, then false), no click", JSON.stringify(out.ctx.rec.updates));
      ok(out.ctx.rec.logs.some((m) => /refused to click: Agree button not visible; the Agree click record was cleared: no click was made/.test(m)) && out.ctx.rec.logs.some((m) => /Agree button not visible; asking for your confirmation again/.test(m)), "logged: the record cleared, then the re-ask", out.ctx.rec.logs.join(" | "));
      ok(env.A.continueAge(RUN_ID, 0, "agree") === null, "(L2) the spent Continue was forgotten (a fresh trusted Continue is needed)");
      agreeNode(env).style.display = "";
      agreeNode(env).addEventListener("click", () => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS); });
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && clicks() === 1 && state.queue[0].agreeClicked === true, "with the button back a trusted Continue clicks Agree once: done, recorded", says(out) + " clicks=" + clicks());
    }
    env.win.close();

    // (N2) the same window with the "Enable APIs" dialog: the re-asked wait clears it, then a Continue clicks.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let records = 0, enableClicks = 0;
      ctx.updateJob = async (f) => {
        ctx.rec.updates.push(f); Object.assign(state.queue[0], f);
        if (f.agreeClicked === true && ++records === 1) {
          env.document.body.insertAdjacentHTML("beforeend", API_DIALOG);
          for (const b of env.D.qa("#api button")) b.addEventListener("click", () => { if (env.D.text(b) === "Enable") { enableClicks += 1; env.document.getElementById("api").remove(); } });
        }
        return { ok: true };
      };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await sleep(300);
      ok(out.done === null && panelOf(env) !== null && contOf(env).disabled === false && enableClicks === 1 && !env.document.getElementById("api"), '(N2) the "Enable APIs" dialog during the record round trip: re-asked, the wait cleared the dialog (one Enable click), Continue enabled', `${says(out)} enableClicks=${enableClicks}`);
      ok(state.queue[0].agreeClicked === false && clicks() === 0, "agreeClicked unset again, Agree not clicked", JSON.stringify(out.ctx.rec.updates));
      agreeNode(env).addEventListener("click", () => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS); });
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && clicks() === 1, "then a trusted Continue clicks Agree once: done", says(out) + " clicks=" + clicks());
    }
    env.win.close();

    // (N5) Stop while the "Enable APIs" dialog's close wait runs inside the Agree wait: honoured at the
    // next poll (the dialog never closes here), the panel is not shown again.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      env.K.TIMEOUTS.API_DIALOG_CLOSE = 5000;
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      env.document.body.insertAdjacentHTML("beforeend", API_DIALOG); // its Enable is clicked, but the dialog stays
      let enableClicks = 0;
      for (const b of env.D.qa("#api button")) b.addEventListener("click", () => { if (env.D.text(b) === "Enable") enableClicks += 1; });
      await sleep(150);
      ok(enableClicks === 1 && out.done === null && out.ctx.rec.logs.some((m) => /clicked Enable, waiting for it to close/.test(m)), "the dialog's Enable was clicked and the close wait is running", `enableClicks=${enableClicks} ${says(out)}`);
      const t0 = Date.now();
      state.stopRequested = true; // Stop from the popup (or the panel's Stop: the same storage flag)
      await out.p;
      const ms = Date.now() - t0;
      ok(out.done && out.done.e && out.done.e.name === "StoppedError" && ms < 1000, `(N5) Stop during the close wait ends it at the next poll (${ms} ms, not api_dialog_close_ms)`, says(out) + ` ${ms} ms`);
      ok(panelOf(env) === null && clicks() === 0 && !out.ctx.rec.logs.some((m) => /confirmation panel shown again/.test(m)) && !out.ctx.rec.logs.some((m) => /"Enable APIs" dialog closed/.test(m)), "the panel was closed and not re-shown, nothing clicked", out.ctx.rec.logs.join(" | "));
      env.K.TIMEOUTS.API_DIALOG_CLOSE = env.K.TIMING_DEFAULTS.api_dialog_close_ms;
    }
    env.win.close();

    // (S2) a dialog that opens between the wait and the guard: the guard refuses, the panel is shown again instead of failing.
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      let calls = 0;
      ctx.assertMayAct = async () => { if (++calls === 3) env.document.body.insertAdjacentHTML("beforeend", ERROR_DIALOG); };
      out = { ctx, done: null };
      out.p = env.A.handleAgreements(ctx).then((x) => { out.done = { r: x }; }, (e) => { out.done = { e }; });
      await sleep(300);
      trustedClick(contOf(env));
      await sleep(300);
      ok(out.done === null && panelOf(env) !== null && contOf(env).disabled === true && /Something went wrong/.test(noteOf(env)), "(S2) the guard refused on the dialog: the panel is up again with the dialog named, the job did not fail", `${says(out)} note=${noteOf(env)}`);
      ok(out.ctx.rec.logs.some((m) => /refused to click: a console dialog is open: Something went wrong.*; asking for your confirmation again/.test(m)) && clicks() === 0 && !recordedClick(out), "logged as a re-ask; nothing clicked or recorded", out.ctx.rec.logs.join(" | "));
      ok(out.ctx.rec.phases.join() === "agreements,awaiting_confirmation(agree),agreements,awaiting_confirmation(agree)", "the awaiting phase was set again", out.ctx.rec.phases.join());
      env.document.getElementById("err").remove();
      await sleep(80);
      agreeNode(env).addEventListener("click", () => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS); });
      trustedClick(contOf(env));
      await out.p;
      ok(out.done && !out.done.e && out.done.r.status === "done" && out.done.r.message === "enabled: Agree clicked and confirmation observed" && clicks() === 1, "after the dialog closed a trusted Continue clicks Agree once: done", says(out) + " clicks=" + clicks());
    }
    env.win.close();

    // full run, no Continue and no user click: the guard refuses when called directly (control that the record is required)
    env = serve(RENDERED);
    clicks = arm(env);
    {
      const state = stateFor({ live: true });
      const ctx = ctxFor(env, state);
      env.D.setCheckbox(env.S.agreements.termsCheckbox(), true);
      let err = null;
      try { await env.A.clickAgreeGuarded(ctx); } catch (e) { err = e; }
      ok(err && err.name === "ForbiddenClickError" && /no trusted Continue/.test(err.message) && clicks() === 0, "clickAgreeGuarded without a trusted Continue refuses (step-by-step on)", err && err.message);
    }
    env.win.close();

    // full run, trusted Continue: Agree clicked once, done
    env = serve(RENDERED);
    clicks = arm(env);
    env.S.agreements.agreeButton().addEventListener("click", () => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS); });
    out = start(env, stateFor({ live: true }));
    await sleep(300);
    trustedClick(contOf(env));
    await out.p;
    ok(out.done && !out.done.e && out.done.r.status === "done" && out.done.r.message === "enabled: Agree clicked and confirmation observed" && clicks() === 1, "a trusted Continue: the guard accepts (record present), Agree clicked once, done", says(out) + " clicks=" + clicks());
    ok(!out.ctx.rec.updates.some((u) => u.agreeClickedByUser) && out.ctx.rec.updates.some((u) => u.agreeClicked === true), "agreeClicked recorded by the guard; agreeClickedByUser not set", JSON.stringify(out.ctx.rec.updates));
    ok(out.ctx.rec.logs.some((m) => /LIVE: clicking Agree/.test(m)), "the click was logged as LIVE");
    env.win.close();
  }

  E.finish("step-by-step");
})();
