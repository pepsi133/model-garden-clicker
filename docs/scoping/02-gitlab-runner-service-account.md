# Scoping 02: run Model Garden Clicker from a GitLab runner under a service account

Status: scoping with a proof of concept (PoC). Nothing in this document is implemented in the extension or the Python harness. Date: 2026-10-12.

## Summary

A service account can run the inventory and audit half of this tool from a GitLab runner, with read-only API calls and no stored keys. A service account cannot sign in to the console (Appendix A, rows 11-15), and this scoping found no public API for the questionnaire or Agree. The recommended design is a hybrid: GitLab prepares the work list, a human runs the extension on a laptop, and a re-audit closes the loop.

## Problem

The tool enables Claude models by driving the Cloud console in a signed-in browser. The owner asked whether the same work can run headless in a GitLab runner under a service account (SA). An SA is a Google Cloud identity for programs, not for people. This document answers three questions:

1. Which parts of the flow can an SA perform from a runner?
2. Which parts need a human, and why?
3. What does a safe pipeline look like, and what does the PoC prove?

## How the tool runs today

Identity: a human Google session in the browser. There is no token anywhere.

| Aspect | Extension | Python harness |
|---|---|---|
| Identity | Cookies of the signed-in Chrome profile. No auth code. Host permission `https://console.cloud.google.com/*` only (`extension/manifest.json:9`). | The same cookies in a dedicated profile dir `python/.chrome-profile` (`python/mgclick/paths.py:5`), passed as `--user-data-dir` (`python/mgclick/browser.py:129`). |
| Sign-in | None. A redirect to `accounts.google.com` lands on a page with no content script, and the job fails on `PAGE.UNKNOWN` (`extension/content/main.js:319`). | `python/scripts/login.py:23` opens a headed browser, waits on `input()` at line 29, then judges the URL with `is_login_page()` (`python/mgclick/urls.py:27-28`). |
| Browser | Chrome with the unpacked extension loaded. | Branded Chrome at `/usr/bin/google-chrome` (`python/mgclick/browser.py:33`). `--headless=new` exists at lines 153-154, but every flow script passes `headless=False`. |
| Secrets | Questionnaire values in `chrome.storage.local`. | `python/config.local.json` (`python/mgclick/config.py:11` names the keys) and the profile. Both are gitignored (`.gitignore:11-13`). |
| Signed-out detection | Not explicit. | `check_signed_in()` (`python/scripts/ext_dryrun.py:190`) returns exit 3 and writes `signed-out.png` (lines 750-751). |
| Agree guard | `clickAgreeGuarded` is the only Agree path. `extension/test/run.sh:33-36` prints its md5 against the baseline in `docs/MAINTENANCE.md:208`. | `click_agree_approved()` runs only with `--i-approve-agree`. |
| CI today | `.github/workflows/release.yml`: node 22, `npm ci`, `run.sh`, strict loop, zip, GitHub release. No browser, no Google identity. | None. |

## What a service account can do

Every claim in this section comes from the probe table in Appendix A. The probe identity was the proxy-injected SA of this container.

| Capability | Evidence | Verdict |
|---|---|---|
| Identity resolution | `tokeninfo` returns `azp` <sa-unique-id> with scope `cloud-platform`. The IAM list maps that id to `<audit-sa>@my-project.iam.gserviceaccount.com`. `userinfo` answers 401, because an SA token has no user profile. | Works. |
| Project access | `projects.list` returns one project: `my-project` (<project-number>, organization <org-id>). `projects.get` answers 200. | Works, bounded to the projects the SA can see. |
| Model inventory | `GET /v1beta1/publishers/anthropic/models?listAllVersions=true&view=PUBLISHER_MODEL_VIEW_FULL` on the global endpoint returns 14 entries and 13 slugs. Each entry carries `launchStage`, `versionId` and a `requestAccess` URI. The `service=` query parameter of that URI is the model's Marketplace service id (`anthropic-882.cloudpartnerservices.goog` for `claude-opus-4-6`). | Works. This list is also the auto-population source for scoping 01. |
| "Model enabled or not" signal | `serviceusage.services:batchGet` on project <project-number> answers `anthropic-882` DISABLED, `anthropic-912` DISABLED, `aiplatform.googleapis.com` ENABLED in one call. The enabled-services list of the project holds no `anthropic-NNN` service. | Works as a read-only, zero-cost signal. The owner must validate it once (PoC section). |
| Inference check | `rawPredict` with `max_tokens` 1 answers 429 "Quota exceeded ... per_base_model" on the global endpoint and 501 UNIMPLEMENTED on `us-east5`. | Not a usable signal. Neither code names the enablement, and the call costs tokens once a model is enabled. The PoC does not use it. |
| Org policy read | `vertexai.allowedModels:getEffectivePolicy` answers 403: the Organization Policy API is not enabled in the project. | Possible after the API is enabled and the SA gets `roles/orgpolicy.policyViewer`. Open question 8. |
| Offline CI | `run.sh`, the strict loop and the zip build ran unchanged in this container with node 22 (PoC section). | Works without any Google identity. |
| Post-consent enable | `projects.publishers.models:enableModel` (v1beta1) exists and succeeds only "if prerequisites are met (e.g. completed questionnaire and consents, or an active Private Offer)" (Appendix B, S1). Not called in this session. | Possible only for pairs a human consented to already. Open question 2. |
| EULA acceptance status | `POST /v1beta1/projects/my-project/modelGardenEula:check` with `{"publisherModel": "publishers/anthropic/models/claude-haiku-4-5"}` answers 200 `{projectNumber, publisherModel}` for `claude-haiku-4-5` and `claude-opus-5-5` (rows 22-23). The documented response type `PublisherModelEulaAcceptance` has a third field `publisherModelEulaAcked` (S29). The answer leaves it out, which in proto3 JSON means `false`. The call reads state and changes nothing. | Works as a documented, per-pair signal next to the Service Usage one. The PoC does not call it yet. Open question 9. |

## What a service account cannot do

| Step | Playwright result (Appendix A, rows 14-15) | Reason |
|---|---|---|
| Console sign-in | Without a bearer, the headless browser ends on `accounts.google.com/v3/signin/identifier` ("Sign in to continue to Google Cloud Platform"). With the SA bearer, the page stays on an empty console shell with a "SIGN IN" link and no model card. | The console is a cookie-based user surface. It ignores `Authorization: Bearer`. An SA has no Google Account web session. |
| Questionnaire | Never reached. | The questionnaire lives at `console.cloud.google.com/vertex-ai/model-garden/questionnaire` behind the sign-in. This scoping found no public REST method for its consent. The Marketplace audit-log method list (S4) names order and license-pool methods only, and `:enableModel` (S1) lists completed consents as a prerequisite. |
| Agree | Never reached. | Same page. `gcloud ai model-garden models` offers only `deploy`, `list` and `list-deployment-config` (SDK 570.0.0). The Terraform resource is post-consent only (S6, S7). |

A seeded human browser session inside the runner is technically possible but not recommended. Google blocks sign-ins from automated browsers (S20). 2-step verification becomes mandatory for console access for Cloud Identity users on 2026-10-20 (S23), and a headless job has nobody to answer a challenge. The profile tarball is a live human session stored in CI variables, and masking "is not a guaranteed way" to protect it (S16).

## Recommended architecture

The hybrid. GitLab runs everything API-shaped under the SA. A human runs the console step on a laptop with the extension. A scheduled re-audit removes the pairs the human enabled.

```text
 GitLab runner (SA via WIF, read-only)                 Human laptop (own Google session)
 ------------------------------------                 ---------------------------------
 [test] offline suite + guard md5 gate
      |
 [build] extension zip (tags)
      |
 [inventory] publishers/anthropic/models  --> inventory (slug, service id, stage)
      |        diff against extension/models.json  --> drift notice
      |
 [audit] services:batchGet per project    --> verdict per (project, model)
      |
 [matrix] projects.txt + settings file    --> artifact ----------------> import into the
      |                                                                  extension options page
 [enable:handoff] manual, protected,                                     DRY RUN, then live run
      prints the pending list only                                       (every Agree click is human)
      |                                                                       |
 [schedule] next run re-audits  <--------------------------------------------+
            enabled pairs drop out of projects.txt
```

Design calls:

- CI identity is the SA only. No human session, cookie jar or password enters the runner.
- No browser job receives a Google session or `--i-approve-agree`. The md5 gate and the single-guard checks stay as failing gates.
- The API enable job (`:enableModel`) stays designed, not built, until open question 2 has an answer.
- An identity-free browser smoke job (extension loads, `ext_dryrun` exits 3 "signed out") is optional and adds no identity.

## Identity and secrets

Workload Identity Federation (WIF) lets a GitLab job exchange its ID token for a Google credential.

| Item | Design |
|---|---|
| Token source | `id_tokens:` block with `aud` set to the GitLab instance URL (S12, S13). |
| Exchange | `gcloud iam workload-identity-pools create-cred-config` writes a credential file, exported as `GOOGLE_APPLICATION_CREDENTIALS` (S14). The sample `.gcp-wif` template in `ci/gitlab/.gitlab-ci.yml` does this. |
| SA impersonation | One dedicated audit SA. `--service-account-token-lifetime-seconds=600`. No downloaded key, ever. |
| GitLab.com alternative | The Google Cloud IAM integration grants roles to a `principalSet` without an SA (S15). Open question 4. |
| Pool restriction | Attribute condition on `assertion.namespace_id` or `assertion.project_id`, as Google requires for GitLab.com (S13). |
| Audit SA roles | `roles/serviceusage.serviceUsageViewer` on each audited project, `serviceusage.services.use` on the quota project, `roles/browser` at the folder only if project discovery is wanted. |
| Enable SA (not built) | Separate principal with `roles/consumerprocurement.entitlementManager`, bound only to a manual protected job. |
| CI/CD variables | `GCP_PROJECT_NUMBER`, `GCP_WIF_POOL`, `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL`, `GCP_QUOTA_PROJECT`, `MGC_PROJECTS`, `MGC_MODELS`, `GITLAB_OIDC_AUDIENCE`. All protected. None is a true secret under WIF, so masking is optional. |
| `python/config.local.json` | Stays on the laptop. The questionnaire runs there. It never enters the runner. |
| Browser profile | Stays on the laptop (`python/.chrome-profile`). Never a CI variable, never an artifact. |
| Artifacts | `mg-inventory-out/` holds project ids and slugs only. `expire_in: 1 week`, protected refs. |

## Pipeline stages

| Stage | Runs as | Identity | Inputs | Outputs | Manual or automatic |
|---|---|---|---|---|---|
| test | `node:22` image | none | repository | `run-sh.log`, pass or fail, md5 gate | automatic on branches, MRs, tags |
| build | `node:22` image | none | `extension/` | `dist/model-garden-clicker-<version>.zip` | automatic on `v*` tags and MRs |
| inventory | `google/cloud-sdk:slim` with `.gcp-wif` | audit SA via WIF | `MGC_PROJECTS`, `MGC_MODELS` | `mg-inventory-out/` (report, `projects.txt`, settings file), drift notice | automatic on schedule, default branch, web |
| enable | `python:3.12-alpine` | none | `mg-inventory-out/` | printed pending list and human instructions | manual, protected refs, environment `model-garden-enable` |
| release (not in the sample) | `node:22` image | `CI_JOB_TOKEN` | zip, `CHANGELOG.md` section | GitLab release with the zip | automatic on `v*` tags |
| browser-smoke (optional, not in the sample) | Playwright image | none | extension, Chromium | `signed-out.png`, exit 3 proof | automatic, `allow_failure: true` at first |
| api-enable (designed, not built) | `google/cloud-sdk:slim` | enable SA | `mg-inventory-out/` | re-audit, "needs human consent" rows | manual, protected, default off |

## PoC

`ci/gitlab/` holds:

| Path | Content |
|---|---|
| `ci/gitlab/.gitlab-ci.yml` | Sample pipeline with the four stages above and the `.gcp-wif` template. PyYAML parses it. A structural check found every `needs` and `stage` reference valid. |
| `ci/gitlab/poc/mg_inventory.py` | Standard-library Python 3 audit, `python3 -I` safe. GET requests only. Writes `projects.txt`, the settings file and `deep-links.md`. |
| `ci/gitlab/poc/console_probe.mjs` | Playwright probe with its result in the header comment. |
| `ci/gitlab/README.md` | How to run both scripts locally and in GitLab. |

Runs in this session against `my-project`:

1. The inventory script with every model (exit 0). Actual output:

```text
$ python3 -I ci/gitlab/poc/mg_inventory.py --projects my-project --quota-project my-project --token proxy-injected --out ./out --save-fixture ./fixture
Anthropic publisher models (global endpoint): 14 entries, 13 slugs audited
slug                   stage    service id                                 versions
claude-haiku-4-5       GA       anthropic-867.cloudpartnerservices.goog    20251001
claude-opus-4-5        GA       anthropic-874.cloudpartnerservices.goog    20251101
claude-opus-4-6        GA       anthropic-882.cloudpartnerservices.goog    default
claude-sonnet-4-6      GA       anthropic-884.cloudpartnerservices.goog    default
claude-opus-4-7        GA       anthropic-895.cloudpartnerservices.goog    default
claude-sonnet-5        GA       anthropic-896.cloudpartnerservices.goog    default
claude-opus-4-8        GA       anthropic-897.cloudpartnerservices.goog    default
claude-fable-5         GA       anthropic-902.cloudpartnerservices.goog    default
claude-opus-5          GA       anthropic-904.cloudpartnerservices.goog    default
claude-fable-5-1       GA       anthropic-912.cloudpartnerservices.goog    default
claude-opus-5-5        GA       anthropic-914.cloudpartnerservices.goog    default
claude-sonnet-5-5      GA       anthropic-915.cloudpartnerservices.goog    default
claude-haiku-5-5       GA       anthropic-932.cloudpartnerservices.goog    20261005,default

project                  model                  service                                    http  state     verdict
my-project               claude-haiku-4-5       anthropic-867.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-4-5        anthropic-874.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-4-6        anthropic-882.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-sonnet-4-6      anthropic-884.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-4-7        anthropic-895.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-sonnet-5        anthropic-896.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-4-8        anthropic-897.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-fable-5         anthropic-902.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-5          anthropic-904.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-fable-5-1       anthropic-912.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-opus-5-5        anthropic-914.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-sonnet-5-5      anthropic-915.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               claude-haiku-5-5       anthropic-932.cloudpartnerservices.goog    200   DISABLED  not-enabled
my-project               (vertex ai api)        aiplatform.googleapis.com                  200   ENABLED

summary: not-enabled=13
pending projects (at least one model not enabled): 1
wrote out/mg-inventory.json, out/projects.txt, out/model-garden-clicker-settings.json
```

   `projects.txt` holds the single line `my-project`. The settings file holds `popup.projects` with that id and `popup.models` with the 13 slugs.

2. `MGC.parseConfig` from `extension/common/constants.js:466` read the settings file in node: `ok= true errors= [] notices= [] format= full projects= [ 'my-project' ] models= 13`.

3. The script with `--models claude-opus-4-6,claude-fable-5-1 --fixture ./fixture` replayed the saved answers offline (exit 0, `not-enabled=2`).

4. The script with a project the SA cannot see, `example-not-visible-proj`, produced `http 403`, verdict `no-permission` (exit 0). That project is not in `projects.txt`.

5. `console_probe.mjs` under Playwright 1.56.1 and Chromium 141 (exit 0). Its summary line reads `no-bearer: sign-in page` and `sa-bearer: console shell, no session`.

6. The CI port ran in a scratch copy of the repository. `npm ci` added 36 packages. `MGC_ALLOW_SKIP=1 sh extension/test/run.sh` exited 0 with `ALL TEST FILES PASSED`. It printed `guard md5 (clickAgreeGuarded): cb9355fd64564c8cca121beccd4d42fc (matches the baseline in docs/MAINTENANCE.md)`. The strict loop printed `271 passed, 0 failed, 0 skipped` and `356 passed, 0 failed, 0 skipped`. `sh scripts/build-extension-zip.sh` built `model-garden-clicker-0.8.0.zip`.

Not run in this session: `:enableModel`, any consent or order call, any console click, and the WIF exchange itself (this container had a proxy-injected token).

The most important follow-up is human. Enable one model on a test project with the extension, re-run the audit, and confirm that exactly that service flips to ENABLED. Run the EULA check (rows 22-23) before and after, and confirm that `publisherModelEulaAcked` turns `true` for that pair only. The two signals then calibrate each other.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| The audit signal is inferred from Service Usage, not from a documented "model enabled" field. | Validate once with the human follow-up above. Keep the `aiplatform.googleapis.com` state next to it. Mark rows, never act on them automatically. |
| The model-to-service mapping comes from parsing a console link. | Fail loudly on an unparsable URI (the script warns). Keep the 13 known ids as a fixture (`--save-fixture`). |
| Two `claude-haiku-5-5` entries share one service id. | The script collapses versions per slug and audits by service id. |
| `:enableModel` is v1beta1, its `service` field is deprecated, and it is a no-op before consent. | Keep the API enable job off by default, with a separate SA and a protected environment. Treat a precondition failure as "needs human consent". |
| The SA sees few projects (one here). | Take `MGC_PROJECTS` from a variable for the MVP. Folder-level viewer is an admin ask (open question 3). |
| Org policies can block a model even for a human. | Read the effective policies in the audit once the SA has `roles/orgpolicy.policyViewer`, and mark "blocked by policy". |
| The human hand-off is subject to Google bot detection and the 2SV mandate. | The human stays on a laptop with their own session. The scheduled re-audit shrinks the work list. |
| Accidental Agree in CI. | No browser job gets a Google session or `--i-approve-agree`. The md5 gate fails the job on a guard edit. |
| Drift between `extension/models.json` and the live list. | The inventory job prints the two differences on every run. |
| Browser smoke fragility (Chromium and chromedriver majors, shared memory, egress). | Pin the Playwright image tag, add `--disable-dev-shm-usage`, start with `allow_failure: true`. |
| Quota. | One `batchGet` per 20 names per project per run. |

## Out of scope

- Any unattended enabling of a Claude model. This scoping found no supported path (Appendix A rows 11-20, S1, S4, S7).
- A seeded human browser session inside the runner.
- Changes to the extension, the Python harness, `run.sh` or the GitHub release workflow.
- Project discovery across an organization.
- The GitLab release job (a direct port of `release.yml` with the `release:` keyword, left out of the sample).

## Open questions for the owner

1. Is the hybrid acceptable: an org-wide "which projects lack which Claude models" view plus a short human work list?
2. Can a human run one `:enableModel` POST on a throwaway project with the `entitlementManager` SA, and report the result? This decides whether the API enable job exists.
3. Which projects are in scope, and who grants `roles/serviceusage.serviceUsageViewer` to the audit SA? This identity sees only `my-project`.
4. GitLab.com or self-managed? This picks the Google Cloud IAM integration or the generic `id_tokens` plus STS flow.
5. Must the "latest models" policy run in CI and write `models.json` by merge request (recommended), or must the extension fetch the API at runtime?
6. Where must the settings file land for the operator: pipeline artifact only, or also a bucket?
7. Confirm that a browser-in-CI job with a human session is out of scope.
8. Do `vertexai.allowedModels` or a procurement API block apply on the target projects? The Organization Policy API is not enabled on `my-project`.
9. Must the audit use the Service Usage state, the EULA check (rows 22-23), or both? The EULA check is documented per pair. The Service Usage state is one call per project. Both need the one-time human calibration above.

## Effort estimate per stage

| Stage | Effort | Notes |
|---|---|---|
| WIF pool, provider, audit SA, `.gcp-wif` template | 1 day | Excludes IAM approvals. |
| test and build port, md5 gate, release job | 0.5 day | The sample already runs locally. |
| inventory and audit modules with fixture tests | 1.5 days | Reuse `mg_inventory.py`. Add the `models.json` drift merge request. |
| matrix writer and schedule | 1 day | Settings file, `projects.txt`, Markdown table, scheduled pipeline. |
| browser smoke (optional) | 1 day | Chromium and chromedriver pairing, exit 3 assertion. |
| api-enable (only after open question 2) | 1 day | Second SA, protected environment, precondition handling. |
| owner validation and documentation | 1 day | Enable one model, confirm the flip, MAINTENANCE.md section. |
| Total | 6 to 7 days | Plus 1 optional day. The questionnaire and Agree stay manual. |

## Appendix A: probe table

All probes ran on 2026-10-12 from this container with the proxy-injected SA (`<audit-sa>@my-project.iam.gserviceaccount.com`), quota project `my-project`. The SA name, its `uniqueId`, the project id, the project number and the organization id are placeholders in this public repository.

| # | URL | Method | HTTP | Result |
|---|---|---|---|---|
| 1 | `https://www.googleapis.com/oauth2/v3/tokeninfo` (bearer header) | GET | 200 | `azp` <sa-unique-id>, scope `cloud-platform`, `expires_in` 3599 |
| 2 | `https://www.googleapis.com/oauth2/v3/userinfo` | GET | 401 | `Invalid Credentials` (no user profile on an SA token) |
| 3 | `https://iam.googleapis.com/v1/projects/my-project/serviceAccounts` | GET | 200 | 4 accounts. `uniqueId` <sa-unique-id> is `<audit-sa>@my-project.iam.gserviceaccount.com` |
| 4 | `https://cloudresourcemanager.googleapis.com/v1/projects` | GET | 200 | one project: `my-project`, <project-number>, organization <org-id> |
| 5 | `https://cloudresourcemanager.googleapis.com/v1/projects/my-project` | GET | 200 | `ACTIVE`, created 2026-10-03 |
| 6 | `https://aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?listAllVersions=true&view=PUBLISHER_MODEL_VIEW_FULL` | GET | 200 | 14 entries, 13 slugs, all `GA`, `requestAccess` URI with `service=anthropic-NNN.cloudpartnerservices.goog` |
| 7 | `https://serviceusage.googleapis.com/v1/projects/<project-number>/services:batchGet?names=...anthropic-882...&names=...anthropic-912...&names=...aiplatform.googleapis.com` | GET | 200 | `anthropic-882` DISABLED, `anthropic-912` DISABLED, `aiplatform.googleapis.com` ENABLED |
| 8 | `https://serviceusage.googleapis.com/v1/projects/<project-number>/services/anthropic-867.cloudpartnerservices.goog` | GET | 200 | `DISABLED` |
| 9 | `https://serviceusage.googleapis.com/v1/projects/<project-number>/services?filter=state:ENABLED&pageSize=200` | GET | 200 | 54 enabled services, no `anthropic-NNN` among them |
| 10 | `https://orgpolicy.googleapis.com/v2/projects/my-project/policies/vertexai.allowedModels:getEffectivePolicy` | GET | 403 | `PERMISSION_DENIED`: Organization Policy API not enabled in the project |
| 11 | `https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-opus-4-6?project=my-project` (curl, no bearer) | GET | 302 | `Location` is the same URL, sets `NID` and `__Secure-DIVERSION_ID` cookies |
| 12 | same URL (curl, SA bearer) | GET | 302 | identical response to row 11 |
| 13 | same URL (curl, SA bearer, cookie jar, follow) | GET | 200 | after one redirect: 3.1 MB shell titled `Google Cloud console`, contains `accounts.google.com/ServiceLogin?service` |
| 14 | same URL (Playwright headless, no bearer) | GET | 302, 200, then client redirect | final URL `accounts.google.com/v3/signin/identifier`, body "Sign in to continue to Google Cloud Platform" |
| 15 | same URL (Playwright headless, SA bearer) | GET | 302, 200, 401 on `accounts.google.com/RotateCookiesPage` | stays on the console shell, body ends with `SIGN IN`, no model card |
| 16 | `https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/anthropic/models/claude-haiku-4-5:rawPredict` (`max_tokens` 1) | POST | 429 | `Quota exceeded for aiplatform.googleapis.com/global_online_prediction_requests_per_base_model` |
| 17 | same on `locations/us-east5` | POST | 501 | `UNIMPLEMENTED: Operation is not implemented, or supported, or enabled.` |
| 18 | same as 16 for `claude-opus-4-6` | POST | 429 | same quota message |
| 19 | same as 17 for `claude-opus-4-6` | POST | 501 | same message |
| 20 | `gcloud ai model-garden models --help` | CLI | n/a | commands: `deploy`, `list`, `list-deployment-config` (SDK 570.0.0) |
| 21 | `gcloud iam workload-identity-pools create-cred-config --help` | CLI | n/a | present in SDK 570.0.0 |
| 22 | `https://aiplatform.googleapis.com/v1beta1/projects/my-project/modelGardenEula:check`, body `{"publisherModel": "publishers/anthropic/models/claude-haiku-4-5"}` | POST (read-only) | 200 | `{"projectNumber": "<project-number>", "publisherModel": "publishers/anthropic/models/claude-haiku-4-5"}`, no `publisherModelEulaAcked` field |
| 23 | same for `claude-opus-5-5` | POST (read-only) | 200 | same shape, no `publisherModelEulaAcked` field |
| 24 | same path under `projects/my-project/locations/global` and `locations/us-central1` | POST (read-only) | 404 | HTML 404: the parent is `projects/{project}` only |
| 25 | `https://cloudresourcemanager.googleapis.com/v1/projects/my-project:testIamPermissions` | POST (read-only) | 200 | granted: `aiplatform.endpoints.predict`, `iam.serviceAccounts.list`, `resourcemanager.projects.get`, `resourcemanager.projects.getIamPolicy`, `serviceusage.services.enable` |
| 26 | `https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/anthropic/models/claude-haiku-4-5:rawPredict` (`max_tokens` 1) | POST | 404 | `NOT_FOUND`: "was not found or your project does not have access to it". Same answer for `claude-sonnet-5-5`, and for a made-up slug on the global endpoint. |
| 27 | `https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-project/locations/us-central1/publishers/anthropic/models/claude-haiku-4-5` | GET | 404 | HTML 404: no project-scoped publisher-model resource on this path |
| 28 | `https://cloudcommerceconsumerprocurement.googleapis.com/v1/projects/<project-number>/orders` | GET | 404 | HTML 404: the Consumer Procurement API is not enabled in the project, or the path is not served |
| 29 | `https://iam.googleapis.com/v1/projects/-/serviceAccounts/<sa-unique-id>` | GET | 200 | `<audit-sa>@my-project.iam.gserviceaccount.com`, description "SA dedicated to managing the infra in this project." |

Rows 16 to 19 and 26 are inference POST calls. They request one token of inference and change no state. Rows 22 to 25 are POST calls to read-only check methods. Everything else is a GET or a local `--help`. Rows 22 to 29 were run by the session after the workflow, with the same identity.

## Appendix B: sources

- S1 https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/projects.publishers.models/enableModel
- S2 https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/projects.modelGardenEula/accept
- S3 https://docs.cloud.google.com/marketplace/docs/reference/consumerprocurement/rest/v1/billingAccounts.orders/place
- S4 https://docs.cloud.google.com/marketplace/docs/audit-logging
- S5 https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models
- S6 https://raw.githubusercontent.com/hashicorp/terraform-provider-google-beta/main/CHANGELOG.md
- S7 https://raw.githubusercontent.com/hashicorp/terraform-provider-google-beta/main/website/docs/r/vertex_ai_model_garden_enable_model.html.markdown
- S9 https://docs.cloud.google.com/vertex-ai/generative-ai/docs/control-model-access
- S10 https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude
- S12 https://docs.gitlab.com/ci/secrets/id_token_authentication/
- S13 https://docs.gitlab.com/ci/cloud_services/google_cloud/
- S14 https://docs.cloud.google.com/sdk/gcloud/reference/iam/workload-identity-pools/create-cred-config
- S15 https://docs.gitlab.com/integration/google_cloud_iam/
- S16 https://docs.gitlab.com/ci/variables/
- S17 https://docs.gitlab.com/runner/executors/docker/
- S18 https://playwright.dev/docs/ci
- S19 https://playwright.dev/docs/docker
- S20 https://support.google.com/accounts/answer/7675428
- S23 https://docs.cloud.google.com/docs/authentication/mfa-requirement
- S25 https://policies.google.com/terms
- S26 https://claude.com/docs/third-party/claude-desktop/vertex.md
- S27 https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai.md
- S28 https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/projects.modelGardenEula/check
- S29 https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/v1beta1/PublisherModelEulaAcceptance
- Repository: `extension/manifest.json`, `extension/content/main.js`, `extension/popup/popup.js`, `extension/common/constants.js`, `extension/test/run.sh`, `python/scripts/login.py`, `python/scripts/ext_dryrun.py`, `python/mgclick/browser.py`, `python/mgclick/urls.py`, `python/mgclick/paths.py`, `docs/MAINTENANCE.md`, `.github/workflows/release.yml`.
