/*
 * Selector unit tests against the saved console pages recorded by
 * python/scripts/recon.py (docs/dom-map.md describes them). The dumps are
 * gitignored and found by shape (lib/env.cjs, findRun); every snapshot that
 * is missing is skipped with a message.
 *
 * Run A: clean dry run on a project where the model is not enabled
 *        (01 model page .. 05 terms checkbox ticked).
 * Run B: the "Enable APIs" dialog on the model page, then Agree with the
 *        success dialog (06..08).
 * Runs C/D: an already-enabled model page, and the billing error dialog
 *        after Agree.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

const RUN_A = "A", RUN_B = "B", RUN_C = "C", RUN_D = "D";

function withSnapshot(run, step, fn) {
  const env = E.envFromSnapshot(run, step);
  if (!env) { skip(`run ${run}/${step}`, "no recon dump of that shape under python/recon"); return; }
  console.log(`--- run ${run} (${E.findRun(run)})/${step}`);
  fn(env);
}

const inDialog = (el) => !!(el && el.closest("mat-dialog-container"));

/* ------------------------------------------------------------ blank pages */

(function blankPages() {
  console.log("--- detectPage from URL alone (blank documents)");
  const cases = [
    ["https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=p", "model"],
    ["https://console.cloud.google.com/agent-platform/model-garden/questionnaire?model=x&mp=y&project=p", "questionnaire"],
    ["https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-867.cloudpartnerservices.goog?project=p", "agreements"],
    ["https://console.cloud.google.com/marketplace/agreements/other-vendor/some-product.cloudpartnerservices.goog?project=p", "unknown"],
    ["https://console.cloud.google.com/marketplace/agreements/?project=p", "unknown"],
    ["https://console.cloud.google.com/", "unknown"],
    ["https://console.cloud.google.com/vertex-ai/model-garden?project=p", "unknown"]
  ];
  for (const [url, want] of cases) {
    const env = E.makeEnv({ url });
    ok(env.S.detectPage() === want, `detectPage(${new URL(url).pathname}) = ${want}`, env.S.detectPage());
    ok(env.S.model.enableButton() === null, "  enableButton null on a blank page");
    ok(env.S.model.isAlreadyEnabled() === false, "  isAlreadyEnabled false on a blank page");
    ok(env.S.dialogs.findApiEnableDialog() === null, "  findApiEnableDialog null on a blank page");
    ok(env.S.agreements.termsCheckbox() === null && env.S.agreements.agreeButton() === null, "  agreements locators null on a blank page");
    ok(env.S.agreements.successDialogs().length === 0 && env.S.agreements.failureDialogs().length === 0 && env.S.dialogs.all().length === 0, "  no success, failure or other dialog on a blank page");
    ok(env.S.questionnaire.businessName() === null && env.S.questionnaire.nextButton() === null, "  questionnaire locators null on a blank page");
  }
})();

/* ------------------------------------------------------------ run A */

withSnapshot(RUN_A, "01-model-page", ({ S, D }) => {
  ok(S.detectPage() === "model", "detectPage = model");
  ok(S.model.isAlreadyEnabled() === false, "isAlreadyEnabled false");
  const btn = S.model.enableButton();
  ok(!!btn && btn.tagName === "BUTTON", "enableButton is a <button>", btn && btn.tagName);
  ok(btn && D.text(btn) === "Enable", 'enableButton text is exactly "Enable" after trim', btn && JSON.stringify(btn.textContent));
  ok(btn && !!btn.closest("vertex-ai-request-access-button"), "enableButton is inside vertex-ai-request-access-button");
  ok(btn && !inDialog(btn), "enableButton is not inside a dialog");
  ok(btn && !D.isDisabled(btn), "enableButton is not disabled (mat-mdc-button-disabled-interactive is styling only)");
  ok(S.dialogs.findApiEnableDialog() === null, "no Enable APIs dialog");
  ok(S.agreements.termsCheckbox() === null && S.agreements.agreeButton() === null, "no agreements controls on the model page");
  ok(S.questionnaire.businessName() === null, "no questionnaire input on the model page");
});

withSnapshot(RUN_A, "02-after-enable", ({ S, D, snapshot }) => {
  ok(S.detectPage() === "questionnaire", "detectPage = questionnaire");
  const id = S.questionnaire.identity();
  ok(id.modelSlug === "claude-haiku-4-5" && id.productId === new URL(snapshot.url).searchParams.get("mp"), "questionnaire identity: model slug and mp product id", JSON.stringify(id));
  const q = S.questionnaire;
  const inputs = { businessName: q.businessName(), businessWebsite: q.businessWebsite(), contactEmail: q.contactEmail(), useCases: q.useCases() };
  const rafOf = { businessName: "businessName", businessWebsite: "businessWebsite", contactEmail: "contactEmailAddress", useCases: "intendedUseCasesSelect" };
  for (const [k, el] of Object.entries(inputs)) {
    ok(!!el && el.tagName === "INPUT" && el.type === "text", `${k} is a text <input>`, el && el.tagName);
    ok(el && el.closest("raf-runtime-form-element") && el.closest("raf-runtime-form-element").getAttribute("raf-name") === rafOf[k],
      `${k} sits in raf-name="${rafOf[k]}"`);
    ok(el && el.value === "", `${k} is empty on first render`, el && el.value);
  }
  ok(new Set(Object.values(inputs).map((e) => e && e.id)).size === 4, "the four text inputs are distinct elements");

  const selects = { headquarters: ["businessHeadquarterSelect", q.headquarters()], industry: ["industrySelect", q.industry()], intendedUsers: ["intendedUserSelect", q.intendedUsers()] };
  for (const [k, [raf, el]] of Object.entries(selects)) {
    ok(!!el && el.tagName === "CFC-SELECT", `${k} is a <cfc-select> (not mat-select)`, el && el.tagName);
    ok(el && el.getAttribute("role") === "combobox" && el.getAttribute("aria-expanded") === "false", `${k} is a closed combobox`);
    ok(el && el.closest(`raf-runtime-form-element[raf-name="${raf}"]`) !== null, `${k} sits in raf-name="${raf}"`);
    ok(el && !!D.q(".cfc-select-trigger", el), `${k} has the .cfc-select-trigger to click`);
  }
  ok(D.selectValueText(selects.industry[1]) === "Agriculture", 'industry shows the default "Agriculture"', D.selectValueText(selects.industry[1]));
  ok(D.selectValueText(selects.headquarters[1]) === "", "headquarters shows no value yet", D.selectValueText(selects.headquarters[1]));

  const group = q.aupRadioGroup();
  ok(!!group && group.tagName === "MAT-RADIO-GROUP", "aupRadioGroup is a <mat-radio-group>", group && group.tagName);
  const radios = group ? D.qa("mat-radio-button", group) : [];
  ok(radios.length === 2 && radios.map(D.text).join("/") === "Yes/No", "radio group holds Yes/No", radios.map(D.text).join("/"));
  ok(radios.length === 2 && radios.every((r) => D.q('input[type="radio"]', r)), "each radio has a native input");
  const details = q.aupDetails();
  ok(!!details && details.tagName === "INPUT", "aupDetails input is present on first render", details && details.tagName);
  const next = q.nextButton();
  ok(!!next && D.text(next) === "Next", 'nextButton text is "Next"', next && D.text(next));
  ok(next && !!next.closest("cfc-panel-footer.mg-questionnaire-footer"), "nextButton is inside the questionnaire footer");
  ok(next && next.getAttribute("type") === "button" && !D.isDisabled(next), "nextButton is type=button and enabled");
  ok(S.model.enableButton() === null, "no model-page Enable button on the questionnaire");
  ok(S.dialogs.findApiEnableDialog() === null, "no Enable APIs dialog");
});

withSnapshot(RUN_A, "03-form-filled", ({ S, D, rehydrated }) => {
  ok(S.detectPage() === "questionnaire", "detectPage = questionnaire");
  ok(rehydrated > 0, `input state rehydrated from forms.json (${rehydrated} elements)`);
  const q = S.questionnaire;
  ok(q.aupDetails() === null, 'aupDetails is null once "No" hid it (raf-hidden)');
  const group = q.aupRadioGroup();
  const no = group && D.q('input[type="radio"][value="No"]', group);
  ok(!!no && no.checked === true, '"No" radio input is checked');
  for (const [k, el] of Object.entries({ headquarters: q.headquarters(), industry: q.industry(), intendedUsers: q.intendedUsers() })) {
    ok(el && D.selectValueText(el).length > 0, `${k} shows a selected value`);
    ok(el && el.classList.contains("ng-valid") && el.classList.contains("ng-dirty"), `${k} host is ng-dirty ng-valid`, el && el.className);
  }
  const forms = D.qa("form[raf-name]").map((f) => f.getAttribute("raf-name") + ":" + (f.classList.contains("ng-valid") ? "valid" : "invalid"));
  ok(forms.join(" ") === "RequestAccessFormGroup:valid AdditionalQuestionFormDataFormGroup:valid", "both reactive forms are ng-valid", forms.join(" "));
  ok(q.businessName() && q.businessName().value.length > 0, "businessName holds a value");
});

withSnapshot(RUN_A, "04-agreements", ({ S, D, snapshot }) => {
  ok(S.detectPage() === "agreements", "detectPage = agreements");
  const id = S.agreements.identity();
  ok(id.anthropic === true && /^anthropic\/anthropic-\d+\.cloudpartnerservices\.goog$/.test(id.productId) && id.projectId === new URL(snapshot.url).searchParams.get("project"),
    "agreements identity: anthropic prefix, product id, project", JSON.stringify(id));
  const cb = S.agreements.termsCheckbox();
  ok(!!cb && cb.tagName === "MAT-CHECKBOX", "termsCheckbox is the <mat-checkbox> host", cb && cb.tagName);
  ok(cb && cb.classList.contains("p6ntest-mp-agreements-body-tos-checkbox"), "termsCheckbox carries the p6ntest hook class");
  ok(cb && !!D.q('input[type="checkbox"]', cb), "termsCheckbox has a native input");
  ok(D.isCheckboxChecked(cb) === false, "termsCheckbox is unchecked before the click");
  ok(D.qa("mat-checkbox").length === 1, "it is the only mat-checkbox on the page", D.qa("mat-checkbox").length);
  const agree = S.agreements.agreeButton();
  ok(!!agree && agree.tagName === "BUTTON", "agreeButton is a <button>");
  ok(agree && agree.getAttribute("data-prober") === "cloud-marketplace-request-product", "agreeButton located by data-prober");
  ok(agree && D.text(agree) === "Agree", 'agreeButton text is "Agree"', agree && JSON.stringify(agree.textContent));
  ok(agree && !D.isDisabled(agree), "agreeButton is enabled even before the box is ticked");
  ok(S.agreements.successDialogs().length === 0 && S.agreements.failureDialogs().length === 0, "no result dialog yet");
  ok(S.model.enableButton() === null, "no Enable button on the agreements page");
  ok(S.dialogs.findApiEnableDialog() === null, "no Enable APIs dialog");
  ok(S.questionnaire.nextButton() === null, "no Next button on the agreements page");
});

withSnapshot(RUN_A, "05-agreements-checked", ({ S, D, rehydrated }) => {
  const cb = S.agreements.termsCheckbox();
  ok(rehydrated > 0, `input state rehydrated from forms.json (${rehydrated} elements)`);
  ok(D.isCheckboxChecked(cb) === true, "termsCheckbox is checked after the click (native input.checked)");
  ok(cb && cb.classList.contains("mat-mdc-checkbox-checked"), "host has mat-mdc-checkbox-checked");
  ok(cb && D.q('input[type="checkbox"]', cb).classList.contains("mdc-checkbox--selected"), "input has mdc-checkbox--selected");
  ok(S.agreements.agreeButton() !== null, "agreeButton still present");
  ok(S.agreements.successDialogs().length === 0 && S.agreements.failureDialogs().length === 0, "still no result dialog (Agree was not clicked)");
});

/* ------------------------------------------------------------ run B */

withSnapshot(RUN_B, "01-model-page-api-dialog", ({ S, D }) => {
  ok(S.detectPage() === "model", "detectPage = model with the dialog open");
  const found = S.dialogs.findApiEnableDialog();
  ok(!!found && !!found.dialog && found.dialog.tagName === "MAT-DIALOG-CONTAINER", "findApiEnableDialog returns the mat-dialog-container");
  ok(found && !!D.q("apis-enabler", found.dialog), "dialog hosts <apis-enabler>");
  ok(found && D.text(D.q("h1", found.dialog)) === "Enable APIs", 'dialog title is "Enable APIs"');
  ok(found && !!found.enableButton && D.text(found.enableButton) === "Enable", 'dialog enableButton text is exactly "Enable"', found && found.enableButton && JSON.stringify(found.enableButton.textContent));
  ok(found && found.enableButton && found.enableButton.closest("mat-dialog-container") === found.dialog, "dialog enableButton is inside the dialog");
  ok(found && found.enableButton && !D.isDisabled(found.enableButton), "dialog enableButton is not disabled");
  const page = S.model.enableButton();
  ok(!!page && !inDialog(page), "model.enableButton is NOT inside the dialog");
  ok(page && !!page.closest("vertex-ai-request-access-button"), "model.enableButton is the request-access button");
  ok(found && page !== found.enableButton, "the two Enable buttons are different elements");
  ok(S.model.isAlreadyEnabled() === false, "isAlreadyEnabled false");
});

withSnapshot(RUN_B, "01-model-page-api-dialog-closed", ({ S }) => {
  ok(S.dialogs.findApiEnableDialog() === null, "findApiEnableDialog null after the dialog closed");
  ok(S.model.enableButton() !== null, "model Enable button still present");
});

withSnapshot(RUN_B, "06-after-agree", ({ S, D }) => {
  ok(S.detectPage() === "agreements", "detectPage = agreements");
  ok(D.isCheckboxChecked(S.agreements.termsCheckbox()) === true, "terms box still ticked right after Agree");
  ok(S.agreements.successDialogs().length === 0 && S.agreements.failureDialogs().length === 0, "no result dialog 1 s after Agree");
});

withSnapshot(RUN_B, "07-post-agree-settled", ({ S, D }) => {
  const done = S.agreements.successDialogs();
  ok(done.length === 1 && done[0].dialog.tagName === "MAT-DIALOG-CONTAINER" && !!D.q("mp-consent-complete-dialog", done[0].dialog), "successDialogs: the one mp-consent-complete-dialog container", done.length);
  ok(done.length === 1 && /^Successfully purchased Claude /.test(done[0].title), 'its title reads "Successfully purchased Claude <model>"', done[0] && done[0].title);
  ok(done.length === 1 && S.dialogs.visible().some((d) => d.dialog === done[0].dialog), "the success dialog is among the visible dialogs");
  ok(S.agreements.failureDialogs().length === 0, "no failure dialog on success");
});

withSnapshot(RUN_B, "08-model-page-after", ({ S }) => {
  ok(S.detectPage() === "model", "detectPage = model");
  ok(S.model.isAlreadyEnabled() === false && S.model.enableButton() !== null, "30 s after Agree the model page still shows Enable (propagation lag)");
});

/* ------------------------------------------------------------ optional runs */

withSnapshot(RUN_C, "01-model-page", ({ S, D }) => {
  ok(S.detectPage() === "model", "detectPage = model");
  ok(S.model.isAlreadyEnabled() === true, "isAlreadyEnabled true: Open in Agent Studio");
  ok(S.model.enableButton() === null, "enableButton null on an enabled model");
  ok(!!D.q("vertex-ai-open-generation-ai-studio-button a"), "the Agent Studio link is an <a>");
});

withSnapshot(RUN_D, "07-post-agree-settled", ({ S }) => {
  const fails = S.agreements.failureDialogs();
  const f = fails[0];
  ok(fails.length === 1 && f.dialog.tagName === "MAT-DIALOG-CONTAINER", "failureDialogs returns the one error dialog", fails.length);
  ok(f && f.title === "Action Required: Choose Different Billing Account", "failure dialog title", f && f.title);
  ok(f && /free trial/.test(f.text) && /different billing account/.test(f.text), "failure dialog text carries the console's billing-account refusal", f && f.text);
  ok(S.agreements.successDialogs().length === 0, "no success dialog on the error dialog");
  ok(S.dialogs.visible().length === 1 && S.dialogs.visible()[0].title === f.title, "dialogs.visible() lists it with the same title");
});

/* ------------------------------------------------------------ (T6) second locators and the DOM-side page detector */

withSnapshot(RUN_A, "01-model-page", ({ S, D, document: doc }) => {
  console.log("--- (T6) model page: the Enable button's second locator, no page-wide text fallback, the DOM-side page detector");
  ok(S.detectPageByDom() === "model" && S.model.hasShell() && !S.questionnaire.hasShell() && !S.agreements.hasShell(), "detectPageByDom = model: the call-to-action stack is the shell; no questionnaire or agreements shell on this page");
  const wrapper = D.q("vertex-ai-request-access-button");
  const renamed = doc.createElement("vertex-ai-renamed-wrapper");
  while (wrapper.firstChild) renamed.appendChild(wrapper.firstChild);
  wrapper.replaceWith(renamed);
  const btn = S.model.enableButton();
  ok(!!btn && D.text(btn) === "Enable" && !!btn.closest("vai-model-garden-call-to-action-button-stack") && !D.q("vertex-ai-request-access-button"), "with the wrapper tag renamed, Enable is found by the second locator: the button reading Enable inside the call-to-action stack");
  doc.body.insertAdjacentHTML("beforeend", '<div class="banner"><button> Enable </button></div>');
  ok(S.model.enableButton() === btn, "a stray Enable button elsewhere on the page is never the one while the stack's is there");
  const stack = D.q("vai-model-garden-call-to-action-button-stack");
  const renamedStack = doc.createElement("vai-renamed-stack");
  while (stack.firstChild) renamedStack.appendChild(stack.firstChild);
  stack.replaceWith(renamedStack);
  ok(S.model.enableButton() === null && S.model.hasShell() === false && S.detectPageByDom() === "unknown", "with the stack renamed too: null (the banner's Enable is never clicked, T7), no shell, page unknown by DOM");
});

withSnapshot(RUN_A, "02-after-enable", ({ S, D, document: doc }) => {
  console.log("--- (T6) questionnaire: Next scoped to the footer, no page-wide text fallback, the DOM-side page detector");
  ok(S.detectPageByDom() === "questionnaire" && S.questionnaire.hasShell() && !S.model.hasShell() && !S.agreements.hasShell(), "detectPageByDom = questionnaire: raf-form RequestAccessFormGroup / the footer are the shell");
  const next = S.questionnaire.nextButton();
  D.q("cfc-panel-footer.mg-questionnaire-footer").classList.remove("mg-questionnaire-footer");
  ok(S.questionnaire.nextButton() === next, "with the footer tag's class gone, Next is still found through the inner .mg-questionnaire-footer element");
  for (const el of D.qa(".mg-questionnaire-footer")) el.classList.remove("mg-questionnaire-footer");
  doc.body.insertAdjacentHTML("beforeend", '<div class="onboarding-popover"><button> Next </button></div>');
  ok(S.questionnaire.nextButton() === null, "with every footer class gone, Next is null although a popover offers a Next (T7: no page-wide text fallback)");
  ok(S.questionnaire.hasShell() === true, "the questionnaire shell is still detected through raf-form");
  D.q('raf-form[raf-entry-name="RequestAccessFormGroup"]').setAttribute("raf-entry-name", "RenamedGroup");
  ok(S.questionnaire.hasShell() === false && S.detectPageByDom() === "unknown", "with the raf-form entry renamed too: no shell, page unknown by DOM");
});

withSnapshot(RUN_A, "04-agreements", ({ S, D, document: doc }) => {
  console.log("--- (T6) agreements: the terms checkbox's three locators, the Agree button's two, the DOM-side page detector");
  ok(S.detectPageByDom() === "agreements" && S.agreements.hasShell() && !S.model.hasShell() && !S.questionnaire.hasShell(), "detectPageByDom = agreements: billing-integrated-ai-agreements-body / mp-agreements-tos are the shell (the footer class in a stylesheet is not an element)");
  const cb = S.agreements.termsCheckbox();
  cb.classList.remove("p6ntest-mp-agreements-body-tos-checkbox");
  ok(S.agreements.termsCheckbox() === cb, "with Google's test hook class gone, the checkbox is found through mp-agreements-tos (second locator)");
  const tos = D.q("mp-agreements-tos");
  const tosRenamed = doc.createElement("mp-renamed-tos");
  while (tos.firstChild) tosRenamed.appendChild(tos.firstChild);
  tos.replaceWith(tosRenamed);
  ok(S.agreements.termsCheckbox() === cb, "with mp-agreements-tos renamed too, the checkbox is the only mat-checkbox inside billing-integrated-ai-agreements-body (third locator)");
  D.q("billing-integrated-ai-agreements-body").insertAdjacentHTML("beforeend", '<mat-checkbox class="newsletter"><label><input type="checkbox"> Email me offers</label></mat-checkbox>');
  ok(S.agreements.termsCheckbox() === null, "a second mat-checkbox in the body makes the third locator refuse (null): the handler then halts naming the locators instead of ticking a guess");
  doc.querySelector("mat-checkbox.newsletter").remove();
  ok(S.agreements.termsCheckbox() === cb, "control: with the second box gone the third locator finds it again");
  const agree = S.agreements.agreeButton();
  agree.removeAttribute("data-prober");
  ok(S.agreements.agreeButton() === agree && S.agreements.hasAgreeButton() === true, "with data-prober gone, Agree is found by its aria-label (second locator)");
  agree.removeAttribute("aria-label");
  ok(S.agreements.agreeButton() === null && S.agreements.hasAgreeButton() === false, "with both hooks gone, Agree is null: no text-based locator exists for the one button that purchases");
  ok(S.agreements.hasShell() === true, "the agreements shell is still detected through the body component");
});

withSnapshot(RUN_B, "01-model-page-api-dialog", ({ S, document: doc }) => {
  console.log('--- (T6) dialogs: the Material container counts, a non-modal role="dialog" does not, an aria-modal="true" one does and is named');
  const vis = S.dialogs.visible();
  ok(vis.length === 1 && vis[0].element === "mat-dialog-container" && vis[0].title === "Enable APIs", 'the real "Enable APIs" dialog is visible and named mat-dialog-container', JSON.stringify(vis.map((v) => [v.element, v.title])));
  doc.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="false" id="drawer"><h2>What is new</h2></div><cfc-side-panel role="dialog" id="help"><h2>Help</h2></cfc-side-panel>');
  ok(S.dialogs.visible().length === 1 && S.dialogs.all().length === 1, 'a non-modal role="dialog" div and a side panel without aria-modal are not dialogs: visible() and all() still list the one container');
  doc.body.insertAdjacentHTML("beforeend", '<div role="dialog" aria-modal="true" id="survey"><h2>Survey</h2></div>');
  const now = S.dialogs.visible();
  ok(now.length === 2 && now[1].element === 'div[role="dialog"]' && now[1].title === "Survey", 'an aria-modal="true" role="dialog" element is a dialog, named div[role="dialog"]', JSON.stringify(now.map((v) => v.element)));
});

(function blankDetector() {
  const env = E.makeEnv({ url: "https://console.cloud.google.com/" });
  ok(env.S.detectPageByDom() === "unknown" && !env.S.model.hasShell() && !env.S.questionnaire.hasShell() && !env.S.agreements.hasShell(), "detectPageByDom = unknown on a blank page (no shell at all)");
  env.document.body.innerHTML = '<billing-integrated-ai-agreements-body></billing-integrated-ai-agreements-body><raf-form raf-entry-name="RequestAccessFormGroup"></raf-form>';
  ok(env.S.detectPageByDom() === "unknown" && env.S.agreements.hasShell() && env.S.questionnaire.hasShell(), "two shells at once (a route change's leftovers) are unknown, never a page to act on");
  env.win.close();
})();

/* ------------------------------------------------------------ dom.js on synthetic markup */

(function domHelpers() {
  console.log("--- dom.js helpers on synthetic markup (shapes from docs/dom-map.md)");
  const env = E.makeEnv({ url: "https://console.cloud.google.com/agent-platform/model-garden/questionnaire?project=p" });
  const { D, document: doc, win } = env;

  const option = (label) => `<mat-option role="option" class="mat-mdc-option"><span class="mdc-list-item__primary-text"><cfc-select-rich-option>` +
    `<div class="cfc-select-option-col"><div class="cfc-select-option-row"><span class="cfc-select-option-primary">${label}</span>` +
    `<span class="cfc-select-option-collapsed" style="display: none;">${label}</span></div></div></cfc-select-rich-option></span></mat-option>`;
  doc.body.innerHTML = `
    <mat-form-field><label><mat-label><span><span>Industry</span></span></mat-label></label>
      <cfc-select role="combobox" aria-expanded="false"><div class="cfc-select-trigger"><div class="cfc-select-value"><span class="cfc-select-placeholder">&nbsp;</span></div></div></cfc-select>
    </mat-form-field>
    <mat-form-field><label><mat-label><span><span>Business name</span></span></mat-label></label><input matinput type="text"></mat-form-field>
    <mat-radio-group role="radiogroup">
      <mat-radio-button><label><input type="radio" name="g" value="Yes"><span>Yes</span></label></mat-radio-button>
      <mat-radio-button><label><input type="radio" name="g" value="No"><span>No</span></label></mat-radio-button>
    </mat-radio-group>
    <mat-checkbox><label><input type="checkbox"><span>terms</span></label></mat-checkbox>
    <button id="agree">Agree</button><button id="enable"> Enable </button>
    <div class="cdk-overlay-container"></div>`;

  // option text: the hidden collapsed copy doubles textContent
  const panel = doc.createElement("div");
  panel.innerHTML = option("Canada");
  const opt = panel.querySelector("mat-option");
  ok(D.text(opt) === "CanadaCanada", "textContent of a cfc option is doubled", D.text(opt));
  ok(D.optionText(opt) === "Canada", "D.optionText reads the primary span only", D.optionText(opt));
  // setInputValue: native setter + input/change/blur events
  const input = doc.querySelector("mat-form-field input[matinput]");
  const seen = [];
  for (const t of ["input", "change", "blur"]) input.addEventListener(t, () => seen.push(t));
  D.setInputValue(input, "https://example.test/path");
  ok(input.value === "https://example.test/path", "setInputValue sets the value", input.value);
  // el.blur() fires its own blur when the element was focused; the explicit
  // blur event from the dom-map sequence follows it, so blur may appear twice.
  ok(seen.slice(0, 3).join(",") === "input,change,blur" && seen.every((t, i) => i < 2 || t === "blur"),
    "setInputValue dispatches input, change, then blur", seen.join(","));

  // click guard
  let threw = null;
  try { D.click(doc.getElementById("agree")); } catch (e) { threw = e.name; }
  ok(threw === "ForbiddenClickError", 'D.click refuses a button reading "Agree"', threw);
  let enableClicks = 0;
  doc.getElementById("enable").addEventListener("click", () => { enableClicks += 1; });
  D.click(doc.getElementById("enable"));
  ok(enableClicks === 1, 'D.click clicks a button reading "Enable" once');

  // radio
  D.chooseMatRadio(doc.querySelector("mat-radio-group"), "No");
  ok(doc.querySelector('input[value="No"]').checked === true && doc.querySelector('input[value="Yes"]').checked === false, "chooseMatRadio checks the No radio");

  // checkbox
  const cb = doc.querySelector("mat-checkbox");
  ok(D.isCheckboxChecked(cb) === false, "checkbox starts unchecked");

  // selectOption: the trigger click renders the panel in the overlay container, the option click closes it
  const host = doc.querySelector("cfc-select");
  const overlay = doc.querySelector(".cdk-overlay-container");
  host.querySelector(".cfc-select-trigger").addEventListener("click", () => {
    host.setAttribute("aria-expanded", "true");
    overlay.innerHTML = `<div class="cdk-overlay-pane"><div class="cfc-select-panel"><div class="cfc-select-body" role="listbox">${["Agriculture", "Education", "Energy"].map(option).join("")}</div></div></div>`;
    for (const o of overlay.querySelectorAll("mat-option")) {
      o.addEventListener("click", () => {
        host.querySelector(".cfc-select-value").innerHTML = `<span class="cfc-select-value-text"><span> ${D.optionText(o)} </span></span>`;
        host.setAttribute("aria-expanded", "false");
        overlay.innerHTML = "";
      });
    }
  });
  (async () => {
    await D.setCheckbox(cb, true);
    ok(D.isCheckboxChecked(cb) === true, "setCheckbox ticks the native input");
    await D.selectOption(host, "Education");
    ok(D.selectValueText(host) === "Education", "selectOption picked Education by exact visible text", D.selectValueText(host));
    ok(overlay.children.length === 0 && host.getAttribute("aria-expanded") === "false", "panel closed after the pick");
    let err = null;
    try { await D.selectOption(host, "Educ"); } catch (e) { err = e.message; }
    ok(/no option matching "Educ"/.test(err || ""), "selectOption refuses a partial match (exact only)", err);
    win.close();
    E.finish("selectors");
  })();
})();
