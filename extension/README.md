# Model Garden Clicker

A Chrome extension (Manifest V3) that enables Anthropic Claude models in the
Cloud console Model Garden for many projects, one project and model at a time,
inside your own signed-in browser. There is no build step: the folder you are
reading is the extension.

Everything the extension stores (questionnaire values, the job queue, results
and the log) lives only in this browser's local extension storage, and the
full per-run logs in the extension's local IndexedDB. Nothing is synced to
an account and nothing is sent anywhere by the extension itself.

## Load the extension

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (toggle in the top-right corner).
3. Click **Load unpacked**.
4. Pick this `extension` folder.
5. Pin "Model Garden Clicker" from the extensions menu so the icon stays visible.

After editing any file in this folder, click the reload icon on the
extension's card in `chrome://extensions`.

## Fill in the options

1. Right-click the extension icon and choose **Options**, or click the
   **Options** button in the popup's header. While a required option is
   missing the popup shows a red notice naming the fields and **Start**
   stays disabled.
2. Fill every questionnaire field: business name, business website (with
   `https://`), contact email, headquarters country, industry, intended
   users, use cases, and the Yes/No answer about additional Acceptable Use
   Policy requirements. Headquarters, industry and intended users are
   dropdowns holding the console's own option texts
   (`common/option-lists.js`); the last entry, **Other (type the exact
   console option)**, reveals a text field for an option that is not in the
   list. A previously saved value that is not in the list is shown there.
   A dropdown whose list is empty in `option-lists.js` is a plain text field.
3. If the Acceptable Use Policy answer is **Yes**, the details field appears
   and is required; it is typed into the console's "If yes, please describe
   ..." field. For **No** it is hidden and ignored.
4. Leave the **DRY RUN** box ticked (see "Modes" below). Tick
   **Step-by-step confirmation** if you want to approve every Next and
   Agree yourself. Leave **Advanced** alone unless a timeout needs changing
   (see "Advanced timing settings" below).
5. Click **Save**. Save refuses with the reason when a required field or the
   AUP details are missing or the advanced JSON is invalid.

## Modes

The options page has one mode control, a checkbox labelled **DRY RUN**
that is ticked by default. While it is ticked the extension fills the forms
but never approves or enables anything, and stops on the Agreements page.
Unticked means a **full run**: the extension clicks Agree, which makes
purchases that bill the project. The popup's header shows the mode as
**MODE: DRY RUN** (neutral) or **MODE: FULL RUN** (red), and a full run asks
for a confirmation when you click Start. The mode cannot be changed while a
run is active: stop the run first. (Internally the setting is stored as
`live_mode`, the inverse of the box.)

The two settings can also be switched from the popup's header:

- the **MODE** banner is a button. Clicking it switches between DRY RUN and
  FULL RUN; switching to FULL RUN asks for a confirmation first (starting a
  full run asks once more). Its tooltip explains the current mode and what
  a click does.
- next to it, a second button shows the step-by-step setting: **slow mode**
  with a snail icon while step-by-step confirmation is on, **kubardy mode**
  with a warning-sign icon (a triangle with an exclamation mark, in the
  same colour) while it is off: each job runs through without pausing, no
  Continue before Next and, in a full run, none before Agree. The button's
  tooltip says so. Clicking it switches the setting, the icon and the label.

Both buttons write the same settings the options page writes, through the
same path, and both are refused with a message while a run is active. The
options page's boxes follow what the popup switched.

## The popup and "Open in a tab"

Chrome caps an extension popup at 800 x 600 px and the popup uses all of
it. The header (photo, title, the two header buttons, **Open in a tab**,
**Options**) and the inputs (the three-row project text area, the model
checklist, the extra-slugs field, Start and Stop, the status line) keep
their natural size and never sit inside a scroll region. The checklist is
a four-column grid, so the twelve models of `models.json` are all visible
without a scrollbar (a longer list scrolls inside the box). The results
table and the log share the remaining height below them with their own
scroll, so unfolding the log never scrolls the whole popup. The log starts
unfolded while a run is active. **Open in a tab** opens the same page in a
normal tab, where it is fluid: it grows with the window (between 360 and
900 px wide) and the checklist takes as many columns as fit; it reads the
same storage and talks to the same worker, so it can be used instead of
the popup at any time, the OK on the end-of-run summary included (the
worker tells that page apart from a console tab by its extension URL, not
by its tab id). The geometry is checked in headless Chrome by
`python/scripts/popup_layout.py`.

## Run a dry run

1. Sign in to the Cloud console in this Chrome profile.
2. Click the extension icon. The banner must read **MODE: DRY RUN**.
3. Paste project IDs into the text area, one per line.
4. Tick the models you want. No model is ticked when the popup is first
   opened; the selection you make is kept in the extension's local storage
   and shown again next time, as are the project IDs and the extra slugs.
   The first time the popup opens after an update, the model selection is
   reset to none once, so an upgrade never carries an old full selection
   into a Start; later opens keep whatever you picked.
   Add any other model slugs in the extra field,
   separated by commas or new lines. Slugs are the last path segment of a
   model's Model Garden URL, for example `claude-haiku-4-5`.
   The **Include pairs already done in earlier runs** box (unchecked by
   default) controls the cross-run guard: with it unchecked, a project and
   model pair that an earlier run recorded as done, or as unverified with
   Agree already clicked, is created as `skipped` in the new queue (the
   message names the earlier run) so the extension does not line up a
   purchase for a pair it may already have bought. Tick the box to run those
   pairs anyway. A pair that was only dry-run, or skipped because the model
   was already enabled, is never skipped by this guard. This is separate
   from, and in addition to, the model page's own already-enabled check,
   which still runs for every job.
5. Click **Start** (a dry run starts at once; only a full run asks for a
   confirmation). The extension opens one tab and works through every
   project and model pair in order. A dark badge in the tab's bottom-right
   corner (at most 520 px and 40 % of the window wide: in a window at
   least about 600 px wide it stays clear of the console's own Next and
   Agree buttons at the bottom left) shows, updated
   every second: job N of M with the project and
   model and the job's elapsed time; the current step with its elapsed
   seconds and timeout (what the extension is waiting for or doing); what
   happens next in this phase and the next job's project and model. The
   popup mirrors the current step under its status line. Leave that tab
   alone while a run is active: the extension refuses to act on a page that
   is not the job's project, the model page is checked against the job's
   model slug before anything is decided on it, and a job whose page
   changed under it is marked `failed`. A page never acts for a job it did
   not start: the previous job's page, in the instant before the tab is
   navigated to the next job, never judges or clicks for that next job,
   whatever project or model it shows, whether it reported its own job or
   the watchdog ended that job unreported; the navigation always brings a
   fresh page, and if it never lands the watchdog ends the job.
6. In a dry run the extension clicks Enable as soon as the button is present
   and enabled and no "Enable APIs" dialog is showing, fills the
   questionnaire, clicks Next, checks that the Agreements page is the job's
   own (the job's project and the product the questionnaire was for from
   the URL at once; the model's exact name and version from the rendered
   Purchase summary, waited for together with the terms checkbox and the
   Agree button), ticks the terms checkbox and stops the instant the tick
   is verified. It never clicks Agree. The results table marks the job
   `dry-run`; if the page was not the job's, the job is marked `failed`
   with the reason instead (a summary that never names the model fails
   after `agreements_ready_ms`).
7. Click **Stop** at any time to end the run after the current action.

The log (bottom of the popup, last 50 lines) carries timing marks per
phase: `<page> page detected`, `action started: ...` and `action done: ...`,
each with `+<ms>` since the job started (the moment the worker navigated
the tab), so the time from Start to the Enable click and from Next to the
checkbox tick can be read from it. It also records the option texts of
every dropdown the questionnaire offered (`select "headquarters" offers
182 options: ...`); that is where `common/option-lists.js` comes from.
The popup shows the last 50 lines and its storage keeps the last 500;
every line of every run is kept in full on the Runs page (below).

## The Runs page: full per-run logs

Every log line the extension writes while a run is active (from the
worker, the content script in the console tab and the extension's own
pages) is also appended, without any cap, to a record of that run in the
extension's IndexedDB, next to the run's id, its start and end, the mode
(dry run or full run), whether step-by-step confirmation was on, the job
list and the result of every job. The service worker is the only writer;
it opens the database for every write and closes it again, so a worker
that Chrome stops and restarts in the middle of a run keeps appending to
the same record. A database error (the quota exhausted, the database
unopenable) is reported once per run with a line in the popup's log and
the run goes on without the full log: the full log never fails a job.

The **Runs** link in the popup's header (next to **Open in a tab**) opens
the Runs page in a tab. It lists the runs newest first with the start and
end, the mode, the number of jobs, the counts (done, dry-run, skipped,
failed, unverified, stopped) and the size of the log, and offers per run:

- **Download log**: saves the run as a plain-text file named
  `model-garden-clicker-run-<YYYYMMDD-HHMMSS>.txt` (the start, in local
  time). The file is built in memory and saved through a link with the
  `download` attribute, so no permission is needed. It opens with a header
  block (run id, start and end as ISO timestamps, mode, step-by-step,
  reason the run ended, job count with the counts, line count), then the
  job results as a plain-text table, then one line per log entry:
  `<ISO timestamp> <source> [<level>] <message>`, where the source is
  `worker`, `content` or `ui`.
- **Delete**: removes that run's record after a confirmation. The run in
  progress cannot be deleted.

At the top, **Download all** saves every run in one text file
(`model-garden-clicker-runs-<now>.txt`), each under its own header,
newest first, and **Purge all** deletes every record after a confirmation
that states how many runs there are (a run in progress keeps its record).
Deleting goes through the worker, like every other write.

The log text holds what the popup's log holds, in full: step names,
timings, the option texts the console offered and, on a failure, the name
of a rejected questionnaire field and the value the console rejected. The
questionnaire values are not written to it otherwise. The project IDs and
model names of the jobs are in it, since the jobs are named by them.

Retention: when a run starts, the oldest records beyond **Runs to keep**
are deleted. The setting is in the **Logs** section of the options page
(default 50, between 1 and 500; Save refuses anything else). That section
has the same **Purge all** button. Everything stays in this browser's
local extension database; nothing is synced or sent anywhere, and the
manifest asks for no new permission for any of this (no `downloads`, no
`unlimitedStorage`; see "Permissions").

Some model pages need a manual step before Enable works (an additional
consent checkbox; see `docs/BACKLOG.md`). The extension never clicks a
disabled Enable button. When Enable is disabled and an unchecked checkbox
is on the page, the job is marked `failed` at once with a message naming
the manual step; a disabled Enable with no such checkbox is waited for
(`model_ready_ms`, three attempts) and then fails with a timeout. When an
Enable click does not open the questionnaire within `nav_ms` the job is
marked `failed` with a message that says so. Complete the step by hand in
the console, then start the job again.

If the console shows its "Enable APIs" dialog (the Agent Platform API must
be enabled in the project), the extension clicks that dialog's Enable button,
waits for it to close and continues. If the dialog comes back for the same
job, the job is marked `failed`.

If a questionnaire field is rejected by the console (for example a website
without `https://`), the job is marked `failed` with the field's name and
Next is not clicked. A dropdown value the console does not offer (the
option texts change now and then) fails the job the same way, at once,
with the options the console offered in the message. Fix the value in the
options page and start again.

The next job starts the instant a result is recorded (the `settle_ms`
setting can add a pause). Each phase of a job has a ten-minute watchdog
(`watchdog_min`). A job that produces no result in that time is marked
`failed` (or `unverified` when Agree had already been clicked) and the run
moves on. If the model is already enabled for a project the job is marked
`skipped`; the enabled state (the "Open in Agent Studio" link with no
Enable button) must hold for two poll intervals and at least 500 ms first
(`poll_ms` is 250 by default), because the console can render that link a
poll before the Enable button.

A project the console cannot open (no such project, no access, a misspelt
ID that passes the format check) does not wait for the watchdog. When the
console leaves the model page's URL for a page the extension does not
know, the job is marked `failed` after `model_ready_ms` with a message
naming the project and the path the tab shows; when the console keeps the
model page's URL but renders no model page at all, the model-page wait
names the project the same way and the job fails after its three
attempts (3 x `model_ready_ms`).

Reloading the extension or restarting Chrome during a run ends the run:
it never resumes on its own. Disabling and re-enabling it ends the run
too, except for a job that was waiting for your Continue, which keeps
waiting until you press Stop (see "Step-by-step confirmation"). However
the run ended, the job that was in progress is marked `stopped`, or
`unverified` if Agree had already been clicked (the purchase may have gone
through: check that project by hand); the rest stay `pending`. Start again
to continue.

When a run ends, for any reason (all jobs processed, Stop, a failure, a
lost tab), the badge in the worker tab turns into an end-of-run summary:
the counts (done, dry-run, skipped, failed, unverified, stopped), one line
per job with its project, model, status and a short message (at most
twelve lines, then "and N more") and an **OK** button. It stays until you
press OK: the summary is recorded in storage with the run's id, so a
reload or a route change of that tab shows it again. The popup, as the
action popup or opened in a tab, shows the same summary above its results
while it is unacknowledged, with its own OK that dismisses both. The next
Start clears it. The extension never brings the worker tab or its window
to the front for this (nor for a later job's navigation: only the tab's
creation, right after Start, opens it in front), never opens the popup by
itself and raises no system notification.

Because of that, a worker tab you switch away from stays in the
background for the rest of the run, and Chrome throttles a hidden page's
timers: after one minute they run once a second at most, and after five
minutes hidden a chain of timers (every wait of the extension is one)
wakes once a minute. A job in a tab hidden that long crawls through its
waits and can hit the per-phase watchdog (`failed: timeout`); nothing
wrong is clicked, since every click re-checks the page at click time, and
the watchdog bounds the effect. To avoid it, keep the worker tab visible
in its own window (drag it out, or start the run from a window you do
not use) rather than switching tabs in front of it.

## Step-by-step confirmation

With **Step-by-step confirmation** ticked in the options page (or the
popup's header button on **slow mode**), the extension fills each page and
then waits for you. The badge in the worker tab turns into a panel with a
summary of the step and two buttons:

- before **Next**, once the questionnaire is filled and valid: **Continue**
  makes the extension click Next; **Stop** ends the run;
- before **Agree**, in a full run, once the terms checkbox is ticked:
  **Continue** makes the extension click Agree (the purchase); **Stop** ends
  the run;
- in a dry run there is no Agree to confirm: once the terms checkbox is
  ticked the panel shows the dry-run message with **Next job** and **Stop**.
  The job ends `dry-run` on either; **Next job** lets the run go on, **Stop**
  stops the run after this job (the worker honours that stop only with the
  result of the job that is current, so a late result for an earlier job
  can never stop the run after a later one). The job does not end until
  you press one.

Only a click or keyboard activation that the browser marks as trusted
(`event.isTrusted`: a real pointer click, Enter or Space on the focused
button, or an automation driver) counts on **Continue** and **Next job**;
clicks dispatched by page script are ignored and logged. **Stop** takes
any click: a script-dispatched Stop can only end the run, which is
harmless. The Agree guard additionally
requires that such a Continue was recorded for this job's Agree step within
the last five minutes.

If you click the console's own Next instead, the extension notices the page
leaving the questionnaire and continues. If you activate the console's own
Agree yourself, a listener on that very button (capture phase) records it:
a trusted click, which is also what the browser fires for Enter or Space
on the focused button (key events on their own never count: a keydown,
with or without its keyup, that produces no click records nothing and
locks nothing). The job records
`agreeClickedByUser` and the console's confirmation or error dialog is
then judged exactly as after the extension's own click (`done`,
`unverified` or `failed`). The extension never infers your click from a
dialog: a "Successfully purchased" dialog that opens while nobody activated
Agree ends the job `unverified: the console reported a purchase while
waiting for confirmation` without recording a click, and an unrelated
error dialog is treated like any open dialog (below). Click one or the
other, not both; either order ends in one click, yours: if you click the
console's Agree and then Continue within the same seconds, the Continue is
ignored and your click's outcome is judged; in the reverse order (Continue,
then the console's Agree before the extension's click happens) the guard
checks for your activation at every step up to the instant of its click
and refuses, undoing the click record it had made, and the job is likewise
judged on your click, not reported `failed`.

While a console dialog is open (an error, or the "Enable APIs" dialog) the
panel's Continue is disabled and the dialog's title is shown in the panel;
close it in the console and Continue is enabled again. The "Enable APIs"
dialog is cleared by the extension itself (its Enable is clicked, as on any
page) and the panel is shown again; a Stop during that dialog's close wait
is honoured at the next poll, not after the dialog's full timeout. A
Continue never reaches the Agree guard while a dialog is open; if a dialog
opens in the instant between your Continue and the click, in either of the
guard's windows (before it records the click, or during the record's round
trip to the worker, in which case the record is undone, since no click was
made), the guard refuses and the panel asks again instead of failing the
job; the same happens when the page changes under the guard during that
round trip (the Agree button hidden or disabled by a re-render): every
refusal raised after the record undoes it, because the click comes after
that check. The spent Continue is forgotten and the next one must be a
fresh click. The extension asks again at most five times for one job.

While a job waits, the popup's status reads `waiting for your confirmation
on <project>/<model>: Next` (or `Agree`, or `Next job`), the job's phase is
`awaiting_confirmation`, and the watchdog is paused (it is re-armed when you
continue), so taking your time never fails the job. If the extension is
disabled and re-enabled while a job waits, the panel is gone but the run
stays in that state: click **Stop** in the popup. If the worker tab itself
is gone when the extension comes back, the run is stopped with the job
marked `stopped: worker tab is gone while the job waited for your
confirmation`. Step-by-step, like the mode, cannot be changed while a run
is active.

## Switch to a full run

1. Run at least one dry run and check that the form is filled correctly on the
   Agreements page.
2. Open the options page, untick **DRY RUN**, click **Save**. The mode cannot
   be changed while a run is active: stop the run first.
3. The popup banner now reads **MODE: FULL RUN** in red. Starting a run asks
   for one more confirmation.
4. The mode is fixed when the run starts: the popup sends the mode its
   banner showed (and, for a full run, that you confirmed), and the run is
   refused if the saved setting changed in between. In a full run the
   extension clicks Agree once per job, and only when the page is the
   Agreements page of the job's project, product and model (exact version:
   a Claude Sonnet 5 job is refused on a Claude Sonnet 5.5 page), the terms
   checkbox is verified checked, the run is still the one that was started
   and nothing changed while the click was being recorded, no console
   dialog is open (a dialog open at that moment refuses the click and fails
   the job with the dialog's text; with step-by-step on the panel asks
   again instead), and, with step-by-step on, you pressed Continue for that
   step within the last five minutes. The job is `done`
   the moment the console's "Successfully purchased <model>" dialog appears
   (5-7 s after the click), provided the dialog opened after the click and
   names the job's model; the next job starts right away, without waiting
   for the model page to show the enabled state (that can lag by minutes).
   `unverified` means Agree was clicked but no such dialog appeared within
   `confirm_ms` (default 60 seconds; check that project by hand). A refusal
   by the console, for example a billing account that cannot buy, is
   reported as `failed` with the console's message. Only the console's
   refusal dialog counts as a refusal: the shape recorded in
   `docs/dom-map.md` (a `behavior-failure-dialog`, or a dialog whose title
   or text carries the recorded wording about a billing account that
   cannot purchase). Any other error dialog that opens after the click is
   not taken as the outcome, because a transient error next to a purchase
   that goes through would report the purchase as failed: the extension
   logs it and keeps waiting for the confirmation for `agree_grace_ms`
   (default 15 seconds), during which a "Successfully purchased" dialog
   still makes the job `done`; if that dialog is still open when the grace
   ends, or it closed by itself and nothing else appeared within
   `confirm_ms`, the job is `unverified` with the dialog's text.

A full run accepts the publisher's terms and enables billing-relevant
products in every project you queue. Tick **DRY RUN** again when you are
finished.

## Advanced timing settings

The **Advanced** section of the options page holds a JSON object with every
timeout and poll interval. The defaults come from `common/constants.js`
(**Reset to defaults** refills the field; Save stores it). A key left out
keeps its default; values are checked on Save (integers within the bounds
below, and `watchdog_min` must exceed the largest phase budget plus
`api_dialog_close_ms`, where the budgets are: model
3 x (`model_ready_ms` + `nav_ms`) + `model_ready_ms`; questionnaire
3 x (`form_ready_ms` + `form_valid_ms` + `next_button_ms` + `nav_ms`);
agreements 3 x `agreements_ready_ms` + `confirm_ms`). A refused Save shows
the reason under the timing field and leaves every other field as you
edited it. The worker and the content script read the stored values on
every use and fall back to the constants when nothing is stored.

| Key | Default | Bounds | What it bounds |
|---|---|---|---|
| `model_ready_ms` | 60000 | 1000-600000 | Model page: an enabled Enable button (with no "Enable APIs" dialog) or the enabled state. |
| `api_dialog_close_ms` | 120000 | 1000-600000 | "Enable APIs" dialog closing after its own Enable was clicked. |
| `form_ready_ms` | 30000 | 1000-600000 | Questionnaire form rendered after Enable. |
| `form_valid_ms` | 3000 | 500-60000 | Every questionnaire field valid after filling, before Next. |
| `next_button_ms` | 10000 | 500-60000 | An enabled Next button after filling. |
| `nav_ms` | 45000 | 1000-600000 | URL change after Enable or Next. |
| `agreements_ready_ms` | 45000 | 1000-600000 | Purchase summary naming the model, terms checkbox and Agree button rendered on the Agreements page. |
| `confirm_ms` | 60000 | 1000-600000 | Full run only: success or error dialog after Agree; used in full only when no dialog appears. |
| `agree_grace_ms` | 15000 | 1000-600000 | Full run only: after an error dialog that is not the console's refusal, how long a success dialog may still arrive before the job is `unverified`; bounded by `confirm_ms`. |
| `poll_ms` | 250 | 50-5000 | Poll interval of the page loop and of every wait above. |
| `settle_ms` | 0 | 0-60000 | Pause between a job's result and the next job's navigation. |
| `watchdog_min` | 10 | 1-60 | Per-phase watchdog (minutes); a phase without a result in that time fails the job. |

## Files

| Path | Purpose |
|---|---|
| `manifest.json` | Extension manifest (MV3). |
| `models.json` | Model list shown in the popup (from `docs/models.md`); replace it to change the list. |
| `common/constants.js` | Storage keys, phases, statuses, time budget and its validation, required-settings check, URL builder. Shared by every part. |
| `common/option-lists.js` | The questionnaire dropdown option texts for the options page. |
| `common/runlog.js` | The per-run logs in IndexedDB: the record shape, one-transaction reads and writes, retention, the plain-text format and file names. |
| `common/theme.css` | The palette (CSS variables) shared by the popup, the options page and the Runs page; see "Theme". |
| `background/service-worker.js` | Queue, worker tab, run identity, watchdog alarm, all storage writes, the only writer of the per-run logs. |
| `content/dom.js` | Generic Angular Material helpers; refuses to click anything containing "agree". |
| `content/selectors.js` | Every console DOM locator and URL check, written from `docs/dom-map.md`. |
| `content/badge.js` | Floating status badge (job, step with timeout, plan, next job), the step-by-step panel and the end-of-run summary. |
| `content/actions.js` | Per-page handlers, the step-by-step wait and `clickAgreeGuarded()`, the only function that clicks Agree. |
| `content/main.js` | Page loop: detects the page and runs the handler. |
| `popup/` | Start/stop UI (popup and tab layouts), mode banner, missing-options notice, step mirror, results table, the last 50 log lines and the link to the Runs page. |
| `options/` | Questionnaire values (dropdowns with "Other"), the DRY RUN and step-by-step boxes, the advanced timing JSON and the Logs section (Runs to keep, Purge all). |
| `runs/` | The Runs page: every run's full log, newest first, with Download log, Delete, Download all and Purge all. |
| `icons/` | Toolbar icons, the 96 px header avatar (`avatar96.png`) and the 512 px master the sizes are made from (`icon-master.png`, kept in the repository, left out of the release zip). |
| `test/` | Offline tests; see `python/README.md` (developer manual). |

## Package for the Chrome Web Store

The Web Store takes a zip of the runtime files with `manifest.json` at the
root. Build it from the repository root:

    sh scripts/build-extension-zip.sh

This writes `dist/model-garden-clicker-<version>.zip` (the version comes from
`manifest.json`; `test/`, `node_modules/`, `package.json` and
`icons/icon-master.png` are left out).
Pushing a tag `v<version>` builds the same zip in GitHub Actions and attaches
it to a GitHub release.

Upload it by hand: open the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole),
choose the item (or **New item** the first time), open **Package**, click
**Upload new package**, pick the zip, fill in the store listing and privacy
fields, then **Submit for review**. Bump `"version"` in `manifest.json`
before every upload; the store rejects a version it has already seen.

## Permissions

The manifest asks for `storage` (the settings, queue and log in local
extension storage) and `alarms` (the watchdog), plus host access to
`https://console.cloud.google.com/*` for the content script and the worker
tab. It does not ask for the `tabs` permission: the install prompt lists
only "Read and change your data on console.cloud.google.com", never
browsing history. Opening, navigating and watching the worker tab needs no
further permission. The per-run logs need none either: IndexedDB is
available to an extension without a permission (and without
`unlimitedStorage`, under the normal origin quota), and a log is saved
through a link with the `download` attribute, not the `downloads` API.

## Development

Selector details, the offline tests, the headless layout probe of the popup
and the end-to-end dry run are described in `python/README.md`.

## Icon and theme

The extension icon is a photo of the author's own dog, a German Shepherd,
cropped to a square avatar centered on the face (`extension/icons/icon-master.png`
at 512x512, downscaled to the 16/32/48/128 sizes the manifest references
and to `icons/avatar96.png`, the 96 px copy the popup and the options page
show in their header; the master stays in the repository but is not
shipped in the release zip). The step-by-step button's snail (slow mode)
and warning-sign (kubardy mode) icons are small inline SVG paths, not
image files.
Promotional images for the Chrome Web Store listing live in `store/`.

The colours of the popup and the options page come from that photo:
`scripts/icon-palette.py` (repository root; needs Pillow) quantizes it,
picks the amber wall, the dog's tan and dark brown and the off-white
ceiling, derives the background, surface, text, accent and border colours
from them and checks the WCAG contrast of every text pair (all are above
4.5:1, including links and the status colours; body text is 16:1) and of
the focus ring (the dark accent, above the 3:1 non-text floor on both
backgrounds). Its output is `common/theme.css`, a set of `--mgc-*` CSS
variables that both pages use; the warning red for full-run notices is
chosen apart from the photo so it still reads as a warning on the warm
background. Rerun the script after changing the photo and paste its output
into `theme.css`.
