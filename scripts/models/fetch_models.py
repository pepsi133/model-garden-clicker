#!/usr/bin/env python3
"""
fetch_models.py: the models.json generator of docs/scoping/01-latest-models.md
(phases 1 and 2).

It lists the Anthropic publisher models of Vertex AI Model Garden, computes
the recency ordering of the design and prints a models.json-compatible array
to stdout, newest first, or, with --write PATH, merges the listing into the
existing file and writes the canonical candidate file. Standard library
only. Safe to run as `python3 -I`.

--write PATH (the candidate file mode; the existing file is --compare when
given, else PATH itself):
  Merge rule  the API gives the slugs, the name fallback, launchStage and
              apiOrder. Every other key of an existing entry wins (name,
              releaseDate, requiresManualConsent, deprecated, ...). A new
              slug gets releaseDate from one GET of the Google per-model page
              ("Release date:", dateSource "google-docs"; --no-scrape skips
              it), else releaseDate "", dateSource "undated" and firstSeen
              <today, UTC>. A slug that left the API stays, loses apiOrder
              (it has no API position) and gets deprecated: true proposed.
  Trust check refuses with exit 2 and writes nothing: an empty or non-JSON
              listing, HTTP 401 or 403, or a listing that holds none of the
              GA slugs of the existing file.
  Canonical   2-space-indented JSON, keys slug, name, launchStage,
              releaseDate, apiOrder, then the other keys (the flags)
              alphabetically, then dateSource and firstSeen; entries sorted
              by MGC.compareModelsByRecency; one trailing newline.
  Exit 1      after writing, when a GA entry is undated (unless
              --allow-undated) or undated with a firstSeen more than
              --max-undated-days days ago. --check writes nothing and also
              exits 1 when PATH would change.

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

Exit codes: 0 ok, 1 (--write/--check only) undated GA entries, an undated
entry past --max-undated-days, or --check found a change, 2 usage, missing
token, an unreadable/unwritable --fixture/--compare/--save-raw/--write/
--summary-md path, or (--write/--check) an untrusted response, 3 untrusted
response in the stdout mode (empty, wrong region, 401/403, or none of the
compared slugs present), 4 other HTTP or network error.
"""

import argparse
import datetime
import functools
import html
import http.client
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

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$", re.I)       # MGC.isValidModelSlug
FAMILY_RE = re.compile(r"^claude-([a-z]+)-(\d+(?:-\d+)*)$", re.I)  # MGC.modelFamily
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# The best-effort date source for a new slug (--write): the Google per-model
# page, "<family>-<version>" from the slug ("claude-haiku-5-5" -> haiku-5-5).
GOOGLE_DOCS_URL = "https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/partner-models/claude/{family}-{version}"
MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july",
     "august", "september", "october", "november", "december"], 1)}
# After the tags are stripped the page reads "Release date: October 7, 2026".
RELEASE_DATE_RE = re.compile(r"Release date:\s*(?:(\d{4}-\d{2}-\d{2})|([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4}))")
TAG_RE = re.compile(r"<[^>]*>")

# Canonical key order of a written entry (--write): these first, then every
# other key alphabetically, then the generator notes.
KEYS_HEAD = ("slug", "name", "launchStage", "releaseDate", "apiOrder")
KEYS_TAIL = ("dateSource", "firstSeen")


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


def _api_order_of(entry):
    n = entry.get("apiOrder")
    # bool is an int in Python; JS Number.isInteger(true) is false.
    return n if isinstance(n, int) and not isinstance(n, bool) and n > 0 else None


def compare_models_by_recency(a, b):
    """A line-by-line port of MGC.compareModelsByRecency (extension/common/constants.js).

    Newest first: releaseDate desc, then apiOrder desc, then the slug's
    version desc (missing parts count as 0, like `va[i] || 0`) with the
    family rank, then slug asc. Undated below dated, no apiOrder below an
    apiOrder, no parsable version below a parsable one.
    """
    da, db = parse_release_date(a.get("releaseDate")), parse_release_date(b.get("releaseDate"))
    if da and db and da != db:
        return 1 if da < db else -1
    if bool(da) != bool(db):
        return -1 if da else 1
    oa, ob = _api_order_of(a), _api_order_of(b)
    if oa and ob and oa != ob:
        return ob - oa
    if bool(oa) != bool(ob):
        return -1 if oa else 1
    sa = a.get("slug") if isinstance(a.get("slug"), str) else ""
    sb = b.get("slug") if isinstance(b.get("slug"), str) else ""
    va, vb = model_version_key(sa), model_version_key(sb)
    if va and vb:
        for i in range(max(len(va), len(vb))):
            x = va[i] if i < len(va) else 0
            y = vb[i] if i < len(vb) else 0
            if x != y:
                return y - x
        ra = FAMILY_RANK.get(model_family(sa), len(FAMILY_RANK))
        rb = FAMILY_RANK.get(model_family(sb), len(FAMILY_RANK))
        if ra != rb:
            return ra - rb
    elif bool(va) != bool(vb):
        return -1 if va else 1
    return -1 if sa < sb else (1 if sa > sb else 0)


def sort_by_recency(entries):
    """A new list sorted like MGC.sortModelsByRecency (newest first)."""
    return sorted(entries, key=functools.cmp_to_key(compare_models_by_recency))


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


# ------------------------------------------------- the candidate file (--write)

def scrape_release_date(slug, timeout):
    """Best effort: one GET of the Google per-model page, its "Release date:"
    as YYYY-MM-DD, else None. Never raises; a failure is one stderr line."""
    m = FAMILY_RE.match(slug or "")
    if not m:
        return None
    url = GOOGLE_DOCS_URL.format(family=m.group(1).lower(), version=m.group(2))
    req = urllib.request.Request(url, headers={"Accept": "text/html", "User-Agent": "model-garden-clicker-fetch-models"}, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(4 * 1024 * 1024).decode("utf-8", "replace")
    except (urllib.error.URLError, OSError, ValueError, http.client.HTTPException) as err:
        sys.stderr.write(f"fetch_models: no release date for {slug}: {url}: {err}\n")
        return None
    text = html.unescape(TAG_RE.sub(" ", body))
    found = RELEASE_DATE_RE.search(text)
    date = None
    if found and found.group(1):
        date = parse_release_date(found.group(1))
    elif found and found.group(2).lower() in MONTHS:
        date = parse_release_date(f"{int(found.group(4)):04d}-{MONTHS[found.group(2).lower()]:02d}-{int(found.group(3)):02d}")
    if not date:
        sys.stderr.write(f"fetch_models: no release date for {slug}: {url} has no parsable \"Release date:\"\n")
    return date


def merge_for_write(api_entries, existing, today, scrape):
    """The --write merge. Returns (entries, added, vanished).

    The API owns slug, launchStage and apiOrder and gives the name fallback;
    every other key of an existing entry wins. A new slug is dated by
    `scrape(slug)` (None to skip), else undated with firstSeen = today. An
    existing slug missing from the API stays, without apiOrder, with
    deprecated: true. `vanished` holds (slug, already_deprecated) pairs.
    """
    by_slug = {x["slug"]: x for x in existing}
    api_slugs = {e["slug"] for e in api_entries}
    out, added, vanished = [], [], []
    for e in api_entries:
        old = by_slug.get(e["slug"])
        if old is not None:
            new = dict(old)
            if not (isinstance(old.get("name"), str) and old["name"]):
                new["name"] = e["name"]
            new["launchStage"] = e["launchStage"]
            new["apiOrder"] = e["apiOrder"]
        else:
            new = {"slug": e["slug"], "name": e["name"], "launchStage": e["launchStage"], "apiOrder": e["apiOrder"]}
            date = scrape(e["slug"]) if scrape else None
            if date:
                new["releaseDate"], new["dateSource"] = date, "google-docs"
            else:
                new["releaseDate"], new["dateSource"], new["firstSeen"] = "", "undated", today
            added.append(new)
        out.append(new)
    for x in existing:
        if x["slug"] in api_slugs:
            continue
        new = dict(x)
        new.pop("apiOrder", None)
        vanished.append((x["slug"], new.get("deprecated") is True))
        new["deprecated"] = True
        out.append(new)
    return out, added, vanished


def canonical_entry(e):
    keys = [k for k in KEYS_HEAD if k in e]
    keys += sorted(k for k in e if k not in KEYS_HEAD and k not in KEYS_TAIL)
    keys += [k for k in KEYS_TAIL if k in e]
    return {k: e[k] for k in keys}


def render_file(entries):
    """The byte-stable canonical text of models.json."""
    return json.dumps([canonical_entry(e) for e in sort_by_recency(entries)], indent=2, ensure_ascii=False) + "\n"


def undated_ga(entries):
    return [e for e in sort_by_recency(entries) if e.get("launchStage") == "GA" and not parse_release_date(e.get("releaseDate"))]


def days_since(date_str, today):
    d = parse_release_date(date_str)
    return (datetime.date.fromisoformat(today) - datetime.date.fromisoformat(d)).days if d else None


def summary_markdown(source, path, entries, added, vanished, today, max_days):
    lines = ["## models.json refresh", "",
             f"Generated by `scripts/models/fetch_models.py` on {today} (UTC) from {source}.",
             f"`{path}` holds {len(entries)} entries after the merge. Review the names, dates and flags before merging; this pull request is never merged or tagged automatically.",
             "", "### Added slugs", ""]
    if added:
        for e in sort_by_recency(added):
            if parse_release_date(e.get("releaseDate")):
                lines.append(f"- `{e['slug']}` ({e['name']}): releaseDate `{e['releaseDate']}`, source `{e.get('dateSource', '')}`")
            else:
                lines.append(f"- `{e['slug']}` ({e['name']}): undated, firstSeen `{e.get('firstSeen', '')}`; fill releaseDate by hand")
    else:
        lines.append("- (none)")
    lines += ["", "### Vanished from the API, now proposed `deprecated: true`", ""]
    if vanished:
        for slug, was in sorted(vanished):
            lines.append(f"- `{slug}`" + (" (already deprecated)" if was else " (newly proposed)"))
    else:
        lines.append("- (none)")
    lines += ["", "### Undated GA entries", ""]
    und = undated_ga(entries)
    if und:
        for e in und:
            age = days_since(e.get("firstSeen"), today)
            seen = f"firstSeen `{e['firstSeen']}`, {age} day(s) ago" if age is not None else "no firstSeen"
            lines.append(f"- `{e['slug']}`: {seen}" + (f"; the run fails after {max_days} days" if max_days is not None else ""))
    else:
        lines.append("- (none)")
    return "\n".join(lines) + "\n"


def write_text(path, text):
    """Write `text` to `path` through a temporary file in the same folder."""
    tmp = f"{path}.tmp-{os.getpid()}"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    os.replace(tmp, path)


# -------------------------------------------------------------------- main

def run_write(args, api_entries, source):
    """--write / --check: trust check, merge, canonical text, then the exit rules."""
    path = args.write
    existing_path = args.compare or path
    try:
        existing = load_existing(existing_path)
    except (OSError, ValueError) as err:
        sys.stderr.write(f"fetch_models: cannot read the existing file {existing_path}: {err}\n")
        return 2
    # Trust check: nothing is written on a refusal.
    if not api_entries:
        sys.stderr.write(f"fetch_models: refused, untrusted response from {source}: no publisherModels "
                         f"(wrong region or credential?); nothing written\n")
        return 2
    api_slugs = {e["slug"] for e in api_entries}
    existing_ga = sorted(x["slug"] for x in existing if x.get("launchStage") == "GA")
    if existing_ga and not api_slugs.intersection(existing_ga):
        sys.stderr.write(f"fetch_models: refused, untrusted response from {source}: none of the {len(existing_ga)} GA slugs "
                         f"of {existing_path} is present (got {', '.join(e['slug'] for e in api_entries)}); nothing written\n")
        return 2

    today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    scrape = None if args.no_scrape else (lambda slug: scrape_release_date(slug, args.timeout))
    merged, added, vanished = merge_for_write(api_entries, existing, today, scrape)
    text = render_file(merged)
    try:
        with open(path, "r", encoding="utf-8", newline="") as fh:
            current = fh.read()
    except OSError:
        current = None
    changed = text != current

    sys.stderr.write(f"fetch_models: {len(api_entries)} models from {source}\n")
    sys.stderr.write(f"merge into {existing_path}: {len(existing)} in file, {len(api_entries)} in API, {len(merged)} after the merge\n")
    for e in sort_by_recency(added):
        how = f"{e['releaseDate']} ({e['dateSource']})" if e.get("releaseDate") else f"undated, firstSeen {e['firstSeen']}"
        sys.stderr.write(f"  added:    {e['slug']}: {how}\n")
    for slug, was in sorted(vanished):
        sys.stderr.write(f"  vanished: {slug}: deprecated: true " + ("(already set)\n" if was else "(proposed)\n"))
    if not added and not vanished:
        sys.stderr.write("  no slug added or vanished\n")
    if args.latest:
        ticked, left_out = latest_model_slugs(merged)
        sys.stderr.write(f"latest (newest GA, dated, per family): {', '.join(ticked) or '(none)'}\n")
        if left_out:
            sys.stderr.write(f"  left out (requiresManualConsent, needs a manual step on the model page): {', '.join(left_out)}\n")

    rc = 0
    if args.check:
        sys.stderr.write(f"check {path}: " + ("would change\n" if changed else "up to date\n"))
        if changed:
            rc = 1
    else:
        try:
            if changed:
                write_text(path, text)
            if args.summary_md:
                write_text(args.summary_md, summary_markdown(source, path, merged, added, vanished, today, args.max_undated_days))
        except OSError as err:
            sys.stderr.write(f"fetch_models: cannot write: {err}\n")
            return 2
        sys.stderr.write(f"wrote {path}: " + ("changed\n" if changed else "unchanged\n"))

    undated = undated_ga(merged)
    if undated and not args.allow_undated:
        sys.stderr.write(f"fetch_models: undated GA entries (fill releaseDate, or pass --allow-undated): "
                         f"{', '.join(e['slug'] for e in undated)}\n")
        rc = 1
    if args.max_undated_days is not None:
        stale = [e["slug"] for e in undated
                 if (days_since(e.get("firstSeen"), today) or 0) > args.max_undated_days]
        if stale:
            sys.stderr.write(f"fetch_models: GA entries undated for more than {args.max_undated_days} days "
                             f"(firstSeen): {', '.join(stale)}\n")
            rc = 1
    return rc


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
    ap.add_argument("--fixture", metavar="PATH", help="saved API response used instead of the API (implies --dry-run)")
    ap.add_argument("--save-raw", metavar="PATH", help="write the raw API response bytes here (makes a fixture)")
    ap.add_argument("--latest", action="store_true", help="also report the computed latest set on stderr")
    ap.add_argument("--indent", type=int, default=1, help="JSON indent for stdout (default 1, 0 for one line)")
    ap.add_argument("--write", metavar="PATH", help="merge into the existing file (--compare, else PATH) and write the "
                    "canonical candidate file to PATH instead of printing JSON")
    ap.add_argument("--check", action="store_true", help="with --write: write nothing, exit 1 when PATH would change")
    ap.add_argument("--no-scrape", action="store_true", help="with --write: do not fetch the Google per-model page of a new slug")
    ap.add_argument("--allow-undated", action="store_true", help="with --write: an undated GA entry does not fail the run")
    ap.add_argument("--max-undated-days", type=int, metavar="N",
                    help="with --write: exit 1 when a GA entry is undated and its firstSeen is more than N days ago")
    ap.add_argument("--summary-md", metavar="PATH", help="with --write: write a Markdown summary (pull request body) here")
    args = ap.parse_args(argv)
    if not args.write and (args.check or args.no_scrape or args.allow_undated or args.summary_md or args.max_undated_days is not None):
        ap.error("--check, --no-scrape, --allow-undated, --max-undated-days and --summary-md need --write PATH")
    if args.max_undated_days is not None and args.max_undated_days < 0:
        ap.error("--max-undated-days must be 0 or more")
    # In the candidate file mode every untrusted response is a refusal (exit 2).
    untrusted_rc = 2 if args.write else 3

    # 1. Obtain the raw payload.
    if args.dry_run or args.fixture:
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
            return 4 if err.code not in (401, 403) else untrusted_rc
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
        return untrusted_rc

    # 2. Build, merge, sort.
    entries = entries_from_response(payload)
    if args.write:
        return run_write(args, entries, source)
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
