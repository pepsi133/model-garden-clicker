# Chrome Web Store update: 1.0.0

The owner's checklist for the developer dashboard. The store refuses a
version it has already seen; 1.0.0 is new. Work through it in order.

## Package

- [ ] Upload `dist/model-garden-clicker-1.0.0.zip`, built by
      `sh scripts/build-extension-zip.sh` (or the zip attached to the GitHub
      release `v1.0.0`).
- [ ] The dashboard shows version 1.0.0 and the same three permissions
      (`storage`, `alarms`, host `https://console.cloud.google.com/*`).

## Store listing tab

- [ ] Paste the Description from `store/LISTING.md` (3,897 characters, under
      the 4,000 limit). Paragraphs that changed: the opening, the
      questionnaire paragraph, steps 1 to 5, DRY RUN, FULL RUN, the
      step-by-step paragraph (now Continue / Skip / Stop), the
      API-enablement paragraph, What it stores, What it needs, Limitations
      and Open source. Title, Summary and the other fields are unchanged.
- [ ] Paste the release notes from `store/RELEASE-NOTES-TO-PASTE.md` (the
      `v1.0.0` block).
- [ ] Re-shoot `store/screenshots/03-step-by-step-panel.png`: the panel now
      has Continue / Skip / Stop.
- [ ] Re-shoot `store/screenshots/01-popup-dry-run.png`: the popup now has
      the "Check only" box next to the include-done box, the header's
      mode and step-by-step controls are now two slider switches, and a
      run shows the progress line (a thin bar and `N/T jobs · P % ·
      elapsed mm:ss · ~mm:ss left`) under the status line.
- [ ] Re-shoot `store/screenshots/02-options.png`: the options page gained
      the "API enablement" section.
- [ ] Re-shoot `store/screenshots/05-popup-in-tab.png`: its header shows
      the two new slider switches (mode, step-by-step) and, during a run,
      the progress line.
- [ ] `04-dry-run-agreements.png` stays unless you want the new status rows
      (skipped-by-you, not-enabled) shown.
- [ ] README images under `docs/images/` stay unchanged.
- [ ] Upload the screenshots in numeric order, 1280x800 PNG, no alpha.

## Privacy tab

- [ ] Permissions unchanged (`storage`, `alarms`, the console host): no new
      permission justification.
- [ ] `PRIVACY.md` unchanged. It was read for this release: the extension
      still sends nothing anywhere. The weekly models workflow runs in
      GitHub, not in the extension.
- [ ] The single purpose text is unchanged.

## After the paste

- [ ] Save the draft, submit for review.
- [ ] Delete the "Re-paste needed" note at the top of `store/LISTING.md`.

## How to capture the screenshots

`store/README.md` (section Screenshots) describes the method the repository
already has: the two popup captures (01 and 05) come from the headless
layout probe's fake storage, `python/scripts/popup_layout.py`, which shows
no real value. The console captures (03 and 04) and the options capture
(02) are taken from the real pages, with project IDs, the account avatar,
every questionnaire value and the billing lines covered with the local
background colour (see `store/README.md`). `store/CHECKLIST.md` lists the
dashboard tabs.
