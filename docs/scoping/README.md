# Scoping documents

A scoping document plans a feature before it is built. When the feature has shipped, the document is removed from the tree and this index keeps the facts that are worth keeping. The last commit that holds the removed texts is `134782d`.

| No. | Title | Date | Status |
|---|---|---|---|
| 01 | Only the latest Anthropic models are enabled | 2026-10-12 | Shipped: phase 0 in 0.9.0, phases 1 and 2 in 1.0.0. Removed. |
| 02 | Run Model Garden Clicker from a GitLab runner under a service account | 2026-10-12 | Open. Kept: [02-gitlab-runner-service-account.md](02-gitlab-runner-service-account.md). |
| 03 | Open the popup from a link, with the project and the models filled in | 2026-10-13 | Shipped in 0.9.0, limits raised in 1.0.0. Removed. |
| 04 | A check-only run that records which models are enabled | 2026-10-29 | Shipped in 1.0.0. Removed. |

## 01 Latest models

Shipped: phase 0 in 0.9.0, phases 1 and 2 in 1.0.0. Each model in `extension/models.json` has a release date, the popup lists the models newest first, and a third link `latest` next to `all` and `none` ticks the newest generally available model of each model line. `scripts/models/fetch_models.py --write` generates a candidate `models.json` from the Vertex AI publisher-models API, and the weekly workflow `.github/workflows/models-refresh.yml` opens or updates one pull request with it. It never merges and never tags. The generator uses a read-only service account through Workload Identity Federation. Phases 3 (a runtime fetch from the extension) and 4 were never built; a runtime fetch was rejected because it breaks the "loads nothing from the network" promise.

Read the last text: `git show 134782d:docs/scoping/01-latest-models.md`

The user-facing facts are in `extension/README.md` and `scripts/models/README.md`.

## 02 GitLab runner

Open. Its remaining stages and the API enable job wait on answers from the owner to the open questions in the document. The document stays in this directory.

## 03 Deep links

Shipped in 0.9.0. A link is the popup page's own URL, `chrome-extension://<extension id>/popup/popup.html?tab=1&v=1&projects=p-a,p-b&models=latest`. The popup tab asks for confirmation, fills the project IDs and the models, shows a "Filled from a link" banner and never starts a run or changes a setting. The second form, a link on a console page read by the content script, was dropped in 0.9.0 because it did not work in the owner's test. In 1.0.0 the limits were raised.

Current limits: 200 projects, 13 models, 16,384 characters for the link, and 8,192 characters for the joined project and model lists in a settings import (the list cap, `MGC.CONFIG_LIST_MAX`). The count caps fire before the length caps.

Read the last text: `git show 134782d:docs/scoping/03-deep-links.md`

The user-facing facts are in `extension/README.md`, "Open the popup from a link". This table is the only security write-up of the link path.

### Deep links: threat model summary

| Entry point | Attacker goal | Control |
|---|---|---|
| Crafted popup query string, from the address bar or a bookmark | Start a run | The popup only fills the form. Start keeps all its guards (project and model checks, the full-run confirm, the worker's checks). No link key maps to a click. |
| Same | Change the mode, step-by-step, include-done, the questionnaire or the timing | The parser knows three keys (`v`, `projects`, `models`). The fill touches only the project, model and extra-model fields. Settings are neither read nor written on the link path. |
| Same | Inject text or HTML into the page | Every value that reaches the page passed the project-id or model-slug check (ASCII only). The banner and the confirm use `textContent`; `popup.js` has no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` (a static check keeps it so). |
| Unicode and percent-encoding tricks, repeated keys, unknown keys (`__proto__`, `note`) | Pass the validators, add a hidden id or key, crash the parser | Decoding happens once, after the split, in a try/catch. Double encoding, non-ASCII, NUL, newline, space and `+` fail the id patterns. A repeated or unknown key refuses the whole link with one reason. |
| A link that is too big, or cut off | Fill a queue the person does not read, or read a cut link as a shorter valid one | More than 200 projects, 13 models or 16,384 characters is refused as a whole. The confirm names the count and the first ids; every id is in the textarea and the banner after OK. |
| A project id that looks like another id | Enable a model in the wrong project | Confusable letters are not in `[a-z0-9-]` and are refused. The confirm and the banner list every id verbatim. A valid id that is simply wrong is the same risk as a typed id, and the run's own project check still applies. |
| `models=latest`, or a slug not in `models.json` | Tick a model the sender did not mean, or hide one | `latest` resolves over this machine's list, and the confirm and the banner name the concrete slugs. An unknown slug goes to the extra-slugs field and is named as "extra". |
| A link while a run is active, or a web page opening the popup | Change the queue, start a second run | The link is dropped with one log line, nothing is stored and no tab opens. `popup.html` is not a web-accessible resource, there is no `externally_connectable`, and the manifest permissions are unchanged. The link path runs only in the tab layout, never in the action popup. |

## 04 Check-only run

Shipped in 1.0.0. The popup's "Check only" box turns one dry run into an inventory: the worker opens each model page, the extension reads the enabled state and the job ends without a click, as `skipped` (already enabled) or the new status `not-enabled`. The results are in the Runs page download.

The design decisions: the status is named `not-enabled`, and it is an ordinary outcome that a later run attempts again. The "Enable APIs" dialog is never cleared in a check-only run, so a project without the API reads `not-enabled` for every model. There is no CSV export; the Runs page text download is the inventory. Check only is a per-run box like include-done (off on every popup open, spent by each Start, never stored) and not a third mode in the options page. FULL RUN refuses the box.

Read the last text: `git show 134782d:docs/scoping/04-check-only-inventory.md`

The user-facing facts are in `extension/README.md`, "Check only".
