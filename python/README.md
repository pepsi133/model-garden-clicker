# Model Garden Clicker: developer manual

This directory holds the Selenium harness that records the console pages
(`recon`), drives the same "Enable" flow for selector work, and runs the
Chrome extension end to end in a dedicated Chrome profile. The offline
tests of the extension (`extension/test/`) read the recorded pages, so they
are described here too.

The harness drives the flow up to the final confirmation page: it fills the
questionnaire, clicks Next, ticks the terms checkbox, and stops. **It never
clicks Agree** unless `--i-approve-agree` is given explicitly.

This file is the reference for each script. The ordered procedure for a
console change (record the pages, compare them with `docs/dom-map.md`,
update `extension/content/selectors.js`, run the offline suite, run one
browser dry run, bump the version and tag) is `docs/MAINTENANCE.md`.

## Setup

1. Run `python/setup.sh`. It creates `python/.venv` and installs Selenium.
   On first browser launch Selenium Manager downloads a matching chromedriver
   into `~/.cache/selenium/` (any chromedriver on PATH is ignored because it
   may not match the installed Chrome).
2. Copy `python/config.example.json` to `python/config.local.json` and fill
   in your business details. The file is gitignored. The three dropdown
   values must be option texts the console offers (`docs/dom-map.md` lists
   them).
3. Run `python/.venv/bin/python python/scripts/login.py`. A Chrome window
   opens on the dedicated profile `python/.chrome-profile/`. Log in to
   Google there, then press Enter in the terminal. Do this once; cookies
   persist in the profile. The profile holds a live Google session: keep it
   out of backups and shared drives.

## Recon: record the console pages

    python/.venv/bin/python python/scripts/recon.py --project my-gcp-project --model claude-haiku-4-5

Snapshots (page.html, screenshot.png, url.txt, forms.json) land in
`python/recon/<timestamp>-<project>-<model>/NN-<step>/`. On failure the
current page is dumped as `99-failure`. The dumps hold the filled form, so
`python/recon/` is gitignored.

The selectors in `mgclick/form.py` were validated against live runs on
2026-10-07; the DOM they rely on is written up in `docs/dom-map.md`. When
the console changes, follow `docs/MAINTENANCE.md`.

### Reaching the model page through the gallery

    python/.venv/bin/python python/scripts/gallery_recon.py --project my-gcp-project --model claude-sonnet-5 [--i-approve-agree]

Opens the Model Garden gallery (`agent-platform/model-garden`), types into
the gallery's own "Search models" box (not the console's global bar; the
query must not contain `/`, which the console binds as a shortcut), presses
Enter (typing alone does not search), records every result row, clicks the
row whose title is exactly `--title` (default `Claude Sonnet 5`; falls back
to the row whose link ends in `/model-garden/<model>` and says so), confirms
the model page URL, then runs the same Enable flow as `recon.py`
(`mgclick/flow.py` holds the shared step functions). Dumps land in
`python/recon/<timestamp>-gallery-<project>-<model>/` as `00-gallery`,
`01-search` (+`search-candidates.json`, `search.json`), `02-results`
(+`cards.json`), `03-model-page` (+`click.json`), then `02-after-enable` ..
`05-agreements-checked` and, with `--i-approve-agree`, `06`-`08` exactly as
`recon.py` names them. The gallery DOM is written up under "Gallery path"
in `docs/dom-map.md`. Before launching, the script refuses to start if a
Chrome process already holds the profile and removes stale `Singleton*`
links otherwise.

### Clicking Agree (explicit opt-in only)

    python/.venv/bin/python python/scripts/recon.py --project my-gcp-project --model claude-haiku-4-5 --i-approve-agree

Only with this flag does the script call `form.click_agree_approved`, the one
function that bypasses the "agree" guard. It then records `06-after-agree`,
`07-post-agree-settled` (success dialog, error dialog or redirect, up to
120 s) and `08-model-page-after`. An "Enable APIs" dialog, if the project has
no Agent Platform API yet, is handled on any page and dumped as
`NN-<step>-api-dialog`.

## How the extension's selectors work

`extension/content/selectors.js` holds every console locator, written from
`docs/dom-map.md`. It relies on component tag names
(`vertex-ai-request-access-button`, `cfc-select`, `mat-dialog-container`),
the questionnaire's `raf-name` attributes, Google's own test hooks
(`p6ntest-mp-agreements-body-tos-checkbox`, `data-prober`) and trimmed button
text; generated ids are never used. Pages are told apart by URL path only;
the agreements page must sit under `/marketplace/agreements/anthropic/`.
Two details worth knowing when the console changes:

- The dropdowns are `<cfc-select>` (a Cloud console wrapper), not
  `<mat-select>`. `MGC_DOM.selectOption()` clicks the inner
  `.cfc-select-trigger`, finds the `mat-option` elements in the body-level
  `div.cdk-overlay-container` and matches the option's
  `.cfc-select-option-primary` text exactly (the raw `textContent` of an
  option is doubled by a hidden copy).
- The model page's Enable button is always looked up outside
  `mat-dialog-container`, because the conditional "Enable APIs" dialog has
  its own Enable button. That dialog's button is only reached through
  `clearBlockingDialog()`, which checks the text is exactly `Enable`.

Before Next is clicked every questionnaire field must be `ng-valid`
(`S.questionnaire.invalidFields()`); the questionnaire URL's `mp` parameter
(the Marketplace product id) is recorded on the job and the Agree guard
requires the Agreements URL to carry the same product id, the job's
`?project=`, and a page text that names the model.

In a full run the result after Agree is read from the console's own dialogs:
`mp-consent-complete-dialog` ("Successfully purchased ...") marks the job
`done`; a `behavior-failure-dialog` (for example "Action Required: Choose
Different Billing Account") marks it `failed` with that dialog's title and
text as the message.

## Offline tests of the extension

    cd extension/test && npm ci    # once; installs jsdom from the committed lockfile
    sh extension/test/run.sh

`run.sh` runs `node --check` on every extension file, greps that
`unguardedClick()` and `agreeButton()` are consumed only inside
`clickAgreeGuarded()`, then runs nine harnesses with node:

| File | What it covers |
|---|---|
| `test/worker-harness.mjs` | The service worker against a fake `chrome` API: queue, worker tab, run id and live-mode snapshot, the popup opened in a tab treated as UI (its summary OK accepted, its job messages refused), Start refused when the mode the popup sent differs from the setting, stale-run messages dropped (also when Stop and Start interleave a message already being checked), watchdog re-armed per phase and `unverified` after a recorded Agree click, stop, recovery after a worker restart between jobs, a restart without the watchdog alarm (extension disabled and re-enabled) stopping the run, the `awaiting_confirmation` phase pausing the watchdog, a waiting job whose tab is gone stopped with a clear result, and a result with `stopAfter` ending the run instead of advancing. The per-run logs against a fake IndexedDB (`test/lib/fake-idb.cjs`, the subset `common/runlog.js` uses, with a switchable quota failure and a request counter): one record per run with its metadata, job list, results and counters, its lines in their own store (one record per line; worker, content and ui sources), the storage log still capped, a fresh worker instance appending to the same record, every database open closed again, a quota error logged once and never failing a job, an unopenable database refusing a full run and warning in a dry run, retention (`runs_keep`, default 50) pruning at Start, delete/purge refused from a content script and for the run in progress, a 10,000-line run deleted with one ranged request while another run appends, and the cross-run double-purchase guard from its sources (the run records, the previous run's queue in storage and the purchased-pairs memory, which outlives wiped records), through a full-run flow ended by a reload. |
| `test/content-guard.cjs` | Every refusal of `clickAgreeGuarded()`: dry run, stop, wrong job or phase, the real Agreements page served under another project, another vendor's path or another product id, a page that does not name the model (exact version: Claude Sonnet 5 is not Claude Sonnet 5.5 and the reverse), a run started in dry-run mode, a stale run id, a second click for the same job, anything that changes while the click is being recorded, a console dialog open at click time; that live mode with every condition met clicks Agree exactly once (in jsdom only); that a dry run on a page that is not the job's fails instead of reporting `dry-run`; that the model name is judged on the rendered Purchase summary (a body that renders late is waited for, stale questionnaire text is not trusted); and that the post-Agree wait accepts only a dialog that appeared after the click and names the job's model. |
| `test/main-loop.cjs` | The page loop in `content/main.js` with a fake `chrome`: `assertMayAct()` refusing after Stop, after a replaced run and on another project's page; the tick-level project check; one document, one job (a page that reported a job never acts for the next one, in the same project or another, whether it shows the enabled state, an Enable button or the ticked Agreements page, while a fresh document does); an idle tab reading storage once and polling only while a run is active; `handled` reset after a cleared "Enable APIs" dialog; attempts exhausted and fatal-error routing; one result per job; the badge and the mirrored step line; on the real ticked Agreements dump, one live Agree click reported `unverified` and no click without `?project=`; and with step-by-step on, the "Enable APIs" dialog cleared during the wait followed by a trusted Continue (one click, not a failed job), an error dialog disabling Continue and a Stop ending the loop, and the dry-run Next job / Stop panel. |
| `test/dialog-step.cjs` | `clearBlockingDialog()` on the real "Enable APIs" dialog: one Enable click per job, a second appearance fails the job, a non-Enable button is refused. |
| `test/model-step.cjs` | `handleModelPage()`: a URL naming another model than the job's fatal before any decision; Enable clicked once on the plain page, skipped on the enabled page only once the enabled state held for two polls and 500 ms (an Enable button one poll after the Studio link is still clicked), a disabled Enable never clicked, the "Enable APIs" dialog cleared first, a click that does not leave the model page fails at once; a disabled Enable next to an unchecked consent checkbox (synthetic and run E) fails at once with the manual-step message, while run F's radio-card page is clicked as usual. |
| `test/questionnaire-step.cjs` | `handleQuestionnaire()` on the real filled form: product id recorded, another model refused, a URL without a parsable `model=` refused before anything is recorded, Next clicked once when valid, Next not clicked and the job failed with the field's name when a field is `ng-invalid` (class injected by the test), hidden hosts ignored, a dropdown value the console does not offer fatal on the first attempt with the offered names, AUP details filled only for Yes. |
| `test/step-by-step.cjs` | The confirmation panel: untrusted clicks ignored, a trusted Continue (jsdom's own event dispatch; the helper in `lib/env.cjs` fails the file when jsdom's internals move) recorded for the guard, a console dialog disabling Continue and naming the dialog, the "Enable APIs" dialog cleared from the wait, Stop ending the wait; `handleQuestionnaire` and `handleAgreements` with step-by-step on: the user's own Next seen through the route, the user's own Agree seen through a capture-phase listener (a trusted click; key events alone never count), a success dialog without a user activation ending the job `unverified` with nothing recorded, an error dialog keeping the wait going, a Continue after the user's Agree ignored, a dialog refusal by the guard re-asking instead of failing, the dry-run Next job / Stop panel (the user's own Agree or a purchase confirmation while it waits ending the job `unverified` with the purchase on record), the terms box re-rendered before the tick failing the job, a full run clicking Agree once after a trusted Continue. |
| `test/selectors.cjs` | Every locator and URL check against the saved console pages plus `dom.js` helpers on synthetic markup; the blocker rules on synthetic markup (accept controls, the questionnaire's listbox skip, the controls counted inside the terms box, flow dialogs, switch inputs, live-region banner names) and the absence control over every dump. |
| `test/ui-pages.cjs` | Options page: dropdowns from `option-lists.js` with "Other" (typing never hides the field), AUP details for Yes/No, advanced timing JSON validation (bounds, unknown and prototype-named keys, the per-phase watchdog rule) with the error shown under the field and the questionnaire edits kept, reset, the DRY RUN box stored inverted, the step-by-step box, neither changed during a run, both following a change made in the popup, the Logs section ("Runs to keep" bounded 1-500 with the error under the field, Purge all asking with the count from the database and going through the worker); popup: missing-options notice, Options button, header with the avatar, the MODE banner and the slow mode / kubardy mode button toggling their settings (with the confirm for FULL RUN and the refusal during a run), the Runs link, popup and tab layouts, the mirrored step line, the log opening during a run; the Runs page against the fake IndexedDB: runs newest first with mode, counts and log size, Download log saving `model-garden-clicker-run-<YYYYMMDD-HHMMSS>.txt` through an anchor and an object URL with the documented text format (header block, results table, `<ISO> <source> [<level>] <message>` lines, markup in a message kept as text, no questionnaire value), Download all, Delete and Purge all asking first (the purge confirm states the count) and sending their messages to the worker, a refusal shown, no `innerHTML`; every element id each page script references exists in its HTML; theme contrast (text pairs incl. links, info and ok at 4.5:1, the focus ring at 3:1); the manifest's permissions (`storage`, `alarms`, nothing added for the logs) and host permission. |

A test file whose async body stalls (an await that never resolves) would
let node exit 0 with no summary line; `lib/env.cjs` and the worker harness
register an exit hook that turns that into a failure, so every file must
end with its `ALL ... CHECKS PASSED` line.

The page tests read `python/recon/<run>/<step>/page.html` through a relative
path (`forms.json` next to it restores the live `value`/`checked` state that
`page_source` does not serialise). Run directories are found by shape, newest
first (`extension/test/lib/env.cjs`, `findRun`); the six run letters A to F,
the shape of each and how to record it are in `docs/MAINTENANCE.md`, section
"Run letters". A missing dump is reported as `skip` with its letter, never
as a pass.

### Popup layout in a real browser

jsdom does not lay pages out, so the popup's geometry at Chrome's maximum
popup size, 800 x 600 (the checklist rows keeping their height and never
overlapping, every model of `models.json` shown in at least three columns
with no scrollbar and no truncated name, the inputs outside any scroll
region and inside the viewport, Start and the status line visible without
scrolling, the results/log region below the inputs with at least 120 px
and its own scroll, nothing overflowing 800 x 600, exactly one
step-by-step icon displayed and matching the setting) is checked in
headless Chrome for Testing, in the idle, running and error states:

    python/.venv/bin/python python/scripts/popup_layout.py [idle|running|error|options|runs|all]

It injects a fake `chrome.*` before the page scripts run, loads
`extension/popup/popup.html`, resizes the window so the viewport (not the
outer window) is exactly 800 x 600, and measures the bounding boxes;
screenshots land in `python/recon/popup-layout-<state>.png`. It also loads
`extension/options/options.html` (`options` state) and checks that the
form rendered from storage, the Logs section included, and
`extension/runs/runs.html` (`runs` state) at 900 x 700, checking that its
header, its three buttons and either its empty state or its database
notice rendered (a `file://` page may be refused IndexedDB; the page must
say so in its notice, not throw). For every page it collects the browser console
log (Selenium `goog:loggingPrefs`, browser `ALL`) and fails on any SEVERE
entry, printing them, so an uncaught script error during init or the first
render fails the probe (for example `options.js` referencing an element id
the HTML no longer has; `popup.js` guards its ids and only warns, so for
the popup it is the offline id-existence check in `test/ui-pages.cjs` that
catches a missing id). Run it after changing anything under `popup/` or
`options/`.

## End-to-end dry run of the extension

    python/.venv/bin/python python/scripts/ext_dryrun.py --projects a,b [--models claude-haiku-4-5] [--expect a=dry-run --expect b=skipped] [--step-by-step]

Loads `extension/` as an unpacked extension into the dedicated profile,
fills the extension's options page from `config.local.json` with the DRY
RUN box ticked (verified in `chrome.storage` before and after Start), starts
a run from the popup page and polls the results for up to `--timeout-min`
(default 8). With `--step-by-step` the extension's step-by-step box is
ticked too and the script presses the panel's buttons with real (trusted)
Selenium clicks: Continue before Next, and Next job on the dry-run end
panel of the Agreements page; it never presses anything before Agree (a dry
run never asks; being asked makes it stop the run) and checks the run's log
for the panel and click lines afterwards.
Screenshots of the worker tab per phase and at the end of each job
(`-final.png` is the last frame seen while the job was running, `-after.png`
the first frame after its result; a screenshot blocks while the console is
still painting, so slow poll iterations are logged), the extension log
(`extension-log.txt`) and `results.json` land in
`python/recon/ext-<timestamp>/`. Every job must end `dry-run` (the terms
checkbox ticked, Agree not clicked) or `skipped` (already enabled);
`--expect PROJECT=STATUS` pins the status for a project. Then the script
opens the extension's Runs page in the same session at a 900 x 700
viewport (`runs-900x700.png`): the run just finished must be listed first
with its counts and its log size, and a real click on its **Download log**
must save `model-garden-clicker-run-<YYYYMMDD-HHMMSS>.txt` into the
download directory the browser was started with (`--download-dir`,
default `<evidence dir>/downloads/`, set through Chrome's download
preferences, no prompt); the file's first 20 lines are printed, its
header must name the run id and the mode, its log section must hold
at least as many `<ISO> <source> [<level>] <message>` lines as the capped
storage log, and neither that log nor the storage log may hold an
error-level line (the extension logs every error it catches at that
level). At the end the
script drains the session's browser console log, which covers the worker
tab, the popup page, the options page and the Runs page (`console-log.txt` in the
evidence directory; a `console.error` control is written first and the
check fails if it does not come back, so a zero is a live zero), and fails
on any SEVERE entry whose message names the extension's own scripts or
pages (a `chrome-extension://` URL), while SEVERE noise from the console
page itself is printed as a note only. Exit code 0 means every
expectation held and no SEVERE entry came from the extension's own scripts
or pages; 1 a job ended differently or such an entry was seen; 2 a config
or extension problem (a stale cached worker, a page that did not load, a
refused Start); 3 the profile is signed out or no browser could load the
extension. The check
does not see the service worker's console (it is not part of the session
log; the offline harness covers the worker), which is why the error-level
check on the run log exists: a tick that threw, a handler that threw
something other than a timeout, a worker message handler that threw or a
failed delete each write an error-level line there (the content script's
tick errors also reach the browser console through `console.error` with
the `[MG Clicker]` prefix, as SEVERE entries). A handler timeout stays a
warning: a slow page is retried, not an error.

Browser attempts, in order: (a) `/usr/bin/google-chrome` with
`--load-extension`, which branded Chrome 137+ ignores, so the script checks
that the extension's options page really loads; (b) Chrome for Testing of
the installed Chrome's major version (`--chrome-major` overrides it),
downloaded once by Selenium Manager into
`~/.cache/selenium/chrome/linux64/<version>/` (`--force-browser-download`,
otherwise Selenium Manager hands back the installed branded Chrome), on the
same profile; (c) if that cannot open the profile or the profile is signed
out, the script reports and stops. `mgclick.browser.make_driver` takes
`extension_dir`, `browser_version` and `extra_args` for this.

Before launching, the script deletes the profile's `Default/Service Worker`
directory: Chrome caches an unpacked extension's service worker script
there and keeps serving the cached copy while `manifest.json` has the same
version, so an edited `background/service-worker.js` would not be the one
that runs (the content scripts are always read from disk).

A stale Chrome on the profile makes the next launch exit at once
("Chrome instance exited"); check `pgrep -af chrome` and the profile's
`SingletonLock` before blaming the browser.

The extension is run against your own Google account. The harness starts
Chrome without the automation hints (`enable-automation`,
`AutomationControlled`) because Google sign-in refuses browsers that
advertise them; the dedicated profile keeps that session separate from your
daily browser.
