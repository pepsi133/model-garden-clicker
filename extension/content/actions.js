/*
 * Page handlers: what to do on the model page, the questionnaire and the
 * Agreements page. Each handler receives a context object built by
 * content/main.js:
 *
 *   ctx.runId              nonce of the run this job belongs to
 *   ctx.jobIndex           index into the queue
 *   ctx.job                { projectId, modelSlug, ... } (snapshot)
 *   ctx.settings           questionnaire values + live_mode (snapshot)
 *   ctx.log(msg)           append to the shared log
 *   ctx.mark(label)        log a timing mark: "<label> at +<ms since the job started>"
 *   ctx.step(text)         name the current action for the badge and the popup
 *   ctx.setPhase(phase)    persist current.phase through the worker
 *   ctx.updateJob(fields)  persist whitelisted job fields through the worker; resolves { ok }
 *   ctx.assertMayAct()     rejects unless the run is still this run, not stopped,
 *                          and the tab's ?project= is the job's project
 *   ctx.refresh()          fresh { settings, queue, current, run, running, stopRequested } from storage
 *   ctx.requestStop()      ask the worker to stop the run (the panel's Stop button)
 *
 * A handler returns null when the flow should continue on the next page, or
 * a { status, message } result that ends the job.
 *
 * Step-by-step confirmation (settings.step_by_step): after the questionnaire
 * is filled and valid, and after the terms checkbox is ticked on the
 * Agreements page, awaitConfirmation() turns the badge into a panel with
 * Continue and Stop and waits. Only a click or keyboard activation the
 * browser marks as trusted (event.isTrusted) on Continue counts; it is
 * recorded per job and step, and the Agree guard requires a fresh one.
 * The user's own Next is seen as the route leaving the questionnaire; the
 * user's own Agree is seen by a capture-phase listener on the Agree node
 * (S.agreements.onAgreeActivation), never inferred from a dialog. While a
 * console dialog is open the wait disables Continue and names the dialog
 * in the panel; the "Enable APIs" dialog is cleared from the wait.
 *
 * clickAgreeGuarded() is the only function in the extension that clicks the
 * Agree button. It re-reads storage and the page immediately before the
 * click and refuses unless every condition in it holds.
 */
(function () {
  if (globalThis.MGC_ACTIONS) return;
  const K = globalThis.MGC;
  const D = globalThis.MGC_DOM;
  const S = globalThis.MGC_SELECTORS;
  const badge = () => globalThis.MGC_BADGE; // loaded before this file in the tab; absent in some tests
  const { PHASE, STATUS, PAGE } = K;
  const T = K.TIMEOUTS;
  const A = {};
  const DRY_RUN_MESSAGE = "dry run: stopped on the Agreements page with the checkbox ticked; Agree was not clicked";

  /* -------------------------------------------------------- step-by-step */

  const confirmations = new Map(); // "runId|jobIndex|step" -> time of the trusted Continue click

  /**
   * Record a Continue click for a job's step. Only a trusted event (a click
   * or keyboard activation the browser generated: event.isTrusted === true)
   * counts; a synthetic click dispatched by page script is ignored and
   * false is returned.
   */
  A.recordContinue = function (runId, jobIndex, step, event) {
    if (!event || event.isTrusted !== true) return false;
    confirmations.set(`${runId}|${jobIndex}|${step}`, Date.now());
    return true;
  };

  /** Age in ms of the trusted Continue recorded for a job's step, or null when none was. */
  A.continueAge = function (runId, jobIndex, step) {
    const t = confirmations.get(`${runId}|${jobIndex}|${step}`);
    return typeof t === "number" ? Date.now() - t : null;
  };

  /** Title and text of a visible dialog, for logs and the panel note. */
  function dialogLabel(d) {
    return [d.title, d.text].filter(Boolean).join(": ") || "dialog without text";
  }

  /**
   * Show the confirmation panel for `step` ("next" | "agree" | "next-job")
   * and wait. Resolves:
   *   "continue"  after a trusted click on the primary button (recorded
   *               first for the guard);
   *   "user"      when opts.userActed() reports that the user activated the
   *               console's own button (the caller passes the check);
   *   "stop"      when opts.stopEndsJob is true and Stop was clicked (the
   *               caller ends the job and asks the worker to stop after);
   *   a { status, message } result when opts.outcome() returns one (the
   *               console settled the step by itself), or when the "Enable
   *               APIs" dialog came back for this job while waiting.
   * Rejects with StoppedError when the run is stopped (the panel's Stop
   * button sends the same stop request as the popup, unless stopEndsJob)
   * or replaced.
   *
   * Every poll also looks at the console's dialogs: the "Enable APIs"
   * dialog is cleared by clearBlockingDialog() and the panel re-shown; any
   * other open dialog disables the primary button and names the dialog in
   * the panel until it closes, so a trusted click never reaches the guard
   * while a dialog is open (a click that lands in the same poll interval as
   * the dialog is dropped). userActed() is checked before a Continue: once
   * the user's own click was seen, a later Continue is ignored.
   *
   * opts: summary, title, continueLabel (default "Continue"),
   * continueAction (data-action, default "continue"), proceedText (log
   * wording after the click), allowContinue (false: Stop only), userActed,
   * outcome, stopEndsJob. The caller sets the awaiting_confirmation phase
   * around this call (that pauses the worker's watchdog) and the page's
   * phase again after it.
   */
  A.awaitConfirmation = async function (ctx, step, opts) {
    const o = opts || {};
    const label = K.CONFIRM_STEP_LABEL[step] || step;
    const continueLabel = o.continueLabel || "Continue";
    const continueAction = o.continueAction || "continue";
    const userActed = () => typeof o.userActed === "function" && !!o.userActed();
    let decision = null;
    const buttons = [];
    if (o.allowContinue !== false) {
      buttons.push({
        label: continueLabel, action: continueAction, primary: true,
        onClick: (ev) => {
          if (userActed()) { ctx.log(`ignored ${continueLabel}: you already activated the console's ${label} yourself`); return; }
          const open = S.dialogs.visible();
          if (open.length) { ctx.log(`ignored ${continueLabel} while a console dialog is open: ${dialogLabel(open[0])}`); return; }
          if (!A.recordContinue(ctx.runId, ctx.jobIndex, step, ev)) { ctx.log(`ignored an untrusted ${continueLabel} click before ${label}`); return; }
          decision = "continue";
        }
      });
    }
    buttons.push({
      label: "Stop", action: "stop",
      onClick: () => {
        if (o.stopEndsJob === true) { decision = "stop"; return; }
        if (typeof ctx.requestStop === "function") ctx.requestStop();
      }
    });
    const spec = { title: o.title || `Step-by-step: ${label}`, summary: o.summary || "", buttons };
    const B = badge();
    const show = () => { if (B) B.panel(spec); };
    show();
    ctx.log(`confirmation panel shown before ${label}: ${buttons.map((b) => b.label).join(" / ")}`);
    ctx.step(`waiting for your confirmation before ${label}`);
    let lastCheck = 0;
    let blockedBy = null; // label of the dialog the primary button is disabled for
    try {
      for (;;) {
        if (userActed()) {
          ctx.log(`you activated the console's ${label} yourself; continuing`);
          return "user";
        }
        if (typeof o.outcome === "function") {
          const r = o.outcome();
          if (r) return r;
        }
        const open = S.dialogs.visible();
        if (open.length) {
          const api = S.dialogs.findApiEnableDialog();
          if (api && api.dialog && D.isVisible(api.dialog)) {
            ctx.log('"Enable APIs" dialog opened while waiting for your confirmation; clearing it');
            const r = await A.clearBlockingDialog(ctx);
            if (r && typeof r === "object") return r;
            show();
            ctx.log(`confirmation panel shown again before ${label}`);
            blockedBy = null;
            decision = null;
          } else {
            const what = dialogLabel(open[0]);
            if (blockedBy !== what) {
              blockedBy = what;
              if (B) { B.panelNote(`A console dialog is open: ${what}. Close it in the console; ${continueLabel} is disabled meanwhile.`); B.panelEnable(continueAction, false); }
              ctx.log(`a console dialog is open while waiting for your confirmation: ${what}; ${continueLabel} disabled until it closes`);
            }
            if (decision === "continue") { ctx.log(`dropped a ${continueLabel} that arrived while a console dialog was open`); decision = null; }
          }
        } else if (blockedBy !== null) {
          blockedBy = null;
          if (B) { B.panelNote(null); B.panelEnable(continueAction, true); }
          ctx.log(`the console dialog closed; ${continueLabel} is enabled again`);
        }
        if (decision === "continue" && !open.length) {
          ctx.log(`${continueLabel} clicked (trusted); ${o.proceedText || `proceeding with ${label}`}`);
          return "continue";
        }
        if (decision === "stop") {
          ctx.log("Stop clicked on the panel; the job ends here and the run stops");
          return "stop";
        }
        if (Date.now() - lastCheck >= 1000) {
          // Storage once a second: a Stop (panel or popup) or a replaced run ends the wait.
          lastCheck = Date.now();
          const f = await ctx.refresh();
          if (!f.running || f.stopRequested) throw new D.StoppedError();
          if (!f.run || f.run.runId !== ctx.runId) throw new D.StoppedError("the run this job belongs to is no longer the current run");
        }
        await D.sleep(K.URL_POLL_MS);
      }
    } finally {
      if (B) B.closePanel();
    }
  };

  async function waitForPageOtherThan(page) {
    await D.waitFor(() => S.detectPage() !== page, { timeout: T.NAV, what: `page change away from ${page}` });
  }

  /* -------------------------------------------------------- blocking dialog */

  /**
   * Pre-action step, run before every page's actions and again after each
   * navigation: clear the "Enable APIs" modal if it is showing.
   *
   * The first time it is seen for a job its own Enable button is clicked
   * and the dialog is waited out (it closes once the API is enabled,
   * observed 8 s). If it is seen again for the same job the job fails:
   * enabling the API did not take. The "seen" memory lives in the content
   * script (a reload would lose it, but nothing here reloads).
   *
   * Returns "none" (no dialog), "cleared", or a { status, message } result
   * that ends the job. The Enable click goes through D.click(), which
   * refuses anything containing "agree", and the button text is matched
   * exactly against "Enable".
   */
  const apiDialogSeen = new Set(); // "runId|jobIndex"

  A.clearBlockingDialog = async function (ctx) {
    const found = S.dialogs.findApiEnableDialog();
    if (!found || !found.dialog || !D.isVisible(found.dialog)) return "none";

    const key = `${ctx.runId}|${ctx.jobIndex}`;
    if (apiDialogSeen.has(key)) {
      return { status: STATUS.FAILED, message: '"Enable APIs" dialog reappeared after its Enable was clicked; giving up on this job' };
    }
    const btn = found.enableButton;
    if (!btn || D.text(btn) !== "Enable") {
      throw new Error('dialogs.findApiEnableDialog() must return an enableButton whose text is exactly "Enable"');
    }
    await ctx.assertMayAct();
    apiDialogSeen.add(key);
    D.click(btn);
    ctx.log('"Enable APIs" dialog: clicked Enable, waiting for it to close');
    await D.waitFor(() => {
      const again = S.dialogs.findApiEnableDialog();
      return !again || !again.dialog || !D.isVisible(again.dialog);
    }, { timeout: T.API_DIALOG_CLOSE, what: '"Enable APIs" dialog to close' });
    ctx.log('"Enable APIs" dialog closed');
    return "cleared";
  };

  /* -------------------------------------------------------- model page */

  /**
   * Model page: click Enable as soon as it is present and enabled and no
   * "Enable APIs" dialog is showing, with no extra delay. A disabled Enable
   * is never clicked; when it sits next to an unchecked checkbox in the
   * page's main content (the consent control some model pages render, see
   * docs/BACKLOG.md) the job fails at once with a message naming the manual
   * step, instead of waiting out model_ready_ms three times. When the click
   * does not lead away from the model page within nav_ms the job fails at
   * once with a clear message instead of retrying.
   */
  A.handleModelPage = async function (ctx) {
    await ctx.setPhase(PHASE.MODEL);
    let found = null;
    for (let pass = 0; pass < 2 && !found; pass++) {
      const seen = await D.waitFor(() => {
        if (S.model.isAlreadyEnabled()) return { enabled: true };
        const btn = S.model.enableButton();
        if (!btn) return null;
        if (D.isDisabled(btn)) {
          if (S.model.uncheckedCheckbox()) {
            throw new D.FatalError("Enable is disabled on the model page next to an unchecked consent checkbox; the model page needs a manual step: tick it by hand in the console, then start the job again");
          }
          return null;
        }
        const dialog = S.dialogs.findApiEnableDialog();
        if (dialog && dialog.dialog && D.isVisible(dialog.dialog)) return { dialog: true };
        return { btn };
      }, { timeout: T.MODEL_READY, what: "Enable button (enabled, no dialog) or enabled state" });
      if (seen.dialog) {
        // The dialog opened while this handler was waiting; clear it here
        // instead of waiting for the next tick's pre-action step.
        const r = await A.clearBlockingDialog(ctx);
        if (r && typeof r === "object") return r;
        continue;
      }
      found = seen;
    }
    if (!found) throw new Error('"Enable APIs" dialog kept the model page busy');
    if (found.enabled) {
      ctx.mark("model page shows the enabled state");
      return { status: STATUS.SKIPPED, message: "skipped: already enabled" };
    }
    await ctx.assertMayAct();
    ctx.step("clicking Enable");
    ctx.mark("action started: click Enable");
    D.click(found.btn);
    ctx.mark("action done: Enable clicked");
    try {
      await waitForPageOtherThan(PAGE.MODEL);
    } catch (err) {
      if (err instanceof D.TimeoutError) {
        throw new D.FatalError(`Enable was clicked but the questionnaire did not open within ${Math.round(T.NAV / 1000)} s; the model page may need a manual step (for example an additional consent control); check it by hand`);
      }
      throw err;
    }
    ctx.mark("left the model page");
    return null;
  };

  /* -------------------------------------------------------- questionnaire */

  A.handleQuestionnaire = async function (ctx) {
    await ctx.setPhase(PHASE.QUESTIONNAIRE);
    const s = ctx.settings;

    // The URL names the model and the Marketplace product this questionnaire
    // belongs to. The product id is what the Agreements page is served
    // under, so it is recorded on the job and checked again before Agree.
    // A URL whose model= parameter is missing or unparsable is fatal: the
    // product id it carries cannot be tied to the job's model, so nothing is
    // recorded and Next is not clicked.
    const id = S.questionnaire.identity();
    if (!id.modelSlug) throw new D.FatalError("questionnaire URL carries no parsable model= parameter; cannot tie its product id to the job's model");
    if (id.modelSlug !== ctx.job.modelSlug) {
      throw new D.FatalError(`questionnaire is for model "${id.modelSlug}", not the job's "${ctx.job.modelSlug}"`);
    }
    if (!id.productId) throw new D.FatalError("questionnaire URL carries no Marketplace product id (mp parameter)");
    const rec = await ctx.updateJob({ productId: id.productId });
    if (!rec || !rec.ok) throw new D.FatalError("could not record the product id on the job (stale run or tab)");

    const nameInput = await D.waitFor(() => S.questionnaire.businessName(), { timeout: T.FORM_READY, what: "questionnaire form" });
    await ctx.assertMayAct();
    ctx.step("filling the questionnaire");
    ctx.mark("action started: fill the questionnaire");

    D.setInputValue(nameInput, s.business_name);
    D.setInputValue(S.questionnaire.businessWebsite(), s.business_website);
    D.setInputValue(S.questionnaire.contactEmail(), s.contact_email);
    ctx.log("filled text fields");

    // The three dropdowns are <cfc-select> hosts; D.selectOption opens the
    // inner trigger and picks the mat-option in the overlay by visible text.
    // Every option list the panel offers is logged once, so the log of a
    // run is the record of the console's current option texts
    // (extension/common/option-lists.js is filled from it).
    // A stored value the panel does not offer is deterministic, so the job
    // fails at once (no retry) naming the field and the offered options.
    const pick = async (name, host, value) => {
      try {
        await D.selectOption(host, value, { onOptions: (names) => ctx.log(`select "${name}" offers ${names.length} options: ${names.join(" | ")}`) });
      } catch (err) {
        if (err instanceof D.NoOptionError) {
          throw new D.FatalError(`questionnaire select "${name}" has no option "${err.wanted}" (fix it in the options page); the console offers: ${err.options.join(" | ")}`);
        }
        throw err;
      }
    };
    await pick("headquarters", S.questionnaire.headquarters(), s.headquarters);
    await pick("industry", S.questionnaire.industry(), s.industry);
    await pick("intended_users", S.questionnaire.intendedUsers(), s.intended_users);
    ctx.log("picked select options");

    D.setInputValue(S.questionnaire.useCases(), s.use_cases);

    const wantYes = K.aupYes(s);
    D.chooseMatRadio(S.questionnaire.aupRadioGroup(), wantYes ? "Yes" : "No");

    // The details field is hidden by the console once "No" is chosen, so it
    // is only filled after a "Yes" (the options page requires it then).
    if (wantYes && s.aup_details) {
      const details = await D.waitFor(() => S.questionnaire.aupDetails(), { timeout: 5000, what: "AUP details field" })
        .catch(() => null);
      if (details) D.setInputValue(details, s.aup_details);
      else ctx.log("AUP details field not present; skipped");
    }

    // Next is always enabled and submits the request-access form, so the
    // form must be valid before it is clicked: a field the console rejects
    // (website without scheme, malformed email) fails the job here instead
    // of being submitted three times.
    try {
      await D.waitFor(() => S.questionnaire.invalidFields().length === 0, { timeout: T.FORM_VALID, what: "all questionnaire fields valid" });
    } catch (err) {
      if (!(err instanceof D.TimeoutError)) throw err;
      const bad = S.questionnaire.invalidFields().map((f) => f.rafName + (f.error ? ` (${f.error})` : "")).join(", ");
      throw new D.FatalError(`questionnaire has invalid fields, not clicking Next: ${bad}`);
    }

    await ctx.assertMayAct();
    await D.waitFor(() => {
      const b = S.questionnaire.nextButton();
      return b && !D.isDisabled(b) ? b : null;
    }, { timeout: T.NEXT_BUTTON, what: "enabled Next button" });

    // Step-by-step: the form is filled and valid; wait for Continue (or for
    // the user's own Next click, seen as the route leaving the questionnaire).
    if (s.step_by_step === true) {
      await ctx.setPhase(PHASE.AWAITING_CONFIRMATION, K.CONFIRM_STEP.NEXT);
      const how = await A.awaitConfirmation(ctx, K.CONFIRM_STEP.NEXT, {
        summary: `The questionnaire for ${ctx.job.modelSlug} in ${ctx.job.projectId} is filled and valid. Continue clicks Next, which submits the request-access form and opens the Agreements page. Stop ends the run.`,
        userActed: () => S.detectPage() !== PAGE.QUESTIONNAIRE
      });
      await ctx.setPhase(PHASE.QUESTIONNAIRE);
      if (how === "user") { ctx.mark("left the questionnaire (Next clicked by you)"); return null; }
      await ctx.assertMayAct();
    }
    // The node is looked up again: the page may have re-rendered during the wait.
    const next = await D.waitFor(() => {
      const b = S.questionnaire.nextButton();
      return b && !D.isDisabled(b) ? b : null;
    }, { timeout: T.NEXT_BUTTON, what: "enabled Next button" });
    ctx.step("clicking Next");
    ctx.mark("action started: click Next");
    D.click(next);
    ctx.mark("action done: Next clicked");
    await waitForPageOtherThan(PAGE.QUESTIONNAIRE);
    ctx.mark("left the questionnaire");
    return null;
  };

  /* -------------------------------------------------------- agreements */

  /**
   * Why the Agreements URL in the tab is not the one for `job`, or null
   * when it is: it must be an Anthropic Marketplace agreements page for the
   * job's project and for the product id recorded on the questionnaire.
   * Decided from the URL alone, so it holds from the first tick after the
   * route change, before the page body renders.
   */
  function agreementsUrlMismatch(job) {
    if (!job || !job.projectId || !job.modelSlug) return "job record in storage is incomplete";
    const page = S.agreements.identity();
    if (!page.anthropic) return "page is not an Anthropic Marketplace agreements page";
    if (page.projectId !== job.projectId) return `page project "${page.projectId}" is not the job's project "${job.projectId}"`;
    if (!job.productId) return "no Marketplace product id was recorded for this job on the questionnaire";
    if (page.productId !== job.productId) return `page product "${page.productId}" is not the job's product "${job.productId}"`;
    return null;
  }

  /** True when the rendered page names the job's model (exact version). */
  function pageNamesModel(job) {
    return S.agreements.mentionsModel(job.modelSlug) || !!(job.modelName && S.agreements.mentionsModel(job.modelName));
  }

  /**
   * Why the Agreements page in the tab is not the one for `job`, or null
   * when it is: the URL checks above plus the rendered text naming the
   * job's model. Used by the guard, and by the handler once the Purchase
   * summary has rendered (the text is the SKU rows; before they render
   * the body is the previous route's leftovers or a spinner).
   */
  function agreementsPageMismatch(job) {
    const url = agreementsUrlMismatch(job);
    if (url) return url;
    if (!pageNamesModel(job)) return `page does not name the job's model "${job.modelName || job.modelSlug}"`;
    return null;
  }

  A.handleAgreements = async function (ctx) {
    await ctx.setPhase(PHASE.AGREEMENTS);

    // A second pass over this page for the same job (the loop retried after
    // an error in the wait below) must never click again, whatever the page
    // now shows.
    const before = await ctx.refresh();
    const job = (before.queue && before.queue[ctx.jobIndex]) || ctx.job;
    if (job && job.agreeClicked) {
      return { status: STATUS.UNVERIFIED, message: "Agree was already clicked for this job; no confirmation observed; check manually" };
    }

    // Both modes: the page must be the job's own Agreements page before the
    // checkbox is ticked. A dry run on another product's page, or with no
    // product id recorded, is a failure, not a successful dry run. The URL
    // checks run at once; the model name is read from the rendered Purchase
    // summary, so the page is ready only when the terms checkbox, the Agree
    // button and the model name are all present together. A page that
    // rendered its checkbox and button but never names the model is fatal
    // after the full wait.
    const urlMismatch = agreementsUrlMismatch(job);
    if (urlMismatch) throw new D.FatalError(`not the job's Agreements page: ${urlMismatch}`);

    const ready = () => {
      const box = S.agreements.termsCheckbox();
      return box && S.agreements.hasAgreeButton() && pageNamesModel(job) ? box : null;
    };
    let checkbox;
    try {
      checkbox = await D.waitFor(ready, { timeout: T.AGREEMENTS_READY, what: "purchase summary naming the job's model, with the terms checkbox and the Agree button" });
    } catch (err) {
      if (err instanceof D.TimeoutError && S.agreements.termsCheckbox() && S.agreements.hasAgreeButton() && !pageNamesModel(job)) {
        throw new D.FatalError(`not the job's Agreements page: ${agreementsPageMismatch(job)}`);
      }
      throw err;
    }
    await ctx.assertMayAct();
    ctx.step("ticking the terms checkbox");
    ctx.mark("action started: tick the terms checkbox");
    await D.setCheckbox(checkbox, true);
    if (!D.isCheckboxChecked(S.agreements.termsCheckbox())) {
      throw new Error("terms checkbox did not stay checked");
    }
    ctx.mark("action done: terms checkbox ticked and verified");
    const stepByStep = ctx.settings.step_by_step === true;

    // Dry run: the job ends here, the instant the tick is verified. With
    // step-by-step on, the panel says so and waits: "Next job" ends the
    // job (the run goes on), "Stop" ends the job and then the run. There
    // is no Agree to confirm, so nothing on this panel can reach the guard.
    if (ctx.settings.live_mode !== true) {
      if (stepByStep) {
        const fresh = await ctx.refresh();
        const more = (fresh.queue || []).some((j, i) => i > ctx.jobIndex && j.status === STATUS.PENDING);
        await ctx.setPhase(PHASE.AWAITING_CONFIRMATION, K.CONFIRM_STEP.NEXT_JOB);
        const how = await A.awaitConfirmation(ctx, K.CONFIRM_STEP.NEXT_JOB, {
          title: "Step-by-step: dry run ends here (Agree not clicked)",
          summary: `${DRY_RUN_MESSAGE}. Next job ends this job as dry-run${more ? " and the run moves to the next job" : " (it is the last job, so the run finishes)"}. Stop ends this job as dry-run and then stops the run.`,
          continueLabel: "Next job", continueAction: "next-job", proceedText: "the job ends dry-run",
          stopEndsJob: true
        });
        await ctx.setPhase(PHASE.AGREEMENTS);
        if (how && typeof how === "object") return how;
        if (how === "stop") return { status: STATUS.DRY_RUN, message: `${DRY_RUN_MESSAGE}; you stopped the run here`, stopAfter: true };
      }
      return { status: STATUS.DRY_RUN, message: DRY_RUN_MESSAGE };
    }

    await ctx.assertMayAct();
    // Every dialog node that exists before the click (the guard refuses
    // while one is visible, so these are hidden or closing ones) is
    // excluded from the result wait below: only a dialog that appeared
    // after the click can be the click's outcome.
    let dialogsBefore = new Set(S.dialogs.all());

    // Step-by-step: wait for Continue before Agree. The user's own Agree
    // activation is observed on the Agree node itself (a trusted click or
    // Enter/Space, capture phase); it is never inferred from a dialog. Once
    // seen, the job records agreeClickedByUser and the outcome is judged by
    // the same dialog wait as the extension's click. A success dialog that
    // opens while nobody activated Agree ends the job unverified without
    // recording a click (nothing is locked for a retry); an error dialog
    // is a dialog like any other (the wait goes on with Continue disabled).
    let byUser = false;
    let userAgree = null; // { at, how } once the user activated the console's Agree
    const unwatch = stepByStep ? S.agreements.onAgreeActivation((how) => { if (!userAgree) userAgree = { at: Date.now(), how }; }) : () => {};
    try {
      if (stepByStep) {
        for (let ask = 0; ; ask++) {
          await ctx.setPhase(PHASE.AWAITING_CONFIRMATION, K.CONFIRM_STEP.AGREE);
          const how = await A.awaitConfirmation(ctx, K.CONFIRM_STEP.AGREE, {
            summary: `FULL RUN: Continue clicks Agree, which accepts the terms and purchases ${job.modelName || job.modelSlug} for ${job.projectId}; the project is billed for its use. Stop ends the run. Click one or the other, not the console's Agree as well.`,
            userActed: () => userAgree !== null,
            outcome: () => {
              const d = S.agreements.successDialogs().find((x) => !dialogsBefore.has(x.dialog) && D.isVisible(x.dialog));
              if (!d) return null;
              ctx.log(`a purchase confirmation opened while waiting for your Continue and no Agree activation by you was seen: "${d.title}"`);
              return { status: STATUS.UNVERIFIED, message: "unverified: the console reported a purchase while waiting for confirmation; check manually" };
            }
          });
          await ctx.setPhase(PHASE.AGREEMENTS);
          if (how && typeof how === "object") return how;
          if (how === "user") {
            byUser = true;
            break;
          }
          await ctx.assertMayAct();
          // Dialog nodes that came and went during the wait are not this click's outcome.
          dialogsBefore = new Set(S.dialogs.all());
          ctx.step("clicking Agree");
          ctx.mark("action started: click Agree");
          try {
            await A.clickAgreeGuarded(ctx);
            ctx.mark("action done: Agree clicked");
            break;
          } catch (err) {
            if (userAgree !== null && err instanceof D.ForbiddenClickError) {
              // Continue and the console's Agree within the same seconds: the
              // user's activation was seen, the guard found the button gone or
              // a dialog opening; that click's outcome is judged, not failed.
              ctx.log(`the guard refused (${err.message}) after you activated the console's Agree yourself; judging that click's outcome`);
              byUser = true;
              break;
            }
            const current = await ctx.refresh();
            const rec = current.queue && current.queue[ctx.jobIndex];
            if (err instanceof D.ForbiddenClickError && /a console dialog is open/.test(err.message) && !(rec && rec.agreeClicked) && ask < 4) {
              ctx.log(`${err.message}; asking for your confirmation again`);
              continue;
            }
            throw err;
          }
        }
        if (byUser) {
          const rec = await ctx.updateJob({ agreeClicked: true, agreeClickedByUser: true });
          if (!rec || !rec.ok) ctx.log("could not record your Agree activation on the job (stale run or tab)");
          ctx.mark(`Agree activated by you (${userAgree.how}); judging its outcome`);
        }
      } else {
        await ctx.assertMayAct();
        ctx.step("clicking Agree");
        ctx.mark("action started: click Agree");
        await A.clickAgreeGuarded(ctx);
        ctx.mark("action done: Agree clicked");
      }
    } finally {
      unwatch();
    }
    const who = byUser ? "Agree clicked by you" : "Agree clicked";

    // After Agree the console opens one of two dialogs 5-7 s later: the
    // "Successfully purchased <model>" confirmation or an error dialog such
    // as "Action Required: Choose Different Billing Account". The job ends
    // the moment either is detected: the success dialog is the
    // authoritative signal (the model page's enabled state can lag it by
    // minutes and is not waited for) and it must name the job's model (a
    // confirmation for another product is logged and ignored). The error
    // text is what the job is reported with so the user sees the console's
    // reason. The wait is bounded by the confirm_ms setting (default 60 s)
    // and only runs its full length when no dialog appears; any error while
    // waiting ends the job as unverified: the click happened.
    const wanted = job.modelName || job.modelSlug;
    const ignored = new Set();
    let outcome;
    try {
      outcome = await D.waitFor(() => {
        for (const d of S.agreements.successDialogs()) {
          if (dialogsBefore.has(d.dialog)) continue;
          if (K.mentionsIdentity(d.title, job.modelSlug) || K.mentionsIdentity(d.title, wanted)) return { done: true, title: d.title };
          if (!ignored.has(d.dialog)) {
            ignored.add(d.dialog);
            ctx.log(`ignoring a confirmation dialog that does not name the job's model "${wanted}": "${d.title}"`);
          }
        }
        const failure = S.agreements.failureDialogs().find((f) => !dialogsBefore.has(f.dialog));
        return failure ? { failure } : null;
      }, { timeout: T.CONFIRM, what: "confirmation or error dialog after Agree" });
    } catch (err) {
      const why = err instanceof D.TimeoutError ? `no confirmation observed within ${T.CONFIRM / 1000} s` : `error while waiting for the confirmation: ${err.message}`;
      return { status: STATUS.UNVERIFIED, message: `${who} but ${why}; check manually` };
    }
    if (outcome.failure) {
      const f = outcome.failure;
      const detail = [f.title, f.text].filter(Boolean).join(": ");
      ctx.log(`console refused Agree: ${detail}`);
      return { status: STATUS.FAILED, message: `Agree refused by the console: ${detail || "error dialog without text"}` };
    }
    ctx.mark(`success dialog detected ("${outcome.title}"); job done`);
    return { status: STATUS.DONE, message: `enabled: ${who} and confirmation observed` };
  };

  /* -------------------------------------------------------- the guard */

  const agreed = new Set(); // "runId|jobIndex" clicked by this content script

  /**
   * The single place that clicks the Agree button. Every condition is
   * re-read from storage and from the page immediately before the click;
   * nothing is trusted from the caller's snapshot. Required, in order:
   *   - a run is in progress, not stopping, and it is the run this job belongs to;
   *   - live mode was on when the run started AND is still on now;
   *   - the job is the run's current job, in the agreements phase, and
   *     Agree has not been clicked for it (storage flag and local memory);
   *   - the tab shows an Anthropic Marketplace agreements page for the
   *     job's project and for the product id recorded on the questionnaire,
   *     and the page names the job's model;
   *   - no console dialog is open;
   *   - with step-by-step on, a trusted Continue for this job's Agree step
   *     was recorded by this content script within CONTINUE_MAX_AGE_MS;
   *   - the terms checkbox is verified checked and the Agree button is
   *     visible, enabled and reads "Agree".
   * The click is recorded on the job before it happens, so a retry can
   * never click twice. Recording is a round trip to the worker; every
   * check is run again after it, immediately before the click, and the
   * button must be the very node that passed the first check.
   */
  A.clickAgreeGuarded = async function (ctx) {
    const key = `${ctx.runId}|${ctx.jobIndex}`;
    if (agreed.has(key)) throw new D.ForbiddenClickError("Agree was already clicked for this job in this tab");

    /** Every storage and page condition; returns the Agree button node. */
    const verify = async (recorded) => {
      const fresh = await ctx.refresh();
      if (!fresh.running) throw new D.ForbiddenClickError("no run is in progress");
      if (fresh.stopRequested) throw new D.StoppedError();
      if (!fresh.run || !ctx.runId || fresh.run.runId !== ctx.runId) {
        throw new D.StoppedError("the run this job belongs to is no longer the current run");
      }
      if (fresh.run.live !== true) throw new D.ForbiddenClickError("the run was started in dry-run mode");
      if (!fresh.settings || fresh.settings.live_mode !== true) throw new D.ForbiddenClickError("live_mode is not true");
      if (!fresh.current || fresh.current.jobIndex !== ctx.jobIndex) {
        throw new D.ForbiddenClickError("current job in storage does not match this job");
      }
      if (fresh.current.phase !== PHASE.AGREEMENTS) {
        throw new D.ForbiddenClickError(`job phase is "${fresh.current.phase}", not "${PHASE.AGREEMENTS}"`);
      }
      const job = fresh.queue && fresh.queue[ctx.jobIndex];
      if (!job || !job.projectId || !job.modelSlug) throw new D.ForbiddenClickError("job record in storage is incomplete");
      if (!recorded && job.agreeClicked) throw new D.ForbiddenClickError("Agree was already clicked for this job");
      if (recorded && job.agreeClicked !== true) throw new D.ForbiddenClickError("the Agree click is not on record in storage after being recorded");

      // The page must be the one this job is for.
      const mismatch = agreementsPageMismatch(job);
      if (mismatch) throw new D.ForbiddenClickError(mismatch);

      // Step-by-step: the user must have pressed Continue for this very
      // step, with a trusted click or keyboard activation, recently.
      if (fresh.settings.step_by_step === true) {
        const age = A.continueAge(ctx.runId, ctx.jobIndex, K.CONFIRM_STEP.AGREE);
        if (age === null) throw new D.ForbiddenClickError("step-by-step is on and no trusted Continue was recorded for this job's Agree step");
        if (age > K.CONTINUE_MAX_AGE_MS) {
          throw new D.ForbiddenClickError(`step-by-step is on and the trusted Continue for Agree is ${Math.round(age / 1000)} s old (limit ${K.CONTINUE_MAX_AGE_MS / 1000} s)`);
        }
      }

      // A click behind an open dialog is one a human could not make, and
      // the dialog would be mistaken for the click's outcome.
      const open = S.dialogs.visible();
      if (open.length) {
        const d = open[0];
        throw new D.ForbiddenClickError(`a console dialog is open: ${[d.title, d.text].filter(Boolean).join(": ") || "dialog without text"}`);
      }

      const checkbox = S.agreements.termsCheckbox();
      if (!checkbox || !D.isCheckboxChecked(checkbox)) {
        throw new D.ForbiddenClickError("terms checkbox is not verified checked");
      }
      const btn = S.agreements.agreeButton();
      if (!btn || !D.isVisible(btn)) throw new D.ForbiddenClickError("Agree button not visible");
      if (D.isDisabled(btn)) throw new D.ForbiddenClickError("Agree button is disabled");
      if (!/agree/i.test(btn.textContent || "")) {
        throw new D.ForbiddenClickError('agreements.agreeButton() returned an element whose text lacks "agree"');
      }
      return btn;
    };

    const btn = await verify(false);

    // Record first, click second: a click that is not on record cannot happen.
    agreed.add(key);
    const rec = await ctx.updateJob({ agreeClicked: true });
    if (!rec || !rec.ok) throw new D.ForbiddenClickError("could not record the Agree click on the job (stale run or tab)");

    // The record was a round trip; the run may have been stopped or
    // replaced and the SPA may have re-rendered the route for another
    // product meanwhile. Check everything again and require the same node.
    const again = await verify(true);
    if (again !== btn || !btn.isConnected) {
      throw new D.ForbiddenClickError("Agree button changed between the check and the click");
    }
    ctx.log("LIVE: clicking Agree");
    D.unguardedClick(btn);
  };

  globalThis.MGC_ACTIONS = A;
})();
