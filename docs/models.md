# Anthropic models in Vertex AI Model Garden

Generated: 2026-10-07

## How this list was produced

Primary source (authoritative for the console-URL slug): the Vertex AI
publisher-models REST API, which backs the Model Garden console pages of the
form `https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/<slug>`.

Command that produced the list (read-only GET):

```
curl -s \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "X-Goog-User-Project: <QUOTA_PROJECT_ID>" \
  "https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?view=PUBLISHER_MODEL_VIEW_BASIC"
```

- The quota-project header (`X-Goog-User-Project: <quota-project-id>`) was
  required: without it the call returns HTTP 403 (when ADC has no quota
  project set).
- `gcloud ai model-garden models list --filter=anthropic` failed with the same
  403 / quota-project error and produced nothing usable.
- The global endpoint `https://aiplatform.googleapis.com/v1beta1/...` returned
  the identical 12-model set.
- The `v1` path (both regional and global) returns HTTP 404; this listing is
  `v1beta1`-only. (Note: `v1` still works for `:rawPredict` inference on
  individual models, just not for the publisher-models list.)
- Requires an active gcloud login and a quota project (set with
  `gcloud auth application-default set-quota-project`).

API result: 12 `publisherModels`, each `openSourceCategory=PROPRIETARY`,
`launchStage=GA`. Only `claude-haiku-4-5` and `claude-opus-4-5` carry a dated
`versionId`; the rest return `versionId=default` (no pinned date version).

Cross-check source: Anthropic docs "Claude on Google Cloud"
(`https://platform.claude.com/docs/en/api/claude-on-vertex-ai`, redirected from
`docs.claude.com`) and Google docs
(`https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude`).

## Ordering

Sorted newest first by **version number in the name** (descending), tie-broken
by family rank Opus > Sonnet > Fable > Haiku. Note this is a name-based reading,
not release chronology: the API's own return order is not strictly
version-ordered (e.g. it returns `claude-sonnet-5` before `claude-opus-4-8`),
so release order and version-number order disagree. The Anthropic docs table is
grouped by family, not by a global timeline, so it does not supply a
cross-family "newest" order either.

## Entries (each with its raw source)

| # | Slug | Name | versionId (API) | launchStage | In API? | In Anthropic docs table? |
|---|------|------|-----------------|-------------|---------|--------------------------|
| 1 | claude-opus-5-5 | Claude Opus 5.5 | default | GA | yes | yes (`claude-opus-5-5`) |
| 2 | claude-sonnet-5-5 | Claude Sonnet 5.5 | default | GA | yes | yes (`claude-sonnet-5-5`) |
| 3 | claude-fable-5-1 | Claude Fable 5.1 | default | GA | yes | yes (`claude-fable-5-1`) |
| 4 | claude-opus-5 | Claude Opus 5 | default | GA | yes | yes (`claude-opus-5`) |
| 5 | claude-sonnet-5 | Claude Sonnet 5 | default | GA | yes | yes (`claude-sonnet-5`) |
| 6 | claude-fable-5 | Claude Fable 5 | default | GA | yes | yes (`claude-fable-5`) |
| 7 | claude-opus-4-8 | Claude Opus 4.8 | default | GA | yes | yes (`claude-opus-4-8`) |
| 8 | claude-opus-4-7 | Claude Opus 4.7 | default | GA | yes | yes (`claude-opus-4-7`) |
| 9 | claude-opus-4-6 | Claude Opus 4.6 | default | GA | yes | yes (`claude-opus-4-6`) |
| 10 | claude-sonnet-4-6 | Claude Sonnet 4.6 | default | GA | yes | yes (`claude-sonnet-4-6`) |
| 11 | claude-opus-4-5 | Claude Opus 4.5 | 20251101 | GA | yes | yes (`claude-opus-4-5@20251101`) |
| 12 | claude-haiku-4-5 | Claude Haiku 4.5 | 20251001 | GA | yes | yes (`claude-haiku-4-5@20251001`) |

Added for 0.8.0 (`extension/models.json`): Claude Haiku 5.5, slug
`claude-haiku-5-5`, launchStage GA. It is not in the 2026-10-07 API listing
above, which was not run again, so its versionId and its docs-table entry
are not recorded here.

All 12 API entries are confirmed by the Anthropic docs table. The dated
versionIds (`@20251101`, `@20251001`) match between the API and the docs.

## Models in the docs but NOT returned by the API (deliberately excluded)

These appear in the Anthropic docs "API model IDs" table but are absent from the
Vertex publisher-models API, so no `agent-platform/.../model-garden/<slug>`
console page is confirmed for them. They are therefore excluded from
`models.json`:

Limited-availability research preview (not in API; "Project Glasswing", invited
customers only — docs link them to a support article on limited availability):
- Claude Mythos 5.1 - `claude-mythos-5-1`
- Claude Mythos 5 - `claude-mythos-5`

Deprecated (docs mark them deprecated and the API omits them, so they are
excluded):
- Claude Opus 4.1 - `claude-opus-4-1@20250805`
- Claude Opus 4 - `claude-opus-4@20250514`
- Claude Sonnet 4.5 - `claude-sonnet-4-5@20250929`
- Claude Sonnet 4 - `claude-sonnet-4@20250514`
- Claude Haiku 3.5 - `claude-3-5-haiku@20241022`

The API does not return any `versionState`/deprecation field for the 12 live
models; the deprecated set is simply not listed by the API at all.
