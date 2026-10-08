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
  const mk = (jobIndex) => ({ runId: "run-1", jobIndex: jobIndex || 0, log: (m) => logs.push(m), assertMayAct: async () => {} });

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

  env.win.close();
  E.finish("dialog step");
})();
