#!/usr/bin/env python3
"""
mg_inventory.py: proof of concept for the "inventory" stage of
docs/scoping/02-gitlab-runner-service-account.md.

What it does, with a service-account token and read-only calls only:
  1. Lists the Anthropic publisher models of Model Garden (global endpoint)
     and parses each model's Marketplace service id out of the
     supportedActions.requestAccess URI (query parameter "service").
  2. For each target project, asks Service Usage for the state of every
     partner service plus aiplatform.googleapis.com in one batchGet per
     20 names, and classifies each (project, model) pair:
       enabled        service state ENABLED
       not-enabled    service state DISABLED
       no-permission  HTTP 403 on the project (or the project is not visible)
       unknown        any other HTTP code or an unparsable answer
  3. Prints a table, writes <out>/mg-inventory.json, writes <out>/projects.txt
     (one pending project id per line, the format the popup textarea takes:
     extension/popup/popup.js projectIds() splits on newlines and trims) and
     <out>/model-garden-clicker-settings.json (the options page import format,
     extension/common/constants.js MGC.parseConfig: app, schema, popup.projects,
     popup.models). Also writes <out>/deep-links.md: one extension deep link per
  pending project and chunked links for all pending projects (at most 200
  projects and 16,384 characters per link; see build_deep_links).

Why Service Usage and not an inference call: in the probe session (2026-10-12)
a minimal rawPredict with max_tokens 1 answered HTTP 429 "Quota exceeded ...
per_base_model" on the global endpoint and HTTP 501 UNIMPLEMENTED on us-east5
for models the project never enabled. Neither code names the enablement, and
the call is a POST that costs tokens once a model is enabled. The Service
Usage state of the model's partner service (anthropic-NNN.cloudpartnerservices
.goog) is a GET, costs nothing and answered DISABLED for every partner service
and ENABLED for aiplatform.googleapis.com. The owner must validate the signal
once by enabling one model in the console and re-running this script
(scoping document, PoC section).

This script never enables, orders, accepts or clicks anything. It sends GET
requests only.

Auth: --token, else env GOOGLE_OAUTH_ACCESS_TOKEN, else
`gcloud auth print-access-token`. In a Claude Code cloud session the token is
the literal "proxy-injected" and the agent proxy adds the real credential.

Standard library only; safe under `python3 -I`.

Usage:
  python3 -I ci/gitlab/poc/mg_inventory.py \
      --projects my-project --quota-project my-project \
      [--token TOKEN] [--models claude-opus-4-6,claude-haiku-4-5] \
      [--out DIR] [--save-fixture DIR] [--fixture DIR] [--extension-id ID]
  --projects takes a comma list, or a path to a file with one id per line.
  --fixture DIR reads publisher-models.json and services-<project>.json from
  DIR instead of the network (offline run; --save-fixture writes that shape).
Exit codes: 0 ran, 2 bad arguments or no token, 3 the model list call failed.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PUBLISHER_URL = ("https://aiplatform.googleapis.com/v1beta1/publishers/anthropic/models"
                 "?listAllVersions=true&view=PUBLISHER_MODEL_VIEW_FULL")
SERVICEUSAGE = "https://serviceusage.googleapis.com/v1"
AIPLATFORM_SERVICE = "aiplatform.googleapis.com"
BATCH_MAX = 20  # services:batchGet takes at most 20 names per call
PROJECT_ID_RE = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")  # MGC.isValidProjectId
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$", re.IGNORECASE)  # MGC.isValidModelSlug
STORE_EXTENSION_ID = "fmfhgpbcpacoddjpfemghhpinhodcglp"  # Chrome Web Store id, as in scripts/deep-link/mgc_link.py
DEEP_LINK_MAX_PROJECTS = 200  # MGC.DEEP_LINK.MAX_PROJECTS
DEEP_LINK_MAX_MODELS = 13     # MGC.DEEP_LINK.MAX_MODELS
DEEP_LINK_MAX_RAW = 16384     # MGC.DEEP_LINK.MAX_RAW


# ----------------------------------------------------------------- helpers

def die(msg: str, code: int) -> None:
    print(f"error: {msg}", file=sys.stderr)
    sys.exit(code)


def get_token(explicit: str) -> str:
    if explicit:
        return explicit
    env = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN", "").strip()
    if env:
        return env
    try:
        out = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True, timeout=60)
        if out.returncode == 0 and out.stdout.strip():
            return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        pass
    die("no token: pass --token, set GOOGLE_OAUTH_ACCESS_TOKEN or sign gcloud in", 2)
    return ""


def http_get(url: str, token: str, quota_project: str):
    """Returns (status, parsed_json_or_text). Never raises on HTTP errors."""
    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Accept", "application/json")
    if quota_project:
        req.add_header("X-Goog-User-Project", quota_project)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        status = e.code
    except (urllib.error.URLError, OSError) as e:
        return 0, {"error": {"message": str(e)}}
    try:
        return status, json.loads(body) if body.strip() else {}
    except json.JSONDecodeError:
        return status, {"error": {"message": body[:300]}}


def read_projects(spec: str) -> list:
    p = Path(spec)
    if p.is_file():
        raw = p.read_text(encoding="utf-8").splitlines()
    else:
        raw = spec.split(",")
    ids, seen = [], set()
    for x in raw:
        x = x.strip()
        if not x or x.startswith("#") or x in seen:
            continue
        seen.add(x)
        ids.append(x)
    return ids


def service_id_from_uri(uri: str) -> str:
    """'...questionnaire?...&service=anthropic-882.cloudpartnerservices.goog&...' -> that service name."""
    try:
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(uri).query)
    except ValueError:
        return ""
    vals = q.get("service") or []
    return vals[0] if vals else ""


# -------------------------------------------------------------- deep links

# The link format is the contract in docs/scoping/03-deep-links.md;
# scripts/deep-link/mgc_link.py builds the same link. This function is
# self-contained on purpose (no import of that script).
def build_deep_links(pending: dict, extension_id: str, max_raw: int = DEEP_LINK_MAX_RAW):
    """pending: {project id: [pending slugs]} in report order.
    Returns (per_project, chunks, warnings): per_project is [(project, link)],
    chunks is [(project ids, link)], warnings is a list of strings.
    Ids and slugs that fail the extension's validation are left out with a warning;
    a link is never longer than max_raw characters (a chunk that would be is split)."""
    prefix = f"chrome-extension://{extension_id}/popup/popup.html?tab=1&v=1&projects="

    def link(ids, slugs):
        return prefix + ",".join(ids) + "&models=" + ",".join(slugs)

    warnings, valid = [], {}
    for project, slugs in pending.items():
        if not PROJECT_ID_RE.match(project):
            warnings.append(f"project id left out of the links, invalid: {project!r}")
            continue
        good = sorted({s for s in slugs if SLUG_RE.match(s)})
        for s in sorted({s for s in slugs if not SLUG_RE.match(s)}):
            warnings.append(f"slug left out of the links ({project}), invalid: {s!r}")
        if not good:
            warnings.append(f"project left out of the links, no valid pending slug: {project}")
            continue
        if len(good) > DEEP_LINK_MAX_MODELS:
            warnings.append(f"project left out of the links, {len(good)} pending models (the extension takes {DEEP_LINK_MAX_MODELS}): {project}")
            continue
        valid[project] = good

    per_project = []
    for project, slugs in valid.items():
        text = link([project], slugs)
        if len(text) > max_raw:
            warnings.append(f"project left out of the links, link longer than {max_raw} characters: {project}")
            continue
        per_project.append((project, text))
    ids_ok = [p for p, _ in per_project]

    chunks = []

    def add_chunk(ids):
        slugs = sorted({s for p in ids for s in valid[p]})
        if len(slugs) > DEEP_LINK_MAX_MODELS:
            warnings.append(f"chunk of {len(ids)} project(s) left out, {len(slugs)} models in the union (the extension takes {DEEP_LINK_MAX_MODELS}): {','.join(ids)}")
            return
        text = link(ids, slugs)
        if len(text) > max_raw and len(ids) > 1:
            half = len(ids) // 2
            add_chunk(ids[:half])
            add_chunk(ids[half:])
            return
        chunks.append((ids, text))

    for i in range(0, len(ids_ok), DEEP_LINK_MAX_PROJECTS):
        add_chunk(ids_ok[i:i + DEEP_LINK_MAX_PROJECTS])
    return per_project, chunks, warnings


def deep_links_markdown(per_project: list, chunks: list, warnings: list, extension_id: str) -> str:
    lines = [
        "# Deep links for the pending projects",
        "",
        "A deep link is the extension popup's own URL with the project ids and the models in its query string. "
        "Open it in a Chrome that has the extension: the popup opens in a tab and asks for a confirmation before it "
        "fills the form, and a link never starts a run (you still press Start). The format and the limits are in "
        "the \"Deep links\" section of the repository README.md and in ci/gitlab/README.md. The extension id in these "
        f"links is `{extension_id}`; it defaults to the Chrome Web Store id `{STORE_EXTENSION_ID}`, and an unpacked "
        "copy has another id (set it with `--extension-id` or the env var `MGC_EXTENSION_ID`).",
        "",
        "## Pending projects",
        "",
    ]
    if not per_project:
        lines += ["No project is pending: no deep link.", ""]
    else:
        lines += [f"- {p}: {text}" for p, text in per_project] + [""]
    lines += ["## All pending projects", ""]
    if not chunks:
        lines += ["No project is pending: no deep link.", ""]
    else:
        lines += ["Each link below holds at most 200 projects and at most 16,384 characters. The models of a link are the "
                  "union of the pending slugs of its projects, so a link may list a pair that is already enabled in some "
                  "project; the extension's model-page check ends that pair as `skipped`.", ""]
        n = len(chunks)
        for i, (ids, text) in enumerate(chunks, start=1):
            lines.append(f"- link {i} of {n} ({len(ids)} project{'s' if len(ids) != 1 else ''}): {text}")
        lines.append("")
    if warnings:
        lines += ["## Warnings", ""] + [f"warning: {w}" for w in warnings] + [""]
    return "\n".join(lines)


# --------------------------------------------------------------- inventory

def parse_inventory(doc: dict) -> list:
    """One row per slug, in API order (oldest first). Versions of one slug collapse into versionIds."""
    rows, by_slug = [], {}
    for i, m in enumerate(doc.get("publisherModels") or [], start=1):
        name = str(m.get("name", ""))
        slug = name.rsplit("/", 1)[-1].split("@", 1)[0]
        if not slug:
            continue
        ra = ((m.get("supportedActions") or {}).get("requestAccess") or {}).get("references") or {}
        uri = ""
        for ref in ra.values():
            if isinstance(ref, dict) and ref.get("uri"):
                uri = ref["uri"]
                break
        sid = service_id_from_uri(uri)
        row = by_slug.get(slug)
        if row is None:
            row = {"slug": slug, "apiOrder": i, "launchStage": m.get("launchStage", ""),
                   "versionIds": [], "serviceId": sid, "requestAccessUri": uri}
            by_slug[slug] = row
            rows.append(row)
        if m.get("versionId"):
            row["versionIds"].append(m["versionId"])
        if not row["serviceId"] and sid:
            row["serviceId"] = sid
    return rows


def read_fixture(path: Path):
    """Parsed JSON of a --fixture file; a missing or malformed file is a usage error (exit 2)."""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        die(f"cannot read fixture {path}: {err}", 2)
    if not isinstance(doc, dict):
        die(f"cannot read fixture {path}: expected a JSON object, got {type(doc).__name__}", 2)
    return doc


def fixture_status(doc) -> int:
    """HTTP status a saved answer stands for: an explicit "status", else a Google error body's code, else 200."""
    if isinstance(doc, dict):
        if isinstance(doc.get("status"), int):
            return doc["status"]
        code = (doc.get("error") or {}).get("code") if isinstance(doc.get("error"), dict) else None
        if isinstance(code, int):
            return code
    return 200


def fetch_inventory(args, token):
    if args.fixture:
        path = Path(args.fixture) / "publisher-models.json"
        doc = read_fixture(path)
        return fixture_status(doc), doc
    status, doc = http_get(PUBLISHER_URL, token, args.quota_project)
    if args.save_fixture and status == 200:
        Path(args.save_fixture).mkdir(parents=True, exist_ok=True)
        (Path(args.save_fixture) / "publisher-models.json").write_text(json.dumps(doc, indent=1), encoding="utf-8")
    return status, doc


# ------------------------------------------------------------------- audit

def classify(status: int, state: str, err: str) -> str:
    if status == 200:
        if state == "ENABLED":
            return "enabled"
        if state == "DISABLED":
            return "not-enabled"
        return "unknown"
    if status == 403:
        return "no-permission"
    return "unknown"


def audit_project(args, token, project: str, service_ids: list) -> dict:
    """One batchGet per 20 names. Returns {service: {"status": int, "state": str, "error": str}}."""
    names = service_ids + [AIPLATFORM_SERVICE]
    out = {}
    if args.fixture:
        path = Path(args.fixture) / f"services-{project}.json"
        if not path.is_file():
            for s in names:
                out[s] = {"status": 0, "state": "", "error": f"no fixture {path.name}"}
            return out
        # Saved shape: {"services": [...]} for a 200, {"status": N, "body": {...}}
        # for anything else. A raw Google error body ({"error": {"code": 403}})
        # dropped in by hand is read as that status too.
        doc = read_fixture(path)
        status = fixture_status(doc)
        if isinstance(doc, dict) and "body" in doc:
            doc = doc["body"]
        docs = [(status, doc, names)]
    else:
        docs = []
        for i in range(0, len(names), BATCH_MAX):
            chunk = names[i:i + BATCH_MAX]
            qs = "&".join("names=" + urllib.parse.quote(f"projects/{project}/services/{s}", safe="/") for s in chunk)
            url = f"{SERVICEUSAGE}/projects/{project}/services:batchGet?{qs}"
            status, doc = http_get(url, token, args.quota_project)
            docs.append((status, doc, chunk))
        if args.save_fixture:
            if all(st == 200 for st, _, _ in docs):
                saved = {"services": [s for _, d, _ in docs for s in d.get("services", [])]}
            else:
                # The first failed chunk stands for the project, so a 403 replays as no-permission.
                st, d, _ = next(x for x in docs if x[0] != 200)
                saved = {"status": st, "body": d}
            Path(args.save_fixture).mkdir(parents=True, exist_ok=True)
            (Path(args.save_fixture) / f"services-{project}.json").write_text(json.dumps(saved, indent=1), encoding="utf-8")
    for status, doc, chunk in docs:
        if status != 200:
            # Only the names of this chunk carry this error; another chunk's answer stands.
            msg = " ".join(str(((doc or {}).get("error") or {}).get("message", "")).split())
            msg = msg.split(" Help Token:", 1)[0][:160]  # drop Google's opaque support token from the report
            for s in chunk:
                out.setdefault(s, {"status": status, "state": "", "error": msg})
            continue
        for svc in doc.get("services") or []:
            short = str(svc.get("name", "")).rsplit("/", 1)[-1]
            out[short] = {"status": 200, "state": svc.get("state", ""), "error": ""}
    for s in names:
        out.setdefault(s, {"status": 0, "state": "", "error": "service missing from the answer"})
    return out


# -------------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser(description="Model Garden inventory and enablement audit (read-only).")
    ap.add_argument("--projects", required=True, help="comma list of project ids, or a file with one id per line")
    ap.add_argument("--quota-project", default=os.environ.get("GOOGLE_CLOUD_QUOTA_PROJECT", ""), help="X-Goog-User-Project value")
    ap.add_argument("--token", default="", help="OAuth access token (else env GOOGLE_OAUTH_ACCESS_TOKEN, else gcloud)")
    ap.add_argument("--models", default="", help="comma list of slugs to audit (default: every listed model)")
    ap.add_argument("--out", default="mg-inventory-out", help="output directory")
    ap.add_argument("--save-fixture", default="", help="write the raw API answers to DIR for an offline run")
    ap.add_argument("--fixture", default="", help="read the raw API answers from DIR instead of the network")
    ap.add_argument("--extension-id", default=os.environ.get("MGC_EXTENSION_ID") or STORE_EXTENSION_ID,
                    help=f"extension id in deep-links.md (default: MGC_EXTENSION_ID, else the store id {STORE_EXTENSION_ID}); an unpacked copy has another")
    args = ap.parse_args()

    projects = read_projects(args.projects)
    if not projects:
        die("--projects names no project", 2)
    bad = [p for p in projects if not PROJECT_ID_RE.match(p)]
    if bad:
        die(f"invalid project id(s): {', '.join(bad)}", 2)
    token = "fixture" if args.fixture else get_token(args.token)
    want = {s.strip() for s in args.models.split(",") if s.strip()}

    status, doc = fetch_inventory(args, token)
    if status != 200:
        die(f"publisher model list: HTTP {status} {json.dumps(doc)[:300]}", 3)
    inventory = parse_inventory(doc)
    full_inventory = inventory  # the report keeps the whole list; --models narrows only the audit
    listed = len(doc.get("publisherModels") or [])
    if want:
        missing = sorted(want - {r["slug"] for r in inventory})
        if missing:
            print(f"warning: not in the publisher list: {', '.join(missing)}", file=sys.stderr)
        inventory = [r for r in inventory if r["slug"] in want]
    unmapped = [r["slug"] for r in inventory if not r["serviceId"]]
    if unmapped:
        print(f"warning: no service id parsed for: {', '.join(unmapped)}", file=sys.stderr)

    print(f"Anthropic publisher models (global endpoint): {listed} entries, {len(inventory)} slugs audited")
    print(f"{'slug':<22} {'stage':<8} {'service id':<42} versions")
    for r in inventory:
        print(f"{r['slug']:<22} {r['launchStage']:<8} {r['serviceId'] or '?':<42} {','.join(r['versionIds']) or '-'}")

    service_ids = sorted({r["serviceId"] for r in inventory if r["serviceId"]})
    results, pending_projects = [], []
    print()
    print(f"{'project':<24} {'model':<22} {'service':<42} {'http':<5} {'state':<9} verdict")
    for project in projects:
        states = audit_project(args, token, project, service_ids)
        ai = states.get(AIPLATFORM_SERVICE, {})
        project_pending = False
        for r in inventory:
            sid = r["serviceId"]
            st = states.get(sid, {"status": 0, "state": "", "error": "no service id"})
            verdict = classify(st["status"], st["state"], st["error"]) if sid else "unknown"
            results.append({"project": project, "model": r["slug"], "serviceId": sid,
                            "http": st["status"], "state": st["state"], "verdict": verdict,
                            "error": st["error"], "aiplatformState": ai.get("state", "")})
            if verdict == "not-enabled":
                project_pending = True
            print(f"{project:<24} {r['slug']:<22} {sid or '?':<42} {st['status']:<5} {st['state'] or '-':<9} {verdict}")
        print(f"{project:<24} {'(vertex ai api)':<22} {AIPLATFORM_SERVICE:<42} {ai.get('status', 0):<5} {ai.get('state') or '-':<9} {ai.get('error', '')}")
        if project_pending:
            pending_projects.append(project)

    counts = {}
    for row in results:
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1
    pending_rows = [row for row in results if row["verdict"] == "not-enabled"]
    print()
    print("summary: " + ", ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    print(f"pending projects (at least one model not enabled): {len(pending_projects)}")

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = {"generated": now, "signal": "serviceusage.services.state of the model's partner service",
              "publisherListUrl": PUBLISHER_URL, "projects": projects, "inventory": full_inventory,
              "audited": [r["slug"] for r in inventory], "results": results, "summary": counts,
              "pending": [{"project": r["project"], "model": r["model"]} for r in pending_rows]}
    (out / "mg-inventory.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    # projects.txt: exactly the popup textarea format, one project id per line.
    (out / "projects.txt").write_text("".join(p + "\n" for p in pending_projects), encoding="utf-8")
    # The options page import file (MGC.parseConfig): only the popup part.
    pending_models = []
    for r in pending_rows:
        if r["model"] not in pending_models:
            pending_models.append(r["model"])
    settings = {"app": "model-garden-clicker", "schema": 1, "exported": now,
                "popup": {"projects": pending_projects, "models": pending_models, "extra": ""}}
    (out / "model-garden-clicker-settings.json").write_text(json.dumps(settings, indent=1), encoding="utf-8")
    # deep-links.md: one link per pending project, then chunked links for all of them.
    pending_by_project = {}
    for r in pending_rows:
        pending_by_project.setdefault(r["project"], []).append(r["model"])
    per_project, chunks, link_warnings = build_deep_links(pending_by_project, args.extension_id)
    for w in link_warnings:
        print(f"warning: {w}", file=sys.stderr)
    (out / "deep-links.md").write_text(deep_links_markdown(per_project, chunks, link_warnings, args.extension_id), encoding="utf-8")
    print(f"wrote {out / 'mg-inventory.json'}, {out / 'projects.txt'}, {out / 'model-garden-clicker-settings.json'}, {out / 'deep-links.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
