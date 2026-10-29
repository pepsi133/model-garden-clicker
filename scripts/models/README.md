# scripts/models: the models.json generator

`fetch_models.py` is the generator of phases 1 and 2 of
[docs/scoping/01-latest-models.md](../../docs/scoping/01-latest-models.md).
With `--write extension/models.json` it writes the candidate file that a
human reviews; the weekly workflow `.github/workflows/models-refresh.yml`
runs it and opens a pull request (see "The weekly workflow" below). Without
`--write` it is the earlier proof of concept and prints the array to
stdout.

## What it does (stdout mode)

`--write` shares steps 1, 2 and 4 and has its own merge, described under
"The candidate file" below.

1. Lists the Anthropic publisher models with one read-only GET:
   `https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/anthropic/models?view=PUBLISHER_MODEL_VIEW_BASIC`
   (or the global host with `--region global`).
2. Derives `slug` (last path segment, `@version` cut off), `name`
   (`claude-haiku-5-5` -> `Claude Haiku 5.5`), `launchStage` and `apiOrder`
   (1-based position in the API order, oldest = 1).
3. Merges an existing `models.json` given with `--compare`: its `name`,
   `releaseDate`, `requiresManualConsent` and `deprecated` values win.
   A slug without a date in that file takes the date from the table
   `KNOWN_RELEASE_DATES` inside the script, else it stays `""` and gets
   `"dateSource": "undated"`.
4. Sorts by the design's comparator, a port of
   `MGC.compareModelsByRecency`: `releaseDate` desc, then `apiOrder`
   desc, then the version in the slug desc with a family rank, then slug asc.
5. Prints the array to stdout, newest first. Every report line goes to
   stderr, so stdout stays parseable JSON.

## Run it

Standard library only, Python 3.8 or newer. The `-I` flag is safe.

```
# live, token from gcloud, quota project given
python3 -I scripts/models/fetch_models.py --quota-project <PROJECT_ID> \
    --compare extension/models.json --latest

# live, explicit token and quota project, and save the raw response as a fixture
python3 -I scripts/models/fetch_models.py --token "$(gcloud auth print-access-token)" \
    --quota-project <PROJECT_ID> --compare extension/models.json \
    --save-raw scripts/models/fixtures/publisher-models-$(date +%F).json

# offline, from a saved fixture (no network, no token)
python3 -I scripts/models/fetch_models.py --dry-run \
    --fixture scripts/models/fixtures/publisher-models-2026-10-12.json \
    --compare extension/models.json --latest
```

Token lookup order: `--token`, env `GOOGLE_OAUTH_ACCESS_TOKEN`, then
`gcloud auth print-access-token`. Quota project: `--quota-project`, else env
`GOOGLE_CLOUD_QUOTA_PROJECT`. The quota project goes into
`X-Goog-User-Project`.

Proxy case (Claude Code cloud session): `gcloud auth print-access-token`
prints the literal string `proxy-injected`. Pass it as is. The agent proxy
swaps it for a real credential on every request to `*.googleapis.com`.
`urllib` reads `HTTPS_PROXY` and `SSL_CERT_FILE` from the environment, so
the script needs no proxy flag.

Options: `--region {us-central1,global}`, `--view`, `--timeout`,
`--indent N` (0 for one line), `--latest` (print the computed preset set;
the `requiresManualConsent` and `deprecated` flags come from `--compare`
when given, else from the built-in `KNOWN_FLAGS` table, so the set matches
the popup either way).

`--fixture PATH` implies `--dry-run`: the listing comes from the file and
no request goes to the API.

Exit codes: `0` ok, `1` (`--write` only) an undated GA entry, an entry
undated past `--max-undated-days`, or `--check` found a change, `2` bad
usage, no token, an unreadable/unwritable path, or (`--write` only) an
untrusted response, `3` untrusted response in the stdout mode (empty,
`401`/`403`, or none of the compared slugs present, as a regional endpoint
returns), `4` other HTTP or network error.

## The candidate file (`--write`)

```
# live: regenerate the file in place, then review the diff and run the lint
python3 -I scripts/models/fetch_models.py --quota-project <PROJECT_ID> \
    --write extension/models.json --summary-md /tmp/summary.md
node extension/test/models-json.cjs

# offline, from the saved fixture, into a scratch file
cp extension/models.json /tmp/models.json
python3 -I scripts/models/fetch_models.py \
    --fixture scripts/models/fixtures/publisher-models-2026-10-12.json \
    --write /tmp/models.json

# CI gate: exit 1 when the file would change, write nothing
python3 -I scripts/models/fetch_models.py --write extension/models.json --check
```

The existing file is `--compare PATH` when given, else the `--write` PATH
itself.

Merge rule:

- The API owns `slug`, `launchStage` and `apiOrder`, and gives the `name`
  fallback (derived from the slug).
- Every other key of an existing entry wins: `name`, `releaseDate`,
  `requiresManualConsent`, `deprecated` and any other key the entry has.
- A new slug gets `releaseDate` from one GET of the Google per-model page
  `https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/<family>-<version>`
  ("Release date:", for example `haiku-5-5`), with
  `"dateSource": "google-docs"`. `--no-scrape` skips the request. Without a
  date it gets `"releaseDate": ""`, `"dateSource": "undated"` and
  `"firstSeen": "<today, UTC>"`. The built-in `KNOWN_RELEASE_DATES` table
  serves the stdout mode only.
- A slug that left the API stays in the file with `deprecated: true`
  proposed. It is never removed. It loses `apiOrder`, because it has no
  position in the listing any more (and the lint forbids a duplicate).

Trust check, before anything is written: an empty or non-JSON listing,
HTTP `401` or `403`, or a listing that holds none of the GA slugs of the
existing file exits `2` and writes nothing, not even the summary.

Canonical form, byte-stable: 2-space-indented JSON; per entry the keys
`slug`, `name`, `launchStage`, `releaseDate`, `apiOrder`, then every other
key (the flags) alphabetically, then `dateSource` and `firstSeen`; entries
sorted by a line-by-line port of `MGC.compareModelsByRecency`
(`extension/common/constants.js`); one trailing newline. A second run over
its own output changes nothing (`--check` exits `0`).

Flags of the candidate file mode (each needs `--write`):

| Flag | Effect |
|---|---|
| `--check` | Write nothing. Exit `1` when PATH would change, `0` when not. |
| `--no-scrape` | No request to the Google per-model page; a new slug stays undated. |
| `--allow-undated` | An undated GA entry no longer exits `1`. Without it the run writes the file, names the undated GA slugs and exits `1`. |
| `--max-undated-days N` | Exit `1` when a GA entry is undated and its `firstSeen` is more than N days ago. An undated entry without `firstSeen` never trips it. |
| `--summary-md PATH` | Write a Markdown summary: added slugs with the date each got and its source, vanished slugs now proposed deprecated, undated GA slugs. Not written with `--check`. |

## The weekly workflow

`.github/workflows/models-refresh.yml` runs every Monday at 06:17 UTC and
on demand (`workflow_dispatch`). It authenticates through Workload Identity
Federation to a read-only service account (no stored key), runs the
generator with `--allow-undated --max-undated-days 30 --write
extension/models.json --summary-md /tmp/summary.md`, runs the lint, and,
when the file changed, force-updates the bot branch `models-refresh` and
opens or updates one pull request to the default branch with the summary as
its body. It never merges and never tags. The job is skipped until the
owner sets the repository variables `GCP_WIF_PROVIDER` and `GCP_SA_EMAIL`
(and `GCP_QUOTA_PROJECT`); the workflow's header comment lists the roles.

## What it proves

| Claim | Evidence (2026-10-12) |
|---|---|
| The listing works with a bearer token and a quota project, standard library only | live run: HTTP 200, 13 models, exit 0 |
| `us-central1` and `global` return the same set | both runs produce the same array |
| The API order is a usable secondary key | `apiOrder` 1..13 matches the API order, one inversion against release dates (sonnet-5 before opus-4-8) |
| The sort is deterministic and byte-stable | two offline runs give the same md5 |
| The offline mode reproduces the live output | `--dry-run --fixture` stdout is identical to the live stdout |
| `--compare` reports added and removed slugs | synthetic fixture: `claude-mythos-5-1` added, `claude-vanished-1` removed |
| `listAllVersions` duplicates collapse on the bare slug | the 14-entry capture gives 13 slugs |
| A wrong region or an empty body is refused | `claude-3-opus` only capture and `{}` both exit 3 |
| The latest preset leaves a flagged line out and names it | `requiresManualConsent` on fable-5-1 gives 3 ticked, 1 left out, with and without `--compare` |
| The tertiary key pads versions like the extension | undated, unordered `claude-fable-5` and `claude-fable-5-1` sort 5-1 first, as `MGC.sortModelsByRecency` does |

## What it does not prove

- Release dates. The API has no date field. The stdout mode takes them
  from the built-in table or the compared file; `--write` scrapes only the
  Google per-model page of a new slug, best effort (checked on 2026-10-29:
  `haiku-5-5` gives 2026-10-07; an unknown page answers 404 and the slug
  stays undated). The Anthropic per-model page is not scraped.
- Display names for an unknown slug are a derivation, not Google's name.
- Deprecation. The API has no such field. A vanished slug is only proposed
  `deprecated: true`; a human confirms it in the pull request.
- A `401` from a bad token. Inside the proxy every token is replaced, so
  that path ran only with `curl` outside the script (see the appendix of
  the scoping document).
- Anything about the extension UI, the popup state or the tests.
- The workflow's identity. It needs the owner's Workload Identity
  Federation setup and has not run yet.

## Files

- `fetch_models.py`: the generator (stdout mode and `--write` mode).
- `fixtures/publisher-models-2026-10-12.json`: raw BASIC view of the live
  response (22123 bytes, 13 models). FULL and BASIC views are byte-identical.
