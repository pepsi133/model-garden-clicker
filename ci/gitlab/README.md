# ci/gitlab: sample pipeline and service-account PoC

This directory is the proof of concept for
[docs/scoping/02-gitlab-runner-service-account.md](../../docs/scoping/02-gitlab-runner-service-account.md).
Nothing here is wired into the repository root, the extension, the Python
harness or the GitHub release workflow.

## Files

| File | What it is |
|---|---|
| `.gitlab-ci.yml` | Sample pipeline: test, build, inventory (service account through Workload Identity Federation), enable (manual hand-off, prints only). |
| `poc/mg_inventory.py` | Read-only audit: lists the Anthropic models, reads the Service Usage state of each model's partner service per project, writes `projects.txt` and a settings file for the extension. Standard library only. |
| `poc/console_probe.mjs` | Playwright script that opens a model page headless with and without a service-account bearer. The result is in the comment at the top. |

## Run the PoC locally

Inventory and audit (GET requests only, no cost):

```sh
# token: --token, else GOOGLE_OAUTH_ACCESS_TOKEN, else gcloud auth print-access-token
python3 -I ci/gitlab/poc/mg_inventory.py \
  --projects my-project-a,my-project-b \
  --quota-project my-project-a \
  --out mg-inventory-out
```

Options: `--models claude-opus-4-6,claude-fable-5-1` limits the audit,
`--projects path/to/file` reads one project id per line,
`--save-fixture DIR` stores the raw answers, `--fixture DIR` replays them
offline (a non-200 `services:batchGet` answer is saved as
`{"status": N, "body": {...}}`, so a `403` project replays as
`no-permission`; a missing `publisher-models.json` or a malformed fixture
file exits 2; a missing `services-<project>.json` marks that project's rows
`unknown`). Outputs in
`--out`:

| Output | Use |
|---|---|
| `mg-inventory.json` | Full report: inventory, per-pair verdicts, pending list. |
| `projects.txt` | Pending project ids, one per line, the format the popup textarea takes (`extension/popup/popup.js` `projectIds()`). |
| `model-garden-clicker-settings.json` | Import file for the options page (Advanced, Import settings), with `popup.projects` and `popup.models`. |

Verdicts: `enabled` (service ENABLED), `not-enabled` (service DISABLED),
`no-permission` (HTTP 403), `unknown` (anything else).

Console probe (needs the `playwright` package and a full Chromium build):

```sh
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node ci/gitlab/poc/console_probe.mjs --project <project-id> --out console-probe-out
```

Exit 0 means no run reached a signed-in console page, which is the expected
result for a service account.

## Run it in GitLab

1. Create a Workload Identity Pool and an OIDC provider for your GitLab
   instance, and a read-only service account with
   `roles/serviceusage.serviceUsageViewer` on every audited project.
2. Set the CI/CD variables named at the top of `.gitlab-ci.yml`
   (`GCP_PROJECT_NUMBER`, `GCP_WIF_POOL`, `GCP_WIF_PROVIDER`, `GCP_SA_EMAIL`,
   `GCP_QUOTA_PROJECT`, `MGC_PROJECTS`, `GITLAB_OIDC_AUDIENCE`, and the
   optional `MGC_MODELS`, empty = every listed model). None is a
   long-lived secret. Mark them protected. The drift line of
   `inventory:audit` compares the full live list with `extension/models.json`
   whatever `MGC_MODELS` says; the report's `audited` array names the
   narrowed set.
   The job images are pinned (`node:22.20.0`, `google/cloud-sdk:570.0.0-slim`,
   `python:3.12.8-alpine`), so a scheduled run does not change under a
   floating tag. Bump them on purpose.
3. Copy `.gitlab-ci.yml` to the repository root, or point the project's CI/CD
   configuration file setting at `ci/gitlab/.gitlab-ci.yml`.
4. Add a pipeline schedule. Each run re-audits and shrinks `projects.txt`.
5. The `enable:handoff` job is manual and protected. It prints the pending
   pairs and the steps for a human run. It enables nothing.

## What the PoC proves

- A service account lists the current Anthropic model catalogue and the
  Marketplace service id of each model (14 entries, 13 slugs on 2026-10-12).
- A service account reads, per project, whether each model's partner service
  is ENABLED or DISABLED, in one `services:batchGet` per 20 names.
- The audit output imports into the extension with zero `MGC.parseConfig`
  errors.
- The offline suite, the strict loop and the zip build run unchanged on a
  `node:22` image.

## What the PoC does not prove

- That a DISABLED partner service always means "the console shows Enable".
  The owner must enable one model in the console and re-run the audit once.
- Any way to complete the questionnaire or click Agree without a signed-in
  human. The console ignores the bearer token (see `poc/console_probe.mjs`).
- The Workload Identity Federation exchange itself. This session had a
  proxy-injected token, so the `.gcp-wif` template is untested here.
- Any enabling call. The PoC sends GET requests only.
