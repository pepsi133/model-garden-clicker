# scripts/models: model-list generator PoC

`fetch_models.py` is the proof of concept for the auto-population phase of
[docs/scoping/01-latest-models.md](../../docs/scoping/01-latest-models.md).
It is not wired into the extension, the build or CI. Nothing in the
extension reads its output yet.

## What it does

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
4. Sorts by the design's comparator: `releaseDate` desc, then `apiOrder`
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

Exit codes: `0` ok, `2` bad usage, no token or an unreadable/unwritable
`--fixture`/`--compare`/`--save-raw` path, `3` untrusted response
(empty, `401`/`403`, or none of the compared slugs present, as a regional
endpoint returns), `4` other HTTP or network error.

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

- Release dates. The API has no date field. The dates come from the
  built-in table or from the compared file. The script does not scrape the
  Google or Anthropic model pages (Phase 1 of the scoping adds that).
- Display names for an unknown slug are a derivation, not Google's name.
- Deprecation. The API has no such field. A vanished slug is only reported.
- A `401` from a bad token. Inside the proxy every token is replaced, so
  that path ran only with `curl` outside the script (see the appendix of
  the scoping document).
- Anything about the extension UI, the popup state or the tests.
- Identity for CI. The script expects a token. The scoping document covers
  the Workload Identity Federation option.

## Files

- `fetch_models.py`: the PoC.
- `fixtures/publisher-models-2026-10-12.json`: raw BASIC view of the live
  response (22123 bytes, 13 models). FULL and BASIC views are byte-identical.
