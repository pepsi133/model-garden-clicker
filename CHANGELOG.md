# Changelog

All notable changes to Model Garden Clicker are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Deep links in the GitLab inventory. `ci/gitlab/poc/mg_inventory.py`
  writes `deep-links.md` next to `projects.txt`: one link per pending
  project with its pending models, then chunked links for all pending
  projects, at most 200 projects and 16,384 characters per link, in the
  format of `docs/scoping/03-deep-links.md`. The extension id comes from
  `--extension-id` or `MGC_EXTENSION_ID` (default: the store id). The
  manual `enable:handoff` job prints the file.
- A Skip button in the step-by-step panel. The panel before Next and
  before Agree now offers Continue / Skip / Stop. Skip ends the job as
  `skipped-by-you` without clicking anything, and the run moves to the next
  job. A later run attempts the pair again, unlike `skipped`. The dry-run
  panel keeps Next job / Stop. The new status shows in the results table,
  the counts, the run log and the Runs page. A result with a purchase on
  record that ends skipped-by-you is `unverified`.
- The scoping document `docs/scoping/04-check-only-inventory.md`: a
  check-only run that records which models are enabled. The Skip button is
  its MVP.
- A "Check only" box in the popup, under the include-done box. It is a
  per-run choice like include-done: each Start spends it. The worker opens
  each model page and the extension reads the enabled state, then ends the
  job without clicking anything: `skipped` (already enabled, "(check
  only)") or the new status `not-enabled` (the Enable button is offered, or
  the "Enable APIs" dialog shows). The dialog's Enable is never clicked in
  such a run. FULL RUN refuses the box, in the popup and in the worker. The
  popup's status line, the summary and the badge read `[DRY RUN · CHECK
  ONLY]`; the Runs page and the downloaded log say `check only`. The new
  status shows in the results table, the counts, the run log and the Runs
  page. A later run attempts a `not-enabled` pair again; a `skipped` pair
  stays left out. `docs/scoping/04-check-only-inventory.md` is marked
  implemented.
- `scripts/models/fetch_models.py --write PATH` writes the candidate
  `models.json`: the API gives the slugs, `launchStage` and `apiOrder`, the
  hand-set fields of the file win, a new slug takes its date from the
  Google per-model page (else `"dateSource": "undated"` and `firstSeen`),
  and a slug that left the API stays with `deprecated: true`. It refuses an
  empty or unauthorised listing (exit 2, nothing written), names undated GA
  slugs (exit 1 unless `--allow-undated`), and writes a byte-stable
  canonical file. New flags: `--check`, `--no-scrape`, `--allow-undated`,
  `--max-undated-days` and `--summary-md`. `models.json` is now in that
  canonical form (same data), and the lint accepts `dateSource` and
  `firstSeen`.
- A weekly workflow, `.github/workflows/models-refresh.yml` (Monday 06:17
  UTC, and on demand). It authenticates through Workload Identity
  Federation (repository variables `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL`,
  `GCP_QUOTA_PROJECT`; no stored key), regenerates `models.json`, runs the
  lint, and opens or updates one pull request from the branch
  `models-refresh`. It never merges and never tags. It is skipped until the
  variables are set, and it fails when a GA entry stays undated for more
  than 30 days.

### Changed
- Deep links accept up to 200 projects (was 23) and 16,384 characters (was
  4,096). The model cap stays 13.
- The settings import has a separate 8,192-character cap for the joined
  project and model lists (`MGC.CONFIG_LIST_MAX`). The 2,000-character cap
  stays for every other text.
- `scripts/deep-link/` follows the new limits.

[Unreleased]: https://github.com/pepsi133/model-garden-clicker/compare/v0.9.0...HEAD

## [0.9.0] - 2026-10-13

### Added
- A third link, `latest`, next to `all` and `none` above the model
  checklist. It ticks the newest GA model of each model line (opus,
  sonnet, haiku, fable, and any new line) and writes a note under the
  checklist. A line whose newest model needs a manual consent step on its
  model page (Fable 5.1) is left out and named in the note. The stored
  selection stays a list of concrete slugs.
- A release date and an API order per model in `models.json`. The date
  shows in the row's tooltip (`<slug> · released <date>`). The stage text
  reads `(GA · manual step)` for a model that needs a manual consent step
  and `(deprecated)` for a deprecated one; the tooltip repeats the flag
  (`· manual step`, `· deprecated`), because the four-column layout cuts
  the stage text with an ellipsis.
- A pair count line under the checklist, updated on every change:
  `P project(s) × M model(s) = K pair(s)`. It counts projects and models
  the way the worker runs them: a project ID typed twice, or a slug ticked
  and typed again as an extra slug in another case, counts once.
- The full-run confirmation says how many selected models (ticked or typed
  as extra slugs) are not the newest of their line. It names a ticked model
  that needs a manual step as a job that fails instead of enabling. Two or
  more left-out or flagged names are joined with "and" and take the plural
  verb, in the note and in the confirmation.
- A lint of `models.json` in the offline suite (`extension/test/models-json.cjs`).
- `scripts/models/fetch_models.py`: a standard-library script that lists
  the Anthropic publisher models from the API, merges the hand-set fields
  of `models.json` and prints the candidate file and the `latest` set
  (`scripts/models/README.md`, `docs/MAINTENANCE.md` section 8).
- `ci/gitlab/`: a sample GitLab pipeline and a read-only service-account
  audit (`mg_inventory.py`) that writes the pending projects and an import
  file for the options page. Nothing in it enables a model. Scoping in
  `docs/scoping/02-gitlab-runner-service-account.md`.
- `docs/scoping/`: the "latest models" design, the GitLab-runner design and
  the deep-link design and its security review.
- Deep links: a link opens the popup in a tab with the project IDs and the
  models filled in, after a confirmation dialog that lists the validated
  values and says that nothing starts until Start. The link is the popup
  page's own URL with the keys `v`, `projects` and `models`, for the
  address bar and bookmarks:
  `chrome-extension://fmfhgpbcpacoddjpfemghhpinhodcglp/popup/popup.html?tab=1&v=1&projects=p-a,p-b&models=latest`
  (the Chrome Web Store id; an unpacked copy has another). `models` may
  be a slug list, `latest` (resolved over this machine's list) or absent
  (nothing ticked). OK fills the form, saves it as a manual edit would and
  shows a "Filled from a link" banner with a Clear button; Cancel changes
  nothing. A link never starts a run and never changes the mode,
  step-by-step, the include-done box, the questionnaire or the timing.
  Any unknown or repeated key, a wrong version, an invalid or repeated id
  or slug, more than 23 projects, more than 13 models or more than 4,096
  characters refuses the whole link with one reason; a link during a run
  is dropped with one error line. The manifest is unchanged.
  `MGC.parseDeepLink` (`common/constants.js`), the suite
  `extension/test/deep-link.cjs` (the parser) and a new section in the
  popup suite. A console link carrying the values was designed too and
  dropped before the release: it did not work in the owner's test
  (`docs/scoping/03-deep-links.md`).
- `scripts/deep-link/`: `mgc_link.py` and `mgc-link.sh`, two small generators
  that print a deep link for a project list and a model list (for a runbook
  or a pipeline; the extension validates the link when it is opened). They
  default to the store id; `--extension-id` or `MGC_EXTENSION_ID` sets the
  id of an unpacked copy.

### Changed
- The model list is sorted by release date, newest first, at load time. The
  file order no longer matters.
- As after every version bump, the first popup open after the next release
  resets the model selection to none once. The `latest` link is the
  one-click way back.

[0.9.0]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.9.0

## [0.8.0] - 2026-10-08

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

## [0.7.0] - 2026-10-08

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

## [0.6.1] - 2026-10-08

### Changed
- The "Include pairs already done" box is no longer remembered between runs;
  it is a choice for each run and is named in the full-run confirmation.

### Fixed
- The repeat-purchase guard tolerates malformed run records and compares
  names without regard to case.
- The log migration from 0.5.0 skips malformed lines instead of failing.
- Downloaded logs also replace invisible and C1 control characters.

[0.6.1]: https://github.com/pepsi133/model-garden-clicker/releases/tag/v0.6.1

## [0.6.0] - 2026-10-08

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

## [0.5.0] - 2026-10-08

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

## [0.4.0] - 2026-10-08

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

## [0.3.0] - 2026-10-07

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
