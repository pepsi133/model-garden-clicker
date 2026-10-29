# Scoping 04: a check-only run that records which models are enabled in which projects

Date: 2026-10-29. Repository state: branch `claude/sharp-volta-r0t5ep`, after the Skip button and the 200-project limit.
Status: implemented (1.0.0), as proposed, with the open questions answered: not-enabled, dialog never cleared, no CSV, per-run box.

## Summary

The owner wants a read-only session over a list of projects and models. For each pair it records whether the model is enabled. It enables nothing.

Two routes exist.

| Route | Who runs it | Identity | Where described |
|---|---|---|---|
| API | a GitLab runner | a service account, read-only calls (`serviceusage.services:batchGet`, `modelGardenEula:check`) | scoping 02, sections "What a service account can do" and "Recommended architecture", open question 9 |
| Browser | a person | the signed-in Chrome profile | this document |

The browser route needs no new detection. The extension already reads the enabled state on the model page and reports `skipped: already enabled`. A "check only" run is the model-page handler stopping before Enable.

## Current state

| Piece | Where | What it does |
|---|---|---|
| Model-page handler | `extension/content/actions.js`, `A.handleModelPage`, around line 379 | Checks the URL slug, then polls with `D.waitFor`. `S.model.isAlreadyEnabled()` must hold across polls for `K.enabledConfirmMs()` (around line 391). Then it returns `skipped: already enabled` (around line 431). Otherwise it clicks Enable (around line 437). A visible "Enable APIs" dialog goes to `A.clearBlockingDialog` (around line 422). |
| Enabled-state selector | `extension/content/selectors.js`, `S.model.isAlreadyEnabled`, around line 161 | False while the `vertex-ai-request-access-button` wrapper exists. True when `vertex-ai-open-generation-ai-studio-button` exists. Else true when the call-to-action stack holds an element reading exactly "Open in Agent Studio". |
| Dialog clearing | `extension/content/actions.js`, `A.clearBlockingDialog`, around line 319 | Finds the "Enable APIs" dialog and clicks its Enable button. This enables an API in the project. |
| Pre-action step | `extension/content/main.js`, `tickInner`, around lines 276-280 | Runs `A.clearBlockingDialog` before any page handler, on any page. It is not read-only. |
| Start | `extension/background/service-worker.js`, `startRunUnsafe`, around line 379 | Takes `{ projects, models, live, includeDone }` from `MSG.START`, validates, builds the queue, runs the cross-run guard, stores the run snapshot `KEYS.RUN` as `{ runId, live, startedAt, finishedAt, reason }` (around line 419). |
| Cross-run guard | same file, `priorPairsUnsafe`, around line 200, and `kindOf`, around lines 260-268 | Only a newest result of `skipped` and done or purchase records leave a pair out of a later run. Every other status is attempted again. |
| Per-run box | `extension/popup/popup.html` line 61, `extension/popup/popup.js` around lines 583-587 and 639 | `include-done` is read and spent by the Start click, then unticked. It travels as `includeDone` in `MSG.START`. This is the pattern for a second per-run box. |
| Statuses | `extension/common/constants.js`, `MGC.STATUS` around line 68, `MGC.SUMMARY_STATUSES` around line 111 | `skipped` means already enabled. `skipped-by-you` means the Skip button was pressed. |
| Project limit | `extension/common/constants.js`, `MAX_PROJECTS: 200`, around line 605 | A run, or a link, may name up to 200 projects. |

The dry run is not read-only. It clicks Enable, fills the questionnaire, clicks Next and ticks the terms checkbox. It stops only before Agree. The "Enable APIs" dialog's Enable is clicked in both modes.

## MVP today

Switch on DRY RUN and step-by-step. Walk the pairs with the Skip button (status `skipped-by-you`).

- An enabled pair ends `skipped: already enabled` by itself.
- A not-enabled pair opens the questionnaire. The panel waits before Next. The person presses Skip. The job ends `skipped-by-you`, with a message that says the model was not enabled.

The Runs page download is then the inventory: `skipped` means enabled, `skipped-by-you` means not enabled.

| Cost of the MVP | Detail |
|---|---|
| One click per not-enabled pair | The person must press Skip on every one. |
| Enable is clicked | For every not-enabled pair the model page's Enable is clicked and the questionnaire opens. |
| The questionnaire is filled | Filled, not submitted, for every not-enabled pair. |
| The "Enable APIs" dialog | Its Enable is still clicked when the project lacks the API. That changes the project. |
| Cross-run guard | `skipped-by-you` counts as "attempt again". This is correct for an inventory that is re-run. |

The MVP is good enough to start. It is not read-only, so it is not the thing the owner asked for.

## Proposal

A per-run box in the popup, next to the include-done box: "Check only: read whether each model is enabled; click nothing".

- Sent as `checkOnly` in `MSG.START`. Stored in the run snapshot as `run.checkOnly`.
- Shown in the worker badge header as `[CHECK ONLY]` and in the popup status.
- Read and spent by the Start click, like include-done. It is never carried into a later Start.

### Behaviour

The worker still navigates to each model page. The model-page handler ends the job after the detection.

| What the page shows | Result | Message |
|---|---|---|
| Enabled state, held for `enabledConfirmMs` | `skipped` | `skipped: already enabled (check only)` |
| An enabled Enable button | `not-enabled` (new) | `not enabled: the Enable button is offered; nothing was clicked` |
| A visible "Enable APIs" dialog | `not-enabled` | the same text, naming the dialog. The dialog's Enable is not clicked. |
| A blocker (consent control, permission error) | `failed` | as today |
| A project that cannot be opened | `failed` | as today |

Nothing else is clicked or ticked anywhere. No questionnaire, no Next, no terms box, no Agree.

The "Enable APIs" dialog needs a second change. The pre-action step in `main.js` runs before any handler and would click that dialog's Enable. It must read the run snapshot and, when `run.checkOnly` is true, skip `A.clearBlockingDialog` and leave the dialog to the model-page handler.

### Mode and guard

- The mode (DRY RUN or FULL RUN) has no effect on a check-only run.
- Start refuses "check only" when the mode is FULL RUN. One meaning per run.
- `not-enabled` is an ordinary outcome. The cross-run guard attempts the pair again.
- `skipped` from a check-only run leaves the pair out of later runs, like today. That is correct: the model is enabled.

### Results export

The Runs page text download covers it. An optional CSV is a later phase, with columns `project`, `model`, `enabled` (yes, no, unknown), `checkedAt`, `runId`.

### Deep links

Deep links do not carry the box. Scoping 03 D2 forbids new keys. A link fills the form and the person ticks the box.

### Decisions

- D1. A per-run popup box named `checkOnly`, off by default, spent by each Start.
- D2. The model-page handler returns before any click when `run.checkOnly` is true.
- D3. A new job status `not-enabled`. It is added to `MGC.STATUS` and `MGC.SUMMARY_STATUSES`.
- D4. The pre-action dialog step in `main.js` is gated on the run snapshot. A check-only run never clicks the "Enable APIs" dialog's Enable.
- D5. Start refuses check only together with FULL RUN.
- D6. No new link key, no new permission, no API call from the extension.

### Safety table

| A check-only run can never | Control |
|---|---|
| Click the model page's Enable | The handler returns `not-enabled` before the click at around line 437. Test T3. |
| Click the "Enable APIs" dialog's Enable | The `main.js` pre-action step is gated on `run.checkOnly`. The handler names the dialog and returns. Tests T4, T5. |
| Click Next or fill the questionnaire | The job ends on the model page. The questionnaire handler is never reached. Test T3. |
| Click Agree or buy anything | Start refuses check only with FULL RUN. The Agree guard `clickAgreeGuarded` and its md5 line are not edited. The single Agree path is untouched. Tests T2, T7. |
| Carry over to the next run | The box is unticked by the Start click and sits in the run snapshot only. Test T6. |
| Start from a link | Scoping 03 D2: a link has three keys and fills the form only. |

## Fit with the other scopings

- Scoping 02 is the headless route when a service account exists. This is the human route with a signed-in browser. The GitLab inventory could consume the Runs download, or the CSV, later.
- Scoping 03 deep links fill the project list for a check-only run. The limit is now 200 projects. It was raised in the same change.
- Scoping 01 (the latest set) picks the models. `models=latest` in a link plus the box is a quick "is the newest line enabled everywhere" check.

## Changes per file (estimate)

| File | Change |
|---|---|
| `extension/common/constants.js` | `STATUS.NOT_ENABLED` = `"not-enabled"`, add it to `SUMMARY_STATUSES`, document the `checkOnly` field in the `MSG.START` comment. |
| `extension/popup/popup.html`, `popup.js` | The box next to `include-done`. Read and spent in the Start click. Sent in `MSG.START`. A status line. A refusal when FULL RUN and check only are both set. |
| `extension/background/service-worker.js` | `startRunUnsafe` validates `checkOnly` (boolean, refused with `live`) and stores `run.checkOnly`. |
| `extension/content/main.js` | Gate the pre-action dialog step on the run snapshot. Add `[CHECK ONLY]` to the badge header. |
| `extension/content/actions.js` | `handleModelPage`: the early return after the detection. |
| `extension/popup/popup.css` | A row colour for `not-enabled`. |
| `extension/runlog/`, Runs page | No change beyond the new status. |
| `extension/test/` | See the test list. |
| `README.md`, `extension/README.md`, `store/LISTING.md`, `CHANGELOG.md` | The box, the status, the MVP route. |

## Test list

Each check has a control case, in the style of the suite.

- T1. `worker-harness.mjs`: Start with `checkOnly: true` in a dry run stores `run.checkOnly === true`. Control: Start without the field stores `false`.
- T2. `worker-harness.mjs`: Start with `checkOnly: true` and `live: true` is refused with a reason. Nothing is stored. Control: the same start with `live: false` is accepted.
- T3. `model-step.cjs`: the enabled state ends `skipped` with `(check only)`. An offered Enable button ends `not-enabled` with zero clicks. Control: without `checkOnly` the Enable button is clicked once.
- T4. `model-step.cjs`: a visible "Enable APIs" dialog ends `not-enabled` with zero clicks and names the dialog. Control: without `checkOnly` the dialog's Enable is clicked.
- T5. `main-loop.cjs`: with `run.checkOnly` the pre-action step does not call the dialog clearing, so a dialog on a model page produces zero clicks. Control: the same page without the flag is cleared.
- T6. `ui-pages.cjs`: the box exists, is unticked after a Start, and travels in `MSG.START`. The popup refuses FULL RUN plus the box. Control: the include-done box still behaves as before.
- T7. `ui-pages.cjs`: the status line and the summary counts show `not-enabled` and `skipped-by-you` with the right strings. A static check keeps the guard md5 line unchanged.
- T8. `worker-harness.mjs`: the cross-run guard leaves out a pair whose newest result is `skipped` from a check-only run, and attempts a pair whose newest result is `not-enabled`. Control: a `done` pair is left out as before.

The offline suite must pass with `MGC_ALLOW_SKIP=1 sh extension/test/run.sh`, and the guard md5 line must match `docs/MAINTENANCE.md`.

## Out of scope

- Any API call from the extension. That is scoping 02.
- Changing the dry run.
- A check-only FULL RUN.
- Project discovery.

## Open questions for the owner

1. Is `not-enabled` the wanted status name, or should it read `enable-offered`?
2. Must a check-only run be allowed to clear the "Enable APIs" dialog? Proposed: no. The cost is that a project without the API reads `not-enabled` for every model.
3. CSV export now, or later?
4. Must check-only results feed the GitLab inventory artifact of scoping 02?
5. Is the per-run box right, or should check only be a third mode in the options page?

## Effort estimate

| Part | Estimate |
|---|---|
| The box, the handler, the pre-action gate, the constants and the worker validation | 0.75 to 1 day |
| Tests T1 to T8 | 0.5 day |
| Docs and changelog | 0.25 to 0.5 day |
| Total | 1.5 to 2 days |
| CSV export (later phase) | 0.5 day |
