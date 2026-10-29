# Scoping 01: only the latest Anthropic models are enabled

Date: 2026-10-12. Repository state: commit `9437508`, version 0.8.0.
Status: Phase 0 (the MVP) is implemented on branch `claude/trusting-feynman-a7kvdo` with open questions 1, 2, 4, 5, 6 and 11 answered as proposed (newest GA per line, flagged models left out of the preset with a note while `all` still ticks them, Google's date, tooltip only, dates inline in `models.json`, the one-time reset kept). Phases 1 and 2 are implemented on 2026-10-29 (`fetch_models.py --write` and `.github/workflows/models-refresh.yml`) with open questions 7, 8, 9 and 10 answered as proposed: the generator stays Python (standard library); CI authenticates through GitHub Actions Workload Identity Federation to a read-only service account, set through the repository variables `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL` and `GCP_QUOTA_PROJECT` (no stored key); the weekly job opens or updates a pull request only, never a tag; a slug that vanishes from the API stays with `deprecated: true`. Phases 3 and 4 are still scoping only.
Deviations in the implementation from the MVP table below: the pair count is a separate line under the checklist (`P project(s) × M model(s) = K pair(s)`), not a Start label; the full-run confirmation gives a count (`The selection includes N model(s) that are not the newest of their line.`), not the names; the row tooltip also repeats the `manual step` or `deprecated` flag, which the ellipsis cuts.
Supporting PoC: `scripts/models/fetch_models.py` (see `scripts/models/README.md`).

## Summary

The popup lists the thirteen models of `extension/models.json` in a hand-kept order. A user who wants only the newest models ticks them one by one. This document plans two things.

1. MVP: a release date per model, a list sorted newest first, and a third link `latest` next to `all` and `none`. The link ticks the newest GA model of each model line.
2. Auto-population: a generator that reads the Vertex AI publisher-models API, writes a candidate `models.json`, and runs on a schedule in CI. A human merges the pull request.

A runtime fetch from the extension is rejected. It needs an OAuth client and new permissions, and it breaks the "loads nothing from the network" promise.

Recommended commitment: Phases 0 to 2, about 3 to 4 developer-days of repository work plus cloud identity setup.

## Problem

- `extension/models.json` is edited by hand. The 0.8.0 entry for Haiku 5.5 came from memory, and the API listing was not run again (`docs/models.md:69-72`).
- The file order is a version-number order, not a release order (`docs/models.md:42-50`). Version numbers do not line up with dates across families. Opus 4.8 (2026-05-28) is older than Fable 5 (2026-06-09) but newer than Sonnet 4.6.
- There is no one-click way to pick "the current lineup". The `all` link ticks every model, including a model the runner cannot enable (Fable 5.1, `docs/BACKLOG.md:47-55`).
- A new model needs a code change, a test change (hard-coded 13 in `extension/test/ui-pages.cjs:469,483,497`) and a release.

## Current state

Model line: the second token of a slug (`opus`, `sonnet`, `haiku`, `fable`). Recency: the order of release dates.

### How models.json is produced

| Step | Where | Note |
|---|---|---|
| Discover with one GET to `us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?view=PUBLISHER_MODEL_VIEW_BASIC` | `docs/models.md:11-31` | Needs a bearer token and `X-Goog-User-Project` |
| Insert one line at the version-order position | `extension/models.json:1-15` | 0.8.0 commit `f2e2134` added line 4 |
| Append a note to `docs/models.md` | `docs/models.md:69-72` | The table itself was not updated |
| Bump the hard-coded count in tests | `extension/test/ui-pages.cjs:469,483,497` | Expects exactly 13 inputs |
| Release notes, version bump, tag | `CHANGELOG.md:10`, `store/RELEASE-NOTES-TO-PASTE.md:10`, `docs/MAINTENANCE.md:341-375` | `MAINTENANCE.md` has no model-list section |

Only committed producer: a hand edit (git history `a365d97`, `f2e2134`).

### How models.json is consumed

All readers fetch `chrome.runtime.getURL("models.json")`, a packaged resource. No permission is involved.

| Reader | File:line | Behaviour |
|---|---|---|
| `parseModelsFile(data)` | `extension/popup/popup.js:112-117` | Keeps objects with a string `slug` that passes `K.isValidModelSlug`. Maps to `{slug, name: name or slug, launchStage: launchStage or ""}`. Keeps the file order. |
| `loadModels()` | `extension/popup/popup.js:119-127` | Fetch and parse. On failure shows `could not read models.json: ...` and returns `[]`. |
| `renderModels(models, selected)` | `extension/popup/popup.js:135-157` | One `<label><input type=checkbox value=slug> name <span class="stage">(launchStage)</span></label>` per model. `label.title = slug`. Each change calls `savePopupState`. |
| `selectedModels()` | `extension/popup/popup.js:159-163` | Ticked slugs plus `#extra-models`, de-duplicated. |
| `all` and `none` links | `extension/popup/popup.js:369-370` | Tick or untick every `#models input`, then `savePopupState()`. |
| Start | `extension/popup/popup.js:384-425` | Refuses an empty selection. A live run asks `confirm()` with the pair count from `MSG.GUARD_PREVIEW`. Sends `MSG.START {projects, models, live, includeDone}`. |
| `listedModels()` | `extension/options/options.js:230-239` | Slugs only. No `isValidModelSlug` check. Used by the import to move unknown slugs to the extra field (`options.js:241-286`). |
| `modelNames()` | `extension/background/service-worker.js:145-156` | `slug -> name` map for job names. Returns `{}` with a warning when the file is unreadable. |
| `isValidModelSlug` | `extension/common/constants.js:586-589` | `/^[a-z0-9][a-z0-9._-]{0,99}$/i`. `constants.js` never reads `models.json`. |
| Export and import | `extension/common/constants.js:434-453`, `:534-542` | `popup.models` travels as a list of validated slugs. |
| Layout probe | `python/scripts/popup_layout.py:160-193` | Counts rows against the file. |
| Build | `scripts/build-extension-zip.sh:25-29` | Zips `manifest.json`, `models.json` and the directories by name. |

Storage: `chrome.storage.local["popup_state"] = {projects, models, extra, version}` (`extension/common/constants.js:24`). `popup.js:342-363` resets the selection once after every version change. No model is ever ticked by default.

A slug in `popup_state.models` that leaves `models.json` is not rendered and silently drops on the next save (`popup.js:135-157`, `:176-185`).

Manifest (`extension/manifest.json`): `permissions ["storage","alarms"]`, `host_permissions ["https://console.cloud.google.com/*"]`, no `identity`, no `oauth2`, no `optional_permissions`. `extension/test/ui-pages.cjs:560-572` asserts exactly this.

## Definition of "latest"

For each model line, "latest" is the single entry with the greatest `releaseDate` among entries that:

- have `launchStage` equal to `"GA"`,
- carry a valid `releaseDate`,
- are not `deprecated`.

Unknown is never newest. An undated or non-GA entry is never latest.

Proposed rule (open question 2): when the newest entry of a line carries `requiresManualConsent`, the preset leaves that line out and says so. It never falls back to an older model of that line. Today this yields:

| Line | Latest | Preset ticks it? |
|---|---|---|
| haiku | `claude-haiku-5-5` (2026-10-07) | yes |
| sonnet | `claude-sonnet-5-5` (2026-09-28) | yes |
| opus | `claude-opus-5-5` (2026-09-22) | yes |
| fable | `claude-fable-5-1` (2026-09-01) | no, flagged. Status line: `latest: 3 ticked; Fable 5.1 left out, needs a manual step on its model page` |

Rejected alternatives:

| Rule | Why rejected |
|---|---|
| Top N by date | N=3 drops Fable 5.1. N=4 drops Haiku the day a new Opus ships. |
| Newest major version only | 5.x ticks seven models today. |
| Allow-list of lines | Needs a tunable. A new line (for example `mythos`) must join on its own. |

Proposed decisions (open questions 1, 2 and 11):

- A new line auto-joins. A user who dislikes a line unticks it.
- `latest` replaces the selection, like `all` and `none`. It never touches `#extra-models`.
- The set is computed at click time from the rendered list. `popup_state.models` keeps storing concrete slugs, so a later run uses exactly what the user saw.
- No default ticking. First open and the one-time upgrade reset stay as they are.

### Recency key

| Rank | Key | Source | Use |
|---|---|---|---|
| 1 | `releaseDate` (`YYYY-MM-DD`), descending | Google per-model page "Release date:", cross-checked with the Anthropic per-model page "Released:" | Authoritative |
| 2 | `apiOrder`, descending | 1-based position in the API default order (equal to `create_time` ascending, verified) | Only below every dated entry. One known inversion: `sonnet-5` is listed before `opus-4-8`. |
| 3 | Version parsed from the slug, descending, with family rank Opus > Sonnet > Fable > Haiku | Today's `docs/models.md:42-50` rule | Undated, unordered entries only |
| 4 | Slug ascending | | Final tie-break, so the comparator is a total order |

Google and Anthropic disagree on `opus-4-7` (April 15 against April 16, 2026). Proposed (open question 4): the file takes Google's Vertex date and `docs/models.md` records the difference.

Rejected keys:

- `orderBy=update_time`: noisy, `haiku-4-5` first.
- `versionId`: dated for two models only, and a snapshot date.
- The Marketplace service number in `requestAccess`: undocumented.
- The Anthropic Models API `created_at`: needs an API key, 401 without one.

## MVP scope

### UI and state behaviour

| Element | Behaviour |
|---|---|
| Model list | Sorted at load time by `K.sortModelsByRecency`. File order stops being load-bearing. |
| Each row | Tooltip only (open question 5). `label.title` = `` `${slug} · released ${releaseDate}` ``. The `.stage` span shows `(GA · manual step)` for `requiresManualConsent`, `(deprecated)` for `deprecated`, else unchanged. No fifth column. The 4-column grid (`popup.css:47-50`) stays. |
| `latest` link | Third link in `extension/popup/popup.html:51-54`: `` <a href="#" id="models-latest" title="newest GA model of each line (opus, sonnet, haiku, fable)">latest</a> `` after ` · `. |
| `latest` click | `e.preventDefault()`. Compute `K.latestModelSlugs(currentModels)`. Untick all, tick the members. Write a status note that names left-out flagged models. `savePopupState()`. |
| `all`, `none` | Unchanged. Whether `all` skips flagged and deprecated models is open question 2. |
| Start button | Label shows the pair count: `Start (P×M pairs)`, updated on every `savePopupState`. |
| Start confirmation (live only, `popup.js:399-419`) | Lists ticked model names when the selection is a strict superset of the latest set: `including N model(s) that are not the newest of their line`. Names `requiresManualConsent` models: `will fail, not enable`. |
| Storage | Nothing new in `chrome.storage` for the MVP. |

Deferred to the open questions: the 90-day stale-selection notice and the per-run pair cap. Both need a `popup_state.savedAt` field, and `parseConfig` (`constants.js:534-542`) must be checked to ignore it.

### File-level change list

| File | Change |
|---|---|
| `extension/models.json` | Dates inline in this file (open question 6). Add `releaseDate` to all 13. Add `apiOrder` 1..13 (`haiku-4-5` = 1, `haiku-5-5` = 13). Add `"requiresManualConsent": true` on `claude-fable-5-1` (`fable-5` only after the dry-run check). Reorder by `releaseDate` desc: haiku-5-5, sonnet-5-5, opus-5-5, fable-5-1, opus-5, sonnet-5, fable-5, opus-4-8, opus-4-7, sonnet-4-6, opus-4-6, opus-4-5, haiku-4-5. Count stays 13. |
| `extension/common/constants.js` (after `:589`) | `MGC.parseReleaseDate(s)` (strict `YYYY-MM-DD`, else `null`). `MGC.modelFamily(slug)` (`/^claude-([a-z]+)-(\d+(?:-\d+)*)$/i`, else `null`). `MGC.modelVersionKey(slug)` (integer array). `MGC.compareModelsByRecency(a, b)`. `MGC.sortModelsByRecency(list)` (returns a new array). `MGC.latestModelSlugs(list)`. All side-effect free: the content script loads this file too. |
| `extension/popup/popup.js:112-117` | `parseModelsFile` carries `releaseDate` (validated or `""`), `apiOrder` (positive integer or `null`), `requiresManualConsent` and `deprecated` (booleans). |
| `extension/popup/popup.js:119-127` | `loadModels` returns `K.sortModelsByRecency(parsed)` and keeps it in a module-level `currentModels`. |
| `extension/popup/popup.js:135-157` | `renderModels`: title and stage text as above. |
| `extension/popup/popup.js:369-370` | New `on("models-latest", "click", ...)`. |
| `extension/popup/popup.js:384-425` | Pair count label, confirmation sentences. |
| `extension/popup/popup.html:51-54` | Third link. The id-coverage check (`ui-pages.cjs:404-412`) needs it. |
| `.github/workflows/release.yml` (before `:89`) | Lint step for `models.json`: array, unique slugs that pass `isValidModelSlug`, `releaseDate` format, unique `apiOrder`, file sorted by the shared comparator, no `@` in slugs. |
| `docs/models.md:42-50` | Rewrite. `releaseDate` is authoritative and the file order is irrelevant. State "omit the date and the model is excluded from latest". Name the two date sources and the `create_time` inversion. Add Release date and apiOrder columns. |
| `docs/MAINTENANCE.md` | New section "Updating the model list". |
| `extension/popup/popup.css:7-8,47-50`, `extension/README.md:88,561` | "thirteen" and "replace it" wording. |
| `python/README.md:151` | The "no scrollbar" claim about the checklist, re-checked by the layout probe. |
| `CHANGELOG.md`, `store/RELEASE-NOTES-TO-PASTE.md` | `Added: latest link, release dates, recency sort`. Note the one-time selection reset. |
| `store/LISTING.md`, `PRIVACY.md` | Unchanged. Still no network. |

No change: `options.js:230-239`, `service-worker.js:145-156`, `manifest.json`, `scripts/build-extension-zip.sh:25-29`, `release.yml` build steps, `python/scripts/popup_layout.py:160-193` (13 rows still, re-run the probe because the stage text and the Start label grow).

### Test list

Helpers (via `globalThis.MGC` in `ui-pages.cjs` or `worker-harness.mjs`):

- `sortModelsByRecency` on the 13 real entries yields the date order above. A shuffled copy gives the same result. Input is not mutated. Sorting twice gives the same output.
- Equal dates fall back to `apiOrder` desc. Undated entries without `apiOrder` sort by slug version (undated `opus-6` above undated `opus-5-5`) below every dated entry. Malformed dates (`"2026-13-40"`, `""`, `123`, `"soon"`) and an undated non-numeric slug (`claude-test`) sink last. Slug asc is the final tie.
- `modelFamily("claude-fable-5-1") === "fable"`, `modelFamily("claude-3-opus") === null`, `modelFamily("my-custom-model") === null`. `modelVersionKey` orders `4-8 < 5 < 5-1 < 5-5`.
- `latestModelSlugs` with `fable-5-1` flagged gives `{opus-5-5, sonnet-5-5, haiku-5-5}`. Unflagged adds `fable-5-1`. `deprecated: true` and `launchStage "PREVIEW"` exclude. An undated newer `opus-6` is excluded and dated `opus-5-5` stays. A dated `claude-mythos-5-1` forms its own line (5 entries). An unparseable slug is rendered but never latest.

`extension/test/ui-pages.cjs`:

- Fixtures at `:108`, `:426`, `:461` gain the new fields. Replace the hard-coded 13 at `:469`, `:483`, `:497` with the fixture length.
- T5 (`:478-504`): 13 inputs, none ticked on first use, version marker stored. First rendered label is the newest date regardless of file order (inject a shuffled fixture through `win.fetch`). `label.title` contains slug and date. `.stage` shows the markers where flagged.
- `#models-latest` click (dispatched `MouseEvent`, as `:495`): ticks exactly the latest set. `popup_state.models` equals it in file spelling. `#extra-models` untouched. Status note names left-out flagged models. `latest` after `all` unticks non-latest. `none` gives 0, `all` gives the fixture length. Reopening restores the selection.
- id-coverage (`:404-412`) sees `#models-latest`. Manifest block (`:560-572`) still exactly `["storage","alarms"]`, console origin only.
- Parse: bad `releaseDate` gives `""`, non-integer `apiOrder` gives `null`, non-boolean flags give `false`, `@` slug dropped, invalid slug dropped as today.
- U3 (`:1018-1033`): after a version change none ticked, even when the stored set is the latest set. Same version restores ticks.
- Start (`:384-425`) live: confirm contains the pair count, the extra-models sentence, the manual-step sentence with names. Cancel sends no `MSG.START`. Dry run sends `START` without confirm. The Start label shows `(N pairs)` and updates on project or model change.
- Import block (`:1289-1308`): four latest slugs in different case keep list spelling. Unknown slugs still move to extra. An export that carries `savedAt` is accepted.

`extension/test/worker-harness.mjs`: `modelNames()` still copes without `models.json` (`:37`, `:83`). `START` with the latest set names jobs from the map. Cross-run guard (`:570-603`) still drops done and skipped pairs.

CI lint: rejects duplicate slug, invalid slug, `@` slug, bad date, duplicate `apiOrder`, file not sorted by the comparator.

`python/scripts/popup_layout.py`: row count read from `models.json` length. Longer stage text keeps `MIN_COLUMNS` and no horizontal scrollbar.

## Auto-population

### Phased plan

| Phase | Content | Depends on |
|---|---|---|
| 0 | The MVP above. The schema is designed so the generator output drops in without a UI change. | |
| 1 | Generator, local. `scripts/models-refresh.mjs` (Node 22 is in `release.yml:51`, no dependencies) or the Python PoC `scripts/models/fetch_models.py` (open question 7). Token from env `GOOGLE_OAUTH_ACCESS_TOKEN` or `gcloud auth print-access-token`, quota project from env. One GET to `us-central1` (fallback `global`). Derive slug, name, `launchStage`, `apiOrder`. Merge with the existing file: hand-set `name`, `releaseDate` and flags win. A new slug gets `releaseDate` from a best-effort scrape of `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/<family>-<ver>` ("Release date:"), with the Anthropic per-model page as second source, else `""` and `"dateSource": "undated"`. Vanished slugs stay and get `deprecated: true` proposed, never removed (open question 10). Trust check: refuse `{}`, 401, 403, or a response without the packaged GA set. Output byte-stable and sorted by the shared comparator. Exit non-zero naming undated GA slugs unless `--allow-undated`. | Phase 0 schema |
| 2 | Scheduled CI. `.github/workflows/models-refresh.yml`: `on: schedule` weekly plus `workflow_dispatch`. Permissions `contents: write`, `pull-requests: write`, `id-token: write`. `google-github-actions/auth` through Workload Identity Federation to a read-only service account (open question 8). Run the generator with `--allow-undated`. When `git diff --quiet extension/models.json` fails, force-update one fixed branch `models-refresh` and open or update a single PR that lists added, removed and undated slugs. Never auto-merge, and no release tag (open question 9). CI fails a PR whose GA entry stays undated for more than 30 days. | Phase 1, cloud identity |
| 3 (optional) | Runtime refresh from a static JSON that Phase 2 publishes (GitHub Pages or Release asset, `ACAO: *`). Service worker fetch on `chrome.alarms`. New `KEYS.MODEL_CATALOG {fetchedAt, source, models[]}`. Merge rule packaged ∪ catalogue: the catalogue can add slugs and set `deprecated`, never remove or re-date packaged ones. Catalogue-only slugs render unticked with `new · unknown date`, never latest. Options Advanced toggle, default off. Needs `PRIVACY.md` and `store/LISTING.md` rewording. | Phase 2 |
| 4 (optional) | Passive discovery through the content script on gallery search rows (`MSG.MODELS_SEEN`), read-only. Needs a recon run first. | |

Workload Identity Federation: GitHub Actions exchanges its OIDC token for a short-lived Google credential, no stored key.

### Identity and permission analysis for a runtime fetch

Facts verified on 2026-10-12:

- `aiplatform.googleapis.com` echoes `Origin: chrome-extension://abc` in `Access-Control-Allow-Origin` on a GET (re-checked at review). The preflight answer, `Allow-Headers authorization,x-goog-user-project` and `Allow-Methods` including GET, comes from the probe report and was not re-run. The fetch itself needs no `host_permissions`.
- The MV3 default CSP does not restrict `connect-src`, so `fetch()` to any https origin passes.
- The API returns 401 without a bearer token. The extension has no token.

A direct runtime fetch therefore needs:

| Requirement | Impact |
|---|---|
| `"identity"` permission and `chrome.identity.getAuthToken` | New install prompt |
| `"oauth2": {client_id, scopes: [cloud-platform.read-only]}` in the manifest | Sensitive scope, Google verification |
| A publisher OAuth client and consent screen | Publisher-side admin work |
| A quota project | Billing identity for every user |
| Store re-review with the disable-until-accepted prompt | Release friction |
| Rewritten privacy claims | Breaks `PRIVACY.md:35`, `store/LISTING.md:51,123,133`, `ui-pages.cjs:560-572` |

The content-script route (console session cookies) is not viable: the publisher-models API needs a bearer token, and console-internal endpoints are undocumented.

### Recommended path and why

Proposed: build-time generation in CI is the source of truth. A regenerated `models.json` ships per release. A scheduled job opens a PR (open questions 8 and 9).

Reasons:

- Phases 0 to 2 change no permission. `permissions` stay `["storage","alarms"]`. `PRIVACY.md` and `store/LISTING.md` stay true. `ui-pages.cjs:560-572` stays the regression guard.
- A written candidate file removes the hand-typing that produced the 0.8.0 lapse (`docs/models.md:69-72`). The PR review is the human gate.
- The service account needs only a quota project (`roles/serviceusage.serviceUsageConsumer` on it). The endpoint needs no project IAM. This decision is shared with the GitLab-runner scoping (feature 2).
- Phase 3 adds a runtime fetch without a manifest change (`ACAO: *` host), but it changes the privacy story. Decide it separately.

## Data model

Proposed `extension/models.json` entry:

```json
{
  "slug": "claude-fable-5-1",
  "name": "Claude Fable 5.1",
  "launchStage": "GA",
  "releaseDate": "2026-09-01",
  "apiOrder": 10,
  "requiresManualConsent": true
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `slug` | string | yes | Model Garden URL slug. Must pass `isValidModelSlug`. No `@`. |
| `name` | string | no | Display name. Falls back to the slug. |
| `launchStage` | string | no | `"GA"` today. Only `"GA"` entries can be latest. |
| `releaseDate` | `"YYYY-MM-DD"` | no | Primary recency key. Empty or absent means undated, never latest. |
| `apiOrder` | positive integer | no | 1-based position in the API default order, oldest = 1. Secondary key. |
| `requiresManualConsent` | boolean | no | The model page needs a manual consent step. The preset leaves the line out. The runner is unchanged. |
| `deprecated` | boolean | no | Proposed by the generator for a vanished slug. Rendered with a marker, never latest. |
| `dateSource` | string | no | Generator note: `"undated"` when no source gave a date. The popup ignores it. |
| `line` | string | no | Optional override of the family parsed from the slug. |

Backward compatibility with the current `{slug, name, launchStage}` shape:

- Every new field is optional. The current file is a valid input.
- An entry without `releaseDate` and `apiOrder` sorts by slug version with family rank, below every dated entry. Today's file therefore keeps today's order when loaded unchanged.
- An undated entry is never latest, so `latest` on today's file ticks nothing and writes a note.

How `parseModelsFile` tolerates it (`popup.js:112-117`):

- `releaseDate`: `K.parseReleaseDate(item.releaseDate) || ""`.
- `apiOrder`: `Number.isInteger(item.apiOrder) && item.apiOrder > 0 ? item.apiOrder : null`.
- `requiresManualConsent`, `deprecated`: `item.x === true`.
- Unknown fields are ignored. A `@` in the slug fails `isValidModelSlug` at `popup.js:115` and the entry drops. The CI lint rejects it earlier.

`listedModels()` (`options.js:230-239`) and `modelNames()` (`service-worker.js:145-156`) read `slug` and `name` only and need no change.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| API order is listing `create_time`, not release (`sonnet-5` before `opus-4-8`) | Never the primary key. Only a fallback below dated entries. |
| Version-number sort is anti-chronological inside the 5.5 generation and arbitrary across families | Used only for undated, unordered entries, which are never latest. |
| A wrong hand-entered date changes the latest set within a line | Two public sources, a per-family uniqueness test, the CI lint, the generator cross-check. |
| Wrong region returns a dead `claude-3-opus`, several regions return `{}`, 401 or 403 without a quota project | Generator pins `us-central1` (fallback `global`) and refuses any catalogue without the packaged GA set. The PoC exits 3 on both captures. |
| `listAllVersions` duplicates (`claude-haiku-5-5@20261005` and `@default`) render twice and queue two jobs | Not passed. `@` collapsed on the bare slug. The lint rejects `@`. |
| Derived display names are a guess (no `displayName` in the API) | Deterministic derivation plus PR review. Names affect labels and confirm text only. Jobs key on the slug. |
| No deprecation field. A retired slug just disappears | Never auto-remove. Propose `deprecated: true`. Marker in the popup, excluded from latest. |
| `requiresManualConsent` is hand-maintained and can go stale both ways | It changes the preset only. The runner already fails cleanly (`BACKLOG.md:49-55`). |
| Over-purchase: a preset makes a large live selection one click away | Dry run stays the default. Start shows the pair count. Confirm lists extra and manual-step models. `latest` replaces, never adds. Pair cap is an open question. |
| Stale persisted selection: a June `latest` buys Opus 5 in October | Proposed `savedAt` plus a notice (open question). Never a silent re-tick. |
| A version bump wipes every user's ticks once | Documented. `latest` is the one-click recovery. Release-note line. |
| A new family auto-joins latest the day it appears | Accepted. Documented in the link title. |
| Growth: the 4-column grid scrolls past about 16 rows (`popup.css:50`, 170px) | `popup_layout.py` checks and the "thirteen" wording need touching when the count changes. |
| Test brittleness: hard-coded 13 and any-URL fetch stubs | Tests read the fixture length. Sort tests inject a shuffled fixture. Phase 3 needs URL dispatch in the stub. |
| `parseConfig` (`constants.js:534-542`) and `savedAt` | Verify it ignores unknown popup fields before Phase 0 ships `savedAt`. |
| CI identity lives outside the repo (WIF pool, SA, quota project) | A SA key in a GitHub secret is the worse fallback. One fixed branch, force-updated, so PRs do not pile up. |
| API is `v1beta1` only and unfilterable (every filter form returns 400) | A future API change breaks the generator, not the shipped extension. GA filtering is client-side. |
| Phase 3 changes the privacy story and adds a GitHub availability dependency. Phase 4 depends on an unstable console DOM | Neither blocks Phases 0 to 2. |

## Out of scope

- Any runtime fetch of `googleapis.com` from the extension.
- A `host_permission`, `identity` permission or `oauth2` key.
- Scraping the Model Garden gallery for chronology.
- Changing the runner's handling of `requiresManualConsent` models (`BACKLOG.md:47-55`).
- The Python harness model defaults (open question 14).
- The GitLab runner identity (feature 2, separate scoping).
- Phases 3 and 4 beyond their description here.

## Open questions for the owner

1. Confirm "newest GA per line" over top-N or 5.x-only, and that a brand-new family (`mythos`) auto-joins latest.
2. Exclude `requiresManualConsent` models (Fable 5.1) from the preset with a visible note, or include them and accept failed pairs? Must `all` also skip flagged and deprecated models? Today it ticks everything.
3. Does `claude-fable-5` carry the same consent controls? Its `requestAccess` flags match `fable-5-1` in the API. One dry-run navigation is needed before flagging it.
4. Authoritative date when Google and Anthropic disagree (`opus-4-7`): Google's Vertex date proposed.
5. Date placement in the UI: tooltip only (proposed) or a visible muted date or `new` marker in the `.stage` span, given nowrap and ellipsis rows.
6. Dates inline in `extension/models.json` (proposed) or a separate `docs/model-dates.json` merged by the generator.
7. Generator language: Node (CI Node 22, can share `constants.js` through `globalThis.MGC`) or Python stdlib (the PoC).
8. CI identity: GitHub Actions WIF to a read-only SA (proposed), a SA key secret, or the GitLab runner path from feature 2. Which GCP project hosts the SA and the quota? `my-project` was only the probe's.
9. Scheduled job opens a PR only (proposed), or also tags a release when only `models.json` changed.
10. Policy for slugs that vanish from the API: keep forever with `deprecated: true` (proposed), or remove after N releases knowing stored selections drop.
11. Keep the one-time selection reset on every version bump for model-only releases, or migrate the stored selection instead.
12. Stale-selection notice (`savedAt`, 90 days) and a per-full-run pair cap: wanted, and with what defaults?
13. Is Phase 3 wanted at all given the "loads nothing from the network" promise, or is one release per new model acceptable latency?
14. Must `python/` read `models.json` for its model-argument defaults, and must `versionId` be recorded for future use?

## Effort estimate per phase

| Phase | Work | Estimate |
|---|---|---|
| 0 MVP | 13 dates and fields. About 80 lines of `constants.js` helpers. About 20 lines of `popup.js` and `popup.html`. Start label and confirm text. 6 to 8 new `ui-pages.cjs` cases plus a `worker-harness.mjs` block. CI lint. Docs, CHANGELOG, MAINTENANCE. Layout probe re-run. `fable-5` dry-run check. | 1.5 to 2 developer-days |
| 1 Generator | Generator, fixture tests, docs (the PoC covers the fetch, merge, sort and compare parts) | 0.5 to 1 day |
| 2 Scheduled CI | Workflow, PR automation, best-effort date scraper | 0.5 to 1 day in the repo, plus GCP admin work (WIF pool and provider, SA, quota project: hours, depends on org access) |
| 3 Runtime catalogue | Worker alarm, `KEYS.MODEL_CATALOG`, merge rule, options toggle, URL-dispatching stubs, privacy and store rewording, re-review | 2 to 3 days. Recommended to defer. |
| 4 Passive discovery | Content-script hook plus a recon run | 1 to 2 days |

Recommended commitment now: Phases 0 to 2, about 3 to 4 days of repository work plus the cloud identity setup shared with feature 2.

## Appendix: API probe results

All calls were read-only GETs on 2026-10-12 with the session's proxy-injected service-account credential and quota project `my-project`. Nothing was clicked or enabled.

### Endpoints and HTTP codes

| URL | Code | Result |
|---|---|---|
| `https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?view=PUBLISHER_MODEL_VIEW_BASIC` | 200 | 13 models, 22123 bytes |
| same with `view=PUBLISHER_MODEL_VIEW_FULL` | 200 | byte-identical to BASIC |
| `https://aiplatform.googleapis.com/v1beta1/publishers/anthropic/models` (global) | 200 | same 13 models, same order |
| `.../v1/publishers/anthropic/models` (list on v1) | 404 | list is v1beta1 only |
| `.../v1/publishers/anthropic/models/claude-haiku-4-5?view=PUBLISHER_MODEL_VIEW_FULL` | 200 | single GET works on v1 |
| `.../v1beta1/projects/my-project/locations/us-central1/publishers/anthropic/models` | 404 | no project-scoped list |
| Regional lists us-east5, europe-west1, europe-west4, asia-southeast1 | 200 | only `claude-3-opus@20240229` |
| Regional lists us-east4, asia-east1, australia-southeast1, northamerica-northeast1 | 200 | `{}` |
| `?listAllVersions=true` | 200 | 14 entries: adds `claude-haiku-5-5@20261005` before `claude-haiku-5-5@default` |
| `.../models/claude-haiku-5-5@20261005` | 200 | `.../models/claude-haiku-5-5@20240101` gives 404 |
| `?orderBy=create_time` | 200 | equals the default order |
| `?orderBy=create_time desc` | 200 | exact reverse |
| `?orderBy=update_time desc` | 200 | noisy: `haiku-4-5` first |
| `?orderBy=name` | 200 | not alphabetical, equals the default order |
| `?orderBy=version_id`, `launch_stage`, `display_name`, `publish_time desc`, `release_time desc`, `foo` | 400 | `Unsupported order_by field` |
| `?filter=launchStage=GA` and four other filter forms | 400 | `Provided filter ... is invalid.` |
| `?pageSize=2` then `pageToken` | 200 | pagination works, order preserved |
| `?$fields=publisherModels(name,versionId,launchStage)` | 200 | 1.7 KB instead of 22 KB |
| Invalid bearer token (curl probe from the code map, not re-run by the PoC) | 401 | the proxy replaces every token inside this session, so the PoC cannot reproduce it |
| `https://api.anthropic.com/v1/models` without a key | 401 | `x-api-key header is required` |

### Fields

Per-model key union over the 13 entries: `name`, `versionId`, `launchStage`, `openSourceCategory`, `supportedActions`, `publisherModelTemplate` (the last on `sonnet-5`, `opus-5`, `opus-5-5`, `sonnet-5-5` only). Absent on every model: `displayName`, `createTime`, `updateTime`, `releaseDate`, `versionState`, any `deprecat*` field. Response headers carry no `ETag` and no `Last-Modified`.

| API order | Slug | versionId | launchStage | Release date (Google) |
|---|---|---|---|---|
| 1 | claude-haiku-4-5 | 20251001 | GA | 2025-10-15 |
| 2 | claude-opus-4-5 | 20251101 | GA | 2025-11-24 |
| 3 | claude-opus-4-6 | default | GA | 2026-02-05 |
| 4 | claude-sonnet-4-6 | default | GA | 2026-02-17 |
| 5 | claude-opus-4-7 | default | GA | 2026-04-15 (Anthropic: 2026-04-16) |
| 6 | claude-sonnet-5 | default | GA | 2026-06-30 |
| 7 | claude-opus-4-8 | default | GA | 2026-05-28 |
| 8 | claude-fable-5 | default | GA | 2026-06-09 |
| 9 | claude-opus-5 | default | GA | 2026-07-24 |
| 10 | claude-fable-5-1 | default | GA | 2026-09-01 |
| 11 | claude-opus-5-5 | default | GA | 2026-09-22 |
| 12 | claude-sonnet-5-5 | default | GA | 2026-09-28 |
| 13 | claude-haiku-5-5 | default | GA | 2026-10-07 |

Date sources: Google per-model pages `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/<family>-<ver>` ("Release date:") and Anthropic per-model pages `https://platform.claude.com/docs/en/models/<family>-<ver>/overview` ("Released:", fetched as `.md`).

### What the PoC demonstrates and what it does not

Demonstrated by `scripts/models/fetch_models.py` runs on 2026-10-12 (details in `scripts/models/README.md`):

- One stdlib GET with a bearer token and a quota project lists 13 models (us-central1 and global, HTTP 200).
- The recency sort is deterministic, byte-stable, and identical offline (`--dry-run --fixture`) and live.
- `--compare` reports added and removed slugs and keeps hand-set fields.
- `listAllVersions` duplicates collapse on the bare slug.
- A `claude-3-opus`-only capture and a `{}` body exit 3.
- With `requiresManualConsent` on `fable-5-1` the latest set is 3 ticked, 1 left out.

Not demonstrated by the PoC:

- Release dates. The API has no date field. The dates come from a table inside the script, filled from the per-model pages during the probe. The PoC scrapes nothing.
- The 401 for an invalid token (the proxy replaces every token).
- The CORS preflight, pagination, the other regional endpoints, and the per-model page dates. These come from the probe report and the saved captures.
- Deprecation, display names for unknown slugs, CI identity, and anything in the extension UI or tests.

Re-run at review time with read-only GETs, all as the table states:

- the regional `claude-3-opus` (europe-west4) and `{}` (us-east4) answers, and the `v1` 404,
- `orderBy=create_time` (equals the default order), `orderBy=update_time desc` (`haiku-4-5` first), the `orderBy=version_id` and `filter` 400s,
- `listAllVersions` (14 entries), `$fields` (1726 bytes), the `Access-Control-Allow-Origin` echo, and the Anthropic 401.

### PoC run 1: live, with compare, fixture saved

Command (exit 0):

```
python3 -I scripts/models/fetch_models.py --token proxy-injected --quota-project my-project \
  --compare extension/models.json --latest \
  --save-raw scripts/models/fixtures/publisher-models-2026-10-12.json
```

stderr:

```
fetch_models: raw response saved to scripts/models/fixtures/publisher-models-2026-10-12.json (22123 bytes)
fetch_models: 13 models from https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?view=PUBLISHER_MODEL_VIEW_BASIC (HTTP 200)
compare extension/models.json: 13 in file, 13 in API
  added:   (none)
  removed: (none)
  order:   the file order differs from the recency order
latest (newest GA, dated, per family): claude-fable-5-1, claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5
```

stdout:

```json
[
 {
  "slug": "claude-haiku-5-5",
  "name": "Claude Haiku 5.5",
  "launchStage": "GA",
  "releaseDate": "2026-10-07",
  "apiOrder": 13
 },
 {
  "slug": "claude-sonnet-5-5",
  "name": "Claude Sonnet 5.5",
  "launchStage": "GA",
  "releaseDate": "2026-09-28",
  "apiOrder": 12
 },
 {
  "slug": "claude-opus-5-5",
  "name": "Claude Opus 5.5",
  "launchStage": "GA",
  "releaseDate": "2026-09-22",
  "apiOrder": 11
 },
 {
  "slug": "claude-fable-5-1",
  "name": "Claude Fable 5.1",
  "launchStage": "GA",
  "releaseDate": "2026-09-01",
  "apiOrder": 10
 },
 {
  "slug": "claude-opus-5",
  "name": "Claude Opus 5",
  "launchStage": "GA",
  "releaseDate": "2026-07-24",
  "apiOrder": 9
 },
 {
  "slug": "claude-sonnet-5",
  "name": "Claude Sonnet 5",
  "launchStage": "GA",
  "releaseDate": "2026-06-30",
  "apiOrder": 6
 },
 {
  "slug": "claude-fable-5",
  "name": "Claude Fable 5",
  "launchStage": "GA",
  "releaseDate": "2026-06-09",
  "apiOrder": 8
 },
 {
  "slug": "claude-opus-4-8",
  "name": "Claude Opus 4.8",
  "launchStage": "GA",
  "releaseDate": "2026-05-28",
  "apiOrder": 7
 },
 {
  "slug": "claude-opus-4-7",
  "name": "Claude Opus 4.7",
  "launchStage": "GA",
  "releaseDate": "2026-04-15",
  "apiOrder": 5
 },
 {
  "slug": "claude-sonnet-4-6",
  "name": "Claude Sonnet 4.6",
  "launchStage": "GA",
  "releaseDate": "2026-02-17",
  "apiOrder": 4
 },
 {
  "slug": "claude-opus-4-6",
  "name": "Claude Opus 4.6",
  "launchStage": "GA",
  "releaseDate": "2026-02-05",
  "apiOrder": 3
 },
 {
  "slug": "claude-opus-4-5",
  "name": "Claude Opus 4.5",
  "launchStage": "GA",
  "releaseDate": "2025-11-24",
  "apiOrder": 2
 },
 {
  "slug": "claude-haiku-4-5",
  "name": "Claude Haiku 4.5",
  "launchStage": "GA",
  "releaseDate": "2025-10-15",
  "apiOrder": 1
 }
]
```

### PoC run 2: offline, from the saved fixture

Command (exit 0):

```
python3 -I scripts/models/fetch_models.py --dry-run \
  --fixture scripts/models/fixtures/publisher-models-2026-10-12.json \
  --compare extension/models.json --latest
```

stderr:

```
fetch_models: 13 models from fixture scripts/models/fixtures/publisher-models-2026-10-12.json
compare extension/models.json: 13 in file, 13 in API
  added:   (none)
  removed: (none)
  order:   the file order differs from the recency order
latest (newest GA, dated, per family): claude-fable-5-1, claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5
```

stdout: byte-identical to run 1 (`cmp` reports no difference). Two offline runs give the same md5 `35572f085f1c3666ec591b1404f91ab5`.

### PoC run 3: other probes

| Command | Exit | stderr (last lines) |
|---|---|---|
| live, `--region global --compare extension/models.json` | 0 | `13 models from https://aiplatform.googleapis.com/...` and the same array as us-central1 |
| offline, compare file with `requiresManualConsent: true` on `claude-fable-5-1`, `--latest` | 0 | `latest (newest GA, dated, per family): claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5` and `left out (requiresManualConsent, ...): claude-fable-5-1` |
| offline, synthetic fixture: `listAllVersions` capture plus `claude-mythos-5-1`, compare file plus `claude-vanished-1` | 0 | `undated (sorted by apiOrder, never latest): claude-mythos-5-1`, `added: claude-mythos-5-1`, `removed: claude-vanished-1 <- keep them, propose deprecated: true`, 14 entries out |
| offline, regional capture with only `claude-3-opus` | 3 | `untrusted response ...: none of the 13 compared slugs is present (got claude-3-opus)` |
| offline, `{}` body | 3 | `untrusted response ...: no publisherModels (wrong region or credential?)` |
| live, no `--token`, no env, `gcloud` absent from PATH | 2 | `no token (use --token, GOOGLE_OAUTH_ACCESS_TOKEN or gcloud auth login)` |
| live, env `GOOGLE_OAUTH_ACCESS_TOKEN=proxy-injected GOOGLE_CLOUD_QUOTA_PROJECT=my-project` | 0 | `13 models ... (HTTP 200)` |
| live, no `--token`, no env, token from `gcloud auth print-access-token` | 0 | `13 models ... (HTTP 200)` |

Proxy note: in this session `gcloud auth print-access-token` prints the literal `proxy-injected`. The agent proxy replaces it on every request to `*.googleapis.com`. A real environment passes a real token the same way.
