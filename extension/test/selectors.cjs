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
  console.log("--- (T6) agreements: the terms checkbox's two locators, the Agree button's two, the DOM-side page detector");
  ok(S.detectPageByDom() === "agreements" && S.agreements.hasShell() && !S.model.hasShell() && !S.questionnaire.hasShell(), "detectPageByDom = agreements: billing-integrated-ai-agreements-body / mp-agreements-tos are the shell (the footer class in a stylesheet is not an element)");
  const cb = S.agreements.termsCheckbox();
  cb.classList.remove("p6ntest-mp-agreements-body-tos-checkbox");
  ok(S.agreements.termsCheckbox() === cb, "with Google's test hook class gone, the checkbox is found through mp-agreements-tos (second locator)");
  const tos = D.q("mp-agreements-tos");
  const tosRenamed = doc.createElement("mp-renamed-tos");
  while (tos.firstChild) tosRenamed.appendChild(tos.firstChild);
  tos.replaceWith(tosRenamed);
  ok(S.agreements.termsCheckbox() === null, "with mp-agreements-tos renamed too, no locator matches (no positional fallback): null, so the handler halts naming the two locators and nothing is ticked");
  ok(D.qa("mat-checkbox", D.q("billing-integrated-ai-agreements-body")).length === 1, "control: the box is still the only mat-checkbox in the body, and it is not taken by position");
  cb.classList.add("p6ntest-mp-agreements-body-tos-checkbox");
  ok(S.agreements.termsCheckbox() === cb, "control: with the test hook class back it is found again");
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

/* ------------------------------------------------------------ (0.8.0) blockers */

(function blockersSynthetic() {
  console.log("--- (0.8.0) blockers: permission wording inside error, alert, snackbar or dialog elements only");
  const MODEL = "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one";
  const page = (inner) => `<!doctype html><html><head></head><body><nav><a>IAM &amp; Admin</a><a>Permissions</a></nav><div role="main"><p>Grant access with IAM. A 403 is a permission error; contact your administrator if you do not have access.</p>${inner || ""}</div></body></html>`;
  const positives = [
    ["a snackbar: \"You do not have permission ...\"", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>You do not have permission to enable models in this project.</simple-snack-bar></mat-snack-bar-container></div>', /^You do not have permission to enable models in this project\.$/],
    ["an alert banner: \"Permission denied ... requires the ... role\"", '<div role="alert" class="banner">Permission denied: this action requires the Vertex AI Administrator (roles/aiplatform.admin) role.</div>', /Permission denied: this action requires the Vertex AI Administrator/],
    ["a modal dialog: \"403 ... contact your administrator\"", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Error 403</h1><div matdialogcontent>That is all we know. Contact your administrator.</div></mat-dialog-container></div>', /403/],
    ["an error cfc-message: \"You don't have access ... IAM\"", '<cfc-message type="error"><div class="cfc-message cfc-message-error">You don\'t have access to project proj-one. Ask an owner for an IAM role.</div></cfc-message>', /You don't have access to project proj-one/],
    ["an error page component in the main content", '<div class="pcc-error-page">Sorry, you lack the required permissions to view this page.</div>', /required permissions/],
    ["a snackbar with the API status PERMISSION_DENIED", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>Request failed: PERMISSION_DENIED</simple-snack-bar></mat-snack-bar-container></div>', /PERMISSION_DENIED/],
    ["a form error: \"Error 403: Forbidden\"", '<mat-form-field><mat-error>Error 403: Forbidden</mat-error></mat-form-field>', /Forbidden/],
    ["a dialog: \"You need additional access\"", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Cannot continue</h1><div matdialogcontent>You need additional access to use this model.</div></mat-dialog-container></div>', /need additional access/],
    ["a snackbar: \"You don't have sufficient permissions ...\"", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>You don\'t have sufficient permissions to view this page.</simple-snack-bar></mat-snack-bar-container></div>', /sufficient permissions/],
    ["an alert: \"You do not have the required permissions ...\"", '<div role="alert">You do not have the required permissions to enable this model.</div>', /required permissions/],
    ["a dialog: \"You are missing at least one of the following required permissions ...\"", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Cannot enable</h1><div matdialogcontent>You are missing at least one of the following required permissions: aiplatform.models.get</div></mat-dialog-container></div>', /missing at least one of the following required permissions/],
    ["a snackbar: \"Required 'serviceusage.services.enable' permission for 'projects/x'\"", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>Required \'serviceusage.services.enable\' permission for \'projects/x\'</simple-snack-bar></mat-snack-bar-container></div>', /serviceusage\.services\.enable/],
    ["an alert: \"Permission error: ...\"", '<div role="alert">Permission error: the request was refused.</div>', /Permission error/],
    ["an error banner: \"requires the ... role\" (weak wording counts in an error banner)", '<cfc-message type="error"><div class="cfc-message cfc-message-error">This action requires the Vertex AI User role.</div></cfc-message>', /requires the Vertex AI User role/]
  ];
  for (const [label, html, re] of positives) {
    const env = E.makeEnv({ html: page(html), url: MODEL });
    const p = env.S.blockers.permission();
    ok(!!p && re.test(p.excerpt) && env.S.blockers.consent() === null, `permission() matches ${label}`, JSON.stringify(p));
    const r = env.A.blockerResult();
    ok(r && r.status === "failed" && r.message === `missing permission: ${p.excerpt}`, `  -> result failed, reason "missing permission: <excerpt>"`, r && r.message);
    env.win.close();
  }
  const negatives = [
    ["ordinary page text with every phrase (nav IAM & Admin, a paragraph naming permission, 403, administrator)", ""],
    ["a hidden alert", '<div role="alert" style="display: none;">Permission denied</div>'],
    ["an info cfc-message (not error/warning)", '<cfc-message type="info"><div class="cfc-message">Permissions are managed in IAM.</div></cfc-message>'],
    ["the \"Enable APIs\" dialog", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page. Requires permission serviceusage.services.enable.</div></apis-enabler></mat-dialog-container></div>'],
    ["a warning banner: \"Request more under IAM & Admin > Quotas\"", '<cfc-message type="warning"><div class="cfc-message cfc-message-warning">You are close to your quota. Request more under IAM &amp; Admin &gt; Quotas.</div></cfc-message>'],
    ["a warning banner naming a product \"anthropic-403\"", '<cfc-message type="warning"><div class="cfc-message cfc-message-warning">The listing anthropic-403.cloudpartnerservices.goog has a new version.</div></cfc-message>'],
    ["a warning banner that mentions permissions without denying anything", '<cfc-message type="warning"><div class="cfc-message cfc-message-warning">Permissions for this model are managed in IAM.</div></cfc-message>'],
    ["an alert: \"If you need access to Claude in more regions ...\"", '<div role="alert">If you need access to Claude in more regions, request a quota increase.</div>'],
    ["a dialog: \"forbidden content ...\"", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Usage policy</h1><div matdialogcontent>Prompts must not include forbidden content such as malware.</div></mat-dialog-container></div>'],
    ["an alert: \"forbidden by your organization policy\"", '<div role="alert">Exporting logs is forbidden by your organization policy.</div>'],
    ["a \"Manage permissions\" dialog", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Manage permissions</h1><div matdialogcontent>Choose who can use this model.</div><button>Close</button></mat-dialog-container></div>'],
    ["a snackbar: \"Permission name copied\"", '<div class="cdk-overlay-container"><mat-snack-bar-container><simple-snack-bar>Permission name copied</simple-snack-bar></mat-snack-bar-container></div>'],
    ["an alert tip: \"requires the Vertex AI User role\"", '<div role="alert">Tip: calling this model from code requires the Vertex AI User role.</div>'],
    ["a form error: \"not allowed to\" validation text", '<mat-form-field><mat-error>Project IDs are not allowed to start with a digit.</mat-error></mat-form-field>'],
    ["the console's refusal dialog after Agree", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog" aria-label="Error dialog"><behavior-failure-dialog><h1 matdialogtitle>Action Required</h1><div matdialogcontent>Denied: choose a different billing account.</div></behavior-failure-dialog></mat-dialog-container></div>']
  ];
  for (const [label, html] of negatives) {
    const env = E.makeEnv({ html: page(html), url: MODEL });
    ok(env.S.blockers.permission() === null && env.A.blockerResult() === null, `no match: ${label}`, JSON.stringify(env.S.blockers.permission()));
    env.win.close();
  }

  console.log("--- (0.8.0) blockers: extra consent controls (dialog or banner), never the flow's own dialogs or the terms box");
  const consentPos = [
    ["a banner holding a checkbox (the Fable 5.1 shape)", '<div class="addendum-banner-container"><cfc-message type="warning"><div class="addendum-intro">To enable this model you must accept the Extra Addendum for this project.</div><mat-checkbox><label><input type="checkbox"> By checking this box, you agree</label></mat-checkbox><button> Accept Terms </button></cfc-message></div>', /^div\.addendum-banner-container$/, /Extra Addendum/],
    ["a dialog with consent wording and a checkbox", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Before you continue</h1><mat-checkbox><label><input type="checkbox"> I accept the model addendum</label></mat-checkbox><button>Continue</button></mat-dialog-container></div>', /^mat-dialog-container$/, /I accept the model addendum/],
    ["a banner with consent wording and only an \"Accept Terms\" button (no checkbox)", '<cfc-message type="warning"><div class="cfc-message">You must accept the model addendum for this project.</div><button> Accept Terms </button></cfc-message>', /^cfc-message$/, /addendum/],
    ["a dialog checkbox whose consent wording is in its aria-label only", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>One more step</h1><mat-checkbox><label><input type="checkbox" aria-label="I agree to the model addendum"></label></mat-checkbox><button>Continue</button></mat-dialog-container></div>', /^mat-dialog-container$/, /model addendum/],
    ["a dialog checkbox whose consent wording is in the element its aria-labelledby names", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>One more step</h1><span id="lbl-x">I agree to the extra terms of service</span><mat-checkbox><label><input type="checkbox" aria-labelledby="lbl-x"></label></mat-checkbox></mat-dialog-container></div>', /^mat-dialog-container$/, /terms of service/],
    ["a banner with any visible checkbox, no wording needed (\"Don't show this again\")", '<cfc-message type="info"><div class="cfc-message">New models are available in Model Garden.</div><mat-checkbox><label><input type="checkbox"> Don\'t show this again</label></mat-checkbox></cfc-message>', /^cfc-message$/, /New models are available/],
    ["any other visible checkbox on a flow page (the model page), whatever its label", '<mat-checkbox><label><input type="checkbox"> Show deprecated models</label></mat-checkbox>', /^checkbox on the model page$/, /Show deprecated models/],
    ["a hooked terms-looking box inside a status region (not the terms box: it sits in a banner)", '<billing-integrated-ai-agreements-body><div role="status"><mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox"><label><input type="checkbox"> I agree to the terms</label></mat-checkbox></div></billing-integrated-ai-agreements-body>', /^div$/, /I agree to the terms/],
    ["a cfc-message whose accept button carries an icon ligature (mat-icon text \"check\" is left out)", '<cfc-message type="warning"><div class="cfc-message">Review the model terms.</div><button><mat-icon>check</mat-icon> Accept </button></cfc-message>', /^cfc-message$/, /Review the model terms/],
    ["a banner whose first checkbox is hidden and whose second, visible one carries the consent wording", '<cfc-message type="warning"><div class="cfc-message">Before using this model, review the addendum.</div><mat-checkbox style="display: none;"><label><input type="checkbox"> Remember me</label></mat-checkbox><mat-checkbox><label><input type="checkbox"> I agree to the addendum</label></mat-checkbox></cfc-message>', /^cfc-message$/, /addendum/]
  ];
  for (const [label, html, where, text] of consentPos) {
    const env = E.makeEnv({ html: page(html), url: MODEL });
    const c = env.S.blockers.consent();
    ok(!!c && where.test(c.where) && text.test(c.excerpt), `consent() matches ${label}`, JSON.stringify(c));
    const r = env.A.blockerResult();
    ok(r && r.status === "failed" && /^extra consent required, not supported \(/.test(r.message) && r.message.includes(c.excerpt) && (!c.title || r.message.includes(`"${c.title}"`)), "  -> result failed, reason names the element, the title if any and the text excerpt", r && r.message);
    env.win.close();
  }
  const consentNeg = [
    ["the \"Enable APIs\" dialog", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>Enable it to agree to nothing.</div><mat-checkbox><label><input type="checkbox"> x</label></mat-checkbox></apis-enabler></mat-dialog-container></div>'],
    ["the purchase confirmation (mp-consent-complete-dialog)", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><mp-consent-complete-dialog><h1 matdialogtitle>Successfully purchased Claude Haiku 4.5</h1><p>You agree to the terms of service.</p></mp-consent-complete-dialog></mat-dialog-container></div>'],
    ["a banner without a checkbox", '<cfc-message type="warning"><div class="cfc-message">You must accept the addendum.</div></cfc-message>'],
    ["a modal dialog with consent wording and an \"I agree\" button but no checkbox (an accept button alone counts only in a cfc-message or addendum banner)", '<div role="dialog" aria-modal="true"><h2>Terms</h2><p>Accept the terms of service to continue.</p><button>I agree</button></div>'],
    ["a dialog with consent wording and an accept button with an icon, no checkbox", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Model terms</h1><div matdialogcontent>Accept the terms of service for this model.</div><button><mat-icon>check</mat-icon> Accept </button></mat-dialog-container></div>'],
    ["a role=\"status\" cookie-style notice with \"Accept all\"", '<div role="status" class="cookie-notice">We use cookies to improve this site. <button>Accept all</button><button>Manage</button></div>'],
    ["a \"What's new\" dialog with a \"Don't show this again\" checkbox (no consent wording)", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>What\'s new</h1><div matdialogcontent>Agent Platform now lists more models.</div><mat-checkbox><label><input type="checkbox"> Don\'t show this again</label></mat-checkbox><button>Close</button></mat-dialog-container></div>'],
    ["a feedback dialog whose footer says \"you agree to Google's terms\" (Send and Cancel, no checkbox, no accepting button)", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Send feedback</h1><textarea></textarea><p>By sending feedback, you agree to Google\'s terms of service and privacy policy.</p><button>Cancel</button><button>Send</button></mat-dialog-container></div>'],
    ["a feedback dialog with an \"Include screenshot\" checkbox and a terms footer (Send and Cancel)", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Send feedback</h1><textarea></textarea><mat-checkbox><label><input type="checkbox"> Include screenshot</label></mat-checkbox><p>By sending feedback, you agree to Google\'s terms of service.</p><button>Cancel</button><button>Send</button></mat-dialog-container></div>']
  ];
  {
    // Consent is checked before permission: an addendum banner that names the required permissions is reported as consent.
    const env = E.makeEnv({ html: page('<div class="addendum-banner-container"><cfc-message type="warning"><div class="addendum-intro">To enable this model you must accept the Advanced AI Safety Addendum; the required permissions are missing until it is accepted.</div><mat-checkbox><label><input type="checkbox"> By checking this box, you agree to the addendum</label></mat-checkbox></cfc-message></div>'), url: MODEL });
    const r = env.A.blockerResult();
    ok(r && /^extra consent required, not supported \(div\.addendum-banner-container\)/.test(r.message) && !!env.S.blockers.permission(), "an addendum banner that also names the required permissions is reported as extra consent (consent is checked first)", r && r.message);
    env.win.close();
  }
  // A warning banner with real denial wording still counts.
  {
    const env = E.makeEnv({ html: page('<cfc-message type="warning"><div class="cfc-message cfc-message-warning">You don\'t have permission to view quotas in this project.</div></cfc-message>'), url: MODEL });
    const p = env.S.blockers.permission();
    ok(!!p && /You don't have permission to view quotas/.test(p.excerpt), "a warning banner with denial wording (\"You don't have permission\") still counts", JSON.stringify(p));
    env.win.close();
  }
  for (const [label, html] of consentNeg) {
    const env = E.makeEnv({ html: page(html), url: MODEL });
    ok(env.S.blockers.consent() === null && env.A.blockerResult() === null, `no consent match and no blocker: ${label}`, JSON.stringify(env.A.blockerResult()));
    env.win.close();
  }
})();


(function termsInvariantAndPageRule() {
  console.log("--- (0.8.0) the terms box: its two hooks must resolve to exactly one mat-checkbox, outside any banner or dialog");
  const AGR = "https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-867.cloudpartnerservices.goog?project=proj-one";
  const terms = (cls, tos, text) => `<mat-checkbox class="${cls}"><label><input type="checkbox">${tos ? "<mp-agreements-tos>" : ""}<span>${text}</span>${tos ? "</mp-agreements-tos>" : ""}</label></mat-checkbox>`;
  const cases = [
    ["the hook class and the label component on the same box", `<billing-integrated-ai-agreements-body>${terms("p6ntest-mp-agreements-body-tos-checkbox", true, "Terms")}</billing-integrated-ai-agreements-body>`, 1],
    ["the hook class on one box, the label component on another", `<billing-integrated-ai-agreements-body>${terms("p6ntest-mp-agreements-body-tos-checkbox", false, "Terms")}${terms("other", true, "Other")}</billing-integrated-ai-agreements-body>`, 0],
    ["two boxes with the hook class", `<billing-integrated-ai-agreements-body>${terms("p6ntest-mp-agreements-body-tos-checkbox", false, "A")}${terms("p6ntest-mp-agreements-body-tos-checkbox", false, "B")}</billing-integrated-ai-agreements-body>`, 0],
    ["the one hooked box inside a cfc-message banner", `<billing-integrated-ai-agreements-body><cfc-message type="warning">${terms("p6ntest-mp-agreements-body-tos-checkbox", true, "Terms")}</cfc-message></billing-integrated-ai-agreements-body>`, 0],
    ["the one hooked box inside a dialog", `<div class="cdk-overlay-container"><mat-dialog-container role="dialog">${terms("p6ntest-mp-agreements-body-tos-checkbox", true, "Terms")}</mat-dialog-container></div>`, 0]
  ];
  for (const [label, body, expect] of cases) {
    const env = E.makeEnv({ html: `<!doctype html><html><head></head><body>${body}</body></html>`, url: AGR });
    const box = env.S.agreements.termsCheckbox();
    ok(expect ? !!box : box === null, `${label}: ${expect ? "found" : "null (the job ends without ticking anything)"}`);
    env.win.close();
  }

  console.log("--- (0.8.0) any other visible checkbox on a flow page is an extra consent control; the questionnaire's own form is the flow's");
  const Q = "https://console.cloud.google.com/agent-platform/model-garden/questionnaire?project=proj-one&model=publishers/anthropic/models/claude-haiku-4-5";
  const box = '<mat-checkbox><label><input type="checkbox"> Send me product updates</label></mat-checkbox>';
  let env = E.makeEnv({ html: `<!doctype html><html><head></head><body><raf-form raf-entry-name="RequestAccessFormGroup">${box}</raf-form></body></html>`, url: Q });
  ok(env.A.blockerResult() === null, "a checkbox inside the questionnaire form: not a blocker");
  env.win.close();
  env = E.makeEnv({ html: `<!doctype html><html><head></head><body><raf-form raf-entry-name="RequestAccessFormGroup"></raf-form>${box}</body></html>`, url: Q });
  const r = env.A.blockerResult();
  ok(r && /^extra consent required, not supported \(checkbox on the questionnaire page\): Send me product updates/.test(r.message), "a checkbox outside the questionnaire form: a blocker naming its label", r && r.message);
  env.win.close();
  env = E.makeEnv({ html: `<!doctype html><html><head></head><body>${box}</body></html>`, url: "https://console.cloud.google.com/agent-platform/model-garden?project=proj-one" });
  ok(env.A.blockerResult() === null, "control: a checkbox on a page outside the flow (the gallery) is not judged by the page rule");
  env.win.close();
  env = E.makeEnv({ html: `<!doctype html><html><head></head><body><billing-integrated-ai-agreements-body>${terms("p6ntest-mp-agreements-body-tos-checkbox", true, "I agree to the Terms")}${box}</billing-integrated-ai-agreements-body></body></html>`, url: AGR });
  const r2 = env.A.blockerResult();
  ok(r2 && /\(checkbox on the agreements page\): Send me product updates/.test(r2.message) && env.S.agreements.termsCheckbox() !== null, "the Agreements page: the terms box is the flow's, a second box is a blocker", r2 && r2.message);
  env.win.close();
})();

(function nestedRoleAndOverlay() {
  console.log("--- (0.8.0) a box nested in the terms label is not the terms box; role=\"checkbox\" counts, role=\"switch\" does not; overlay panes are judged except the questionnaire's select panel");
  const AGR = "https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-867.cloudpartnerservices.goog?project=proj-one";
  const MODEL = "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one";
  const Q = "https://console.cloud.google.com/agent-platform/model-garden/questionnaire?project=proj-one&model=publishers/anthropic/models/claude-haiku-4-5";
  // The nested box comes first in document order inside the terms label.
  const nested = '<billing-integrated-ai-agreements-body><mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox" id="terms"><label><mat-checkbox id="inner"><label><input type="checkbox" id="inner-input"> Also subscribe</label></mat-checkbox><input type="checkbox" id="terms-input"><mp-agreements-tos>I agree to the Terms</mp-agreements-tos></label></mat-checkbox></billing-integrated-ai-agreements-body>';
  let env = E.makeEnv({ html: `<!doctype html><html><head></head><body>${nested}</body></html>`, url: AGR });
  const terms = env.S.agreements.termsCheckbox();
  const host = env.document.getElementById("terms");
  ok(terms === null && env.D.ownCheckboxInput(host) === null, "a terms host holding more than one checkbox-like element (a nested box in its label) is ambiguous: termsCheckbox() and its own input are null", terms && terms.id);
  env.document.getElementById("terms-input").checked = true;
  ok(env.D.isCheckboxChecked(host) === false, "an ambiguous host never reads as checked (no class or aria fallback)");
  ok(env.D.checkboxControls(host).length === 3, "control: the host holds three checkbox-like elements (the nested host, its input, the terms input), which setCheckbox refuses to click");
  const r = env.A.blockerResult();
  ok(r && /^extra consent required, not supported \(terms checkbox\): the terms checkbox holds 3 checkbox controls;/.test(r.message), "the blocker names the ambiguous terms box: \"the terms checkbox holds 3 checkbox controls\"", r && r.message);
  env.win.close();
  env = E.makeEnv({ html: '<!doctype html><html><head></head><body><div role="checkbox" aria-checked="false" aria-label="Share usage data with the publisher" tabindex="0"></div></body></html>', url: MODEL });
  const r2 = env.A.blockerResult();
  ok(r2 && /\(checkbox on the model page\): Share usage data with the publisher/.test(r2.message), "a role=\"checkbox\" element on the model page is an extra checkbox, named by its aria-label", r2 && r2.message);
  env.win.close();
  env = E.makeEnv({ html: '<!doctype html><html><head></head><body><mat-slide-toggle><button role="switch" aria-checked="false" disabled>Show deprecated</button></mat-slide-toggle></body></html>', url: MODEL });
  ok(env.A.blockerResult() === null, "a role=\"switch\" slide toggle is not a checkbox");
  env.win.close();
  const paneBox = '<div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div role="listbox"><mat-option>Canada</mat-option><mat-checkbox><label><input type="checkbox"> Select all</label></mat-checkbox></div></div></div>';
  env = E.makeEnv({ html: `<!doctype html><html><head></head><body><raf-form raf-entry-name="RequestAccessFormGroup"></raf-form>${paneBox}</body></html>`, url: Q });
  ok(env.A.blockerResult() === null, "the questionnaire's own select panel (an overlay pane with a listbox and options) is not judged");
  env.win.close();
  env = E.makeEnv({ html: `<!doctype html><html><head></head><body>${paneBox}</body></html>`, url: MODEL });
  ok(!!env.A.blockerResult(), "the same overlay pane on the model page is judged like the page: a blocker");
  env.win.close();
  env = E.makeEnv({ html: '<!doctype html><html><head></head><body><raf-form raf-entry-name="RequestAccessFormGroup"></raf-form><div class="cdk-overlay-container"><div class="cdk-overlay-pane"><mat-checkbox><label><input type="checkbox"> Send me offers</label></mat-checkbox></div></div></body></html>', url: Q });
  ok(!!env.A.blockerResult(), "an overlay pane on the questionnaire page without a select panel is judged: a blocker");
  env.win.close();
})();
(function remainingReviewItems() {
  console.log("--- (0.8.0) the select-panel skip, accept controls, terms-host controls, flow dialogs, switch inputs and live-region names");
  const AGR = "https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-867.cloudpartnerservices.goog?project=proj-one";
  const MODEL = "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=proj-one";
  const Q = "https://console.cloud.google.com/agent-platform/model-garden/questionnaire?project=proj-one&model=publishers/anthropic/models/claude-haiku-4-5";
  const doc = (body) => `<!doctype html><html><head></head><body>${body}</body></html>`;
  // Only the listbox that holds the options is skipped: a box beside it in the same overlay pane is judged.
  let env = E.makeEnv({ html: doc('<raf-form raf-entry-name="RequestAccessFormGroup"></raf-form><div class="cdk-overlay-container"><div class="cdk-overlay-pane"><div role="listbox"><mat-option>Canada</mat-option></div><mat-checkbox><label><input type="checkbox"> I agree to the addendum</label></mat-checkbox></div></div>'), url: Q });
  ok(!!env.A.blockerResult(), "a checkbox in the select panel's overlay pane but outside its listbox is judged: a blocker", JSON.stringify(env.A.blockerResult()));
  env.win.close();
  // Accepting controls: an icon-only button named by aria-label, a link, and an accept-only cfc-message inside a dialog the flow does not handle.
  const accepts = [
    ["an icon-only button whose aria-label accepts", '<cfc-message type="warning"><div>Review the model addendum.</div><button aria-label="Accept terms"><mat-icon>check</mat-icon></button></cfc-message>', /^cfc-message$/],
    ["an <a> accept link", '<cfc-message type="warning"><div>Review the model addendum.</div><a href="#">Accept terms</a></cfc-message>', /^cfc-message$/],
    ["an accept-only cfc-message inside a non-flow modal dialog", '<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><h1 matdialogtitle>Model terms</h1><cfc-message type="warning"><div>Review the model addendum.</div><button> Accept </button></cfc-message></mat-dialog-container></div>', /^mat-dialog-container$/]
  ];
  for (const [label, html, where] of accepts) {
    env = E.makeEnv({ html: doc(html), url: MODEL });
    const c = env.S.blockers.consent();
    ok(!!c && where.test(c.where), `accepting control: ${label} is an extra consent control`, JSON.stringify(c));
    env.win.close();
  }
  // Terms-host controls: each of these inside the terms box makes it ambiguous (2 controls), so it is never ticked.
  const terms = (extra) => `<billing-integrated-ai-agreements-body><mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox"><label><input type="checkbox">${extra}<mp-agreements-tos>I agree to the Terms</mp-agreements-tos></label></mat-checkbox></billing-integrated-ai-agreements-body>`;
  const extras = ['<div role="radio">x</div>', '<div role="menuitemradio">x</div>', '<button aria-pressed="false">x</button>', '<div aria-selected="false">x</div>', "<iframe></iframe>", "<object></object>", "<embed>"];
  const counted = extras.filter((x) => {
    const e = E.makeEnv({ html: doc(terms(x)), url: AGR });
    const r = e.A.blockerResult();
    const hit = e.S.agreements.termsCheckbox() === null && !!r && /the terms checkbox holds 2 checkbox controls/.test(r.message);
    e.win.close();
    return hit;
  });
  ok(counted.length === extras.length, `role=radio, role=menuitemradio, aria-pressed, aria-selected, iframe, object and embed inside the terms box are counted (${counted.length} of ${extras.length})`, extras.filter((x) => !counted.includes(x)).join(" "));
  // A terms host whose input is not rendered yet (0 controls): not a blocker, the handler keeps waiting.
  env = E.makeEnv({ html: doc('<billing-integrated-ai-agreements-body><mat-checkbox class="p6ntest-mp-agreements-body-tos-checkbox"><label><mp-agreements-tos>I agree to the Terms</mp-agreements-tos></label></mat-checkbox></billing-integrated-ai-agreements-body>'), url: AGR });
  ok(env.S.agreements.termsCheckbox() === null && env.S.blockers.consent() === null, "a terms host with no control yet: termsCheckbox() is null and it is not a blocker (waited for)", JSON.stringify(env.S.blockers.consent()));
  env.win.close();
  // The flow's "Enable APIs" dialog is scanned for a consent checkbox like any dialog.
  env = E.makeEnv({ html: doc('<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler><h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div><mat-checkbox><label><input type="checkbox"> I agree to the API terms of service</label></mat-checkbox><button> Enable </button></apis-enabler></mat-dialog-container></div>'), url: MODEL });
  const api = env.S.blockers.consent();
  ok(!!api && api.where === "mat-dialog-container" && api.title === "Enable APIs", "a consent checkbox inside the \"Enable APIs\" dialog is an extra consent control", JSON.stringify(api));
  env.win.close();
  // A native checkbox input with role="switch" is a toggle: not an unchecked consent box, not a blocker.
  env = E.makeEnv({ html: doc('<div role="main"><input type="checkbox" role="switch" aria-label="Show deprecated models"></div>'), url: MODEL });
  ok(env.S.model.uncheckedCheckbox() === null && env.A.blockerResult() === null, "an input[type=checkbox][role=switch] is neither model.uncheckedCheckbox() nor a blocker");
  env.win.close();
  // A banner wrapped in a live region is named by the cfc-message inside it.
  env = E.makeEnv({ html: doc('<div role="status"><cfc-message type="warning"><div>Review the model addendum.</div><button> Accept Terms </button></cfc-message></div>'), url: MODEL });
  const live = env.S.blockers.consent();
  ok(!!live && live.where === "cfc-message", "a banner inside a role=\"status\" wrapper is named by its cfc-message, not \"div\"", JSON.stringify(live));
  env.win.close();
})();
(function blockersOnEveryDump() {
  console.log("--- (0.8.0) absence control: both detectors over every recon dump; the only match is the Fable 5.1 consent banner (run E)");
  const fs = require("fs");
  const path = require("path");
  const { execFileSync } = require("child_process");
  const runs = E.listRuns();
  const expected = [];
  for (const run of runs) for (const step of fs.readdirSync(E.reconPath(run))) if (fs.existsSync(E.reconPath(run, step, "page.html"))) expected.push(`${run}/${step}`);
  if (!expected.length) { skip("blocker absence control", "no recon dumps under python/recon"); return; }
  const rows = [];
  for (const run of runs) {
    const out = execFileSync(process.execPath, [path.join(__dirname, "lib", "blocker-scan.cjs"), run], { encoding: "utf8", maxBuffer: 1 << 24 });
    for (const line of out.split("\n")) if (line.startsWith("{")) rows.push(JSON.parse(line));
  }
  const fable = E.findRun("E");
  ok(rows.length === expected.length && rows.length >= 2, `every dump was scanned: ${rows.length} of ${expected.length} page.html files`, `${rows.length}/${expected.length}`);
  const normal = rows.filter((r) => r.run !== fable);
  const hits = normal.filter((r) => r.consent || r.permission);
  ok(normal.length === rows.length - rows.filter((r) => r.run === fable).length && hits.length === 0, `absence control: 0 matches on the ${normal.length} dumps of normal pages (model, Enable APIs dialog, questionnaire, Agreements, post-Agree dialogs, gallery)`, JSON.stringify(hits).slice(0, 300));
  console.log(`     blocker absence control: ${normal.length} normal-page dumps scanned, ${hits.length} matches`);
  const agreementsDumps = rows.filter((r) => r.page === "agreements");
  ok(agreementsDumps.length >= 1 && agreementsDumps.every((r) => r.checkboxes === 1 && r.termsIsTheBox), `every recorded Agreements page (${agreementsDumps.length}) has exactly one visible checkbox, and it is the box the terms hooks find`, JSON.stringify(agreementsDumps.filter((r) => !(r.checkboxes === 1 && r.termsIsTheBox)).map((r) => [r.run, r.step, r.checkboxes])));
  ok(agreementsDumps.every((r) => r.termsChecked === !/^04-/.test(r.step)), `the terms box reads unticked on every 04 step and ticked on every later Agreements step (${agreementsDumps.filter((r) => r.termsChecked).length} ticked, ${agreementsDumps.filter((r) => r.termsChecked === false).length} unticked)`, JSON.stringify(agreementsDumps.map((r) => [r.step, r.termsChecked])));
  const otherFlow = rows.filter((r) => r.run !== fable && (r.page === "model" || r.page === "questionnaire"));
  ok(otherFlow.every((r) => r.checkboxes === 0), `no recorded model or questionnaire page (${otherFlow.length}) besides the Fable dump has a visible checkbox outside dialogs`, JSON.stringify(otherFlow.filter((r) => r.checkboxes).map((r) => [r.run, r.step, r.checkboxes])));
  console.log(`     checkbox survey: ${agreementsDumps.length} Agreements-page dumps with one box each; ${otherFlow.length} model/questionnaire dumps with none`);
  if (!fable) { skip("the Fable 5.1 dump (run E) is detected", "no run of shape E"); return; }
  const fr = rows.filter((r) => r.run === fable);
  ok(fr.length >= 1 && fr.every((r) => r.consent && /addendum-banner-container/.test(r.consent.where) && /Advanced AI Safety Addendum/.test(r.consent.excerpt) && r.permission === null), `the Fable 5.1 model page (${fable}) is detected as an extra consent control naming the Advanced AI Safety Addendum; no permission match`, JSON.stringify(fr));
})();

/* ------------------------------------------------------------ dom.js on synthetic markup */

(function domHelpers() {
  console.log("--- dom.js helpers on synthetic markup (shapes from docs/dom-map.md)");
  const env = E.makeEnv({ url: "https://console.cloud.google.com/agent-platform/model-garden/questionnaire?project=p" });
  env.D.interrupt = null; // dom.js helpers alone: this synthetic markup is not a console page, so the blocker hook actions.js installs is off
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
