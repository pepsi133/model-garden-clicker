# Anthropic models in Vertex AI Model Garden

Generated: 2026-10-07, entries refreshed 2026-10-12

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

API result: 12 `publisherModels` (the 2026-10-07 listing, the 2026-10-12
listing has 13, see Entries), each `openSourceCategory=PROPRIETARY`,
`launchStage=GA`. Only `claude-haiku-4-5` and `claude-opus-4-5` carry a dated
`versionId`; the rest return `versionId=default` (no pinned date version).

Cross-check source: Anthropic docs "Claude on Google Cloud"
(`https://platform.claude.com/docs/en/api/claude-on-vertex-ai`, redirected from
`docs.claude.com`) and Google docs
(`https://docs.cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-claude`).

## Ordering

The popup sorts the list at load time with `MGC.compareModelsByRecency`
(`extension/common/constants.js`). The file order is the same release order,
so a reviewer reads the file as the popup shows it. The popup never relies
on it. The lint `extension/test/models-json.cjs` fails when the file is not
in that order, among its other checks. The keys, in order:

1. `releaseDate` (`YYYY-MM-DD`), descending. The authoritative recency key.
   An entry without a valid date sorts below every dated entry and is never
   `latest`. Omit the date and the model is excluded from `latest`.
2. `apiOrder`, descending. The 1-based position in the API default order
   (oldest = 1), which equals `create_time` ascending. A fallback only, below
   every dated entry. The API lists `claude-sonnet-5` (6) before
   `claude-opus-4-8` (7), although Opus 4.8 shipped first. It is never the
   primary key.
3. The version parsed from the slug, descending, then the family rank
   Opus > Sonnet > Fable > Haiku > other. Undated, unordered entries only.
4. The slug, ascending. The final tie-break, so the order is total.

Date sources, both checked on 2026-10-12: the Google per-model page
`https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/<family>-<ver>`
("Release date:") and the Anthropic per-model page
`https://platform.claude.com/docs/en/models/<family>-<ver>/overview`
("Released:"). The two agree on every model but `claude-opus-4-7`: Google
says 2026-04-15, Anthropic 2026-04-16. The file takes Google's Vertex date.
The API itself has no date field.

`latest` (the popup link) is, per model line, the single newest entry with
`launchStage` `"GA"`, a valid `releaseDate` and no `deprecated: true`. A line
whose newest such entry carries `requiresManualConsent: true` is left out as
a whole and named in the popup's note. Today that is Fable 5.1, whose model
page has an extra consent control (`docs/BACKLOG.md`, "Models with extra
consent controls on the model page"). The popup row of a flagged entry reads
`(<launchStage> · manual step)` in its stage span, so `(GA · manual step)`
today. A deprecated entry reads `(deprecated)`. Two or more left-out lines
are named with "and" in the note.

## Entries (each with its raw source)

The API listing of 2026-10-12 (`scripts/models/fixtures/publisher-models-2026-10-12.json`,
13 `publisherModels`, all `launchStage=GA`) confirms every row. The API order
column is `apiOrder` in `extension/models.json`.

| # | Slug | Name | Release date | apiOrder | versionId (API) | launchStage | In API? | In Anthropic docs table? |
|---|------|------|--------------|----------|-----------------|-------------|---------|--------------------------|
| 1 | claude-haiku-5-5 | Claude Haiku 5.5 | 2026-10-07 | 13 | default | GA | yes (2026-10-12 listing) | yes (`claude-haiku-5-5`) |
| 2 | claude-sonnet-5-5 | Claude Sonnet 5.5 | 2026-09-28 | 12 | default | GA | yes | yes (`claude-sonnet-5-5`) |
| 3 | claude-opus-5-5 | Claude Opus 5.5 | 2026-09-22 | 11 | default | GA | yes | yes (`claude-opus-5-5`) |
| 4 | claude-fable-5-1 | Claude Fable 5.1 | 2026-09-01 | 10 | default | GA | yes | yes (`claude-fable-5-1`), flagged `requiresManualConsent: true` |
| 5 | claude-opus-5 | Claude Opus 5 | 2026-07-24 | 9 | default | GA | yes | yes (`claude-opus-5`) |
| 6 | claude-sonnet-5 | Claude Sonnet 5 | 2026-06-30 | 6 | default | GA | yes | yes (`claude-sonnet-5`) |
| 7 | claude-fable-5 | Claude Fable 5 | 2026-06-09 | 8 | default | GA | yes | yes (`claude-fable-5`) |
| 8 | claude-opus-4-8 | Claude Opus 4.8 | 2026-05-28 | 7 | default | GA | yes | yes (`claude-opus-4-8`) |
| 9 | claude-opus-4-7 | Claude Opus 4.7 | 2026-04-15 (Anthropic: 2026-04-16) | 5 | default | GA | yes | yes (`claude-opus-4-7`) |
| 10 | claude-sonnet-4-6 | Claude Sonnet 4.6 | 2026-02-17 | 4 | default | GA | yes | yes (`claude-sonnet-4-6`) |
| 11 | claude-opus-4-6 | Claude Opus 4.6 | 2026-02-05 | 3 | default | GA | yes | yes (`claude-opus-4-6`) |
| 12 | claude-opus-4-5 | Claude Opus 4.5 | 2025-11-24 | 2 | 20251101 | GA | yes | yes (`claude-opus-4-5@20251101`) |
| 13 | claude-haiku-4-5 | Claude Haiku 4.5 | 2025-10-15 | 1 | 20251001 | GA | yes | yes (`claude-haiku-4-5@20251001`) |

Claude Haiku 5.5 was added by hand for 0.8.0 from memory. The 2026-10-12
listing confirms it with `versionId` `default`, and with `listAllVersions=true`
the API also lists `claude-haiku-5-5@20261005`. The 2026-10-07 listing quoted
above had 12 models.

All 13 API entries are confirmed by the Anthropic docs table. The dated
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

The API does not return any `versionState`/deprecation field for the 13 live
models. The deprecated set is not listed by the API at all.
