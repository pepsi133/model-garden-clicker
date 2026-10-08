/*
 * The questionnaire handler (actions.handleQuestionnaire) on the real
 * filled questionnaire dump (run A, 03-form-filled, see lib/env.cjs):
 *   - the Marketplace product id from the URL is recorded on the job and a
 *     questionnaire for another model is refused;
 *   - with every field valid, Next is clicked exactly once;
 *   - (N1) a URL whose model= parameter is absent or unparsable is fatal:
 *     nothing is recorded and Next is not clicked;
 *   - (F7) with a field carrying ng-invalid, Next is not clicked and the
 *     job fails naming the field; a hidden host's ng-invalid is ignored.
 *   - a stored select value the console's panel does not offer is fatal on
 *     the first attempt (no retry) naming the field and the offered options,
 *     and Next is not clicked (the panel is simulated: jsdom opens none);
 *   - on the unfilled form (02-after-enable, selects stubbed because jsdom
 *     opens no panel) the AUP details field is filled only when the answer
 *     is Yes, and every option list a select offers is logged.
 * The values typed are the ones already in the dump, read back from it, so
 * nothing personal lives in this file. jsdom runs no Angular: the invalid
 * state is injected by a wrapper around D.setInputValue, so the F7 checks
 * prove the handler's reaction to the class, not that the console sets it
 * (the real-console evidence is the unfilled form at the end).
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

(async () => {
  const run = E.findRun("A");
  const snap = run && E.readSnapshot(run, "03-form-filled");
  if (!snap) { skip("handleQuestionnaire on 03-form-filled", "recon dump not present"); E.finish("questionnaire step"); return; }

  const serve = () => { const env = E.makeEnv(snap); env.rehydrated = E.rehydrate(env.document, snap.forms); return env; };
  const PRODUCT = new URL(snap.url).searchParams.get("mp");
  const SLUG = (new URL(snap.url).searchParams.get("model") || "").split("/").pop();

  /** Questionnaire values as the dump holds them. */
  function settingsFrom(env) {
    const q = env.S.questionnaire;
    const radio = env.D.q('input[type="radio"]:checked', q.aupRadioGroup());
    return {
      business_name: q.businessName().value,
      business_website: q.businessWebsite().value,
      contact_email: q.contactEmail().value,
      headquarters: env.D.selectValueText(q.headquarters()),
      industry: env.D.selectValueText(q.industry()),
      intended_users: env.D.selectValueText(q.intendedUsers()),
      use_cases: q.useCases().value,
      aup_additional_requirements: radio && radio.value === "Yes" ? "yes" : "no",
      aup_details: "",
      live_mode: false
    };
  }

  function ctxFor(env, overrides) {
    const job = { projectId: new URL(snap.url).searchParams.get("project"), modelSlug: SLUG };
    const updates = [];
    const ctx = Object.assign({
      runId: "run-1", jobIndex: 0, job, settings: settingsFrom(env), updates,
      log: () => {}, mark: () => {}, step: () => {}, setPhase: async () => {}, assertMayAct: async () => {},
      updateJob: async (f) => { updates.push(f); Object.assign(job, f); return { ok: true }; },
      refresh: async () => ({})
    }, overrides);
    return ctx;
  }

  const armNext = (env) => { let n = 0; env.S.questionnaire.nextButton().addEventListener("click", () => { n += 1; }); return () => n; };

  console.log("--- identity and product id");
  let env = serve();
  ok(env.S.detectPage() === "questionnaire", "detectPage = questionnaire");
  const id = env.S.questionnaire.identity();
  ok(id.modelSlug === SLUG && id.productId === PRODUCT && /^anthropic\/anthropic-\d+\./.test(id.productId), "identity() reads model slug and product id from the URL", JSON.stringify(id));
  ok(env.S.questionnaire.invalidFields().length === 0, "03-form-filled has no ng-invalid field", JSON.stringify(env.S.questionnaire.invalidFields()));
  env.K.TIMEOUTS.NAV = 100; // the page cannot change in jsdom; do not wait 45 s for it
  env.K.TIMEOUTS.FORM_VALID = 300;

  let clicks = armNext(env);
  let ctx = ctxFor(env);
  let err = null;
  try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
  ok(err && err.name === "TimeoutError" && /page change/.test(err.message), "handler ran to the Next click and then waited for the page change (times out in jsdom)", err && err.message);
  ok(clicks() === 1, "Next clicked exactly once with every field valid", clicks());
  ok(ctx.updates.length === 1 && ctx.updates[0].productId === PRODUCT, "product id recorded on the job before filling", JSON.stringify(ctx.updates));
  env.win.close();

  console.log("--- questionnaire for another model");
  env = serve();
  env.K.TIMEOUTS.NAV = 100; env.K.TIMEOUTS.FORM_VALID = 300;
  clicks = armNext(env);
  ctx = ctxFor(env);
  ctx.job.modelSlug = "claude-sonnet-4-6";
  err = null;
  try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
  ok(err && env.D.isFatal(err) && /another|not the job's/.test(err.message), "refused as fatal: URL model differs from the job's model", err && err.message);
  ok(clicks() === 0 && ctx.updates.length === 0, "nothing clicked, nothing recorded");
  env.win.close();

  console.log("--- (N1) a questionnaire URL without a parsable model= is fatal: no product id recorded, no Next");
  const base = new URL(snap.url);
  const variants = [
    ["model= absent", (u) => { u.searchParams.delete("model"); }],
    ["model= with a trailing slash", (u) => { u.searchParams.set("model", `publishers/anthropic/models/${SLUG}/`); }],
    ["model= with a '?' inside", (u) => { u.searchParams.set("model", `projects/x/publishers/anthropic/models/${SLUG}?x`); }],
    ["model= empty", (u) => { u.searchParams.set("model", ""); }]
  ];
  for (const [label, mutate] of variants) {
    const u = new URL(base.href); mutate(u);
    env = E.makeEnv({ html: snap.html, url: u.href }); E.rehydrate(env.document, snap.forms);
    env.K.TIMEOUTS.NAV = 100; env.K.TIMEOUTS.FORM_VALID = 300;
    clicks = armNext(env);
    ctx = ctxFor(env);
    const idv = env.S.questionnaire.identity();
    ok(idv.modelSlug === null && idv.productId === PRODUCT, `${label}: identity() has no slug but still the mp product id`, JSON.stringify(idv));
    err = null;
    try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
    ok(err && env.D.isFatal(err) && /no parsable model=/.test(err.message), `${label}: fatal`, err && err.message);
    ok(clicks() === 0 && ctx.updates.length === 0 && ctx.job.productId === undefined, `${label}: nothing clicked, no product id recorded`, JSON.stringify(ctx.updates));
    env.win.close();
  }

  console.log("--- (F7) the handler refuses Next while a visible field carries ng-invalid (class injected by the test)");
  env = serve();
  env.K.TIMEOUTS.NAV = 100; env.K.TIMEOUTS.FORM_VALID = 300;
  clicks = armNext(env);
  ctx = ctxFor(env);
  ctx.settings.business_website = "example.com"; // no scheme: the console rejects it (docs/dom-map.md, website validation)
  const realSet = env.D.setInputValue;
  env.D.setInputValue = (el, value) => {
    realSet(el, value);
    const host = el.closest("raf-runtime-form-element");
    if (host && host.getAttribute("raf-name") === "businessWebsite") {
      const invalid = !/^https?:\/\//.test(value);
      el.classList.toggle("ng-invalid", invalid);
      el.classList.toggle("ng-valid", !invalid);
      let msg = host.querySelector("mat-error");
      if (!msg) { msg = env.document.createElement("mat-error"); host.appendChild(msg); }
      msg.textContent = invalid ? "Please provide your full website with protocol included." : "";
      if (!invalid) msg.remove();
    }
  };
  err = null;
  try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
  ok(err && env.D.isFatal(err) && /invalid fields/.test(err.message) && /businessWebsite/.test(err.message) && /protocol/.test(err.message),
    "fatal error names the invalid field and the console's message", err && err.message);
  ok(clicks() === 0, "Next received no click");
  const bad = env.S.questionnaire.invalidFields();
  ok(bad.length === 1 && bad[0].rafName === "businessWebsite", "invalidFields() lists exactly businessWebsite", JSON.stringify(bad));

  // A host the console hides (raf-hidden="true", as the AUP details field is in this dump once "No" is chosen)
  // is skipped even while its input carries ng-invalid: the hidden field cannot block Next.
  const websiteHost = env.D.q('raf-runtime-form-element[raf-name="businessWebsite"]');
  websiteHost.setAttribute("raf-hidden", "true");
  ok(env.S.questionnaire.invalidFields().length === 0, "an ng-invalid input inside a raf-hidden host is ignored by invalidFields()", JSON.stringify(env.S.questionnaire.invalidFields()));
  websiteHost.removeAttribute("raf-hidden");
  ok(env.S.questionnaire.invalidFields().length === 1, "visible again: listed again");

  // The same wrapper with a valid value lets the handler through again.
  ctx = ctxFor(env);
  ctx.settings.business_website = "https://example.com";
  clicks = armNext(env);
  err = null;
  try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
  ok(err && err.name === "TimeoutError" && clicks() === 1, "with a scheme the field is valid again and Next is clicked once", err && err.message);
  env.win.close();

  console.log("--- (F7) the unfilled questionnaire lists its required fields as invalid");
  const empty = E.envFromSnapshot("A", "02-after-enable");
  if (!empty) skip("invalidFields on 02-after-enable", "recon dump not present");
  else {
    const names = empty.S.questionnaire.invalidFields().map((f) => f.rafName);
    ok(names.length >= 3 && names.includes("businessName") && names.includes("businessWebsite"), "unfilled form: required text fields are ng-invalid", names.join(","));
    empty.win.close();
  }

  console.log("--- (R9) a select value the console does not offer is fatal on the first attempt");
  env = serve();
  env.K.TIMEOUTS.NAV = 100; env.K.TIMEOUTS.FORM_VALID = 300; env.K.URL_POLL_MS = 20;
  clicks = armNext(env);
  ctx = ctxFor(env);
  ctx.settings.headquarters = "Deutschland";
  {
    // The console's panel, simulated: clicking the headquarters trigger renders the options into the overlay container.
    const host = env.S.questionnaire.headquarters();
    const trigger = env.D.q(".cfc-select-trigger", host) || host;
    let overlay = env.D.q(".cdk-overlay-container");
    if (!overlay) { overlay = env.document.createElement("div"); overlay.className = "cdk-overlay-container"; env.document.body.appendChild(overlay); }
    const offered = ["United States of America", "Canada", "Afghanistan", "Germany"];
    trigger.addEventListener("click", () => {
      overlay.innerHTML = offered.map((t) => `<mat-option role="option"><span class="cfc-select-option-primary">${t}</span></mat-option>`).join("");
    });
    env.document.body.addEventListener("keydown", (e) => { if (e.key === "Escape") overlay.innerHTML = ""; });
    const logs = []; ctx.log = (m) => logs.push(m);
    const t0 = Date.now();
    err = null;
    try { await env.A.handleQuestionnaire(ctx); } catch (e) { err = e; }
    ok(err && env.D.isFatal(err) && /questionnaire select "headquarters" has no option "Deutschland"/.test(err.message), "fatal (no retry) naming the field and the wanted value", err && err.message.slice(0, 120));
    ok(err && new RegExp(`the console offers: ${offered.join(" \\| ")}$`).test(err.message), "the failure message lists the offered option names", err && err.message.slice(-120));
    ok(clicks() === 0 && Date.now() - t0 < 2000, "Next received no click; decided without waiting out a timeout", `${Date.now() - t0} ms`);
    ok(logs.some((m) => /^select "headquarters" offers 4 options: United States of America \| Canada \| Afghanistan \| Germany$/.test(m)), "the offered list was logged before the failure");
    ok(overlay.innerHTML === "", "the panel was closed (Escape) before failing");
  }
  env.win.close();

  console.log("--- AUP details filled only for Yes; option lists logged (02-after-enable, selects stubbed)");
  const aupRun = async (answer, details) => {
    const e = E.envFromSnapshot("A", "02-after-enable");
    if (!e) return null;
    e.K.TIMEOUTS.NAV = 100; e.K.TIMEOUTS.FORM_VALID = 200;
    const selectCalls = [];
    const clicks = armNext(e);
    e.D.selectOption = async (host, text, opts) => {
      selectCalls.push(text);
      if (opts && opts.onOptions) opts.onOptions(["Alpha", "Beta", text]);
    };
    for (const el of e.D.qa("raf-runtime-form-element .ng-invalid")) el.classList.remove("ng-invalid"); // jsdom runs no Angular: nothing flips the classes
    const logs = [];
    const ctx = ctxFor(e, { log: (m) => logs.push(m) });
    ctx.settings = Object.assign({}, ctx.settings, { business_name: "n", business_website: "https://n.example", contact_email: "a@n.example",
      headquarters: "HQ", industry: "IND", intended_users: "USERS", use_cases: "u", aup_additional_requirements: answer, aup_details: details });
    let error = null;
    try { await e.A.handleQuestionnaire(ctx); } catch (x) { error = x; }
    const detailsInput = e.D.q('raf-runtime-form-element[raf-name="additionalRequirements"] input');
    const result = { logs, selectCalls, error, clicks: clicks(), detailsValue: detailsInput ? detailsInput.value : null,
      yesChecked: e.D.q('input[type="radio"][value="Yes"]', e.S.questionnaire.aupRadioGroup()).checked };
    e.win.close();
    return result;
  };
  const yes = await aupRun("yes", "we review every consumer-facing answer");
  if (!yes) skip("AUP details on 02-after-enable", "recon dump not present");
  else {
    ok(yes.clicks === 1 && yes.error && yes.error.name === "TimeoutError" && /page change away from questionnaire/.test(yes.error.message), "Yes: handler ran through to the Next click: Next clicked once, then the page change times out in jsdom", `clicks=${yes.clicks} ${yes.error && yes.error.message}`);
    ok(yes.yesChecked === true, 'Yes: the "Yes" radio is checked');
    ok(yes.detailsValue === "we review every consumer-facing answer", "Yes: the AUP details field was filled (real D.setInputValue)", yes.detailsValue);
    ok(yes.selectCalls.join() === "HQ,IND,USERS", "the three selects were picked in order", yes.selectCalls.join());
    const listed = yes.logs.filter((m) => /^select ".*" offers 3 options: Alpha \| Beta \| /.test(m));
    ok(listed.length === 3 && /"headquarters"/.test(listed[0]) && /"industry"/.test(listed[1]) && /"intended_users"/.test(listed[2]), "every option list a select offered was logged with its field name", yes.logs.join(" || "));
    const no = await aupRun("no", "must not be typed");
    ok(no.yesChecked === false && no.detailsValue === "" && no.clicks === 1, "No: the details field is left untouched, Next still clicked once", `${no.detailsValue} clicks=${no.clicks}`);
  }

  console.log("--- (T6) the questionnaire's readiness wait names the page and the locator instead of retrying blind");
  {
    const eS = serve();
    const baseSettings = settingsFrom(eS);
    // ctxFor reads the settings off the page, which these pages cannot give: the same ctx shape with the dump's values.
    const plainCtx = (e) => {
      const job = { projectId: new URL(snap.url).searchParams.get("project"), modelSlug: SLUG };
      return { runId: "run-1", jobIndex: 0, job, settings: baseSettings, log: () => {}, mark: () => {}, step: () => {}, setPhase: async () => {}, assertMayAct: async () => {},
        updateJob: async (f) => { Object.assign(job, f); return { ok: true }; }, refresh: async () => ({}) };
    };
    // (a) the shell rendered but the business name hook renamed: fatal after the wait, naming the locator.
    eS.K.TIMEOUTS.FORM_READY = 300; eS.K.URL_POLL_MS = 20;
    eS.D.q('raf-runtime-form-element[raf-name="businessName"]').setAttribute("raf-name", "companyName");
    let errT = null; let t0 = Date.now();
    try { await eS.A.handleQuestionnaire(plainCtx(eS)); } catch (x) { errT = x; }
    ok(errT && eS.D.isFatal(errT) && Date.now() - t0 >= 300 && /^the questionnaire rendered \(its raf-form or footer is present\) but its business name input was not found by raf-runtime-form-element\[raf-name="businessName"\] within 0 s; the console renamed the field: see docs\/MAINTENANCE\.md \(questionnaire\.businessName\)$/.test(errT.message),
      "(T6) raf-name businessName renamed on the real form: fatal after the form wait, naming the page's shell and the locator", errT ? errT.message : "no error");
    eS.win.close();
    // (b) the questionnaire URL, but the body holds the model page's shell: fatal naming the page shown.
    const e2 = E.makeEnv({ url: snap.url, html: '<!doctype html><html><body><vai-model-garden-call-to-action-button-stack><vertex-ai-request-access-button><button> Enable </button></vertex-ai-request-access-button></vai-model-garden-call-to-action-button-stack></body></html>' });
    e2.K.TIMEOUTS.FORM_READY = 300; e2.K.URL_POLL_MS = 20;
    errT = null;
    try { await e2.A.handleQuestionnaire(plainCtx(e2)); } catch (x) { errT = x; }
    ok(errT && e2.D.isFatal(errT) && /^the questionnaire URL is open but after 0 s the page body shows the model page's shell and not the questionnaire's \(raf-form RequestAccessFormGroup or cfc-panel-footer\.mg-questionnaire-footer\); the console changed the questionnaire page: see docs\/MAINTENANCE\.md$/.test(errT.message),
      "(T6) the questionnaire URL with the model page's shell in the body: fatal after the wait, naming the page shown and the questionnaire's shell locators", errT ? errT.message : "no error");
    e2.win.close();
    // (c) control: an empty body is a plain timeout (a slow page), retried by the loop.
    const e3 = E.makeEnv({ url: snap.url });
    e3.K.TIMEOUTS.FORM_READY = 300; e3.K.URL_POLL_MS = 20;
    errT = null;
    try { await e3.A.handleQuestionnaire(plainCtx(e3)); } catch (x) { errT = x; }
    ok(errT && errT.name === "TimeoutError" && !e3.D.isFatal(errT), "(T6) control: an empty body is a plain timeout, not fatal", errT ? errT.message : "no error");
    e3.win.close();
  }

  E.finish("questionnaire step");
})();
