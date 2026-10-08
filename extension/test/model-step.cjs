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
 *   - (H1) a page whose URL names another model than the job's is fatal
 *     at once, before any enabled-state or Enable decision;
 *   - (R6) the enabled state must hold for enabledConfirmMs() (two polls,
 *     at least 500 ms) before a skip; at the production poll (250 ms) an
 *     Enable button rendered 300 ms after the Studio link is still clicked;
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
  // The job's model is the one the window's URL names (a saved page keeps its own URL).
  return Object.assign({
    runId: "run-1", jobIndex: 0, job: { projectId: "proj-one", modelSlug: env.S.urlModelSlug() || "claude-haiku-4-5", startedAt: Date.now() },
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
    const t0 = Date.now();
    const result = await enabled.A.handleModelPage(ctx);
    const ms = Date.now() - t0;
    ok(result && result.status === "skipped" && /already enabled/.test(result.message), "enabled page: skipped without a click", JSON.stringify(result));
    ok(ms >= enabled.K.enabledConfirmMs(), `(R6) the skip waited until the state held for ${enabled.K.enabledConfirmMs()} ms (${ms} ms)`, ms);
    ok(ctx.marks.some((m) => /enabled state/.test(m)), "the enabled state was marked");
    enabled.win.close();
  }

  console.log("--- (H1) the URL names another model than the job's: fatal at once, before any decision");
  {
    const ENABLE_PAGE = '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack><vertex-ai-request-access-button><button> Enable </button></vertex-ai-request-access-button></vai-model-garden-call-to-action-button-stack></body></html>';
    const STUDIO_PAGE = '<!doctype html><html><head></head><body><vai-model-garden-call-to-action-button-stack><vertex-ai-open-generation-ai-studio-button><a> Open in Agent Studio </a></vertex-ai-open-generation-ai-studio-button></vai-model-garden-call-to-action-button-stack></body></html>';
    for (const [label, html] of [["an Enable button", ENABLE_PAGE], ["the enabled state", STUDIO_PAGE]]) {
      const env = E.makeEnv({ html, url: MODEL_URL });
      env.K.TIMEOUTS.MODEL_READY = 2000; env.K.URL_POLL_MS = 20;
      const clicks = armEnable(env);
      const ctx = ctxFor(env, { job: { projectId: "proj-one", modelSlug: "claude-sonnet-4-6", startedAt: Date.now() } });
      const t0 = Date.now();
      let err = null, result = null;
      try { result = await env.A.handleModelPage(ctx); } catch (e) { err = e; }
      const ms = Date.now() - t0;
      ok(result === null && err && env.D.isFatal(err) && /model page is for "claude-haiku-4-5", not the job's "claude-sonnet-4-6"/.test(err.message) && clicks() === 0 && ms < 150 && ctx.phases.length === 0 && ctx.marks.length === 0,
        `the page of claude-haiku-4-5 (${label}) for a claude-sonnet-4-6 job: fatal naming both slugs, no click, no skip, no phase, at once`, err ? `${err.message} (${ms} ms, clicks ${clicks()})` : JSON.stringify(result));
      env.win.close();
    }
    const env = E.makeEnv({ html: ENABLE_PAGE, url: "https://console.cloud.google.com/agent-platform/model-garden?project=proj-one" });
    let err = null;
    try { await env.A.handleModelPage(ctxFor(env, { job: { projectId: "proj-one", modelSlug: "claude-haiku-4-5" } })); } catch (e) { err = e; }
    ok(err && env.D.isFatal(err) && /model page is for "no model"/.test(err.message), "a URL that is not a model page's: fatal, \"no model\"", err && err.message);
    ok(env.S.urlModelSlug() === null, "urlModelSlug() is null off the model path");
    env.dom.reconfigure({ url: "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-opus-4-6/overview?project=proj-one" });
    ok(env.S.urlModelSlug() === "claude-opus-4-6", "urlModelSlug() takes the first segment after the model path prefix", env.S.urlModelSlug());
    env.dom.reconfigure({ url: "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude%2Dhaiku%2D4%2D5?project=proj-one" });
    ok(env.S.urlModelSlug() === "claude-haiku-4-5", "urlModelSlug() decodes the segment", env.S.urlModelSlug());
    env.win.close();
  }

  console.log("--- (R6) the enabled state must hold for two polls, at least 500 ms, before a job is skipped");
  {
    const STUDIO = '<vai-model-garden-call-to-action-button-stack id="stack"><vertex-ai-open-generation-ai-studio-button><a> Open in Agent Studio </a></vertex-ai-open-generation-ai-studio-button></vai-model-garden-call-to-action-button-stack>';
    const ENABLE = '<vertex-ai-request-access-button><button> Enable </button></vertex-ai-request-access-button>';
    const studioPage = (extra) => `<!doctype html><html><head></head><body>${STUDIO}${extra || ""}</body></html>`;
    // (a) enabled from the start: skipped, after the second poll.
    let env = E.makeEnv({ html: studioPage(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 2000; env.K.URL_POLL_MS = 20;
    ok(env.K.ENABLED_CONFIRM_MIN_MS === 500 && env.K.enabledConfirmMs() === 500, "at a 20 ms poll the window is the 500 ms floor", env.K.enabledConfirmMs());
    env.K.URL_POLL_MS = 250;
    ok(env.K.enabledConfirmMs() === 500, "at the production poll (250 ms) the window is 500 ms (two polls)", env.K.enabledConfirmMs());
    env.K.URL_POLL_MS = 400;
    ok(env.K.enabledConfirmMs() === 800, "at a 400 ms poll the window follows the poll: 800 ms", env.K.enabledConfirmMs());
    env.K.URL_POLL_MS = 20;
    let t0 = Date.now();
    let result = await env.A.handleModelPage(ctxFor(env));
    let ms = Date.now() - t0;
    ok(result && result.status === "skipped" && ms >= 500 && ms < 1000, `enabled on every poll: skipped once the state held for 500 ms (${ms} ms)`, `${JSON.stringify(result)} ${ms} ms`);
    env.win.close();
    // (a2) the production ratio: poll 250 ms, the Enable button rendered 300 ms after the Studio link (one poll later): clicked, not skipped.
    env = E.makeEnv({ html: studioPage(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 3000; env.K.TIMEOUTS.NAV = 100; env.K.URL_POLL_MS = 250;
    setTimeout(() => { env.document.getElementById("stack").insertAdjacentHTML("beforeend", ENABLE); }, 300);
    let err = null; result = null;
    try { result = await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    ok(result === null && err && env.D.isFatal(err) && /Enable was clicked but/.test(err.message) && !!env.S.model.enableButton(), "(R6 margin) poll 250 ms, Enable button 300 ms after the Studio link: not skipped; Enable clicked", err ? err.message.slice(0, 80) : JSON.stringify(result));
    env.win.close();
    // (b) the Studio link renders one poll before the request-access button (the shell's render order): not skipped, Enable clicked.
    env = E.makeEnv({ html: studioPage(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 2000; env.K.TIMEOUTS.NAV = 100; env.K.URL_POLL_MS = 20;
    setTimeout(() => { env.document.getElementById("stack").insertAdjacentHTML("beforeend", ENABLE); }, 100);
    err = null; result = null;
    try { result = await env.A.handleModelPage(ctxFor(env)); } catch (e) { err = e; }
    const clickedEnable = !!env.S.model.enableButton();
    ok(result === null && err && env.D.isFatal(err) && /Enable was clicked but/.test(err.message) && clickedEnable, "Studio link first, Enable button 100 ms later: not skipped; Enable clicked (then the missing page change fails it)", err ? err.message.slice(0, 80) : JSON.stringify(result));
    env.win.close();
    // (c) the Studio link seen once, gone on the next poll, back later: the clock restarts.
    env = E.makeEnv({ html: studioPage(), url: MODEL_URL });
    env.K.TIMEOUTS.MODEL_READY = 2000; env.K.URL_POLL_MS = 20;
    const stack = env.document.getElementById("stack");
    const link = stack.firstElementChild;
    setTimeout(() => { link.remove(); }, 60);
    setTimeout(() => { stack.appendChild(link); }, 200);
    t0 = Date.now();
    result = await env.A.handleModelPage(ctxFor(env));
    ms = Date.now() - t0;
    ok(result && result.status === "skipped" && ms >= 650, `the state went away between two sightings: the 500 ms clock restarted (skipped after ${ms} ms, not 500)`, `${JSON.stringify(result)} ${ms} ms`);
    env.win.close();
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
    ["unchecked box in the main content", mainPage(box(false) + page().replace(/^.*<body>|<\/body>.*$/g, "")), "page"],
    ["box in the main content, already checked", mainPage(box(true) + page().replace(/^.*<body>|<\/body>.*$/g, "")), "page"],
    ["unchecked box only inside a dialog", mainPage(page().replace(/^.*<body>|<\/body>.*$/g, "")) + '<div class="cdk-overlay-container"><mat-dialog-container role="dialog">' + box(false) + "</mat-dialog-container></div>", "blocked"],
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
    if (fatal === "page") {
      // (0.8.0) any visible checkbox on the model page is an extra consent control, ticked or not, whatever its label.
      ok(clicks() === 0 && err && err.name === "BlockedError" && /^extra consent required, not supported \(checkbox on the model page\): By checking this box, you agree to the addendum/.test(err.message) && ms < 150,
        `${label}: (0.8.0) fatal at once as an extra checkbox on the model page, naming its label, no click`, err ? `${err.name}: ${err.message.slice(0, 120)} (${ms} ms)` : "no error");
    } else if (fatal === "blocked") {
      // (0.8.0) a consent dialog is an extra consent control: the job ends at once naming it.
      ok(clicks() === 0 && err && err.name === "BlockedError" && env.D.isFatal(err) && /^extra consent required, not supported \(mat-dialog-container\): By checking this box, you agree to the addendum; nothing in it was clicked/.test(err.message) && ms < 150,
        `${label}: (0.8.0) fatal at once naming the dialog's text, no click (it was a timeout before 0.8.0)`, err ? `${err.name}: ${err.message.slice(0, 120)} (${ms} ms)` : "no error");
    } else if (fatal) {
      ok(clicks() === 0 && err && env.D.isFatal(err) && /Enable is disabled on the model page next to an unchecked consent checkbox \("By checking this box, you agree to the addendum"\)/.test(err.message) && /manual step/.test(err.message) && ms < 150,
        `${label}: fatal at once with the manual-step message naming the box's label, no click`, err ? `${err.name}: ${err.message.slice(0, 120)} (${ms} ms)` : "no error");
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
    ok(clicks() === 0 && err && err.name === "BlockedError" && /^extra consent required, not supported \(div\.addendum-banner-container\): .*Advanced AI Safety Addendum.*; nothing in it was clicked; accept it by hand in the console/.test(err.message) && Date.now() - t0 < 300, "(0.8.0) fatal at once naming the banner and its text excerpt (the Advanced AI Safety Addendum), Enable never clicked", err ? `${err.message.slice(0, 200)} (${Date.now() - t0} ms)` : "no error");
    const boxEl = S.model.uncheckedCheckbox();
    ok(!!boxEl && !D.isCheckboxChecked(boxEl) && D.qa("mat-checkbox").every((b) => !D.isCheckboxChecked(b)), "(0.8.0) the addendum checkbox was never ticked");
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
