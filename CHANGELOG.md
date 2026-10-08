# Changelog

All notable changes to Model Garden Clicker are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

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
