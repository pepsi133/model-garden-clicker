/*
 * ALL console DOM locators live in this file and nowhere else.
 *
 * Every entry was filled from docs/dom-map.md (recorded 2026-10-07 from live
 * Selenium runs) and is exercised against the saved page.html dumps by
 * extension/test/selectors.cjs. Keep the two in sync: when the console
 * changes, update dom-map.md first, then this file, then the tests.
 *
 * Rules that hold on all three pages (see the map):
 *   - generated ids (_0rif_mat-input-0, _1rif_mat-mdc-dialog-0, ...) are never
 *     used; only component tag names, raf-name attributes, Google's own test
 *     hooks (p6ntest-*, data-prober) and trimmed visible text are;
 *   - button text is padded (" Enable "), so every comparison trims first;
 *   - overlays (select panels, dialogs) render into body > div.cdk-overlay-container;
 *   - the "Enable APIs" dialog has its own "Enable" button, so the model
 *     page's Enable button is always looked up outside mat-dialog-container;
 *   - a button is never found by its text alone anywhere on the page: a
 *     text match is scoped to the component the map places it in (the
 *     model page's call-to-action stack, the questionnaire footer), so a
 *     renamed hook ends in a clean timeout that names the locator, never
 *     in a click on some other "Enable" or "Next".
 *
 * Each entry returns an element (or null when it is simply absent), a boolean,
 * a small object or a list of those; nothing else in the extension touches a
 * selector string. Each page also has a DOM-side detector (hasShell) that is
 * independent of its URL prefix, so a changed console URL is named instead
 * of waited out (S.detectPageByDom).
 */
(function () {
  if (globalThis.MGC_SELECTORS) return;
  const D = globalThis.MGC_DOM;
  const K = globalThis.MGC;
  const PAGE = K.PAGE;
  const { MODEL_PATH_PREFIX, QUESTIONNAIRE_PATH, AGREEMENTS_PATH_PREFIX } = K;
  // A console dialog: Angular Material's container (the shape of every
  // dialog in docs/dom-map.md: "Enable APIs", the purchase confirmation, the
  // refusal; all aria-modal="false") or any other element that declares
  // itself a modal dialog. A non-modal role="dialog" (a side drawer, a
  // survey panel) is not a dialog here: it blocks no click.
  const DIALOG_SELECTOR = 'mat-dialog-container, [role="dialog"][aria-modal="true"]';

  const S = {};

  /* ------------------------------------------------------------ helpers */

  function inDialog(el) {
    return !!(el && el.closest && el.closest(DIALOG_SELECTOR));
  }

  /** Visible button-like elements with exactly this trimmed text inside `root`, outside any dialog. */
  function buttonByExactText(text, root) {
    if (!root) return null;
    const all = D.qa('button, [role="button"], a[mat-button]', root).filter((b) => !inDialog(b));
    return all.find((b) => D.isVisible(b) && D.text(b) === text) || null;
  }

  /** "mat-dialog-container" or 'div[role="dialog"]': names the element a dialog check matched, for the log. */
  function elementName(el) {
    if (!el || !el.tagName) return "dialog";
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute && el.getAttribute("role");
    return tag === "mat-dialog-container" || !role ? tag : `${tag}[role="${role}"]`;
  }

  function dialogTitle(dialog) {
    const h = D.q("h1, h2, [matdialogtitle], .mat-mdc-dialog-title", dialog);
    return D.text(h);
  }

  function dialogText(dialog) {
    return D.text(D.q("[matdialogcontent], .mat-mdc-dialog-content", dialog));
  }

  function rafElement(rafName) {
    return D.q(`raf-runtime-form-element[raf-name="${rafName}"]`);
  }

  function rafInput(rafName) {
    const host = rafElement(rafName);
    return host ? D.q('input:not([type="hidden"]), textarea', host) : null;
  }

  function rafSelect(rafName) {
    const host = rafElement(rafName);
    return host ? D.q("cfc-select, mat-select", host) : null;
  }

  function rafHidden(host) {
    return !host || host.getAttribute("raf-hidden") === "true" || !D.isVisible(host);
  }

  /* ------------------------------------------------------------ page detection */

  /**
   * Which page is the tab showing right now?
   * Decided from the URL path only (the console is a single-page app and
   * changes the path on every step). The agreements match is limited to the
   * Anthropic publisher prefix: another vendor's Marketplace agreements page
   * is UNKNOWN, never a page the extension acts on. Never throws; returns
   * UNKNOWN while nothing is recognisable. Called on every poll.
   */
  S.detectPage = function () {
    const path = (globalThis.location && location.pathname) || "";
    if (path.startsWith(MODEL_PATH_PREFIX)) return PAGE.MODEL;
    if (path.startsWith(QUESTIONNAIRE_PATH)) return PAGE.QUESTIONNAIRE;
    if (path.startsWith(AGREEMENTS_PATH_PREFIX)) return PAGE.AGREEMENTS;
    return PAGE.UNKNOWN;
  };

  /**
   * Which page the DOM shows, from each page's own shell component
   * (model.hasShell, questionnaire.hasShell, agreements.hasShell) and
   * independent of the URL: the second locator for detectPage. UNKNOWN
   * while no shell is rendered or more than one is (a route change leaves
   * the previous page's shell behind for a moment, so a caller never acts
   * on this alone; the page loop uses it to name a URL the extension does
   * not know while the body shows a page it does).
   */
  S.detectPageByDom = function () {
    const shown = [];
    if (S.model.hasShell()) shown.push(PAGE.MODEL);
    if (S.questionnaire.hasShell()) shown.push(PAGE.QUESTIONNAIRE);
    if (S.agreements.hasShell()) shown.push(PAGE.AGREEMENTS);
    return shown.length === 1 ? shown[0] : PAGE.UNKNOWN;
  };

  /** The ?project= parameter of the current URL, or null. */
  S.urlProject = function () {
    try { return new URL(location.href).searchParams.get("project"); } catch (e) { return null; }
  };

  /**
   * The model slug the current model page URL names (the path segment
   * after MODEL_PATH_PREFIX, decoded), or null when the path is not a
   * model page's. The model handler compares it with the job's slug before
   * any decision, so a document left on another model's page never judges
   * or clicks for a job.
   */
  S.urlModelSlug = function () {
    try {
      const path = new URL(location.href).pathname;
      if (!path.startsWith(MODEL_PATH_PREFIX)) return null;
      const slug = decodeURIComponent(path.slice(MODEL_PATH_PREFIX.length).split("/")[0]);
      return slug || null;
    } catch (e) { return null; }
  };

  /* ------------------------------------------------------------ model page */

  S.model = {
    /**
     * True when the model is already enabled for this project: the
     * call-to-action stack shows the "Open in Agent Studio" link
     * (vertex-ai-open-generation-ai-studio-button) and the Enable wrapper
     * (vertex-ai-request-access-button) is gone. No "Enabled" text exists in
     * this flow.
     */
    isAlreadyEnabled: function () {
      if (D.q("vertex-ai-request-access-button")) return false;
      if (D.q("vertex-ai-open-generation-ai-studio-button")) return true;
      const stack = D.q("vai-model-garden-call-to-action-button-stack");
      if (!stack) return false;
      return D.qa("a, button", stack).some((el) => D.text(el) === "Open in Agent Studio");
    },

    /**
     * The model page's "Enable" button, or null while it is not rendered.
     * Primary: the button inside vertex-ai-request-access-button. Second
     * locator: the visible button reading exactly "Enable" inside the
     * call-to-action stack (vai-model-garden-call-to-action-button-stack,
     * the component that holds Enable, Open Notebook and View Code). Never
     * a button elsewhere on the page, and never one inside a dialog, so the
     * "Enable APIs" dialog's own Enable is never returned here.
     */
    enableButton: function () {
      const wrapped = D.qa("vertex-ai-request-access-button button")
        .find((b) => !inDialog(b) && D.isVisible(b) && D.text(b) === "Enable");
      if (wrapped) return wrapped;
      return buttonByExactText("Enable", D.q("vai-model-garden-call-to-action-button-stack"));
    },

    /**
     * True when any part of the model page's call-to-action stack is in
     * the DOM (the stack itself, the Enable wrapper or the Agent Studio
     * wrapper). False on a page that kept the model page's URL but rendered
     * no model page at all (the console's error page for a project that
     * does not exist or cannot be opened), which the handler names.
     */
    hasShell: function () {
      return !!D.q("vai-model-garden-call-to-action-button-stack, vertex-ai-request-access-button, vertex-ai-open-generation-ai-studio-button");
    },

    /**
     * A visible, unchecked checkbox in the page's main content (inside
     * [role="main"] or <main> when the page has one, else anywhere), outside
     * any dialog or overlay: the consent control some model pages render
     * next to a disabled Enable button. Returns the mat-checkbox host (or
     * the bare input) or null. Nothing in the extension clicks it.
     */
    uncheckedCheckbox: function () {
      const root = D.q('[role="main"], main') || document;
      for (const el of D.qa('mat-checkbox, input[type="checkbox"]', root)) {
        const host = el.tagName === "INPUT" ? (el.closest("mat-checkbox") || el) : el;
        if (inDialog(host) || host.closest(".cdk-overlay-container")) continue;
        if (!D.isVisible(host) || D.isCheckboxChecked(host)) continue;
        return host;
      }
      return null;
    }
  };

  /* ------------------------------------------------------------ questionnaire */

  S.questionnaire = {
    businessName: function () {
      return rafInput("businessName");
    },
    businessWebsite: function () {
      return rafInput("businessWebsite");
    },
    contactEmail: function () {
      return rafInput("contactEmailAddress");
    },
    /** cfc-select host for the headquarters country (182 flat options). */
    headquarters: function () {
      return rafSelect("businessHeadquarterSelect");
    },
    /** cfc-select host for the industry (16 options, "Agriculture" preselected). */
    industry: function () {
      return rafSelect("industrySelect");
    },
    /** cfc-select host for the intended users (3 options). */
    intendedUsers: function () {
      return rafSelect("intendedUserSelect");
    },
    /** Text input (despite the raf-name ending in Select) for the use cases. */
    useCases: function () {
      return rafInput("intendedUseCasesSelect");
    },
    /** The mat-radio-group holding the Yes/No Acceptable Use Policy radios. */
    aupRadioGroup: function () {
      const host = rafElement("hasAdditionalRequirements");
      if (host) return D.q('mat-radio-group, [role="radiogroup"]', host);
      return D.q('mat-radio-group, [role="radiogroup"]');
    },
    /**
     * Optional "If yes, please describe ..." input. Rendered on first paint,
     * hidden (raf-hidden="true", display:none, content removed) once "No" is
     * chosen. Returns null when absent or hidden.
     */
    aupDetails: function () {
      const host = rafElement("additionalRequirements");
      if (rafHidden(host)) return null;
      return D.q('input:not([type="hidden"]), textarea', host);
    },
    /**
     * True when the questionnaire has rendered: its request-access form
     * component (raf-form[raf-entry-name="RequestAccessFormGroup"], the
     * raf-name hooks' parent) or its footer. Independent of the URL.
     */
    hasShell: function () {
      return !!D.q('raf-form[raf-entry-name="RequestAccessFormGroup"], cfc-panel-footer.mg-questionnaire-footer');
    },
    /**
     * The "Next" button in the questionnaire footer (type=button, always
     * enabled): the footer component by tag and class, or by its class
     * alone, then the visible button reading exactly "Next" inside it.
     * Never a "Next" elsewhere on the page.
     */
    nextButton: function () {
      return buttonByExactText("Next", D.q("cfc-panel-footer.mg-questionnaire-footer, .mg-questionnaire-footer"));
    },
    /**
     * What the questionnaire URL says it is for:
     *   ?model=publishers/anthropic/models/<slug>&mp=anthropic/anthropic-NNN.cloudpartnerservices.goog
     * Returns { modelSlug, productId } (either may be null). The productId is
     * the Marketplace listing the Agreements page is served under; it differs
     * per model and is not derivable from the slug, so it is recorded here and
     * compared again before Agree.
     */
    identity: function () {
      let params;
      try { params = new URL(location.href).searchParams; } catch (e) { return { modelSlug: null, productId: null }; }
      const model = params.get("model") || "";
      const m = /\/models\/([^/?#]+)$/.exec(model);
      return { modelSlug: m ? m[1] : null, productId: params.get("mp") || null };
    },
    /**
     * Visible questionnaire fields that Angular still marks ng-invalid, as
     * [{ rafName, error }]. Next is always enabled, so this is the only way
     * to know before clicking it whether the form would be accepted.
     */
    invalidFields: function () {
      const out = [];
      for (const host of D.qa("form[raf-name] raf-runtime-form-element[raf-name]")) {
        if (rafHidden(host)) continue;
        const bad = D.qa("input.ng-invalid, textarea.ng-invalid, cfc-select.ng-invalid, mat-select.ng-invalid, mat-radio-group.ng-invalid, mat-form-field.ng-invalid", host);
        if (!bad.length) continue;
        const err = D.q("mat-error, cfc-form-error, .mat-mdc-form-field-error", host);
        out.push({ rafName: host.getAttribute("raf-name"), error: D.text(err) });
      }
      return out;
    }
  };

  /* ------------------------------------------------------------ dialogs */

  S.dialogs = {
    /** Every dialog container node in the document, visible or not. */
    all: function () {
      return D.qa(DIALOG_SELECTOR);
    },
    /**
     * Visible dialogs as [{ dialog, element, title, text }], in document
     * order; `element` names the node the selector matched (for the log,
     * so a block by an unexpected element is diagnosable).
     */
    visible: function () {
      return D.qa(DIALOG_SELECTOR).filter(D.isVisible).map((dialog) => ({ dialog, element: elementName(dialog), title: dialogTitle(dialog), text: dialogText(dialog) }));
    },
    /**
     * The "Enable APIs" dialog (apis-enabler, h1 "Enable APIs", body "The
     * Agent Platform API must be enabled to use this page.", buttons Send
     * feedback / Cancel / Enable). It can sit on any of the three pages.
     * Returns { dialog, enableButton } when it is in the DOM, else null.
     * enableButton is the dialog's own button whose trimmed text is exactly
     * "Enable"; the caller re-checks that text before clicking.
     */
    findApiEnableDialog: function () {
      for (const dialog of D.qa(DIALOG_SELECTOR)) {
        const isApi = !!D.q("apis-enabler", dialog) || dialogTitle(dialog) === "Enable APIs";
        if (!isApi) continue;
        const enableButton = D.qa("button", dialog).find((b) => D.text(b) === "Enable") || null;
        return { dialog, enableButton };
      }
      return null;
    }
  };

  /* ------------------------------------------------------------ agreements */

  S.agreements = {
    /**
     * What the Agreements URL says it is for:
     *   /marketplace/agreements/anthropic/anthropic-NNN.cloudpartnerservices.goog?project=<id>
     * Returns { anthropic, productId, projectId }: anthropic is true only
     * under the Anthropic publisher prefix; productId is the path below
     * /marketplace/agreements/ in the same form as the questionnaire's mp
     * parameter ("anthropic/anthropic-NNN.cloudpartnerservices.goog").
     */
    identity: function () {
      let url;
      try { url = new URL(location.href); } catch (e) { return { anthropic: false, productId: null, projectId: null }; }
      const anthropic = url.pathname.startsWith(AGREEMENTS_PATH_PREFIX);
      const rest = anthropic ? decodeURIComponent(url.pathname.slice("/marketplace/agreements/".length)) : "";
      return { anthropic, productId: rest.replace(/\/+$/, "") || null, projectId: url.searchParams.get("project") };
    },
    /**
     * True when the page's visible text names the model: the "Purchase
     * summary" SKU rows read "Claude Haiku 4 5 - Batch Cache Read Tokens ...",
     * so the comparison ignores case and punctuation but keeps token
     * boundaries and compares the version exactly (MGC.mentionsIdentity):
     * "claude-sonnet-5" is not satisfied by a Claude Sonnet 5.5 page and
     * the reverse.
     */
    mentionsModel: function (nameOrSlug) {
      if (!document.body) return false;
      // Text nodes joined with spaces, so adjacent elements never run
      // together into one token ("summaryClaude").
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const parts = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue);
      return K.mentionsIdentity(parts.join(" "), nameOrSlug);
    },
    /**
     * True when the Agreements page has rendered: its body component
     * (billing-integrated-ai-agreements-body) or the terms label component
     * (mp-agreements-tos). Independent of the URL.
     */
    hasShell: function () {
      return !!D.q("billing-integrated-ai-agreements-body, mp-agreements-tos");
    },
    /**
     * The terms mat-checkbox host on the "Purchase summary" page. Google's
     * own test hook class is the primary locator; mp-agreements-tos (the
     * label component) is the second; the third is the fact the map
     * records, that it is the only mat-checkbox inside the page's body
     * component: with both hooks gone, the one mat-checkbox inside
     * billing-integrated-ai-agreements-body, and null when there are two.
     */
    termsCheckbox: function () {
      const hooked = D.q("mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox");
      if (hooked) return hooked;
      const tos = D.q("mp-agreements-tos");
      const labelled = tos && tos.closest ? tos.closest("mat-checkbox") : null;
      if (labelled) return labelled;
      const body = D.q("billing-integrated-ai-agreements-body");
      const boxes = body ? D.qa("mat-checkbox", body) : [];
      return boxes.length === 1 ? boxes[0] : null;
    },
    /**
     * The "Agree" button, located by data-prober (fallback: its aria-label).
     * This locator is only ever consumed by clickAgreeGuarded() in
     * content/actions.js; nothing else may click what it returns.
     */
    agreeButton: agreeButtonNode,
    /**
     * True when the Agree button is rendered: the handler's readiness wait
     * needs the fact, never the node (see agreeButton).
     */
    hasAgreeButton: function () {
      return !!agreeButtonNode();
    },
    /**
     * Watch for the user activating the console's own Agree button while
     * the step-by-step panel waits: a trusted click on the node. That is
     * the pointer click, or the click the browser itself fires for Enter or
     * Space on the focused button, so a keyboard activation is seen through
     * the same event. Key events are not counted on their own: a keydown
     * with its keyup and no click is not an activation the console acted
     * on, and counting it would lock the job as clicked. The listener sits
     * on the document in the capture phase, so a handler on the button
     * cannot hide the event, and the target is compared with the Agree
     * node at event time (the page may re-render). callback("click") is
     * called once per trusted click. Returns a function that stops
     * watching. Nothing here clicks anything; the node is never handed out.
     */
    onAgreeActivation: function (callback) {
      const onClick = (ev) => {
        const node = agreeButtonNode();
        if (node && ev && ev.isTrusted === true && ev.target && node.contains(ev.target)) callback("click");
      };
      document.addEventListener("click", onClick, true);
      return () => document.removeEventListener("click", onClick, true);
    },
    /**
     * The purchase confirmations open in the document, as [{ dialog,
     * title }]: every dialog container holding mp-consent-complete-dialog
     * or titled "Successfully purchased <model>". The model page can lag
     * this signal by more than 30 s, so this dialog, not the model page, is
     * the authoritative success signal. The caller ties a dialog to its
     * own Agree click (the node did not exist before the click) and to its
     * job (the title names the model).
     */
    successDialogs: function () {
      const out = [];
      for (const dialog of D.qa(DIALOG_SELECTOR)) {
        const title = dialogTitle(dialog);
        if (D.q("mp-consent-complete-dialog", dialog) || title.startsWith("Successfully purchased")) out.push({ dialog, title });
      }
      return out;
    },
    /**
     * The error dialogs in the document, as [{ dialog, title, text,
     * refusal }]: every dialog container holding behavior-failure-dialog or
     * carrying aria-label="Error dialog". `refusal` is true for the shape
     * the console uses to refuse a purchase after Agree (docs/dom-map.md,
     * "Error": the behavior-failure-dialog component, title "Action
     * Required: Choose Different Billing Account", the billing-account
     * explanation, a single "Got it" button): the component is present, or
     * the title or text carries the recorded refusal wording
     * (MGC.REFUSAL_PHRASES). A bare "Error dialog" container without
     * either is not a refusal: the Agreements handler gives the success
     * dialog a grace period before it judges the click. The text is what a
     * live-mode failure is reported with.
     */
    failureDialogs: function () {
      const out = [];
      for (const dialog of D.qa(DIALOG_SELECTOR)) {
        const shaped = !!D.q("behavior-failure-dialog", dialog);
        if (!shaped && dialog.getAttribute("aria-label") !== "Error dialog") continue;
        const title = dialogTitle(dialog);
        const text = dialogText(dialog);
        out.push({ dialog, title, text, refusal: shaped || K.isRefusalText(`${title} ${text}`) });
      }
      return out;
    }
  };

  function agreeButtonNode() {
    return D.q('button[data-prober="cloud-marketplace-request-product"]') ||
      D.q('button[aria-label^="Agree to the terms"]');
  }

  globalThis.MGC_SELECTORS = S;
})();
