#!/usr/bin/env python3
"""Print a Model Garden Clicker deep link.

    mgc_link.py PROJECT [PROJECT ...] [--models SLUG,SLUG|latest] [--extension-id ID]

The first line is the console form: a plain https link for a chat, a
ticket or a runbook, opened in a browser that has the extension and a
console session. With --extension-id a second line holds the popup-page
form, for the address bar and bookmarks. Either link fills the popup's
form after a confirmation and never starts a run. The extension refuses a
link with more than 23 projects or 13 models, so this script stops there
too. It does no other validation: the extension validates every value.
"""
import argparse
import sys

CONSOLE = "https://console.cloud.google.com/agent-platform/model-garden"
MAX_PROJECTS, MAX_MODELS = 23, 13


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("projects", nargs="+", help="project IDs")
    ap.add_argument("--models", default="", help="comma list of slugs, or 'latest'; absent ticks nothing")
    ap.add_argument("--extension-id", default="", help="also print the chrome-extension:// form")
    a = ap.parse_args()
    projects = [p.strip() for p in a.projects if p.strip()]
    models = [m.strip() for m in a.models.split(",") if m.strip()]
    if len(projects) > MAX_PROJECTS or len(models) > MAX_MODELS:
        sys.exit(f"at most {MAX_PROJECTS} projects and {MAX_MODELS} models")
    keys = ["projects=" + ",".join(projects)]
    if models:
        keys.append("models=" + ",".join(models))
    print(f"{CONSOLE}?project={projects[0]}#mgc=v1;" + ";".join(keys))
    if a.extension_id:
        print(f"chrome-extension://{a.extension_id}/popup/popup.html?tab=1&v=1&" + "&".join(keys))


if __name__ == "__main__":
    main()
