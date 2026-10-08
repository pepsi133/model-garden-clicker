/*
 * The model page handler (actions.handleModelPage):
 *   - on the saved plain model page (run A) Enable is clicked exactly once,
 *     on the enabled page (run C) the job is skipped without a click;
 *   - a disabled Enable button is never clicked; it is clicked within one
 *     poll of becoming enabled, with no fixed delay;
 *   - an "Enable APIs" dialog that opens while the handler waits is cleared
 *     first, then the model Enable is clicked;
 *   - an Enable click that does not leave the model page within nav_ms ends
 *     the job at once (fatal, no retry) with a message naming a manual step;
 *   - a disabled Enable next to an unchecked checkbox in the main content
 *     (the consent control of run E's model page) fails at once with the
 *     manual-step message; a disabled Enable alone, a checked box or a box
 *     inside a dialog only waits; run F's radio-card model page (enabled
 *     Enable, no checkbox) is clicked as usual.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

const MODEL_URL = "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one";

function ctxFor(env, extra) {
  const logs = [], marks = [], steps = [], phases = [];
  return Object.assign({
    runId: "run-1", jobIndex: 0, job: { projectId: "proj-one", modelSlug: "claude-haiku-4-5", startedAt: Date.now() },
    settings: { live_mode: false }, logs, marks, steps, phases,
    log: (m) => logs.push(m), mark: (m) => marks.push(m), step: (m) => steps.push(m),
    setPhase: async (p) => phases.push(p), updateJob: async () => ({ ok: true }), assertMayAct: async () => {}, refresh: async () => ({})
  }, extra);
}

function armEnable(env) {
  let n = 0;
  const btn = env.S.model.enableButton();
  if (btn) btn.addEventListener("click", () => { n += 1; });
  return () => n;
}

(async () => {
  console.log("--- run A: the plain model page");
  const plain = E.envFromSnapshot("A", "01-model-page");
  if (!plain) skip("handleModelPage on run A", "recon dump not present");
  else {
    plain.K.TIMEOUTS.NAV = 150;
    const clicks = armEnable(plain);
    const ctx = ctxFor(plain);
    let err = null;
    try { await plain.A.handleModelPage(ctx); } catch (e) { err = e; }
    ok(clicks() === 1, "Enable clicked exactly once", clicks());
    ok(err && plain.D.isFatal(err) && /Enable was clicked but the questionnaire did not open within 0 s/.test(err.message) && /manual step/.test(err.message), "no page change in jsdom: fatal with the manual-step message (no retry)", err && err.message);
    ok(ctx.marks.join(" | ") === "action started: click Enable | action done: Enable clicked", "timing marks for the click were made (the loop stamps them with +ms)", ctx.marks.join(" | "));
    ok(ctx.steps.join() === "clicking Enable" && ctx.phases.join() === "model", "step named for the badge, phase set to model");
    plain.win.close();
  }

  console.log("--- run C: the enabled model page");
  const enabled = E.envFromSnapshot("C", "01-model-page");
  if (!enabled) skip("handleModelPage on run C", "recon dump not present");
  else {
    const ctx = ctxFor(enabled);
    const result = await enabled.A.handleModelPage(ctx);
    ok(result && result.status === "skipped" && /already enabled/.test(result.message), "enabled page: skipped without a click", JSON.stringify(result));
    ok(ctx.marks.some((m) => /enabled state/.test(m)), "the enabled state was marked");
    enabled.win.close();
  }

  console.log("--- synthetic: the handler's timing and its failure modes");
  const page = (extraHtml) => '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack>' +
    '<vertex-ai-request-access-button><button aria-disabled="true" class="mat-mdc-button-disabled"> Enable </button></vertex-ai-request-access-button></vai-model-garden-call-to-action-button-stack>' + (extraHtml || "") + '</body></html>';
  {
    // Enable rendered disabled first, enabled 120 ms later: clicked right after.
    const env = E.makeEnv({ html: page(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 2000; env.K.TIMEOUTS.NAV = 100; env.K.URL_POLL_MS = 20;
    const btn = env.S.model.enableButton();
    let clickedAt = null; btn.addEventListener("click", () => { clickedAt = Date.now(); });
    const t0 = Date.now();
    setTimeout(() => { btn.removeAttribute("aria-disabled"); btn.classList.remove("mat-mdc-button-disabled"); }, 120);
    let err = null;
    try { await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    ok(clickedAt !== null && clickedAt - t0 >= 120 && clickedAt - t0 < 600, "a disabled Enable is not clicked; it is clicked within a poll of becoming enabled", clickedAt && (clickedAt - t0) + " ms");
    ok(err && env.D.isFatal(err) && /manual step/.test(err.message), "then the missing page change is a clean failure", err && err.message);
    env.win.close();
  }
  {
    // Enable stays disabled with no checkbox anywhere: never clicked, the wait times out (non-fatal: the loop retries, then gives up).
    const env = E.makeEnv({ html: page(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 200; env.K.URL_POLL_MS = 20;
    const clicks = armEnable(env);
    let err = null;
    try { await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    ok(clicks() === 0 && err && err.name === "TimeoutError" && !env.D.isFatal(err) && /Enable button \(enabled, no dialog\)/.test(err.message), "a permanently disabled Enable with no checkbox is never clicked; the wait times out (retried, not fatal)", err && err.message);
    env.win.close();
  }

  console.log("--- a disabled Enable next to an unchecked consent checkbox fails at once");
  const box = (checked, where) => `<mat-checkbox class="mat-mdc-checkbox${checked ? " mat-mdc-checkbox-checked" : ""}"><label><input type="checkbox"${checked ? " checked" : ""}><span>By checking this box, you agree to the addendum</span></label></mat-checkbox>`;
  const mainPage = (inner) => '<!doctype html><html><head></head><body><div role="main">' + inner + '</div></body></html>';
  const consentCases = [
    ["unchecked box in the main content", mainPage(box(false) + page().replace(/^.*<body>|<\/body>.*$/g, "")), true],
    ["box in the main content, already checked", mainPage(box(true) + page().replace(/^.*<body>|<\/body>.*$/g, "")), false],
    ["unchecked box only inside a dialog", mainPage(page().replace(/^.*<body>|<\/body>.*$/g, "")) + '<div class="cdk-overlay-container"><mat-dialog-container role="dialog">' + box(false) + "</mat-dialog-container></div>", false],
    ["unchecked box in the main content, hidden", mainPage('<div style="display: none;">' + box(false) + "</div>" + page().replace(/^.*<body>|<\/body>.*$/g, "")), false]
  ];
  for (const [label, html, fatal] of consentCases) {
    const env = E.makeEnv({ html, url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 300; env.K.URL_POLL_MS = 20;
    const clicks = armEnable(env);
    const t0 = Date.now();
    let err = null;
    try { await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    const ms = Date.now() - t0;
    if (fatal) {
      ok(clicks() === 0 && err && env.D.isFatal(err) && /Enable is disabled on the model page next to an unchecked consent checkbox/.test(err.message) && /manual step/.test(err.message) && ms < 150,
        `${label}: fatal at once with the manual-step message, no click`, err ? `${err.name}: ${err.message.slice(0, 80)} (${ms} ms)` : "no error");
    } else {
      ok(clicks() === 0 && err && err.name === "TimeoutError" && !env.D.isFatal(err) && ms >= 300, `${label}: no fast failure, the wait times out as before`, err ? `${err.name}: ${err.message.slice(0, 80)} (${ms} ms)` : "no error");
    }
    env.win.close();
  }

  console.log("--- run E: the real model page with a consent checkbox and a disabled Enable");
  const consent = E.envFromSnapshot("E", "01-model-page");
  if (!consent) skip("handleModelPage on run E", "recon dump not present");
  else {
    const { S, D } = consent;
    const btn = S.model.enableButton();
    ok(!!btn && D.isDisabled(btn) && !S.model.isAlreadyEnabled(), "the page renders Enable disabled and is not enabled", btn && btn.outerHTML.slice(0, 120));
    const cb = S.model.uncheckedCheckbox();
    ok(!!cb && cb.tagName === "MAT-CHECKBOX" && !!cb.closest('[role="main"]') && /agree to the/.test(D.text(cb)), "uncheckedCheckbox() finds the consent box in the main content", cb && D.text(cb).slice(0, 80));
    consent.K.TIMEOUTS.MODEL_READY = 2000; consent.K.URL_POLL_MS = 20;
    const clicks = armEnable(consent);
    const t0 = Date.now();
    let err = null;
    try { await consent.A.handleModelPage(ctxFor(consent)); } catch (e) { err = e; }
    ok(clicks() === 0 && err && D.isFatal(err) && /unchecked consent checkbox/.test(err.message) && Date.now() - t0 < 300, "fatal at once with the manual-step message, Enable never clicked", err ? `${err.message.slice(0, 80)} (${Date.now() - t0} ms)` : "no error");
    consent.win.close();
  }

  console.log("--- run F: the real radio-card model page (negative control: enabled Enable, no checkbox)");
  const cards = E.envFromSnapshot("F", "03-model-page");
  if (!cards) skip("handleModelPage on run F", "recon dump not present");
  else {
    const { S, D } = cards;
    ok(D.qa('mat-radio-button, [role="radio"]').length > 0 && S.model.uncheckedCheckbox() === null, "the page has radio cards and no unchecked checkbox", D.qa('mat-radio-button, [role="radio"]').length);
    cards.K.TIMEOUTS.NAV = 100; cards.K.URL_POLL_MS = 20;
    const clicks = armEnable(cards);
    let err = null;
    try { await cards.A.handleModelPage(ctxFor(cards)); } catch (e) { err = e; }
    ok(clicks() === 1 && err && D.isFatal(err) && /Enable was clicked but/.test(err.message) && !/consent checkbox/.test(err.message), "Enable clicked once as on any plain page; only the missing page change fails it", err && err.message.slice(0, 90));
    cards.win.close();
  }
  {
    // The Enable APIs dialog opens while the handler waits: its Enable is clicked, then the model Enable.
    const env = E.makeEnv({ html: page().replace(' aria-disabled="true" class="mat-mdc-button-disabled"', ""), url: MODEL_URL });
    env.K.TIMEOUTS.NAV = 100; env.K.TIMEOUTS.MODEL_READY = 2000; env.K.URL_POLL_MS = 20;
    env.document.body.insertAdjacentHTML("beforeend", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogactions><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>');
    const order = [];
    env.S.model.enableButton().addEventListener("click", () => order.push("model Enable"));
    for (const b of env.D.qa("mat-dialog-container button")) b.addEventListener("click", () => { order.push("dialog " + env.D.text(b)); env.D.q(".cdk-overlay-container").remove(); });
    let err = null;
    try { await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    ok(order.join(", ") === "dialog Enable, model Enable", "dialog Enable first, then the model Enable, no extra wait", order.join(", "));
    ok(err && env.D.isFatal(err), "then the missing page change is a clean failure", err && err.message);
    env.win.close();
  }

  E.finish("model step");
})();
