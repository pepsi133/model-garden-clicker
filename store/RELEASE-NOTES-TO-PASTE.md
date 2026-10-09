# Release notes to paste

One block per GitHub release. Copy everything between a version heading and the next horizontal rule into that release's edit form.

---

## v0.8.0

### Added
- Claude Haiku 5.5 in the model list.
- A Pause button next to Stop while a run is active. The current job
  finishes, the next one waits until you press Resume. The popup and the
  console tab's badge show PAUSED. Stop works while paused.
- Export settings and Import settings in the options page's Advanced
  section: one JSON file with the questionnaire, step-by-step, the timing,
  runs to keep, the project IDs and the models. The DRY RUN mode is never
  in it. A timing-only JSON still imports.
- An "inside joke" box at the bottom of the options page.

### Changed
- The step-by-step off setting is now called "fast mode". Tick "inside
  joke" to see "kubardy mode" again. The icons are the same.
- Pairs whose latest result was skipped (already enabled) are left out of
  a new run, like pairs already done in any run. The box is now "Include pairs already
  done or skipped in earlier runs", and the full-run confirmation and the
  log name how many of each kind are left out.
- An extra consent control ends the job as failed at once, quoting it, and
  nothing in it is clicked: any checkbox on the model, questionnaire or
  Agreements page other than the terms box (the questionnaire's own form
  and its dropdown panel excepted), overlays included; any checkbox in a
  message banner; an accept button in a console message banner (such as
  the Fable 5.1 addendum's), also inside a status or alert region; or a
  dialog checkbox labelled with consent wording.
- The extra consent check also covers accept buttons named only by their
  aria-label, accept links, an accept-only message banner inside a dialog,
  and a consent checkbox in the "Enable APIs" or error dialog. On the
  questionnaire only the dropdown's option list is skipped, not the rest
  of its overlay. A banner inside a status region is named by the banner.
- A slide toggle built on a native checkbox input is not a checkbox.
- A permission error shown by the console ends the job as failed at once
  with "missing permission:" and the console's words.
- Both checks also run right before every click and tick, the "Enable
  APIs" dialog's Enable, each dropdown and the Acceptable Use Policy radio
  included.

### Security
- The terms checkbox is ticked only when its two page hooks lead to exactly
  one checkbox on the page, outside any banner or dialog. The positional
  fallback is gone, so another checkbox (such as the addendum's) can never
  be ticked in its place; otherwise the job fails and nothing is ticked.
- A pair is never bought twice: once Agree was clicked, or the console
  reported a purchase while the step-by-step panel waited, the job ends
  unverified (never failed or stopped, except the console's own refusal),
  and every later run leaves that pair out.
- In a dry run with step-by-step on, clicking the console's own Agree, or
  a purchase confirmation, while the "dry run ends here" panel waits ends
  the job unverified with the purchase on record.
- Bought pairs are also kept in a small list in the extension's storage
  that "Runs to keep" never prunes and Purge all does not clear, so a later
  run still leaves them out after their run logs are gone.
- The terms box counts radios, toggle buttons, selectable items and
  embedded frames inside it as extra controls, and is looked up again right
  before the tick (it must be the same element). A terms box whose input
  has not rendered yet is waited for instead of failing the job.
- The test run prints the checksum of the Agree guard. The guard itself is
  unchanged.

[0.8.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.8.0

---

## v0.7.0

### Changed
- Every fragile page locator now has a second way to find its element; when
  both fail, the job halts cleanly and names the page and the locator.
- Deleting a run from the Runs page removes its log lines in one step, so
  large runs delete much faster.
- The guard against repeat purchases also reads the previous queue.
- Dead code and stale comments removed.
- Five more tests against the recorded console pages.

### Fixed
- Errors that were caught silently in the page script and the background
  worker now go to the run log, and the dry-run test harness fails on them.

### Security
- A full run is refused when the run-record database cannot be opened, so
  the repeat-purchase guard never runs blind.

[0.7.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.7.0

---

## v0.6.1

### Changed
- The "Include pairs already done" box is no longer remembered between runs;
  it is a choice for each run and is named in the full-run confirmation.

### Fixed
- The repeat-purchase guard tolerates malformed run records and compares
  names without regard to case.
- The log migration from 0.5.0 skips malformed lines instead of failing.
- Downloaded logs also replace invisible and C1 control characters.

[0.6.1]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.6.1

---

## v0.6.0

### Added
- A guard against repeat purchases: at Start, a project and model pair already
  done in an earlier run is skipped unless the new "Include pairs already
  done" box in the popup is ticked.

### Changed
- The run log stores one record per line, so long runs no longer rewrite the
  whole log. Logs from 0.5.0 migrate on first open.
- Upgrading resets the model selection once.

### Security
- Downloaded logs replace control characters.
- The release build installs from the committed lockfile, no longer keeps the
  checkout token and pins every action to a fixed version.

[0.6.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.6.0

---

## v0.5.0

### Added
- A full log of every run, kept in the extension's own storage, with a Runs
  page to download a run's log as a text file, delete a run or purge all,
  and a "Runs to keep" setting. No new permission.

### Changed
- The popup starts with no model ticked and remembers the last selection.
- A project page that never renders fails fast.
- The test runner fails when tests would be skipped, and a release is built
  only after the test suite passes.

### Fixed
- After Agree, only the console's own refusal dialog counts as a refusal.
- A page reload after Agree was already clicked reports the job as unverified.
- A page never acts for a job it did not start.

[0.5.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.5.0

---

## v0.4.0

### Added
- An end-of-run summary in the worker tab and the popup, dismissed with OK.
- "How it works" on the options page, and a maintenance guide for repairing
  the extension after console changes.

### Changed
- The popup uses Chrome's full 800 px width with a four-column model list.
- The step-by-step button shows a warning-sign icon in kubardy mode.
- The extension never brings a tab or window to the front.
- Step-by-step confirmation and the Agree guard refined.
- The manifest description fits the Chrome Web Store limit.
- The README was rewritten.

### Fixed
- One page acts for one job only, and the model page checks the model it
  shows before acting.
- The tests now also check for runtime errors.

[0.4.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.4.0

---

## v0.3.0

First public release.

### Added
- A Chrome extension (Manifest V3) that enables Anthropic Claude models in the
  Google Cloud console Model Garden for many projects: it fills the
  enablement form with values saved once and accepts the Marketplace
  agreement.
- Dry run is the default and never clicks Agree; a full run must be switched
  on and confirmed.
- Step-by-step confirmation, a status badge, option dropdowns, advanced
  timing settings and header toggles for mode and pace.
- A Selenium harness for recording the console pages and testing the
  extension in a dedicated Chrome profile.
- Documentation, the Chrome Web Store listing and the privacy policy.

[0.3.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.3.0
