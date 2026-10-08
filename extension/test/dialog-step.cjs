/*
 * The "Enable APIs" dialog step (actions.clearBlockingDialog), driven on the
 * real dialog dump when present (run B, see lib/env.cjs): the first
 * appearance for a job clicks the dialog's own Enable and waits for it to
 * close, a second appearance for the same job fails the job without a
 * click, another job starts fresh, and a button whose text is not exactly
 * "Enable" is refused.
 */
"use strict";
const E = require("./lib/env.cjs");
const { ok, skip } = E;

(async () => {
  let env = E.envFromSnapshot("B", "01-model-page-api-dialog");
  let real = true;
  if (!env) {
    skip("real Enable APIs dialog dump", "recon dump not present; using synthetic markup");
    real = false;
    env = E.makeEnv({ url: "https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/claude-haiku-4-5?project=p" });
    env.document.body.innerHTML = `<div class="cdk-overlay-container"><mat-dialog-container role="dialog"><apis-enabler>` +
      `<h1 matdialogtitle> Enable APIs </h1><div matdialogcontent>The Agent Platform API must be enabled to use this page.</div>` +
      `<div matdialogactions><button> Send feedback </button><button> Cancel </button><button> Enable </button></div></apis-enabler></mat-dialog-container></div>`;
  }
  const { D, S, A, jsdomErrors } = env;
  console.log(`--- clearBlockingDialog on ${real ? "the real dialog dump" : "synthetic markup"}`);

  const found = S.dialogs.findApiEnableDialog();
  ok(!!found && D.text(found.enableButton) === "Enable", "dialog found with its Enable button");
  const container = found.dialog;
  const keep = container.cloneNode(true);
  const parent = container.parentNode;
  let clicks = [];
  const arm = (dlg) => {
    for (const b of D.qa("button", dlg)) b.addEventListener("click", () => { clicks.push(D.text(b)); dlg.remove(); });
  };
  arm(container);

  const logs = [];
  const flags = { running: true, stopRequested: false, run: { runId: "run-1", live: false } };
  const mk = (jobIndex) => ({ runId: "run-1", jobIndex: jobIndex || 0, log: (m) => logs.push(m), assertMayAct: async () => {}, refresh: async () => Object.assign({}, flags) });

  let r = await A.clearBlockingDialog(mk());
  ok(r === "cleared", "appearance 1 -> cleared", r);
  ok(clicks.join() === "Enable", 'appearance 1 clicked exactly the dialog "Enable"', clicks.join());
  ok(S.dialogs.findApiEnableDialog() === null, "dialog gone after the click");
  ok(S.model.enableButton() === null || !S.model.enableButton().closest("mat-dialog-container"), "model Enable button lookup never returned the dialog button");

  const again = keep.cloneNode(true);
  parent.appendChild(again);
  arm(again);
  r = await A.clearBlockingDialog(mk());
  ok(r && r.status === "failed" && /reappeared/.test(r.message), "appearance 2 for the same job -> failed result, no reload", JSON.stringify(r));
  ok(clicks.length === 1, "appearance 2 made no click", clicks.join());
  ok(!jsdomErrors.some((m) => /navigation|reload/i.test(m)), "no location.reload() was attempted", jsdomErrors.join(" | "));

  r = await A.clearBlockingDialog(mk(1));
  ok(r === "cleared", "the same dialog for the next job -> cleared again", r);
  ok(clicks.length === 2, "the next job clicked Enable once", clicks.join());

  r = await A.clearBlockingDialog(mk(1));
  ok(r === "none", "no dialog -> none", r);

  // A button whose text is not exactly "Enable" is refused before any click.
  const bad = keep.cloneNode(true);
  parent.appendChild(bad);
  const badBtn = D.qa("button", bad).find((b) => D.text(b) === "Enable");
  badBtn.querySelector(".mdc-button__label, span").textContent = " Agree ";
  let badClicks = 0;
  badBtn.addEventListener("click", () => { badClicks += 1; });
  S.dialogs.findApiEnableDialog = () => ({ dialog: bad, enableButton: badBtn });
  try { await A.clearBlockingDialog(mk(2)); ok(false, "did not throw for a non-Enable button"); }
  catch (e) { ok(/exactly "Enable"/.test(e.message), `button text "Agree" refused -> ${e.message.slice(0, 70)}`, e.message); }
  ok(badClicks === 0, "the refused button received no click");

  // (N5) a Stop (or a replaced run) during the close wait ends it at the next poll, not after api_dialog_close_ms.
  console.log("--- (N5) Stop during the dialog's close wait");
  env.K.TIMEOUTS.API_DIALOG_CLOSE = 5000; env.K.URL_POLL_MS = 20;
  const stays = keep.cloneNode(true); // its Enable does nothing: the dialog never closes
  parent.appendChild(stays);
  const stayBtn = D.qa("button", stays).find((b) => D.text(b) === "Enable");
  S.dialogs.findApiEnableDialog = () => ({ dialog: stays, enableButton: stayBtn });
  const closedLines = () => logs.filter((m) => /dialog closed/.test(m)).length;
  const closedBefore = closedLines();
  let t0 = Date.now();
  let p = A.clearBlockingDialog(mk(3));
  setTimeout(() => { flags.stopRequested = true; }, 100);
  let err = null;
  try { await p; } catch (e) { err = e; }
  let ms = Date.now() - t0;
  ok(err && err.name === "StoppedError" && ms >= 100 && ms < 1000, `stop requested 100 ms into the close wait: StoppedError after ${ms} ms (not 5000)`, err ? `${err.name} ${ms} ms` : "resolved");
  ok(closedLines() === closedBefore, "no 'dialog closed' line was logged for the stopped wait");
  flags.stopRequested = false;
  t0 = Date.now();
  p = A.clearBlockingDialog(mk(4));
  setTimeout(() => { flags.run = { runId: "run-2", live: false }; }, 100);
  err = null;
  try { await p; } catch (e) { err = e; }
  ms = Date.now() - t0;
  ok(err && err.name === "StoppedError" && /no longer the current run/.test(err.message) && ms < 1000, `a replaced run during the close wait: StoppedError after ${ms} ms`, err ? `${err.name}: ${err.message} ${ms} ms` : "resolved");
  flags.run = { runId: "run-1", live: false };
  // control: with the flags untouched the wait still runs to its timeout
  env.K.TIMEOUTS.API_DIALOG_CLOSE = 150;
  err = null;
  try { await A.clearBlockingDialog(mk(5)); } catch (e) { err = e; }
  ok(err && err.name === "TimeoutError" && /dialog to close/.test(err.message), "control: no stop, the close wait times out as before", err && err.message);

  env.win.close();
  E.finish("dialog step");
})();
