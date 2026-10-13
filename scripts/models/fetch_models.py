#!/usr/bin/env python3
"""
fetch_models.py: proof of concept for the "auto-populated model list" phase
of docs/scoping/01-latest-models.md.

It lists the Anthropic publisher models of Vertex AI Model Garden, computes
the recency ordering of the design and prints a models.json-compatible array
to stdout, newest first. Standard library only. Safe to run as `python3 -I`.

Recency fields written per entry (see "Data model" in the scoping document):
  releaseDate  "YYYY-MM-DD" or "" when unknown. The primary key. The API has
               no such field, so the value comes from --compare (an existing
               models.json whose hand-set dates win), else from the table
               KNOWN_RELEASE_DATES below (verified 2026-10-12 against the
               Google and Anthropic per-model pages), else "".
  apiOrder     1-based position in the API default order (create_time
               ascending, oldest = 1). The secondary key, and the only
               signal the API itself gives for a slug nobody dated yet.
  dateSource   "file", "table" or "undated": where releaseDate came from.

Ordering (MGC.compareModelsByRecency in the design): releaseDate desc, then
apiOrder desc, then the version parsed from the slug desc with a family rank,
then slug asc. Undated entries sort below every dated entry.

Auth: --token, else env GOOGLE_OAUTH_ACCESS_TOKEN, else
`gcloud auth print-access-token`. Quota project: --quota-project, else env
GOOGLE_CLOUD_QUOTA_PROJECT (sent as X-Goog-User-Project when set).
Proxy case: in a Claude Code cloud session the token string is the literal
"proxy-injected" and gcloud prints the same string. That is fine: the agent
proxy replaces it with a real credential for *.googleapis.com. urllib honours
HTTPS_PROXY and SSL_CERT_FILE from the environment, so no extra flag is needed.

Exit codes: 0 ok, 2 usage, missing token or an unreadable/unwritable
--fixture/--compare/--save-raw path, 3 untrusted response (empty, wrong
region, 401/403, or none of the compared slugs present), 4 other HTTP or
network error.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

API_HOSTS = {
    "us-central1": "https://us-central1-aiplatform.googleapis.com",
    "global": "https://aiplatform.googleapis.com",
}
LIST_PATH = "/v1beta1/publishers/anthropic/models"
DEFAULT_VIEW = "PUBLISHER_MODEL_VIEW_BASIC"

# Release dates verified on 2026-10-12 against the Google per-model page
# ("Release date:") and the Anthropic per-model page ("Released:"). The two
# sources agree except for claude-opus-4-7 (Google April 15, Anthropic
# April 16, 2026); the design keeps Google's Vertex availability date.
KNOWN_RELEASE_DATES = {
    "claude-haiku-4-5": "2025-10-15",
    "claude-opus-4-5": "2025-11-24",
    "claude-opus-4-6": "2026-02-05",
    "claude-sonnet-4-6": "2026-02-17",
    "claude-opus-4-7": "2026-04-15",
    "claude-opus-4-8": "2026-05-28",
    "claude-fable-5": "2026-06-09",
    "claude-sonnet-5": "2026-06-30",
    "claude-opus-5": "2026-07-24",
    "claude-fable-5-1": "2026-09-01",
    "claude-opus-5-5": "2026-09-22",
    "claude-sonnet-5-5": "2026-09-28",
    "claude-haiku-5-5": "2026-10-07",
}

# Flags that models.json carries by hand and the API does not know. Used
# when --latest runs without --compare, so the preset matches the popup.
KNOWN_FLAGS = {
    "claude-fable-5-1": {"requiresManualConsent": True},
}

# Family rank for the tertiary key only (today's docs/models.md rule).
# A family outside this table ranks after the listed ones.
FAMILY_RANK = {"opus": 0, "sonnet": 1, "fable": 2, "haiku": 3}
# Slugs have at most two numeric parts today; the padding leaves room.
VERSION_WIDTH = 4

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$", re.I)       # MGC.isValidModelSlug
FAMILY_RE = re.compile(r"^claude-([a-z]+)-(\d+(?:-\d+)*)$", re.I)  # MGC.modelFamily
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


# ----------------------------------------------------------------- helpers

def parse_release_date(value):
    """Strict YYYY-MM-DD and a real calendar date, else None."""
    if not isinstance(value, str) or not DATE_RE.match(value):
        return None
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return None
    return value


def model_family(slug):
    m = FAMILY_RE.match(slug or "")
    return m.group(1).lower() if m else None


def model_version_key(slug):
    m = FAMILY_RE.match(slug or "")
    return [int(x) for x in m.group(2).split("-")] if m else []


def display_name(slug):
    """'claude-haiku-5-5' -> 'Claude Haiku 5.5' (the API has no displayName)."""
    tokens = slug.split("-")
    words, digits = [], []
    for t in tokens:
        if t.isdigit():
            digits.append(t)
        else:
            if digits:
                words.append(".".join(digits))
                digits = []
            words.append(t[:1].upper() + t[1:])
    if digits:
        words.append(".".join(digits))
    return " ".join(words)


def recency_sort_key(entry):
    """A total order: newest first when sorted ascending by this key."""
    date = parse_release_date(entry.get("releaseDate"))
    api_order = entry.get("apiOrder")
    api_order = api_order if isinstance(api_order, int) and api_order > 0 else None
    slug = entry.get("slug", "")
    family = model_family(slug)
    version = model_version_key(slug)
    # Each component: (group, value) where a lower tuple wins.
    k_date = (0, -int(date.replace("-", ""))) if date else (1, 0)
    k_api = (0, -api_order) if api_order else (1, 0)
    # Version desc with a family rank: compare negated version lists. The
    # list is padded with zeros like the JS loop (`va[i] || 0`), so that
    # 5.1 ranks above 5; a bare Python list compare would put [5] first.
    # The width grows with the longest slug seen, so two lists always
    # compare at equal length (a shorter list is never a "prefix").
    padded = version + [0] * (max(VERSION_WIDTH, _version_width()) - len(version))
    k_ver = (0, [-v for v in padded], FAMILY_RANK.get(family, len(FAMILY_RANK))) if version else (1, [], 0)
    return (k_date, k_api, k_ver, slug)


_VERSION_WIDTH_SEEN = [VERSION_WIDTH]


def _version_width():
    return _VERSION_WIDTH_SEEN[0]


def sort_by_recency(entries):
    _VERSION_WIDTH_SEEN[0] = max([VERSION_WIDTH] + [len(model_version_key(e.get("slug", ""))) for e in entries])
    return sorted(entries, key=recency_sort_key)


def latest_model_slugs(entries):
    """Newest GA, dated, not deprecated entry per family, as (ticked, left_out).

    A family whose newest entry carries requiresManualConsent contributes
    nothing to the ticked set: the preset never ticks a model the runner
    cannot enable, and it never falls back to an older model of that line.
    The left_out list names those slugs for the status note.
    """
    best = {}
    for e in sort_by_recency(entries):
        fam = model_family(e.get("slug", ""))
        if not fam or fam in best:
            continue
        if e.get("launchStage") != "GA" or not parse_release_date(e.get("releaseDate")):
            continue
        if e.get("deprecated") is True:
            continue
        best[fam] = e
    ticked = sorted(e["slug"] for e in best.values() if e.get("requiresManualConsent") is not True)
    left_out = sorted(e["slug"] for e in best.values() if e.get("requiresManualConsent") is True)
    return ticked, left_out


# --------------------------------------------------------------- fetching

def resolve_token(explicit):
    if explicit:
        return explicit
    env = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN", "").strip()
    if env:
        return env
    try:
        out = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.SubprocessError) as err:
        sys.stderr.write(f"fetch_models: gcloud auth print-access-token failed: {err}\n")
        return None
    tok = out.stdout.strip()
    if out.returncode != 0 or not tok:
        sys.stderr.write(f"fetch_models: gcloud auth print-access-token exited {out.returncode}: {out.stderr.strip()}\n")
        return None
    return tok


def fetch_raw(region, token, quota_project, view, timeout):
    host = API_HOSTS[region]
    url = host + LIST_PATH + "?" + urllib.parse.urlencode({"view": view})
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if quota_project:
        headers["X-Goog-User-Project"] = quota_project
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return url, resp.status, resp.read()


# ---------------------------------------------------------------- building

def entries_from_response(payload):
    """API payload -> list of {slug, name, launchStage, apiOrder}; '@ver' collapsed."""
    models = payload.get("publisherModels") if isinstance(payload, dict) else None
    if not isinstance(models, list):
        return []
    out, seen = [], {}
    for pm in models:
        name = pm.get("name") if isinstance(pm, dict) else None
        if not isinstance(name, str):
            continue
        slug = name.rsplit("/", 1)[-1].split("@", 1)[0]
        if not slug or not SLUG_RE.match(slug):
            continue
        if slug in seen:
            continue  # listAllVersions duplicates (slug@date and slug@default)
        seen[slug] = True
        stage = pm.get("launchStage")
        out.append({
            "slug": slug,
            "name": display_name(slug),
            "launchStage": stage if isinstance(stage, str) else "",
            "apiOrder": len(out) + 1,
            "versionId": pm.get("versionId", "") or "",
        })
    return out


def load_existing(path):
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if not isinstance(data, list):
        raise ValueError("not a JSON array")
    return [e for e in data if isinstance(e, dict) and isinstance(e.get("slug"), str)]


def merge(entries, existing):
    """Hand-set name, releaseDate and flags of the existing file win."""
    by_slug = {e["slug"]: e for e in existing}
    for e in entries:
        old = by_slug.get(e["slug"], {})
        if isinstance(old.get("name"), str) and old["name"]:
            e["name"] = old["name"]
        date = parse_release_date(old.get("releaseDate"))
        if date:
            e["releaseDate"], e["dateSource"] = date, "file"
        elif e["slug"] in KNOWN_RELEASE_DATES:
            e["releaseDate"], e["dateSource"] = KNOWN_RELEASE_DATES[e["slug"]], "table"
        else:
            e["releaseDate"], e["dateSource"] = "", "undated"
        # Flags: the file wins when it knows the slug, else the table.
        flags = old if e["slug"] in by_slug else KNOWN_FLAGS.get(e["slug"], {})
        for flag in ("requiresManualConsent", "deprecated"):
            if flags.get(flag) is True:
                e[flag] = True
    return entries


def output_shape(e):
    out = {"slug": e["slug"], "name": e["name"], "launchStage": e["launchStage"],
           "releaseDate": e["releaseDate"], "apiOrder": e["apiOrder"]}
    for flag in ("requiresManualConsent", "deprecated"):
        if e.get(flag) is True:
            out[flag] = True
    if e.get("dateSource") == "undated":
        out["dateSource"] = "undated"
    return out


# -------------------------------------------------------------------- main

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[1], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--token", help="OAuth access token (else env GOOGLE_OAUTH_ACCESS_TOKEN, else gcloud)")
    ap.add_argument("--quota-project", default=os.environ.get("GOOGLE_CLOUD_QUOTA_PROJECT") or None,
                    help="X-Goog-User-Project value (else env GOOGLE_CLOUD_QUOTA_PROJECT)")
    ap.add_argument("--region", choices=sorted(API_HOSTS), default="us-central1",
                    help="us-central1 (default) or global; other regions return a stale or empty list")
    ap.add_argument("--view", default=DEFAULT_VIEW, help=f"view query parameter (default {DEFAULT_VIEW})")
    ap.add_argument("--timeout", type=float, default=30.0)
    ap.add_argument("--compare", metavar="PATH", help="existing models.json: report added/removed slugs, keep its hand-set fields")
    ap.add_argument("--dry-run", action="store_true", help="no network: read the API response from --fixture")
    ap.add_argument("--fixture", metavar="PATH", help="saved API response used by --dry-run")
    ap.add_argument("--save-raw", metavar="PATH", help="write the raw API response bytes here (makes a fixture)")
    ap.add_argument("--latest", action="store_true", help="also report the computed latest set on stderr")
    ap.add_argument("--indent", type=int, default=1, help="JSON indent for stdout (default 1, 0 for one line)")
    args = ap.parse_args(argv)

    # 1. Obtain the raw payload.
    if args.dry_run:
        if not args.fixture:
            ap.error("--dry-run needs --fixture PATH")
        try:
            with open(args.fixture, "rb") as fh:
                raw = fh.read()
        except OSError as err:
            sys.stderr.write(f"fetch_models: cannot read --fixture: {err}\n")
            return 2
        if args.save_raw:
            sys.stderr.write("fetch_models: --save-raw is ignored with --dry-run\n")
        source = f"fixture {args.fixture}"
    else:
        token = resolve_token(args.token)
        if not token:
            sys.stderr.write("fetch_models: no token (use --token, GOOGLE_OAUTH_ACCESS_TOKEN or gcloud auth login)\n")
            return 2
        try:
            url, status, raw = fetch_raw(args.region, token, args.quota_project, args.view, args.timeout)
        except urllib.error.HTTPError as err:
            body = err.read()[:400].decode("utf-8", "replace")
            sys.stderr.write(f"fetch_models: HTTP {err.code} from {err.geturl()}: {body}\n")
            return 4 if err.code not in (401, 403) else 3
        except (urllib.error.URLError, OSError) as err:
            sys.stderr.write(f"fetch_models: network error: {err}\n")
            return 4
        source = f"{url} (HTTP {status})"
        if args.save_raw:
            try:
                with open(args.save_raw, "wb") as fh:
                    fh.write(raw)
            except OSError as err:
                sys.stderr.write(f"fetch_models: cannot write --save-raw {args.save_raw}: {err}\n")
                return 2
            sys.stderr.write(f"fetch_models: raw response saved to {args.save_raw} ({len(raw)} bytes)\n")

    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError as err:
        sys.stderr.write(f"fetch_models: response is not JSON: {err}\n")
        return 3

    # 2. Build, merge, sort.
    entries = entries_from_response(payload)
    try:
        existing = load_existing(args.compare) if args.compare else []
    except (OSError, ValueError) as err:
        sys.stderr.write(f"fetch_models: cannot read --compare {args.compare}: {err}\n")
        return 2
    if not entries:
        sys.stderr.write(f"fetch_models: untrusted response from {source}: no publisherModels (wrong region or credential?)\n")
        return 3
    if existing and not any(e["slug"] in {x["slug"] for x in existing} for e in entries):
        sys.stderr.write(f"fetch_models: untrusted response from {source}: none of the {len(existing)} compared slugs is present "
                         f"(got {', '.join(e['slug'] for e in entries)})\n")
        return 3
    entries = merge(entries, existing)
    ordered = sort_by_recency(entries)

    # 3. Report on stderr, JSON on stdout.
    sys.stderr.write(f"fetch_models: {len(ordered)} models from {source}\n")
    undated = [e["slug"] for e in ordered if e["dateSource"] == "undated"]
    if undated:
        sys.stderr.write(f"fetch_models: undated (sorted by apiOrder, never latest): {', '.join(undated)}\n")
    if existing:
        old_slugs = [x["slug"] for x in existing]
        new_slugs = [e["slug"] for e in ordered]
        added = [s for s in new_slugs if s not in old_slugs]
        removed = [s for s in old_slugs if s not in new_slugs]
        sys.stderr.write(f"compare {args.compare}: {len(old_slugs)} in file, {len(new_slugs)} in API\n")
        sys.stderr.write(f"  added:   {', '.join(added) or '(none)'}\n")
        sys.stderr.write(f"  removed: {', '.join(removed) or '(none)'}" + ("  <- keep them, propose deprecated: true\n" if removed else "\n"))
        if old_slugs != new_slugs:
            sys.stderr.write("  order:   the file order differs from the recency order\n")
        else:
            sys.stderr.write("  order:   the file order equals the recency order\n")
    if args.latest:
        ticked, left_out = latest_model_slugs(ordered)
        sys.stderr.write(f"latest (newest GA, dated, per family): {', '.join(ticked) or '(none)'}\n")
        if left_out:
            sys.stderr.write(f"  left out (requiresManualConsent, needs a manual step on the model page): {', '.join(left_out)}\n")

    json.dump([output_shape(e) for e in ordered], sys.stdout, indent=args.indent if args.indent > 0 else None)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
