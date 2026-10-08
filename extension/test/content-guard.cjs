/*
 * The Agree guard. Proves that no code path except clickAgreeGuarded() can
 * click the Agree button, and that clickAgreeGuarded() refuses unless every
 * condition holds (re-read from storage and from the page), using the real
 * Agreements page dumps when they are present (run A, see lib/env.cjs).
 *
 * Covers: dry run / stopped / wrong job / wrong phase; the page identity
 * (another project, another vendor's agreements path, another product id,
 * a page that does not name the model); the live-mode snapshot taken at
 * Start; a stale run id; that Agree is clicked at most once per job; that
 * the handler reads the model name from the rendered Purchase summary (a
 * body that renders after the route change is waited for, a rendered body
 * naming another model is fatal after the wait); and that a dialog open
 * before the click refuses it while the post-Agree wait accepts only a
 * dialog that appeared after the click and, for success, names the model.
 * (S1) With step-by-step on, the guard also needs a trusted Continue for
 * this job's Agree step recorded within the last five minutes.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

const RUN_ID = "run-1";
const PRODUCT = "anthropic/anthropic-867.cloudpartnerservices.goog"; // claude-haiku-4-5 (docs/dom-map.md)
const AGREEMENTS_PATH = `/marketplace/agreements/${PRODUCT}`;
const BLANK_URL = `https://console.cloud.google.com${AGREEMENTS_PATH}?project=proj-one`;

function expectThrow(fn, name, label) {
  try { fn(); } catch (e) { return ok(e.name === name, `${label} -> ${e.name}: ${e.message.slice(0, 90)}`, e.name); }
  return ok(false, label + " did not throw");
}

/** Storage state as the guard reads it: every flag set for a live click on job 0 of RUN_ID. */
function liveState(projectId, extra) {
  const job = Object.assign({ projectId, modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", productId: PRODUCT, agreeClicked: false }, extra && extra.job);
  return Object.assign({
    running: true,
    stopRequested: false,
    settings: { live_mode: true },
    run: { runId: RUN_ID, live: true },
    current: { jobIndex: 0, phase: "agreements" },
    queue: [job]
  }, extra && extra.state);
}

/** A ctx whose refresh() returns `state`; updateJob records into state.queue and `updates`. */
function mk(state, updates, runId) {
  return {
    runId: runId === undefined ? RUN_ID : runId,
    jobIndex: 0,
    refresh: async () => state,
    updateJob: async (fields) => { Object.assign(state.queue[0], fields); if (updates) updates.push(fields); return { ok: true }; },
    log: () => {}, mark: () => {}, step: () => {}
  };
}

async function refused(env, state, name, label, opts) {
  const o = opts || {};
  try { await env.A.clickAgreeGuarded(mk(state, null, o.runId)); ok(false, label + " did not throw"); }
  catch (e) { ok(e.name === name && (!o.re || o.re.test(e.message)), `${label} -> ${e.name}: ${e.message.slice(0, 90)}`, e.name + ": " + e.message); }
}

const blank = E.makeEnv({ url: BLANK_URL });
const { D, S, A } = blank;
console.log("--- static guard");
ok(S.detectPage() === "agreements", "detectPage = agreements on the Anthropic agreements URL");
ok(S.agreements.agreeButton() === null, "agreeButton null on a blank page (no throw)");
expectThrow(() => D.click({ textContent: "I agree", isConnected: true }), "ForbiddenClickError", "D.click refuses agree text");
expectThrow(() => D.click({ textContent: "Agree", isConnected: true }), "ForbiddenClickError", "D.click refuses Agree");
expectThrow(() => D.click({ textContent: " AGREE ", isConnected: true }), "ForbiddenClickError", "D.click refuses padded upper-case AGREE");

(async () => {
  console.log("--- clickAgreeGuarded refusals on a blank page (no checkbox, no button)");
  const P = "proj-one";
  await refused(blank, liveState(P, { state: { settings: { live_mode: false } } }), "ForbiddenClickError", "guard: live_mode false now", { re: /live_mode/ });
  await refused(blank, liveState(P, { state: { run: { runId: RUN_ID, live: false } } }), "ForbiddenClickError", "guard (F2): run started in dry-run mode, setting flipped to live later", { re: /dry-run mode/ });
  await refused(blank, liveState(P, { state: { running: false } }), "ForbiddenClickError", "guard: not running");
  await refused(blank, liveState(P, { state: { stopRequested: true } }), "StoppedError", "guard: stop requested");
  await refused(blank, liveState(P, { state: { run: { runId: "run-2", live: true } } }), "StoppedError", "guard (F3): storage holds a newer run id", { re: /no longer the current run/ });
  await refused(blank, liveState(P), "StoppedError", "guard (F3): ctx without a run id", { runId: null });
  await refused(blank, liveState(P, { state: { current: { jobIndex: 1, phase: "agreements" } } }), "ForbiddenClickError", "guard: wrong job");
  await refused(blank, liveState(P, { state: { current: { jobIndex: 0, phase: "questionnaire" } } }), "ForbiddenClickError", "guard: wrong phase");
  await refused(blank, liveState(P, { job: { agreeClicked: true } }), "ForbiddenClickError", "guard (F6): agreeClicked already recorded on the job", { re: /already clicked/ });
  await refused(blank, liveState("proj-two"), "ForbiddenClickError", "guard (F1): URL project differs from the job's project", { re: /not the job's project/ });
  await refused(blank, liveState(P, { job: { productId: "anthropic/anthropic-884.cloudpartnerservices.goog" } }), "ForbiddenClickError", "guard (F1): URL product id differs from the job's product id", { re: /not the job's product/ });
  await refused(blank, liveState(P, { job: { productId: null } }), "ForbiddenClickError", "guard (F1): no product id recorded on the job", { re: /no Marketplace product id/ });
  // A page whose SKU rows name another model (row format from docs/dom-map.md, "Purchase summary").
  // A Purchase summary row as the 04/05 dumps render it: an em-dash-separated SKU row with the context-window tail.
  const skuRow = (name) => `<h2>Purchase summary</h2><button class="cfc-tiered-table-entry">${name} — Batch Cache Read Tokens — global — Context Window Size from 0 to 200000 Tokens</button>`;
  blank.document.body.innerHTML = skuRow("Claude Sonnet 4 6");
  await refused(blank, liveState(P), "ForbiddenClickError", "guard (F1): page naming another model (Claude Sonnet 4 6) refused for a claude-haiku-4-5 job", { re: /does not name/ });
  blank.document.body.innerHTML = "";

  console.log("--- (N1) model-name match is token-bounded with an exact version");
  // Each pair in both directions: the shorter version must not match the longer one's page and the reverse.
  const pairs = [
    ["claude-sonnet-5", "Claude Sonnet 5", "claude-sonnet-5-5", "Claude Sonnet 5.5", "Claude Sonnet 5 5"],
    ["claude-opus-5", "Claude Opus 5", "claude-opus-5-5", "Claude Opus 5.5", "Claude Opus 5 5"],
    ["claude-fable-5", "Claude Fable 5", "claude-fable-5-1", "Claude Fable 5.1", "Claude Fable 5 1"]
  ];
  for (const [shortSlug, shortName, longSlug, longName, longRow] of pairs) {
    const shortRow = shortName;
    blank.document.body.innerHTML = skuRow(longRow);
    ok(!S.agreements.mentionsModel(shortSlug) && !S.agreements.mentionsModel(shortName), `${shortSlug} / "${shortName}" NOT named by a "${longRow}" page`);
    ok(S.agreements.mentionsModel(longSlug) && S.agreements.mentionsModel(longName), `${longSlug} / "${longName}" named by a "${longRow}" page`);
    await refused(blank, liveState(P, { job: { modelSlug: shortSlug, modelName: shortName } }), "ForbiddenClickError", `guard: ${shortSlug} job on the ${longName} page`, { re: /does not name/ });
    blank.document.body.innerHTML = skuRow(shortRow);
    ok(!S.agreements.mentionsModel(longSlug) && !S.agreements.mentionsModel(longName), `${longSlug} / "${longName}" NOT named by a "${shortRow}" page`);
    ok(S.agreements.mentionsModel(shortSlug) && S.agreements.mentionsModel(shortName), `${shortSlug} / "${shortName}" named by a "${shortRow}" page`);
    await refused(blank, liveState(P, { job: { modelSlug: longSlug, modelName: longName } }), "ForbiddenClickError", `guard: ${longSlug} job on the ${shortName} page`, { re: /does not name/ });
  }
  blank.document.body.innerHTML = skuRow("Claude Sonnet 5 5") + skuRow("Claude Sonnet 5");
  ok(S.agreements.mentionsModel("claude-sonnet-5") && S.agreements.mentionsModel("claude-sonnet-5-5"), "a page listing both versions names both (each row ends its own version)");
  blank.document.body.innerHTML = "<p>claudesonnet5</p>";
  ok(!S.agreements.mentionsModel("claude-sonnet-5"), "run-together text without token boundaries is not a match");
  blank.document.body.innerHTML = "";

  const other = E.makeEnv({ url: `https://console.cloud.google.com/marketplace/agreements/other-vendor/expensive-saas.cloudpartnerservices.goog?project=${P}` });
  ok(other.S.detectPage() === "unknown", "detectPage = unknown on another vendor's agreements URL");
  await refused(other, liveState(P, { job: { productId: "other-vendor/expensive-saas.cloudpartnerservices.goog" } }), "ForbiddenClickError", "guard (F1): another vendor's agreements path refused even when the product id matches", { re: /not an Anthropic/ });
  other.win.close();

  // Real page, box unticked (04): every flag set, still refused.
  const unticked = E.envFromSnapshot("A", "04-agreements");
  if (!unticked) skip("guard on 04-agreements", "recon dump not present");
  else {
    console.log("--- clickAgreeGuarded on the real 04-agreements page (box unticked)");
    const project = new URL(unticked.snapshot.url).searchParams.get("project");
    let clicks = 0;
    unticked.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
    ok(unticked.S.agreements.identity().productId === PRODUCT, "agreements identity reads the product id from the URL", JSON.stringify(unticked.S.agreements.identity()));
    ok(unticked.S.agreements.mentionsModel("claude-haiku-4-5") && unticked.S.agreements.mentionsModel("Claude Haiku 4.5"), "page names the model (slug and display name)");
    ok(!unticked.S.agreements.mentionsModel("claude-sonnet-4-6"), "page does not name another model");
    await refused(unticked, liveState(project), "ForbiddenClickError", "refused with the checkbox reason", { re: /checkbox/ });
    ok(clicks === 0, "Agree received no click");
    unticked.win.close();
  }

  // Real page, box ticked (05): dry run refused; identity refusals; live mode with every flag set clicks exactly once.
  const snap05 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
  if (!snap05) skip("guard on 05-agreements-checked", "recon dump not present");
  else {
    const project = new URL(snap05.url).searchParams.get("project");
    const serve = (url) => { const env = E.makeEnv({ html: snap05.html, url }); env.rehydrated = E.rehydrate(env.document, snap05.forms); return env; };
    const armed = (env) => { let n = 0; env.S.agreements.agreeButton().addEventListener("click", () => { n += 1; }); return () => n; };

    console.log("--- (F1) the real 05 page served under another project");
    let env = serve(`https://console.cloud.google.com${AGREEMENTS_PATH}?project=some-other-project`);
    let clicks = armed(env);
    ok(env.D.isCheckboxChecked(env.S.agreements.termsCheckbox()), "terms checkbox verified checked");
    await refused(env, liveState(project), "ForbiddenClickError", "refused: page project is not the job's", { re: /not the job's project/ });
    ok(clicks() === 0, "Agree received no click");
    env.win.close();

    console.log("--- (F1) the real 05 page served under another vendor's agreements path");
    env = serve(`https://console.cloud.google.com/marketplace/agreements/other-vendor/expensive-saas.cloudpartnerservices.goog?project=${project}`);
    clicks = armed(env);
    ok(env.S.detectPage() === "unknown", "detectPage = unknown");
    await refused(env, liveState(project), "ForbiddenClickError", "refused: not an Anthropic agreements page", { re: /not an Anthropic/ });
    ok(clicks() === 0, "Agree received no click");
    env.win.close();

    console.log("--- (F1) the real 05 page served under another Anthropic product id");
    env = serve(`https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-884.cloudpartnerservices.goog?project=${project}`);
    clicks = armed(env);
    await refused(env, liveState(project), "ForbiddenClickError", "refused: page product is not the job's product", { re: /not the job's product/ });
    ok(clicks() === 0, "Agree received no click");
    env.win.close();

    console.log("--- (F1) the real 05 page, job for another model with the same product id");
    env = serve(snap05.url);
    clicks = armed(env);
    await refused(env, liveState(project, { job: { modelSlug: "claude-sonnet-4-6", modelName: "Claude Sonnet 4.6" } }), "ForbiddenClickError", "refused: page does not name the job's model", { re: /does not name/ });
    ok(clicks() === 0, "Agree received no click");
    env.win.close();

    console.log("--- clickAgreeGuarded on the real 05-agreements-checked page at its own URL");
    env = serve(snap05.url);
    clicks = armed(env);
    await refused(env, liveState(project, { state: { settings: { live_mode: false } } }), "ForbiddenClickError", "dry run refused", { re: /live_mode/ });
    await refused(env, liveState(project, { state: { run: { runId: RUN_ID, live: false } } }), "ForbiddenClickError", "(F2) run snapshot says dry run: refused although the setting is live now", { re: /dry-run/ });
    await refused(env, liveState(project, { state: { stopRequested: true } }), "StoppedError", "live but stop requested -> StoppedError");
    await refused(env, liveState(project, { state: { run: { runId: "run-9", live: true } } }), "StoppedError", "(F3) stale run id -> StoppedError");
    ok(clicks() === 0, "no click so far");

    const state = liveState(project);
    const updates = [];
    const logs = [];
    const ctx = mk(state, updates);
    ctx.log = (m) => logs.push(m);
    await env.A.clickAgreeGuarded(ctx);
    ok(clicks() === 1, "live mode with every condition met: Agree clicked exactly once (jsdom, nothing left the test)", clicks());
    ok(updates.length === 1 && updates[0].agreeClicked === true && state.queue[0].agreeClicked === true, "the click was recorded on the job before it happened", JSON.stringify(updates));
    ok(logs.some((m) => /LIVE: clicking Agree/.test(m)), "the click was logged as LIVE");

    console.log("--- (F6) a second call for the same job never clicks again");
    await refused(env, state, "ForbiddenClickError", "second call with agreeClicked recorded", { re: /already clicked/ });
    const fresh = liveState(project); // storage flag lost: the content script's own memory still refuses
    await refused(env, fresh, "ForbiddenClickError", "second call even if storage no longer shows the flag", { re: /already clicked/ });
    ok(clicks() === 1, "Agree click count still 1");

    console.log("--- (N3) state that changes during the record round trip is seen before the click");
    // One window for every case (jsdom keeps closed windows of this 4 MB page
    // in memory); each case uses its own run id so the guard's per-tab memory
    // of recorded clicks does not short-circuit it, and undoes its mutation.
    const e3 = serve(snap05.url);
    const clicks3 = armed(e3);
    const realIdentity = e3.S.agreements.identity;
    let n3 = 0;
    const during = async (label, mutate, name, re) => {
      const rid = `run-n3-${++n3}`;
      const st = liveState(project, { state: { run: { runId: rid, live: true } } });
      const cx = mk(st, null, rid);
      let undo = null;
      cx.updateJob = async (f) => { Object.assign(st.queue[0], f); undo = mutate(e3, st) || null; return { ok: true }; };
      try { await e3.A.clickAgreeGuarded(cx); ok(false, label + " did not throw"); }
      catch (err) { ok(err.name === name && re.test(err.message), `${label} -> ${err.name}: ${err.message.slice(0, 90)}`, err.name + ": " + err.message); }
      ok(clicks3() === 0, `${label}: Agree received no click`);
      e3.S.agreements.identity = realIdentity;
      if (undo) undo();
    };
    await during("stop requested during the record", (e, st) => { st.stopRequested = true; }, "StoppedError", /stop/);
    await during("run replaced during the record", (e, st) => { st.run = { runId: "run-2", live: true }; }, "StoppedError", /no longer the current run/);
    await during("live mode switched off during the record", (e, st) => { st.settings.live_mode = false; }, "ForbiddenClickError", /live_mode/);
    await during("record lost (storage shows no agreeClicked) after an ok reply", (e, st) => { st.queue[0].agreeClicked = false; }, "ForbiddenClickError", /not on record/);
    await during("page re-rendered for another product during the record", (e) => {
      e.S.agreements.identity = () => ({ anthropic: true, productId: "anthropic/anthropic-884.cloudpartnerservices.goog", projectId: project });
    }, "ForbiddenClickError", /not the job's product/);
    await during("page re-rendered under another project during the record", (e) => {
      e.S.agreements.identity = () => ({ anthropic: true, productId: PRODUCT, projectId: "someone-else" });
    }, "ForbiddenClickError", /not the job's project/);
    await during("Agree button node replaced during the record", (e) => {
      const old = e.S.agreements.agreeButton(); const clone = old.cloneNode(true); old.parentNode.replaceChild(clone, old);
      return () => { clone.parentNode.replaceChild(old, clone); };
    }, "ForbiddenClickError", /changed between the check and the click/);
    await during("terms checkbox unticked during the record", (e) => {
      const input = e.D.q('input[type="checkbox"]', e.S.agreements.termsCheckbox()); input.checked = false;
      return () => { input.checked = true; };
    }, "ForbiddenClickError", /checkbox/);
    // Positive control for the same window: with nothing changing during the record, the click happens once.
    {
      const rid = `run-n3-${++n3}`;
      const st = liveState(project, { state: { run: { runId: rid, live: true } } });
      await e3.A.clickAgreeGuarded(mk(st, null, rid));
      ok(clicks3() === 1, "control: same window, nothing changed during the record -> Agree clicked once", clicks3());
    }
    e3.win.close();

    console.log("--- (F6) a job whose updateJob is refused by the worker does not click");
    const env2 = serve(snap05.url);
    const clicks2 = armed(env2);
    const ctx2 = mk(liveState(project), null, "run-7");
    ctx2.updateJob = async () => ({ ok: false, error: "not the current run" });
    // run-7 is unknown to env2's local memory, and the state carries run-7 so the run-id check passes
    ctx2.refresh = async () => liveState(project, { state: { run: { runId: "run-7", live: true } } });
    try { await env2.A.clickAgreeGuarded(ctx2); ok(false, "did not throw"); }
    catch (e) { ok(e.name === "ForbiddenClickError" && /could not record/.test(e.message), `refused -> ${e.message.slice(0, 80)}`, e.message); }
    ok(clicks2() === 0, "Agree received no click when the record was refused");
    env2.win.close();
    env.win.close();
  }

  // Dry-run handler never reaches the guard: handleAgreements on 04 ends with dry-run and the box ticked.
  const dry = E.envFromSnapshot("A", "04-agreements");
  if (!dry) skip("handleAgreements dry run on 04-agreements", "recon dump not present");
  else {
    console.log("--- handleAgreements (dry run) on the real 04-agreements page");
    const project = new URL(dry.snapshot.url).searchParams.get("project");
    let clicks = 0;
    dry.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
    const phases = [], logs = [];
    const state = liveState(project, { state: { settings: { live_mode: false }, run: { runId: RUN_ID, live: false } } });
    const ctx = Object.assign(mk(state), { settings: { live_mode: false }, log: (m) => logs.push(m), setPhase: async (p) => phases.push(p), assertMayAct: async () => {} });
    const result = await dry.A.handleAgreements(ctx);
    ok(result && result.status === "dry-run", "result status is dry-run", JSON.stringify(result));
    ok(dry.D.isCheckboxChecked(dry.S.agreements.termsCheckbox()), "terms checkbox ticked by the handler");
    ok(clicks === 0, "Agree never clicked in a dry run");
    ok(phases.join() === "agreements", "phase set to agreements");
    dry.win.close();
  }


  // (0.8.0) The recorded Fable 5.1 addendum banner placed inside the recorded Agreements body, with the terms
  // box's two hooks present and with both gone: the job fails as extra consent in both cases (full run), the
  // addendum box is never ticked and Agree is never clicked. There is no positional terms-box locator to take
  // the addendum box ("... to these terms ...") for the terms box.
  {
    const fableRun = E.findRun("E");
    const fableSnap = fableRun && E.readSnapshot(fableRun, "01-model-page");
    const agr = E.readSnapshot(E.findRun("A") || "", "04-agreements");
    if (!fableSnap || !agr) skip("the Fable addendum banner on an Agreements page", "recon dump not present");
    else {
      console.log("--- (0.8.0) the recorded Fable addendum banner inside the recorded Agreements body: failed as extra consent, nothing ticked, Agree never clicked");
      const fableEnv = E.makeEnv({ html: fableSnap.html, url: fableSnap.url });
      const bannerHtml = fableEnv.D.q(".addendum-banner-container").outerHTML;
      fableEnv.win.close();
      const project = new URL(agr.url).searchParams.get("project");
      // Variants: [hooks on the terms box, terms box moved out of the body, the addendum's label reuses mp-agreements-tos, the real terms box removed]
      for (const [hooks, moveTerms, reuseTos, dropTerms] of [[true, false, false, false], [false, false, false, false], [false, true, false, false], [true, false, true, false], [true, false, true, true]]) {
        const env = E.makeEnv({ html: agr.html, url: agr.url }); E.rehydrate(env.document, agr.forms);
        env.K.TIMEOUTS.AGREEMENTS_READY = 1500; env.K.TIMEOUTS.CONFIRM = 300; env.K.URL_POLL_MS = 20;
        const body = env.D.q("billing-integrated-ai-agreements-body");
        body.insertAdjacentHTML("afterbegin", bannerHtml);
        const terms = env.D.q("mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox");
        if (reuseTos) {
          // The addendum's label component is the terms label component, earlier in the DOM than the real one.
          const span = env.D.q(".addendum-banner-container mat-checkbox .mdc-label");
          const tosEl = env.document.createElement("mp-agreements-tos");
          span.parentNode.insertBefore(tosEl, span); tosEl.appendChild(span);
        }
        if (dropTerms) terms.remove();
        if (!hooks) {
          terms.classList.remove("p6ntest-mp-agreements-body-tos-checkbox");
          const tos = env.D.q("mp-agreements-tos"); const renamed = env.document.createElement("mp-renamed-tos");
          while (tos.firstChild) renamed.appendChild(tos.firstChild); tos.replaceWith(renamed);
        }
        // The terms box moved out of the body, so the addendum box is the body's only mat-checkbox.
        if (moveTerms) body.parentNode.insertBefore(terms, body.nextSibling);
        const addendumInput = env.D.q('.addendum-banner-container input[type="checkbox"]');
        let agreeClicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { agreeClicks += 1; });
        let addendumClicks = 0; addendumInput.addEventListener("click", () => { addendumClicks += 1; });
        const state = liveState(project);
        const ctx = Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
        let err = null, result = null;
        try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
        const label = reuseTos && dropTerms ? "with the addendum's label reusing mp-agreements-tos and the real terms box gone (the hooks find one box, inside a banner)"
          : reuseTos ? "with the addendum's label reusing mp-agreements-tos earlier in the DOM (the hooks resolve to two boxes)"
          : hooks ? "with both terms-box hooks" : moveTerms ? "with both terms-box hooks gone and the terms box moved out of the body (the addendum box is the body's only mat-checkbox)" : "with both terms-box hooks gone";
        const expectTerms = hooks && !reuseTos;
        ok(expectTerms ? env.S.agreements.termsCheckbox() === terms : env.S.agreements.termsCheckbox() === null, `${label}: termsCheckbox() is ${expectTerms ? "the hooked terms box" : "null (never the addendum box)"}`);
        ok(result === null && err && err.name === "BlockedError" && /^extra consent required, not supported \(div\.addendum-banner-container\): .*Advanced AI Safety Addendum/.test(err.message),
          `${label}: the job fails at once as extra consent naming the addendum`, err ? `${err.name}: ${err.message.slice(0, 160)}` : JSON.stringify(result));
        ok(!addendumInput.checked && addendumClicks === 0 && !env.D.isCheckboxChecked(terms) && agreeClicks === 0 && !state.queue[0].agreeClicked,
          `${label}: the addendum box is never ticked, the terms box is untouched, Agree is never clicked or recorded`, `addendum ${addendumInput.checked}/${addendumClicks} agree ${agreeClicks}`);
        env.win.close();
      }
    }
  }

  // (0.8.0) the guard's `refuse` carries the blocker check: a permission alert that appears during the guard's own
  // record round trip (after every pre-action check passed) refuses the click; the record is undone.
  {
    const s05 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!s05) skip("the guard refuses on a blocker that appears during its record round trip", "recon dump not present");
    else {
      console.log("--- (0.8.0) a permission alert that appears during the guard's record round trip: no click, the record undone");
      const env = E.makeEnv({ html: s05.html, url: s05.url }); E.rehydrate(env.document, s05.forms);
      env.K.TIMEOUTS.CONFIRM = 300; env.K.URL_POLL_MS = 20;
      const state = liveState(new URL(s05.url).searchParams.get("project"));
      const base = mk(state);
      const ctx = Object.assign(base, { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {},
        updateJob: async (fields) => {
          if (fields.agreeClicked === true) env.document.body.insertAdjacentHTML("beforeend", '<div role="alert">Permission denied: you cannot purchase in this billing account.</div>');
          Object.assign(state.queue[0], fields); return { ok: true };
        } });
      let clicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
      let err = null, result = null;
      try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
      ok(clicks === 0 && err && err.name === "ForbiddenClickError" && /refused to click: missing permission: Permission denied: you cannot purchase/.test(err.message) && state.queue[0].agreeClicked === false && err.recordCleared === true,
        "the guard refuses with the blocker's message, no click, the Agree record undone", err ? `${err.name}: ${err.message} clicks=${clicks} rec=${state.queue[0].agreeClicked}` : JSON.stringify(result));
      env.win.close();
    }
  }

  // (0.8.0) The recorded Fable banner moved into an overlay pane (not a modal dialog), and the banner with only
  // its "Accept Terms" button wrapped in a role="alert" / role="status" live region, on the recorded ticked
  // Agreements page in a full run: a blocker, no tick, Agree never clicked.
  {
    const fableSnap = E.readSnapshot(E.findRun("E") || "", "01-model-page");
    const agr5 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!fableSnap || !agr5) skip("the Fable banner in an overlay pane or a live region on the Agreements page", "recon dump not present");
    else {
      console.log("--- (0.8.0) the recorded Fable banner in an overlay pane, or accept-button-only inside a live region, on the recorded Agreements page: blocked");
      const fableEnv = E.makeEnv({ html: fableSnap.html, url: fableSnap.url });
      const bannerHtml = fableEnv.D.q(".addendum-banner-container").outerHTML;
      fableEnv.D.q(".addendum-banner-container .addendum-checkbox-row").remove();
      const acceptOnlyHtml = fableEnv.D.q(".addendum-banner-container").outerHTML;
      fableEnv.win.close();
      const project = new URL(agr5.url).searchParams.get("project");
      const variants = [
        ["in .cdk-overlay-container > .cdk-overlay-pane", `<div class="cdk-overlay-container"><div class="cdk-overlay-pane">${bannerHtml}</div></div>`],
        ["accept button only, wrapped in role=\"alert\"", `<div role="alert">${acceptOnlyHtml}</div>`],
        ["accept button only, wrapped in role=\"status\"", `<div role="status">${acceptOnlyHtml}</div>`]
      ];
      for (const [label, html] of variants) {
        const env = E.makeEnv({ html: agr5.html, url: agr5.url }); E.rehydrate(env.document, agr5.forms);
        env.K.TIMEOUTS.AGREEMENTS_READY = 1500; env.K.TIMEOUTS.CONFIRM = 300; env.K.URL_POLL_MS = 20;
        env.document.body.insertAdjacentHTML("beforeend", html);
        const terms = env.S.agreements.termsCheckbox();
        if (terms) env.D.ownCheckboxInput(terms).checked = false; // the 05 dump is ticked; start unticked
        let agreeClicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { agreeClicks += 1; });
        const state = liveState(project);
        const ctx = Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
        let err = null, result = null;
        try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
        ok(result === null && err && err.name === "BlockedError" && /^extra consent required, not supported \(/.test(err.message) && /Advanced AI Safety Addendum/.test(err.message) && agreeClicks === 0 && !state.queue[0].agreeClicked && !env.D.isCheckboxChecked(terms),
          `${label}: the job fails as extra consent, the terms box is not ticked, Agree is never clicked`, err ? `${err.name}: ${err.message.slice(0, 140)} agree=${agreeClicks}` : JSON.stringify(result));
        env.win.close();
      }
      // The same banner in an overlay pane on the recorded Fable model page: the model handler stops at once.
      const env = E.makeEnv({ html: fableSnap.html, url: fableSnap.url });
      env.K.TIMEOUTS.MODEL_READY = 1500; env.K.URL_POLL_MS = 20;
      const banner = env.D.q(".addendum-banner-container");
      env.document.body.insertAdjacentHTML("beforeend", '<div class="cdk-overlay-container"><div class="cdk-overlay-pane" id="pane"></div></div>');
      env.document.getElementById("pane").appendChild(banner);
      const input = env.D.q('#pane input[type="checkbox"]');
      let enableClicks = 0; const en = env.S.model.enableButton(); if (en) en.addEventListener("click", () => { enableClicks += 1; });
      let err = null;
      try { await env.A.handleModelPage({ runId: "r", jobIndex: 0, job: { projectId: new URL(fableSnap.url).searchParams.get("project"), modelSlug: "claude-fable-5-1" }, settings: {}, log: () => {}, mark: () => {}, step: () => {}, setPhase: async () => {}, updateJob: async () => ({ ok: true }), assertMayAct: async () => {}, refresh: async () => ({}) }); } catch (e) { err = e; }
      ok(err && err.name === "BlockedError" && /Advanced AI Safety Addendum/.test(err.message) && !input.checked && enableClicks === 0, "the Fable banner in an overlay pane on the recorded model page: blocked at once, nothing ticked or clicked", err ? `${err.name}: ${err.message.slice(0, 120)}` : "no error");
      env.win.close();
    }
  }

  // (0.8.0) the Agreements handler's re-entry check reads purchaseObserved as well as agreeClicked.
  {
    const agr5 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!agr5) skip("re-entry with purchaseObserved", "recon dump not present");
    else {
      const env = E.makeEnv({ html: agr5.html, url: agr5.url }); E.rehydrate(env.document, agr5.forms);
      const state = liveState(new URL(agr5.url).searchParams.get("project"), { job: { purchaseObserved: true } });
      let agreeClicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { agreeClicks += 1; });
      const ctx = Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
      const r = await env.A.handleAgreements(ctx);
      ok(r && r.status === "unverified" && /the console already reported a purchase for this job/.test(r.message) && agreeClicks === 0, "a job with purchaseObserved (no agreeClicked) re-entering the Agreements handler: unverified at once, no tick, no click", JSON.stringify(r));
      env.win.close();
    }
  }

  // (0.8.0) Foreign checkbox controls injected into the terms mat-checkbox: a bare input in its label (V1), a
  // role="checkbox" element in its label (V2), a bare input as the host's first child (V4). On the recorded
  // unticked (04) and ticked (05) Agreements pages, full run: the job fails, nothing extra is ticked, Agree is
  // never clicked.
  {
    const s04 = E.readSnapshot(E.findRun("A") || "", "04-agreements");
    const s05 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
    if (!s04 || !s05) skip("foreign controls inside the terms mat-checkbox", "recon dump not present");
    else {
      console.log("--- (0.8.0) foreign checkbox controls inside the terms mat-checkbox: the job fails, nothing extra ticked, Agree never clicked");
      const inLabel = (html) => (host) => { (host.querySelector("label") || host).insertAdjacentHTML("beforeend", html); };
      const inject = {
        V1: inLabel('<input type="checkbox" id="foreign" aria-label="Also accept the marketing terms">'),
        V2: inLabel('<span role="checkbox" id="foreign" aria-checked="false" aria-label="Also accept the marketing terms" tabindex="0"></span>'),
        V4: (host) => { host.insertAdjacentHTML("afterbegin", '<input type="checkbox" id="foreign" aria-label="Also accept the marketing terms">'); }
      };
      // Every spelling Chrome still exposes as a checkbox, and every other checkable control.
      for (const role of ["Checkbox", "CHECKBOX", " checkbox ", "checkbox switch", "foo checkbox"]) inject[`role="${role}"`] = inLabel(`<span role="${role}" id="foreign" tabindex="0">Also accept</span>`);
      inject["an [aria-checked] element"] = inLabel('<span id="foreign" aria-checked="false" tabindex="0">Also accept</span>');
      inject['role="switch"'] = inLabel('<button role="switch" id="foreign">Also accept</button>');
      inject['role="menuitemcheckbox"'] = inLabel('<span role="menuitemcheckbox" id="foreign" tabindex="0">Also accept</span>');
      inject["a radio input"] = inLabel('<input type="radio" id="foreign">');
      inject["a mat-slide-toggle"] = inLabel('<mat-slide-toggle id="foreign"></mat-slide-toggle>');
      inject["a mat-radio-button"] = inLabel('<mat-radio-button id="foreign"></mat-radio-button>');
      // setCheckbox itself refuses an ambiguous host and clicks nothing.
      {
        const env = E.makeEnv({ html: s04.html, url: s04.url }); E.rehydrate(env.document, s04.forms);
        const host = env.D.q("mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox");
        const real = env.D.ownCheckboxInput(host);
        inject.V1(host, env.document);
        let clicks = 0; for (const i of env.D.qa('input[type="checkbox"]', host)) i.addEventListener("click", () => { clicks += 1; });
        let thrown = null;
        try { await env.D.setCheckbox(host, true); } catch (e) { thrown = e; }
        ok(thrown && /more than one checkbox-like element; nothing is clicked/.test(thrown.message) && clicks === 0 && !real.checked, "await D.setCheckbox(ambiguousHost, true) throws, with 0 clicks and the real box unticked", thrown ? `${thrown.message} clicks=${clicks}` : "no throw");
        env.win.close();
      }
      // One window per recorded page (a 4 MB page per variant would exhaust the heap): each variant is injected,
      // judged and removed again, and the real box is checked unchanged after each.
      for (const [start, snap] of [["unticked start (04)", s04], ["ticked start (05)", s05]]) {
        const env = E.makeEnv({ html: snap.html, url: snap.url }); E.rehydrate(env.document, snap.forms);
        env.K.TIMEOUTS.AGREEMENTS_READY = 1200; env.K.TIMEOUTS.CONFIRM = 300; env.K.URL_POLL_MS = 20;
        const host = env.D.q("mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox");
        const realInput = env.D.ownCheckboxInput(host);
        const realBefore = realInput.checked;
        let agreeClicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { agreeClicks += 1; });
        for (const [name, fn] of Object.entries(inject)) {
          fn(host, env.document);
          const foreign = env.document.getElementById("foreign");
          let foreignClicks = 0; foreign.addEventListener("click", () => { foreignClicks += 1; });
          const agreeBefore = agreeClicks;
          const state = liveState(new URL(snap.url).searchParams.get("project"));
          const ctx = Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
          let err = null, result = null;
          try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
          const foreignTicked = foreign.tagName === "INPUT" ? foreign.checked : foreign.getAttribute("aria-checked") === "true" || foreign.classList.contains("mat-mdc-slide-toggle-checked");
          ok(env.S.agreements.termsCheckbox() === null && result === null && err && env.D.isFatal(err) && /the terms checkbox holds 2 checkbox controls/.test(err.message) && foreignClicks === 0 && !foreignTicked && realInput.checked === realBefore && agreeClicks === agreeBefore && !state.queue[0].agreeClicked,
            `${name}, ${start}: termsCheckbox() is null, the job fails naming "the terms checkbox holds 2 checkbox controls", nothing extra ticked, the real box unchanged, Agree never clicked`, err ? `${err.name}: ${err.message.slice(0, 140)} agree=${agreeClicks - agreeBefore} foreign=${foreignClicks}` : JSON.stringify(result));
          foreign.remove();
          await new Promise((r) => setTimeout(r, 300)); // past the blocker check's 250 ms throttle before the next variant
        }
        ok(env.S.agreements.termsCheckbox() === host && realInput.checked === realBefore && agreeClicks === 0, `${start}: control: with every injected control removed the terms box resolves again, unchanged, and Agree was never clicked`);
        env.win.close();
      }
    }
  }
  // (N6) the dry-run handler runs the same identity checks as the guard before it touches the checkbox.
  const snap04 = E.readSnapshot(E.findRun("A") || "", "04-agreements");
  if (!snap04) skip("handleAgreements dry run identity on 04-agreements", "recon dump not present");
  else {
    console.log("--- (N6) handleAgreements (dry run) refuses a page that is not the job's");
    const project = new URL(snap04.url).searchParams.get("project");
    const e6 = E.makeEnv({ html: snap04.html, url: snap04.url }); E.rehydrate(e6.document, snap04.forms);
    e6.K.TIMEOUTS.AGREEMENTS_READY = 300; e6.K.URL_POLL_MS = 20;
    let clicks6 = 0; e6.S.agreements.agreeButton().addEventListener("click", () => { clicks6 += 1; });
    const dryFails = async (label, url, jobExtra, re) => {
      e6.dom.reconfigure({ url });
      const state = liveState(project, { job: jobExtra, state: { settings: { live_mode: false }, run: { runId: RUN_ID, live: false } } });
      const ctx = Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: false }, setPhase: async () => {}, assertMayAct: async () => {} });
      let result = null, err = null;
      try { result = await e6.A.handleAgreements(ctx); } catch (x) { err = x; }
      ok(!result && err && e6.D.isFatal(err) && /not the job's Agreements page/.test(err.message) && re.test(err.message), `${label} -> fatal, not dry-run: ${err ? err.message.slice(0, 100) : JSON.stringify(result)}`, err ? err.message : JSON.stringify(result));
      ok(!e6.D.isCheckboxChecked(e6.S.agreements.termsCheckbox()) && clicks6 === 0, `${label}: checkbox left unticked, Agree not clicked`);
    };
    await dryFails("job's product id is another Anthropic product (884 on the 867 page)", snap04.url, { productId: "anthropic/anthropic-884.cloudpartnerservices.goog" }, /not the job's product/);
    await dryFails("no product id recorded on the job", snap04.url, { productId: null }, /no Marketplace product id/);
    await dryFails("page served under another project", `https://console.cloud.google.com${AGREEMENTS_PATH}?project=some-other-project`, {}, /not the job's project/);
    const t6 = Date.now();
    await dryFails("job for a model the page does not name", snap04.url, { modelSlug: "claude-sonnet-4-6", modelName: "Claude Sonnet 4.6" }, /does not name/);
    ok(Date.now() - t6 >= 300, "the name mismatch is decided after the full agreements_ready wait (the summary could still render)", `${Date.now() - t6} ms`);
    e6.win.close();
  }

  // (R1) the model name is read from the rendered Purchase summary: the URL
  // flips to the agreements route seconds before the SKU rows render, so the
  // handler waits for checkbox + Agree button + model name together.
  console.log("--- (R1) handleAgreements waits for the rendered Purchase summary before judging the model name");
  {
    // The rendered Agreements page as the 04/05 dumps shape it: the body component, the Purchase summary's
    // em-dash SKU rows (with the context-window tail and a second row), the hooked mat-checkbox around
    // mp-agreements-tos, and the Agree button with both hooks and its label span.
    const RENDERED = '<h1>Agreements</h1><billing-integrated-ai-agreements-body><h2>Purchase summary</h2>' +
      '<button class="cfc-tiered-table-entry">Claude Haiku 4 5 — Input Tokens — global — Context Window Size from 0 to 200000 Tokens</button>' +
      '<button class="cfc-tiered-table-entry">Claude Haiku 4 5 — Web Search Requests — global</button>' +
      '<mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox"><label><input type="checkbox"><mp-agreements-tos><p>By purchasing, deploying, accessing, or using this product, you agree to comply with the terms.</p></mp-agreements-tos></label></mat-checkbox>' +
      '<button data-prober="cloud-marketplace-request-product" aria-label="Agree to the terms and agreements before continuing"><span class="mdc-button__label"> Agree </span></button></billing-integrated-ai-agreements-body>';
    const OTHER = RENDERED.split("Claude Haiku 4 5").join("Claude Sonnet 4 6");
    const NO_BOX = RENDERED.replace(/<mat-checkbox[\s\S]*?<\/mat-checkbox>/, '<mp-agreements-tos><p>By purchasing you agree to the terms.</p></mp-agreements-tos>');
    const NO_AGREE = RENDERED.replace(/<button data-prober[\s\S]*?<\/button>/, "");
    const dryCtx = (env) => {
      const state = liveState("proj-one", { state: { settings: { live_mode: false }, run: { runId: RUN_ID, live: false } } });
      return Object.assign(mk(state), { job: state.queue[0], settings: { live_mode: false }, setPhase: async () => {}, assertMayAct: async () => {} });
    };
    const run = async (label, initialBody, renderHtml, renderAfterMs, url) => {
      const env = E.makeEnv({ html: `<!doctype html><html><body>${initialBody}</body></html>`, url: url || BLANK_URL });
      env.K.TIMEOUTS.AGREEMENTS_READY = 600; env.K.URL_POLL_MS = 20;
      if (renderHtml !== null) setTimeout(() => { env.document.body.innerHTML = renderHtml; }, renderAfterMs);
      const t0 = Date.now();
      let result = null, err = null;
      try { result = await env.A.handleAgreements(dryCtx(env)); } catch (e) { err = e; }
      const ticked = env.D.isCheckboxChecked(env.S.agreements.termsCheckbox());
      // isFatal is taken from this window: error classes differ per jsdom window.
      const out = { result, err, ms: Date.now() - t0, ticked, fatal: !!err && env.D.isFatal(err) };
      env.win.close();
      return out;
    };
    let r = await run("rendered from the start", RENDERED, null, 0);
    ok(r.result && r.result.status === "dry-run" && r.ticked && r.ms < 300, "summary rendered from the start: dry-run at once, box ticked", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms`);
    r = await run("spinner", '<div class="spinner">Loading...</div>', RENDERED, 200);
    ok(r.result && r.result.status === "dry-run" && r.ticked && r.ms >= 200, "spinner for 200 ms, then the summary: dry-run (no fatal on the spinner)", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms`);
    r = await run("questionnaire leftovers", '<h1>Claude Haiku 4.5 enablement</h1><form raf-name="q"></form>', RENDERED, 200);
    ok(r.result && r.result.status === "dry-run" && r.ms >= 200, "questionnaire text still in the body for 200 ms: not judged on it, dry-run once the summary renders", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms`);
    r = await run("questionnaire leftovers, then another model", '<h1>Claude Haiku 4.5 enablement</h1>', OTHER, 200);
    ok(!r.result && r.fatal && /does not name the job's model/.test(r.err.message) && r.ms >= 600 && !r.ticked,
      "stale text names the model but the rendered summary names another: fatal after the full wait, box untouched (no pass on stale text)", r.err ? `${r.err.message.slice(0, 90)} ${r.ms} ms` : JSON.stringify(r.result));
    r = await run("empty body", "", RENDERED, 200);
    ok(r.result && r.result.status === "dry-run" && r.ms >= 200, "empty body for 200 ms, then the summary: dry-run", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms`);
    r = await run("other model from the start", OTHER, null, 0);
    ok(!r.result && r.fatal && /not the job's Agreements page: the page's visible text \(the Purchase summary rows\) does not name the job's model "Claude Haiku 4.5"/.test(r.err.message) && r.ms >= 600 && !r.ticked,
      "summary naming another model: fatal after the full wait, box untouched, the message names the page and the locator (the visible text, the Purchase summary rows)", r.err ? `${r.err.message.slice(0, 140)} ${r.ms} ms` : JSON.stringify(r.result));
    // (T6) the page rendered (its shell is there) but a control's every locator is missing: fatal at once after the
    // wait, naming the page and the locators; nothing is ticked. A body without the shell stays a plain timeout.
    r = await run("shell without the checkbox", NO_BOX, null, 0);
    ok(!r.result && r.fatal && r.ms >= 600 && !r.ticked && /^the Agreements page rendered \(billing-integrated-ai-agreements-body or mp-agreements-tos is present\) but the terms checkbox \(mat-checkbox\.p6ntest-mp-agreements-body-tos-checkbox or mp-agreements-tos\) was not found within 1 s; the console changed the page: see docs\/MAINTENANCE\.md$/.test(r.err.message),
      "(T6) the agreements shell rendered without any checkbox locator matching: fatal after the wait, naming the page and the two locators", r.err ? `${r.err.message} ${r.ms} ms` : JSON.stringify(r.result));
    r = await run("shell without the Agree button", NO_AGREE, null, 0);
    ok(!r.result && r.fatal && r.ms >= 600 && !r.ticked && /but the Agree button \(button\[data-prober="cloud-marketplace-request-product"\] or button\[aria-label\^="Agree to the terms"\]\) was not found within 1 s/.test(r.err.message),
      "(T6) the agreements shell rendered without either Agree locator matching: fatal after the wait, naming both hooks, box untouched", r.err ? `${r.err.message} ${r.ms} ms` : JSON.stringify(r.result));
    r = await run("checkbox never renders", '<h2>Purchase summary</h2><p>Claude Haiku 4 5 - Input Tokens</p>', null, 0);
    ok(!r.result && r.err && r.err.name === "TimeoutError" && !r.fatal && /purchase summary naming the job's model, with the terms checkbox and the Agree button/.test(r.err.message),
      "model named but no checkbox or Agree button: a plain timeout (retried by the loop), not fatal", r.err ? r.err.message : JSON.stringify(r.result));
    r = await run("wrong project in the URL", RENDERED, null, 0, BLANK_URL.replace("proj-one", "someone-else"));
    ok(!r.result && r.fatal && /not the job's project/.test(r.err.message) && r.ms < 200 && !r.ticked, "URL for another project: fatal at once, before any wait", r.err ? `${r.err.message.slice(0, 90)} ${r.ms} ms` : JSON.stringify(r.result));
    r = await run("wrong product in the URL", RENDERED, null, 0, BLANK_URL.replace("anthropic-867", "anthropic-884"));
    ok(!r.result && r.fatal && /not the job's product/.test(r.err.message) && r.ms < 200, "URL for another product: fatal at once, before any wait", r.err ? `${r.err.message.slice(0, 90)} ${r.ms} ms` : JSON.stringify(r.result));
  }

  // (R2) dialogs around the live click, on the real ticked page.
  const snapR2 = E.readSnapshot(E.findRun("A") || "", "05-agreements-checked");
  if (!snapR2) skip("dialogs around the live click on 05-agreements-checked", "recon dump not present");
  else {
    console.log("--- (R2) a dialog open before the click refuses it; the post-Agree wait accepts only a dialog that appeared after the click");
    const project = new URL(snapR2.url).searchParams.get("project");
    const ERROR_OPEN = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog" aria-label="Error dialog"><h1 matdialogtitle>Something went wrong</h1><div matdialogcontent>Could not load billing accounts. Try again.</div></mat-dialog-container></div>';
    const API_OPEN = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div><button> Enable </button></apis-enabler></mat-dialog-container></div>';
    const success = (name, hidden) => `<div class="cdk-overlay-container"><mat-dialog-container role="dialog"${hidden ? ' style="display: none;"' : ""}><mp-consent-complete-dialog><h1 matdialogtitle>Successfully purchased ${name}</h1></mp-consent-complete-dialog></mat-dialog-container></div>`;
    const failure = (hidden) => `<div class="cdk-overlay-container"><mat-dialog-container role="dialog" aria-label="Error dialog"${hidden ? ' style="display: none;"' : ""}><behavior-failure-dialog><h1 matdialogtitle>Action Required: Choose Different Billing Account</h1><div matdialogcontent>This billing account cannot buy.</div></behavior-failure-dialog></mat-dialog-container></div>`;
    let n = 0;
    const live = async (label, beforeHtml, afterHtml) => {
      const env = E.makeEnv({ html: snapR2.html, url: snapR2.url }); E.rehydrate(env.document, snapR2.forms);
      env.K.TIMEOUTS.CONFIRM = 400; env.K.URL_POLL_MS = 20;
      const rid = `run-r2-${++n}`;
      const state = liveState(project, { state: { run: { runId: rid, live: true } } });
      const ctx = Object.assign(mk(state, null, rid), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
      const logs = []; ctx.log = (m) => logs.push(m);
      let clicks = 0, clickAt = null;
      env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; clickAt = Date.now(); if (afterHtml) env.document.body.insertAdjacentHTML("beforeend", afterHtml); });
      if (beforeHtml) env.document.body.insertAdjacentHTML("beforeend", beforeHtml);
      let result = null, err = null;
      try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
      // ms counts from the click (as in T1): the readiness checks on the 4 MB page before it vary with machine load.
      const out = { result, err, clicks, logs, ms: clickAt === null ? -1 : Date.now() - clickAt, recorded: state.queue[0].agreeClicked === true };
      env.win.close();
      return out;
    };
    let r = await live("control", "", success("Claude Haiku 4.5", false));
    ok(r.clicks === 1 && r.result && r.result.status === "done" && r.ms >= 0 && r.ms < 300, "control: no dialog before, the success dialog naming the model appears after the click: one click, done within 300 ms of the click", r.err ? r.err.message : `${JSON.stringify(r.result)} clicks=${r.clicks} ${r.ms} ms`);
    r = await live("error open", ERROR_OPEN, null);
    ok(r.clicks === 0 && !r.recorded && r.err && r.err.name === "ForbiddenClickError" && /a console dialog is open: Something went wrong: Could not load billing accounts\. Try again\. \(element mat-dialog-container\)/.test(r.err.message),
      "an unrelated error dialog open before the click: refused with the dialog's text and the element it was matched by, nothing recorded, no click", r.err ? r.err.message : JSON.stringify(r.result));
    r = await live("Enable APIs open", API_OPEN, null);
    ok(r.clicks === 0 && r.err && r.err.name === "ForbiddenClickError" && /a console dialog is open: Enable APIs/.test(r.err.message), 'the "Enable APIs" dialog open before the click: refused, no click', r.err ? r.err.message : JSON.stringify(r.result));
    r = await live("success for the model open", success("Claude Haiku 4.5", false), null);
    ok(r.clicks === 0 && r.err && r.err.name === "ForbiddenClickError" && /Successfully purchased Claude Haiku 4.5/.test(r.err.message), "a success dialog naming the model already open: refused (it is not this click's outcome), no click", r.err ? r.err.message : JSON.stringify(r.result));
    r = await live("hidden stale success", success("Claude Haiku 4.5", true), null);
    ok(r.clicks === 1 && r.result && r.result.status === "unverified" && r.ms >= 400, "a hidden (closing) success dialog naming the model from before the click is not accepted: unverified after confirm_ms", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms`);
    r = await live("hidden stale error", failure(true), null);
    ok(r.clicks === 1 && r.result && r.result.status === "unverified", "a hidden error dialog from before the click is not accepted: unverified", r.err ? r.err.message : JSON.stringify(r.result));
    r = await live("new success for another model", "", success("Claude Sonnet 4.6", false));
    ok(r.clicks === 1 && r.result && r.result.status === "unverified" && r.logs.some((m) => /ignoring a confirmation dialog that does not name the job's model "Claude Haiku 4.5": "Successfully purchased Claude Sonnet 4.6"/.test(m)),
      "a success dialog that appears after the click but names another model: logged and ignored, unverified", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.logs.join(" | ")}`);
    r = await live("new success, exact version", "", success("Claude Haiku 4.55", false) + success("Claude Haiku 4.5", false));
    ok(r.clicks === 1 && r.result && r.result.status === "done" && r.logs.some((m) => /ignoring a confirmation dialog .*"Successfully purchased Claude Haiku 4.55"/.test(m)), "two new success dialogs, the longer version first: it is logged and skipped, the exact version counts (done)", r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.logs.join(" | ")}`);
    r = await live("new error", "", failure(false));
    ok(r.clicks === 1 && r.result && r.result.status === "failed" && /Agree refused by the console: Action Required: Choose Different Billing Account: This billing account cannot buy/.test(r.result.message),
      "the console's refusal dialog (behavior-failure-dialog) that appears after the click: failed with its title and text", r.err ? r.err.message : JSON.stringify(r.result));

    console.log('--- (T6) the dialog check is scoped: a non-modal role="dialog" element blocks nothing; an aria-modal="true" one blocks and is named');
    const DRAWER = '<div role="dialog" aria-modal="false" id="drawer"><h2>What is new</h2><p>Release notes for the console.</p></div><cfc-side-panel role="dialog" id="help"><h2>Help</h2></cfc-side-panel>';
    const MODAL = '<div role="dialog" aria-modal="true" id="survey"><h2>Survey</h2><p>How are we doing?</p></div>';
    r = await live("drawer open", DRAWER, success("Claude Haiku 4.5", false));
    ok(r.clicks === 1 && r.result && r.result.status === "done" && !r.logs.some((m) => /dialog is open/.test(m)),
      '(T6) a visible non-modal role="dialog" drawer and a side panel without aria-modal, open before the click: not console dialogs, one click, done', r.err ? r.err.message : `${JSON.stringify(r.result)} clicks=${r.clicks}`);
    r = await live("modal open", MODAL, null);
    ok(r.clicks === 0 && !r.recorded && r.err && r.err.name === "ForbiddenClickError" && /a console dialog is open: Survey \(element div\[role="dialog"\]\)/.test(r.err.message),
      '(T6) a visible aria-modal="true" role="dialog" element: refused, the element named in the message (div[role="dialog"]), nothing recorded, no click', r.err ? r.err.message : JSON.stringify(r.result));
  }

  // (T1) after the click only the console's refusal shape fails the job. A bare "Error dialog" container
  // (no behavior-failure-dialog, no refusal wording) gives the success dialog a grace period
  // (agree_grace_ms): the four orderings of the 0.4.0 review's probe, then the persisting, the
  // transient-and-nothing-else and the refusal-wording cases.
  if (!snapR2) skip("(T1) post-Agree dialog orderings on 05-agreements-checked", "recon dump not present");
  else {
    console.log("--- (T1) an error dialog after Agree that is not the console's refusal never fails the job; the success dialog wins within the grace period");
    const project = new URL(snapR2.url).searchParams.get("project");
    const GENERIC = '<div class="cdk-overlay-container" id="gen"><mat-dialog-container role="dialog" aria-label="Error dialog"><h1 matdialogtitle>Something went wrong</h1><div matdialogcontent>Could not load billing accounts. Try again.</div></mat-dialog-container></div>';
    const SUCCESS_OK = '<div class="cdk-overlay-container" id="suc"><mat-dialog-container role="dialog"><mp-consent-complete-dialog><h1 matdialogtitle>Successfully purchased Claude Haiku 4.5</h1></mp-consent-complete-dialog></mat-dialog-container></div>';
    const REFUSAL_WORDED = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog" aria-label="Error dialog"><h1 matdialogtitle>Action Required: Choose Different Billing Account</h1><div matdialogcontent>This product cannot be purchased using a billing account currently associated with a free trial.</div></mat-dialog-container></div>';
    const REFUSAL_SHAPED = '<div class="cdk-overlay-container"><mat-dialog-container role="dialog" aria-label="Error dialog"><behavior-failure-dialog><h1 matdialogtitle>Action Required: Choose Different Billing Account</h1><div matdialogcontent>This billing account cannot buy.</div></behavior-failure-dialog></mat-dialog-container></div>';
    // The grace is long enough that the "at once" checks (g)-(i), bounded by it, never race machine load.
    const GRACE = 2000, CONFIRM = 3000;
    let n = 0;
    /** The live handler on the real ticked page; `afterClick(env)` schedules what the console does after the click. */
    const timed = async (afterClick) => {
      const env = E.makeEnv({ html: snapR2.html, url: snapR2.url }); E.rehydrate(env.document, snapR2.forms);
      env.K.TIMEOUTS.CONFIRM = CONFIRM; env.K.TIMEOUTS.AGREE_GRACE = GRACE; env.K.URL_POLL_MS = 20;
      const rid = `run-t1-${++n}`;
      const state = liveState(project, { state: { run: { runId: rid, live: true } } });
      const ctx = Object.assign(mk(state, null, rid), { job: state.queue[0], settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
      const logs = []; ctx.log = (m) => logs.push(m);
      let clicks = 0, clickAt = null;
      env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; clickAt = Date.now(); afterClick(env); });
      let result = null, err = null;
      try { result = await env.A.handleAgreements(ctx); } catch (e) { err = e; }
      // ms counts from the click (the grace and confirm clocks start there), not from the handler's start:
      // the readiness checks on the 4 MB page take several hundred ms before the click.
      const out = { result, err, clicks, logs, ms: clickAt === null ? -1 : Date.now() - clickAt, recorded: state.queue[0].agreeClicked === true };
      env.win.close();
      return out;
    };
    const add = (env, html, ms) => setTimeout(() => env.document.body.insertAdjacentHTML("beforeend", html), ms);
    const remove = (env, id, ms) => setTimeout(() => { const el = env.document.getElementById(id); if (el) el.remove(); }, ms);
    const says = (r) => (r.err ? r.err.message : `${JSON.stringify(r.result)} ${r.ms} ms | ${r.logs.filter((m) => /dialog/.test(m)).join(" | ")}`);
    const genericLogged = (r) => r.logs.some((m) => /an error dialog that is not the console's refusal opened after Agree: "Something went wrong: Could not load billing accounts. Try again."; waiting up to 2 s more/.test(m));
    const superseded = (r) => r.logs.some((m) => /the confirmation arrived after the error dialog "Something went wrong: Could not load billing accounts. Try again.": that dialog was not the click's outcome/.test(m));

    let r = await timed((env) => { add(env, GENERIC, 100); add(env, SUCCESS_OK, 250); });
    ok(r.clicks === 1 && r.recorded && r.result && r.result.status === "done" && r.ms < 1000 && genericLogged(r) && superseded(r),
      "(a) a generic error container at +100 ms, the success dialog at +250 ms: one click, done (the generic dialog logged, then superseded), not failed", says(r));
    r = await timed((env) => { add(env, GENERIC, 100); remove(env, "gen", 180); add(env, SUCCESS_OK, 250); });
    ok(r.clicks === 1 && r.result && r.result.status === "done" && r.ms < 1000 && genericLogged(r) && superseded(r),
      "(b) the generic container at +100 ms is a transient removed at +180 ms, the success dialog at +250 ms: done", says(r));
    r = await timed((env) => { add(env, SUCCESS_OK, 250); });
    ok(r.clicks === 1 && r.result && r.result.status === "done" && r.ms < 1000 && !genericLogged(r) && !superseded(r) && !r.logs.some((m) => /error dialog/.test(m)),
      "(c) control: the success dialog alone at +250 ms: done, no error dialog logged", says(r));
    r = await timed((env) => { setTimeout(() => { env.document.body.insertAdjacentHTML("beforeend", SUCCESS_OK); env.document.body.insertAdjacentHTML("beforeend", GENERIC); }, 100); });
    ok(r.clicks === 1 && r.result && r.result.status === "done" && r.ms < 1000 && !r.logs.some((m) => /is not the console's refusal/.test(m)),
      "(d) the success dialog and the generic container in the same instant: done (the success dialog is checked first in a poll)", says(r));
    r = await timed((env) => { add(env, GENERIC, 100); });
    ok(r.clicks === 1 && r.result && r.result.status === "unverified" && r.ms >= 100 + GRACE && r.ms < CONFIRM && genericLogged(r)
      && /Agree clicked but the console shows an error dialog that is not its refusal \("Something went wrong: Could not load billing accounts. Try again."\) and no confirmation appeared within 2 s of it; check manually/.test(r.result.message),
      "(e) the generic container persists and no confirmation follows: unverified with the dialog's text once the grace period ends, before confirm_ms, never failed", says(r));
    r = await timed((env) => { add(env, GENERIC, 100); remove(env, "gen", 180); });
    ok(r.clicks === 1 && r.result && r.result.status === "unverified" && r.ms >= CONFIRM && /no confirmation observed within 3 s; an error dialog that is not the console's refusal was seen meanwhile: "Something went wrong: Could not load billing accounts. Try again."; check manually/.test(r.result.message),
      "(f) the generic container closes by itself and nothing else appears: unverified after confirm_ms, naming the dialog that was seen", says(r));
    r = await timed((env) => { add(env, REFUSAL_WORDED, 100); add(env, SUCCESS_OK, GRACE + 500); });
    ok(r.clicks === 1 && r.result && r.result.status === "failed" && r.ms < GRACE && /Agree refused by the console: Action Required: Choose Different Billing Account: This product cannot be purchased using a billing account currently associated with a free trial\./.test(r.result.message),
      "(g) a bare Error dialog container whose text carries the console's recorded refusal wording: failed at once with the console's text (no grace period)", says(r));
    r = await timed((env) => { add(env, REFUSAL_SHAPED, 100); });
    ok(r.clicks === 1 && r.result && r.result.status === "failed" && r.ms < GRACE && /Agree refused by the console: Action Required: Choose Different Billing Account: This billing account cannot buy/.test(r.result.message) && !genericLogged(r),
      "(h) the behavior-failure-dialog shape: failed at once, never logged as a generic dialog", says(r));
    r = await timed((env) => { add(env, GENERIC, 100); add(env, REFUSAL_SHAPED, 250); });
    ok(r.clicks === 1 && r.result && r.result.status === "failed" && r.ms < GRACE && genericLogged(r) && /Agree refused by the console: Action Required/.test(r.result.message),
      "(i) a generic container first, then the refusal within the grace period: the refusal is the outcome, failed with its text", says(r));
  }

  // (F6) the live handler on a job already marked agreeClicked returns unverified without touching the button.
  const again = E.envFromSnapshot("A", "05-agreements-checked");
  if (!again) skip("handleAgreements re-entry on 05-agreements-checked", "recon dump not present");
  else {
    console.log("--- (F6) handleAgreements (live) re-entered after the click was recorded");
    const project = new URL(again.snapshot.url).searchParams.get("project");
    let clicks = 0;
    again.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
    const state = liveState(project, { job: { agreeClicked: true } });
    const ctx = Object.assign(mk(state), { settings: { live_mode: true }, setPhase: async () => {}, assertMayAct: async () => {} });
    const result = await again.A.handleAgreements(ctx);
    ok(result && result.status === "unverified" && /already clicked/.test(result.message), "re-entry reports unverified", JSON.stringify(result));
    ok(clicks === 0, "Agree not clicked on re-entry");
    again.win.close();
  }


  // (S1) step-by-step: the guard needs a trusted Continue for this job's Agree step, recorded by this content script recently.
  if (!snap05) skip("step-by-step guard on 05-agreements-checked", "recon dump not present");
  else {
    console.log("--- (S1) step-by-step: the guard requires a recent trusted Continue for this job's Agree step");
    const project = new URL(snap05.url).searchParams.get("project");
    const env = E.makeEnv({ html: snap05.html, url: snap05.url }); E.rehydrate(env.document, snap05.forms);
    let clicks = 0; env.S.agreements.agreeButton().addEventListener("click", () => { clicks += 1; });
    const st = () => liveState(project, { state: { settings: { live_mode: true, step_by_step: true } } });
    await refused(env, st(), "ForbiddenClickError", "step-by-step on, nothing recorded", { re: /no trusted Continue was recorded for this job's Agree step/ });
    ok(env.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: false }) === false && env.A.continueAge(RUN_ID, 0, "agree") === null, "an untrusted event (isTrusted false) records nothing");
    ok(env.A.recordContinue(RUN_ID, 0, "agree", {}) === false && env.A.recordContinue(RUN_ID, 0, "agree", null) === false && env.A.continueAge(RUN_ID, 0, "agree") === null, "an event without isTrusted, or no event, records nothing");
    await refused(env, st(), "ForbiddenClickError", "still refused after the untrusted attempts", { re: /no trusted Continue/ });
    ok(env.A.recordContinue(RUN_ID, 0, "next", { isTrusted: true }) === true && env.A.continueAge(RUN_ID, 0, "next") !== null, "a trusted Continue for the Next step is recorded");
    await refused(env, st(), "ForbiddenClickError", "a Continue for Next does not satisfy the Agree step", { re: /no trusted Continue/ });
    ok(env.A.recordContinue("run-other", 0, "agree", { isTrusted: true }) === true && env.A.recordContinue(RUN_ID, 1, "agree", { isTrusted: true }) === true, "trusted Continues for another run and another job are recorded under their own keys");
    await refused(env, st(), "ForbiddenClickError", "they do not satisfy this run's job 0", { re: /no trusted Continue/ });
    ok(clicks === 0, "Agree received no click so far");
    // An old record: the trusted Continue is older than CONTINUE_MAX_AGE_MS.
    const realNow = env.win.Date.now;
    ok(env.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a trusted Continue for Agree is recorded");
    env.win.Date.now = () => realNow() + env.K.CONTINUE_MAX_AGE_MS + 1000;
    await refused(env, st(), "ForbiddenClickError", "a trusted Continue older than 5 minutes is refused", { re: /is 30\d s old \(limit 300 s\)/ });
    env.win.Date.now = realNow;
    ok(clicks === 0, "Agree received no click with the stale record");
    // With step-by-step off the record is not needed (control), and with it on a fresh record lets the click through once.
    ok(env.K.CONTINUE_MAX_AGE_MS === 300000, "the Continue limit is 5 minutes");
    ok(env.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a fresh trusted Continue for Agree is recorded");
    const state = st(); const updates = [];
    await env.A.clickAgreeGuarded(mk(state, updates));
    ok(clicks === 1 && state.queue[0].agreeClicked === true, "with a fresh trusted Continue every other condition met: Agree clicked exactly once", clicks);
    ok(env.A.continueAge(RUN_ID, 0, "agree") === null, "the trusted Continue record is cleared once its click was made");
    // (N1) the refuse hook: a reason it returns refuses at the first check, before any record, with no click.
    const env1 = E.makeEnv({ html: snap05.html, url: snap05.url }); E.rehydrate(env1.document, snap05.forms);
    let clicks1 = 0; env1.S.agreements.agreeButton().addEventListener("click", () => { clicks1 += 1; });
    ok(env1.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a trusted Continue recorded in a fresh window");
    const st1 = st(); const updates1 = [];
    let err1 = null;
    try { await env1.A.clickAgreeGuarded(mk(st1, updates1), { refuse: () => "you activated the console's Agree yourself" }); } catch (e) { err1 = e; }
    ok(err1 && err1.name === "ForbiddenClickError" && /you activated the console's Agree yourself/.test(err1.message) && err1.byUser === true && clicks1 === 0 && updates1.length === 0 && st1.queue[0].agreeClicked === false,
      "(N1) refuse() with a reason: refused before any record, flagged byUser, no click", err1 ? err1.message : "no error");
    // (N1) the hook turning true during the record round trip: the record is undone, no click.
    let hookOn = false;
    const cx1 = mk(st1, updates1);
    cx1.updateJob = async (f) => { Object.assign(st1.queue[0], f); updates1.push(f); if (f.agreeClicked === true) hookOn = true; return { ok: true }; };
    err1 = null;
    try { await env1.A.clickAgreeGuarded(cx1, { refuse: () => (hookOn ? "you activated the console's Agree yourself" : null) }); } catch (e) { err1 = e; }
    ok(err1 && err1.byUser === true && err1.recordCleared === true && clicks1 === 0 && JSON.stringify(updates1) === JSON.stringify([{ agreeClicked: true }, { agreeClicked: false }]) && st1.queue[0].agreeClicked === false,
      "(N1) refuse() true only after the record: the record is undone (agreeClicked true then false), recordCleared set, no click", err1 ? `${err1.message} ${JSON.stringify(updates1)}` : "no error");
    // and the guard's per-tab memory was undone too: a later call with a fresh Continue clicks once.
    ok(env1.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a fresh trusted Continue");
    await env1.A.clickAgreeGuarded(mk(st1, updates1));
    ok(clicks1 === 1 && st1.queue[0].agreeClicked === true, "after the undone record the guard clicks once with everything in place (the tab's memory was cleared with the record)", clicks1);
    env1.win.close();
    // (L2) every refusal of the second check undoes the record: the button disabled by a re-render during the
    // record round trip (no user, no dialog) leaves agreeClicked false in storage, no click, recordCleared set.
    const env2 = E.makeEnv({ html: snap05.html, url: snap05.url }); E.rehydrate(env2.document, snap05.forms);
    let clicks2 = 0; const agreeBtn2 = env2.S.agreements.agreeButton(); agreeBtn2.addEventListener("click", () => { clicks2 += 1; });
    ok(env2.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a trusted Continue recorded in a fresh window");
    const st2 = st(); const updates2 = [];
    const cx2 = mk(st2, updates2);
    cx2.updateJob = async (f) => { Object.assign(st2.queue[0], f); updates2.push(f); if (f.agreeClicked === true) agreeBtn2.setAttribute("aria-disabled", "true"); return { ok: true }; };
    let err2 = null;
    try { await env2.A.clickAgreeGuarded(cx2); } catch (e) { err2 = e; }
    ok(err2 && err2.name === "ForbiddenClickError" && /Agree button is disabled/.test(err2.message) && err2.byUser !== true && err2.dialogOpen !== true && err2.recordCleared === true && clicks2 === 0 && JSON.stringify(updates2) === JSON.stringify([{ agreeClicked: true }, { agreeClicked: false }]) && st2.queue[0].agreeClicked === false,
      "(L2) the button disabled during the record round trip: refused, the record undone (true then false), recordCleared, no click", err2 ? `${err2.message} ${JSON.stringify(updates2)}` : "no error");
    agreeBtn2.removeAttribute("aria-disabled");
    ok(env2.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a fresh trusted Continue");
    await env2.A.clickAgreeGuarded(mk(st2, updates2));
    ok(clicks2 === 1 && st2.queue[0].agreeClicked === true, "(L2) with the button enabled again the guard clicks once (the tab's memory was cleared with the record)", clicks2);
    // control: a refusal BEFORE the record (the first check) makes no record and needs no undo.
    const st3 = st(); const updates3 = [];
    const env3 = E.makeEnv({ html: snap05.html, url: snap05.url }); E.rehydrate(env3.document, snap05.forms);
    env3.S.agreements.agreeButton().setAttribute("aria-disabled", "true");
    ok(env3.A.recordContinue(RUN_ID, 0, "agree", { isTrusted: true }) === true, "a trusted Continue in a third window");
    let err3 = null;
    try { await env3.A.clickAgreeGuarded(mk(st3, updates3)); } catch (e) { err3 = e; }
    ok(err3 && /Agree button is disabled/.test(err3.message) && updates3.length === 0 && err3.recordCleared === undefined, "control: the same refusal at the first check records nothing and clears nothing", err3 ? `${err3.message} ${JSON.stringify(updates3)}` : "no error");
    env3.win.close();
    env2.win.close();
    env.win.close();
  }

  console.log("url:", blank.K.modelUrl("proj-one", "claude-haiku-4-5"));
  blank.win.close();
  E.finish("content guard");
})();
