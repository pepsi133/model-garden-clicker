/*
 * Content script entry point. Runs on every console page load, but only
 * acts inside the tab the service worker opened for the run.
 *
 * Loop: while a run is active in this tab, every MGC.URL_POLL_MS (an
 * advanced setting, default 250 ms) it checks whether location.href changed
 * (the console is a single-page app that changes routes without reloading)
 * and runs a tick. A tick reads the current job from storage, asks
 * selectors.js which page is showing, and runs that page's handler at most
 * a few times. Results go to the service worker as runtime messages, each
 * tagged with the run's id so a message from a superseded run is dropped.
 * An idle tab (no run, or not the run's worker tab) does not poll: it ticks
 * once at load and then only when chrome.storage.onChanged reports a run.
 *
 * Timing: the log carries "page detected", "action started" and "action
 * done" marks per phase, each with the milliseconds since the job started
 * (the worker's navigation), so a run's log reads as a timeline.
 */
(function () {
  if (globalThis.__mgcMainLoaded) return;
  globalThis.__mgcMainLoaded = true;

  const K = globalThis.MGC;
  const D = globalThis.MGC_DOM;
  const S = globalThis.MGC_SELECTORS;
  const B = globalThis.MGC_BADGE;
  const A = globalThis.MGC_ACTIONS;
  const { KEYS, MSG, PHASE, STATUS, PAGE } = K;

  let busy = false;
  let lastHref = location.href;
  const attempts = new Map();   // "runId|jobIndex|page" -> number of attempts
  const lastErrors = new Map(); // "runId|jobIndex|page" -> last error message
  const handled = new Set();    // "runId|jobIndex|page" handled successfully
  const reported = new Set();   // "runId|jobIndex" already reported

  /* ---------------------------------------------------------- messaging */

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => {
          void chrome.runtime.lastError; // extension reloaded or worker gone
          resolve(reply);
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  function log(level, msg) {
    try { console.debug("[MG Clicker]", level, msg); } catch (e) { /* ignore */ }
    return send({ type: MSG.LOG, level, msg, src: "content" });
  }

  async function readState() {
    const o = await chrome.storage.local.get([KEYS.SETTINGS, KEYS.QUEUE, KEYS.CURRENT, KEYS.RUN, KEYS.RUNNING, KEYS.STOP_REQUESTED, KEYS.TIMING, KEYS.SUMMARY_ACK]);
    // Advanced timing settings override the constants; absent = constants.
    if (o[KEYS.TIMING] && typeof o[KEYS.TIMING] === "object") K.applyTiming(o[KEYS.TIMING]);
    return {
      settings: Object.assign({}, K.DEFAULT_SETTINGS, o[KEYS.SETTINGS] || {}),
      queue: o[KEYS.QUEUE] || [],
      current: o[KEYS.CURRENT] || null,
      run: o[KEYS.RUN] || null,
      running: o[KEYS.RUNNING] === true,
      stopRequested: o[KEYS.STOP_REQUESTED] === true,
      summary: o[KEYS.SUMMARY_ACK] || null
    };
  }

  /* ---------------------------------------------------------- end-of-run summary */

  // After a run ends (any reason) the tab the run used shows a summary in
  // its badge until OK is pressed: the record in storage (KEYS.SUMMARY_ACK,
  // keyed by run id) outlives a reload or a route change of this tab, so
  // the summary is shown again on the next tick; OK or the next Start
  // clears it. Nothing here focuses the tab.
  let summaryShownFor = null; // run id of the summary this document shows
  async function showSummaryIfPending(st) {
    if (!K.summaryPending(st.summary, st.run)) { summaryShownFor = null; B.hide(); return; }
    const who = await send({ type: MSG.WHOAMI });
    if (!who || !who.showsSummary) { summaryShownFor = null; B.hide(); return; }
    const runId = st.run.runId;
    if (summaryShownFor === runId && B.summaryOpen()) return;
    const s = K.runSummary(st.queue);
    summaryShownFor = runId;
    B.summary({
      title: `MG Clicker: run ${st.run.reason || "finished"} · ${s.total} job(s)`,
      counts: K.summaryCountsText(s.counts),
      lines: s.lines.map((l) => l.text),
      more: s.more,
      onOk: () => {
        B.closeSummary();
        summaryShownFor = null;
        send({ type: MSG.SUMMARY_ACK, runId });
      }
    });
  }

  /** Report a job's result; stopAfter asks the worker to stop the run after recording it. */
  async function report(runId, jobIndex, status, message, stopAfter) {
    const key = `${runId}|${jobIndex}`;
    if (reported.has(key)) return;
    reported.add(key);
    await log("info", `job ${jobIndex} -> ${status}: ${message}${stopAfter ? " (run stops after this job)" : ""}`);
    const msg = { type: MSG.JOB_RESULT, runId, jobIndex, status, message };
    if (stopAfter === true) msg.stopAfter = true;
    await send(msg);
  }

  /** True when this document's script already reported another job of `runId`. */
  function reportedOtherJob(runId, jobIndex) {
    for (const key of reported) {
      const [r, i] = key.split("|");
      if (r === runId && Number(i) !== jobIndex) return true;
    }
    return false;
  }

  /* ---------------------------------------------------------- step mirror */

  // The step line (the wait in progress or the named action) is shown in
  // the badge and mirrored into the job record for the popup. Only the tab
  // acting for the current job sends it, and only when it changes.
  let stepTarget = null; // { runId, jobIndex } while a handler runs
  let lastStep = null;
  function mirrorStep(text) {
    if (!stepTarget || text === lastStep) return;
    lastStep = text;
    send({ type: MSG.JOB_UPDATE, runId: stepTarget.runId, jobIndex: stepTarget.jobIndex, fields: { step: text } });
  }
  D.onWait = (w) => {
    B.refresh();
    if (!stepTarget) return;
    if (w) mirrorStep(`waiting for ${w.what}`);
  };

  /* ---------------------------------------------------------- tick */

  function makeCtx(st, jobIndex) {
    const runId = st.run ? st.run.runId : null;
    const job = st.queue[jobIndex];
    const t0 = job && job.startedAt ? job.startedAt : Date.now();
    return {
      runId,
      jobIndex,
      job,
      settings: st.settings,
      log: (msg) => log("info", `job ${jobIndex}: ${msg}`),
      mark: (label) => log("info", `job ${jobIndex}: ${label} at +${Date.now() - t0} ms`),
      step: (text) => { B.step(text); mirrorStep(text); },
      setPhase: async (phase, awaiting) => send(awaiting ? { type: MSG.SET_PHASE, runId, jobIndex, phase, awaiting } : { type: MSG.SET_PHASE, runId, jobIndex, phase }),
      updateJob: async (fields) => send({ type: MSG.JOB_UPDATE, runId, jobIndex, fields }),
      /** The panel's Stop button: the same stop request the popup sends. */
      requestStop: async () => send({ type: MSG.STOP }),
      /**
       * Called before every click. Rejects with StoppedError when the run
       * was stopped or replaced by a newer run, and with a fatal error when
       * the tab shows another project than the job's.
       */
      assertMayAct: async () => {
        const f = await readState();
        if (!f.running || f.stopRequested) throw new D.StoppedError();
        if (!f.run || f.run.runId !== runId) throw new D.StoppedError("the run this job belongs to is no longer the current run");
        const urlProject = S.urlProject();
        if (urlProject && urlProject !== job.projectId) {
          throw new D.FatalError(`tab shows project "${urlProject}" instead of the job's project "${job.projectId}"`);
        }
      },
      refresh: readState
    };
  }

  const HANDLERS = {
    [PAGE.MODEL]: A.handleModelPage,
    [PAGE.QUESTIONNAIRE]: A.handleQuestionnaire,
    [PAGE.AGREEMENTS]: A.handleAgreements
  };

  /** What the handler of `page` does next, for the badge's "then:" line. */
  function planFor(page, live, stepByStep) {
    const ask = stepByStep ? "wait for your Continue, " : "";
    switch (page) {
      case PAGE.MODEL: return "click Enable, then the questionnaire";
      case PAGE.QUESTIONNAIRE: return `fill the form, ${ask}click Next, then the Agreements page`;
      case PAGE.AGREEMENTS: return live ? `tick the terms checkbox, ${ask}click Agree, wait for the success dialog` : `tick the terms checkbox, then ${stepByStep ? "wait for your Next job or Stop" : "stop"} (dry run)`;
      default: return "wait for a known console page";
    }
  }

  function badgeInfo(st, jobIndex, mode, page, note) {
    const job = st.queue[jobIndex];
    const nextIndex = st.queue.findIndex((j, i) => i > jobIndex && j.status === STATUS.PENDING);
    const nextJob = nextIndex >= 0 ? { projectId: st.queue[nextIndex].projectId, modelSlug: st.queue[nextIndex].modelSlug } : null;
    return {
      mode, jobIndex, total: st.queue.length, projectId: job.projectId, modelSlug: job.modelSlug,
      jobStartedAt: job.startedAt || null, plan: planFor(page, mode === "FULL RUN", st.settings.step_by_step === true), nextJob, note
    };
  }

  let active = false; // true while this tab is the run's worker tab

  async function tickInner() {
    const st = await readState();
    if (!st.running || !st.current || !st.run) {
      active = false;
      stepTarget = null;
      if (!st.running) await showSummaryIfPending(st); else B.hide();
      return;
    }

    // Only the tab the worker opened may act; every other console tab stays idle.
    const who = await send({ type: MSG.WHOAMI });
    if (!who || !who.isWorkerTab) { active = false; stepTarget = null; B.hide(); return; }
    active = true;
    const runId = st.run.runId;
    const jobIndex = st.current.jobIndex;
    const job = st.queue[jobIndex];
    if (!job) { B.hide(); return; }
    const mode = st.run.live && st.settings.live_mode ? "FULL RUN" : "DRY RUN";

    if (st.stopRequested) { B.update(badgeInfo(st, jobIndex, mode, null, "stopping")); return; }
    if (reported.has(`${runId}|${jobIndex}`) || st.current.phase === PHASE.FINISHED) {
      B.update(badgeInfo(st, jobIndex, mode, null, "finished, waiting for next job"));
      return;
    }

    // One document, one job. The worker records the next job (phase
    // navigate) a few ms before its tabs.update lands, and storage.onChanged
    // wakes this script at once: a document that already reported a job of
    // this run is the finished job's page, still waiting to be navigated
    // away, whatever its URL says (inside a project the next job's page
    // has the same ?project=, and an enabled or ticked page would be
    // judged for the wrong job). It only shows the badge; the worker's
    // navigation always brings a fresh document, whose script judges the
    // new URL, and if the navigation never lands the watchdog ends the job.
    if (reportedOtherJob(runId, jobIndex)) {
      B.update(badgeInfo(st, jobIndex, mode, null, "finished, waiting for the next job's page"));
      return;
    }

    const urlProject = S.urlProject();
    if (urlProject && urlProject !== job.projectId) {
      await report(runId, jobIndex, STATUS.FAILED, `tab shows project "${urlProject}" instead of the job's project`);
      return;
    }

    // Pre-action step: a blocking "Enable APIs" modal can sit on any page.
    try {
      const dialog = await A.clearBlockingDialog(makeCtx(st, jobIndex));
      if (dialog && typeof dialog === "object") {
        await report(runId, jobIndex, STATUS.FAILED, dialog.message);
        return;
      }
      if (dialog === "cleared") {
        // The page may re-render after the API is enabled; allow its actions to run again.
        for (const k of Array.from(handled)) if (k.startsWith(`${runId}|${jobIndex}|`)) handled.delete(k);
      }
    } catch (err) {
      if (err instanceof D.StoppedError) { await report(runId, jobIndex, STATUS.STOPPED, "stopped by request"); return; }
      if (D.isFatal(err) || err instanceof D.TimeoutError) {
        await report(runId, jobIndex, STATUS.FAILED, `"Enable APIs" dialog: ${err.message}`);
        return;
      }
      await log("warn", `job ${jobIndex}: dialog check failed: ${err.message}`);
      return;
    }

    let page;
    try {
      page = S.detectPage();
    } catch (err) {
      B.update(badgeInfo(st, jobIndex, mode, null, `error: ${err.message}`));
      await report(runId, jobIndex, STATUS.FAILED, err.message);
      return;
    }
    B.update(badgeInfo(st, jobIndex, mode, page, `phase ${st.current.phase}, page ${page}`));
    if (page === PAGE.UNKNOWN || !HANDLERS[page]) return;

    const key = `${runId}|${jobIndex}|${page}`;
    if (handled.has(key)) return;
    const n = attempts.get(key) || 0;
    if (n >= K.MAX_ATTEMPTS_PER_PAGE) {
      await report(runId, jobIndex, STATUS.FAILED, `gave up on ${page} page after ${n} attempts: ${lastErrors.get(key) || "unknown error"}`);
      return;
    }
    attempts.set(key, n + 1);

    const ctx = makeCtx(st, jobIndex);
    stepTarget = { runId, jobIndex };
    if (n === 0) ctx.mark(`${page} page detected`);
    try {
      const result = await HANDLERS[page](ctx);
      handled.add(key);
      if (result) await report(runId, jobIndex, result.status, result.message, result.stopAfter === true);
    } catch (err) {
      if (err instanceof D.StoppedError) {
        await report(runId, jobIndex, STATUS.STOPPED, "stopped by request");
      } else if (D.isFatal(err)) {
        await report(runId, jobIndex, STATUS.FAILED, err.message);
      } else {
        lastErrors.set(key, err.message);
        await log("warn", `job ${jobIndex}: ${page} attempt ${n + 1} failed: ${err.message}`);
      }
    } finally {
      B.step(null);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      await tickInner();
    } catch (err) {
      try { console.warn("[MG Clicker] tick error", err); } catch (e) { /* ignore */ }
    } finally {
      busy = false;
      if (active) schedule();
    }
  }

  /* ---------------------------------------------------------- triggers */

  // The poll runs only while this tab is the active run's worker tab: a
  // re-armed timeout (so a poll interval changed in the advanced settings
  // takes effect on the next tick) that stops itself once a tick found no
  // run. An idle tab is woken by storage.onChanged or popstate below.
  let polling = false;
  function schedule() {
    if (polling) return;
    polling = true;
    const next = () => setTimeout(() => {
      if (!active) { polling = false; return; }
      if (location.href !== lastHref) {
        lastHref = location.href;
        log("debug", `url changed: ${location.pathname}`);
      }
      tick();
      next();
    }, K.URL_POLL_MS);
    next();
  }

  window.addEventListener("popstate", () => tick());

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[KEYS.CURRENT] || changes[KEYS.RUNNING] || changes[KEYS.STOP_REQUESTED] || changes[KEYS.SUMMARY_ACK]) tick();
  });

  tick();
})();
