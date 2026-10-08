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
  // A message banner: the console's cfc-message, the addendum's container,
  // or an element announcing a status or an alert.
  const BANNER = 'cfc-message, .addendum-banner-container, [role="alert"], [role="status"]';

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
     * The terms mat-checkbox host on the "Purchase summary" page. Its two
     * hooks (Google's own test hook class, and mp-agreements-tos, the label
     * component, with its closest mat-checkbox) must resolve to exactly ONE
     * mat-checkbox on the whole page, that box must not sit inside a
     * message banner or a dialog, and it must hold exactly one
     * checkbox-like element (its own native input; dom.js
     * ownCheckboxInput); otherwise null, and the job ends without
     * ticking anything. There is no positional fallback: another consent
     * box (the Fable 5.1 addendum's reads "... to these terms ...", and
     * could reuse the label component) is never taken for it.
     */
    termsCheckbox: function () {
      const box = hookedTermsHost();
      // The host must hold exactly one checkable control (its own native
      // input); anything else injected into it makes it ambiguous.
      return box && D.ownCheckboxInput(box) ? box : null;
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

  /* ------------------------------------------------------------ blockers */

  /*
   * What the extension cannot get past by itself, on any page of the flow,
   * found by shape and never clicked:
   *   - consent(): an extra consent control, found by structure (see
   *     S.blockers.consent below): a consent checkbox in a dialog, a
   *     checkbox or an accepting button in a banner, or any other visible
   *     checkbox on a flow page. The shape of the
   *     Fable 5.1 model page (div.addendum-banner-container > cfc-message
   *     type="warning", the "Advanced AI Safety Addendum" text, a
   *     mat-checkbox and an "Accept Terms" button; docs/dom-map.md). The
   *     Agreements page's own terms box is never one.
   *   - permission(): denial wording inside an error, alert, snackbar,
   *     form error or dialog element (never in ordinary page text: the side
   *     navigation's "IAM & Admin", say); the bare word "permission", "requires
   *     the ... role" and "not allowed to" count only in an error banner or
   *     error page, and "IAM" or "403" alone never count.
   * Each returns { where, title, excerpt } or null; the excerpt is the
   * element's text, cut to BLOCKER_EXCERPT_CHARS around the match.
   */
  const BLOCKER_EXCERPT_CHARS = 160;
  // A checkbox: Angular Material's host, a native input, or any element
  // that declares the checkbox role (not role="switch": a slide toggle).
  const CHECKBOX = 'mat-checkbox, input[type="checkbox"], [role~="checkbox" i]';
  const ERROR_SCOPE = [
    DIALOG_SELECTOR, '[role="alert"]', '[role="alertdialog"]',
    "mat-snack-bar-container", ".mat-mdc-snack-bar-container", "simple-snack-bar", "mat-error",
    'cfc-message[type="error"]', 'cfc-message[type="warning"]', ".cfc-message-error", ".cfc-message-warning",
    '[class*="error-page" i]', '[class*="error-state" i]', '[class*="permission-denied" i]', '[class*="access-denied" i]'
  ].join(", ");
  // Error banners and error pages: the only places where the weak wording
  // below (the bare word "permission", "requires the ... role", "not
  // allowed to") counts. Dialogs, snackbars, alerts, form errors and
  // warning banners count denial wording only ("Manage permissions", a
  // "requires the Vertex AI User role" tip or "not allowed to" validation
  // text never fail a job there).
  const ERROR_BANNER = 'cfc-message[type="error"], .cfc-message-error, [class*="error-page" i], [class*="error-state" i], [class*="permission-denied" i], [class*="access-denied" i]';
  const CONSENT_RE = /\b(addendum|consent|terms of service|accept (the )?terms|i agree|agree to)\b/i;
  // An accepting control ("Accept Terms", "I agree", "Accept").
  const ACCEPT_BUTTON_RE = /^(i (accept|agree)|accept|agree)\b/i;
  // Denial wording: a match on its own in every scope. "IAM" and "403" are
  // never a match on their own.
  const DENIAL_RES = [
    /\bdenied\b/i,
    /permission_denied/i, // the API status; "_" defeats \b
    /\b403:?\s+forbidden\b|\bforbidden:/i, // "403 Forbidden", "Error 403: Forbidden", "Forbidden: ..." (not "forbidden content")
    /\b(do not|don't|does not|doesn't) have (the )?(sufficient |required |necessary )?(access|permissions?)\b/i,
    /\b(lack|lacks|insufficient) (the )?(required |necessary )?permissions?\b/i,
    /\bmissing (at least one of the following )?(required )?permissions?\b/i,
    /\brequired '[^']+' permission\b/i,
    /\bpermission error\b/i,
    /\bpermissions? (is |are )?(required|needed|missing)\b/i,
    // "You need access", never a condition such as "If you need access to ...".
    /(?<!\b(?:if|when|where|whether|unless|once)\s)\byou need (additional )?(access|permissions?)\b/i,
    /\bcontact your ([a-z]+ )?administrator\b/i,
    /\bnot authori[sz]ed to\b/i
  ];
  const WEAK_RES = [
    /\bpermissions?\b/i,
    /\brequires? (the )?[^.]{1,80}? role\b/i,
    /\bnot allowed to\b/i
  ];

  function excerpt(text, at) {
    const t = D.norm(text);
    if (t.length <= BLOCKER_EXCERPT_CHARS) return t;
    const from = Math.max(0, Math.min((at || 0) - 40, t.length - BLOCKER_EXCERPT_CHARS));
    return (from > 0 ? "…" : "") + t.slice(from, from + BLOCKER_EXCERPT_CHARS).trim() + (from + BLOCKER_EXCERPT_CHARS < t.length ? "…" : "");
  }

  /**
   * An element's text with its text nodes joined by spaces, so adjacent
   * elements never run together into one word ("addendumContinue") and the
   * word-bounded wording checks below see every word. With `skipIcons`,
   * the text inside icon elements (mat-icon, cm-icon, .material-icons: a
   * ligature such as "check") is left out.
   */
  function spacedText(el, skipIcons) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (skipIcons && n.parentElement && n.parentElement.closest("mat-icon, cm-icon, .material-icons, .material-icons-extended")) continue;
      parts.push(n.nodeValue);
    }
    return D.norm(parts.join(" "));
  }

  /** True for the dialogs the flow itself handles: "Enable APIs", the purchase confirmation and the refusal. */
  function flowDialog(dialog) {
    if (D.q("apis-enabler, mp-consent-complete-dialog, behavior-failure-dialog", dialog)) return true;
    if (dialog.getAttribute("aria-label") === "Error dialog") return true;
    const title = dialogTitle(dialog);
    return title === "Enable APIs" || title.startsWith("Successfully purchased");
  }

  // The banners in which an accepting button alone is a consent control
  // (not a role="status" cookie notice with "Accept all").
  const ACCEPT_BANNER = "cfc-message, .addendum-banner-container";
  // The questionnaire's own form: its controls are the flow's, never extra.
  const QUESTIONNAIRE_FORM = "raf-form, form[raf-name]";

  /** The visible checkbox hosts inside `root` (a mat-checkbox, or a bare input), each once. */
  function visibleCheckboxes(root) {
    const out = [];
    for (const el of D.qa(CHECKBOX, root)) {
      // An input or role="checkbox" element folds onto its mat-checkbox only
      // when it is that host's own single native control; any other one is
      // a checkbox of its own (and is judged as one).
      const mc = el.tagName === "MAT-CHECKBOX" ? null : el.closest("mat-checkbox");
      const host = el.tagName === "MAT-CHECKBOX" ? el : (mc && D.ownCheckboxInput(mc) === el ? mc : el);
      if (!out.includes(host) && D.isVisible(host)) out.push(host);
    }
    return out;
  }

  /** A checkbox's label: its text, its aria-label and the text its aria-labelledby names. */
  function checkboxLabel(host) {
    const parts = [spacedText(host)];
    for (const el of [host].concat(D.qa("input", host))) {
      const aria = el.getAttribute("aria-label");
      if (aria) parts.push(aria);
      for (const id of String(el.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean)) {
        const ref = document.getElementById(id);
        if (ref) parts.push(spacedText(ref));
      }
    }
    return D.norm(parts.join(" "));
  }

  /** True when `host` is the terms box itself (a box nested in its label is not). */
  function isTerms(host, terms) {
    return !!terms && host === terms;
  }

  /**
   * True for an element inside an overlay pane that holds the flow's own
   * select panel (the questionnaire's dropdown options), on the
   * questionnaire page only. Every other overlay is judged like the page.
   */
  function inSelectPanel(el, page) {
    if (page !== PAGE.QUESTIONNAIRE) return false;
    const pane = el.closest(".cdk-overlay-pane");
    return !!pane && !!D.q('[role="listbox"], mat-option, .cfc-select-option-primary', pane);
  }

  S.blockers = {
    /*
     * Structural rules, in order:
     *   - a dialog (not one the flow handles) with a visible checkbox whose
     *     label (text, aria-label or aria-labelledby) carries consent wording;
     *   - a banner outside any dialog with any visible checkbox other than
     *     the terms box, or a visible accepting button in a cfc-message /
     *     addendum container at or under it;
     *   - on the model, questionnaire and Agreements pages: any other
     *     visible checkbox outside dialogs, whatever its label; overlay
     *     panes are judged like the page, except the questionnaire's own
     *     form and its select panel. Every recorded flow page has none
     *     besides the terms box.
     */
    consent: function () {
      const terms = S.agreements.termsCheckbox();
      for (const dialog of D.qa(DIALOG_SELECTOR)) {
        if (!D.isVisible(dialog) || flowDialog(dialog)) continue;
        const control = visibleCheckboxes(dialog).find((h) => !isTerms(h, terms) && CONSENT_RE.test(checkboxLabel(h)));
        if (!control) continue;
        // The excerpt is the text after the title (named on its own).
        const full = spacedText(dialog);
        const title = dialogTitle(dialog);
        const body = title && full.startsWith(title) ? full.slice(title.length).trim() : full;
        const m = CONSENT_RE.exec(body);
        return { where: elementName(dialog), title, excerpt: excerpt(m ? body : `${body} ${checkboxLabel(control)}`.trim(), m ? m.index : 0) };
      }
      const agree = agreeButtonNode();
      const page = S.detectPage();
      // The terms box itself holding more than its own native input: named
      // on its own (it is never ticked; termsCheckbox() is null).
      const hooked = hookedTermsHost();
      if (hooked && !D.ownCheckboxInput(hooked)) {
        return { where: "terms checkbox", title: "", excerpt: `the terms checkbox holds ${D.checkboxControls(hooked).length} checkbox controls` };
      }
      for (const banner of D.qa(BANNER)) {
        // An overlay pane that is not a modal dialog (a banner moved into
        // .cdk-overlay-container) is judged like the page; only the
        // questionnaire's own select panel is skipped.
        if (inDialog(banner) || inSelectPanel(banner, page) || !D.isVisible(banner)) continue;
        // The outermost banner names it once (cfc-message inside the container).
        const outer = banner.parentElement && banner.parentElement.closest(BANNER);
        if (outer && !inDialog(outer) && D.isVisible(outer)) continue;
        const box = visibleCheckboxes(banner).some((h) => !isTerms(h, terms));
        // An accepting button counts in every cfc-message or addendum
        // container at or under this banner (one wrapped in a status or
        // alert live region included).
        const acceptRoots = [banner].filter((b) => b.matches(ACCEPT_BANNER)).concat(D.qa(ACCEPT_BANNER, banner));
        const accept = acceptRoots.some((root) => D.qa('button, [role="button"]', root).some((b) => b !== agree && D.isVisible(b) && ACCEPT_BUTTON_RE.test(spacedText(b, true))));
        if (!box && !accept) continue;
        const text = spacedText(banner);
        const m = CONSENT_RE.exec(text);
        const cls = (banner.getAttribute("class") || "").trim().split(/\s+/)[0];
        return { where: banner.tagName.toLowerCase() + (cls ? `.${cls}` : ""), title: "", excerpt: excerpt(text, m ? m.index : 0) };
      }
      if (page === PAGE.MODEL || page === PAGE.QUESTIONNAIRE || page === PAGE.AGREEMENTS) {
        for (const host of visibleCheckboxes(document)) {
          if (isTerms(host, terms) || inDialog(host) || inSelectPanel(host, page)) continue;
          if (page === PAGE.QUESTIONNAIRE && host.closest(QUESTIONNAIRE_FORM)) continue;
          return { where: `checkbox on the ${page} page`, title: "", excerpt: excerpt(checkboxLabel(host) || "checkbox without a label", 0) };
        }
      }
      return null;
    },
    permission: function () {
      for (const el of D.qa(ERROR_SCOPE)) {
        if (!D.isVisible(el)) continue;
        if (el.matches(DIALOG_SELECTOR) && flowDialog(el)) continue;
        if (el.closest(DIALOG_SELECTOR) && flowDialog(el.closest(DIALOG_SELECTOR))) continue;
        const text = spacedText(el);
        const res = el.matches(ERROR_BANNER) ? DENIAL_RES.concat(WEAK_RES) : DENIAL_RES;
        for (const re of res) {
          const m = re.exec(text);
          if (m) return { where: elementName(el), title: el.matches(DIALOG_SELECTOR) ? dialogTitle(el) : "", excerpt: excerpt(text, m.index) };
        }
      }
      return null;
    }
  };

  /** The one mat-checkbox the terms hooks lead to, outside any banner or dialog, whatever it holds; or null. */
  function hookedTermsHost() {
    const boxes = new Set(D.qa("mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox"));
    for (const tos of D.qa("mp-agreements-tos")) {
      const box = tos.closest ? tos.closest("mat-checkbox") : null;
      if (box) boxes.add(box);
    }
    if (boxes.size !== 1) return null;
    const box = boxes.values().next().value;
    return box.closest(`${BANNER}, ${DIALOG_SELECTOR}, .cdk-overlay-container`) ? null : box;
  }

  function agreeButtonNode() {
    return D.q('button[data-prober="cloud-marketplace-request-product"]') ||
      D.q('button[aria-label^="Agree to the terms"]');
  }

  globalThis.MGC_SELECTORS = S;
})();
