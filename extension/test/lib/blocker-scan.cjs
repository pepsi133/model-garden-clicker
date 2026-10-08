/*
 * Runs the blocker detectors (selectors.js S.blockers.consent and
 * S.blockers.permission) over every page.html of one recon run and prints
 * one JSON line per dump: { run, step, consent, permission }. selectors.cjs
 * starts it once per run directory, in a child process, so the memory of
 * fifty 4 MB jsdom documents is never held at once.
 * Usage: node lib/blocker-scan.cjs <run directory name>
 */
"use strict";
const fs = require("fs");
const E = require("./env.cjs");

(async () => {
  const run = process.argv[2];
  for (const step of fs.readdirSync(E.reconPath(run)).sort()) {
    const snap = E.readSnapshot(run, step);
    if (!snap) continue;
    const env = E.makeEnv(snap);
    E.rehydrate(env.document, snap.forms);
    // The page type and its visible checkboxes (outside dialogs), and whether the one the terms hooks find is among them.
    const boxes = [];
    for (const el of env.D.qa('mat-checkbox, input[type="checkbox"], [role="checkbox"]')) {
      const host = el.tagName === "MAT-CHECKBOX" ? el : (el.closest("mat-checkbox") || el);
      if (!boxes.includes(host) && env.D.isVisible(host) && !host.closest('mat-dialog-container, [role="dialog"][aria-modal="true"], .cdk-overlay-container')) boxes.push(host);
    }
    const terms = env.S.agreements.termsCheckbox();
    const out = { run, step, page: env.S.detectPage(), checkboxes: boxes.length, termsIsTheBox: !!terms && boxes.length === 1 && boxes[0] === terms, termsChecked: terms ? env.D.isCheckboxChecked(terms) : null,
      consent: env.S.blockers.consent(), permission: env.S.blockers.permission() };
    env.win.close();
    console.log(JSON.stringify(out));
    await new Promise((r) => setTimeout(r, 20));
  }
  E.finish("blocker scan"); // the reporter's exit guard expects a finish
})();
