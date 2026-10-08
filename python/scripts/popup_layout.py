#!/usr/bin/env python3
"""Layout probe of the extension's popup in a real headless Chrome.

jsdom has no layout engine, so the offline tests can only check the CSS
text. This script loads extension/popup/popup.html at the popup's 520 x 600
px in headless Chrome for Testing (the copy Selenium Manager keeps under
~/.cache/selenium/), with a fake chrome.* injected before the page scripts
run so popup.js renders the real models.json, and measures the result:
every checklist row keeps its full line height and no two rows overlap,
the checklist box is at least 120 px, the results/log region at least
160 px, the Start/Stop row sits below the checklist, the page does not
overflow 600 px, and exactly one step-by-step icon is displayed.

Run:  python/.venv/bin/python python/scripts/popup_layout.py [idle|running|error|all]

Exit code 0 when every check holds, 1 otherwise. A screenshot per state is
written to python/recon/popup-layout-<state>.png (gitignored).
"""
from __future__ import annotations

import glob
import json
import os
import sys
import time

import _bootstrap  # noqa: F401

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service

from mgclick.paths import PYTHON_DIR, RECON_DIR

EXTENSION_DIR = PYTHON_DIR.parent / "extension"
STATES = {
    "idle": {},
    "running": {
        "running": True, "run": {"runId": "r", "live": False}, "current": {"jobIndex": 0, "phase": "model"},
        "queue": [{"projectId": "proj-one", "modelSlug": "claude-haiku-4-5", "status": "running", "phase": "model",
                   "step": "waiting for Enable button (enabled, no dialog) or enabled state", "message": ""}],
        "settings": {"step_by_step": True},
    },
    "error": {"settings": {"business_name": ""}},
}
FAKE_CHROME = """
const store = %s;
store.settings = Object.assign({business_name: 'b', business_website: 'https://b.example', contact_email: 'a@b.example', headquarters: 'x', industry: 'x',
  intended_users: 'x', use_cases: 'x', aup_additional_requirements: 'no', aup_details: '', live_mode: false, step_by_step: false}, store.settings || {});
window.chrome = {
  storage: { local: {
    get: async (k) => { const ks = Array.isArray(k) ? k : [k]; const o = {}; for (const x of ks) if (x in store) o[x] = JSON.parse(JSON.stringify(store[x])); return o; },
    set: async (o) => Object.assign(store, o) }, onChanged: { addListener() {} } },
  runtime: { getURL: (p) => %s + p, sendMessage: (m, cb) => cb({ ok: true }), openOptionsPage() {}, lastError: undefined },
  tabs: { create() {} }
};
"""
MEASURE_JS = """
const rect = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height, w: b.width }; };
const rows = Array.from(document.querySelectorAll('#models label')).map(rect);
const display = (id) => getComputedStyle(document.getElementById(id)).display;
return { rows, models: rect(document.getElementById('models')), scroll: rect(document.querySelector('.scroll')), inputs: rect(document.querySelector('.inputs')),
  docScrollH: document.documentElement.scrollHeight, start: rect(document.getElementById('start')), status: rect(document.getElementById('status')),
  snail: display('icon-snail'), dog: display('icon-dog'), label: document.getElementById('step-toggle-label').textContent,
  lineH: parseFloat(getComputedStyle(document.querySelector('#models label')).lineHeight) };
"""


def newest(pattern: str) -> str:
    found = sorted(glob.glob(os.path.expanduser(pattern)))
    if not found:
        print(f"nothing matches {pattern}; run ext_dryrun.py once so Selenium Manager downloads Chrome for Testing")
        sys.exit(2)
    return found[-1]


def probe(state: str) -> bool:
    opts = Options()
    opts.binary_location = newest("~/.cache/selenium/chrome/linux64/*/chrome")
    for arg in ("--headless=new", "--window-size=520,600", "--allow-file-access-from-files", "--no-sandbox", "--disable-gpu"):
        opts.add_argument(arg)
    driver = webdriver.Chrome(service=Service(newest("~/.cache/selenium/chromedriver/linux64/*/chromedriver")), options=opts)
    try:
        base = json.dumps(f"file://{EXTENSION_DIR}/")
        driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": FAKE_CHROME % (json.dumps(STATES[state]), base)})
        driver.get(f"file://{EXTENSION_DIR}/popup/popup.html")
        time.sleep(1.0)
        r = driver.execute_script(MEASURE_JS)
        RECON_DIR.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(RECON_DIR / f"popup-layout-{state}.png"))
    finally:
        driver.quit()
    rows = r["rows"]
    problems = []
    for i, a in enumerate(rows):
        if a["h"] < r["lineH"] - 0.5:
            problems.append(f"row {i} height {a['h']:.1f} < line height {r['lineH']:.1f}")
        for j in range(i + 1, len(rows)):
            b = rows[j]
            ox = min(a["right"], b["right"]) - max(a["left"], b["left"])
            oy = min(a["bottom"], b["bottom"]) - max(a["top"], b["top"])
            if ox > 0.5 and oy > 0.5:
                problems.append(f"rows {i} and {j} overlap by {ox:.1f} x {oy:.1f} px")
    checks = [
        ("every checklist row keeps its full line height", not any("height" in p for p in problems)),
        ("no two checklist rows overlap", not any("overlap" in p for p in problems)),
        ("checklist box at least 120 px", r["models"]["h"] >= 119.5),
        ("results/log region at least 160 px", r["scroll"]["h"] >= 159.5),
        ("Start/Stop row below the checklist (no overlap)", r["start"]["top"] >= r["models"]["bottom"] - 0.5),
        ("page does not overflow 600 px", r["docScrollH"] <= 600),
        ("exactly one step-by-step icon displayed", (r["snail"] == "none") != (r["dog"] == "none")),
    ]
    if state == "idle":
        checks.append(("status line visible without scrolling the inputs", r["status"]["bottom"] <= r["inputs"]["bottom"] + 0.5))
    print(f"state {state}: {len(rows)} rows of {r['lineH']:.1f} px line height, row heights {sorted(set(round(x['h'], 1) for x in rows))}; "
          f"checklist {r['models']['h']:.0f} px, inputs {r['inputs']['h']:.0f} px, results/log {r['scroll']['h']:.0f} px, document {r['docScrollH']} px; "
          f"icons snail={r['snail']} dog={r['dog']} label={r['label']!r}")
    ok = True
    for label, good in checks:
        print(f"  {'PASS' if good else 'FAIL'} {label}")
        ok = ok and good
    for p in problems:
        print(f"    {p}")
    return ok


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    states = list(STATES) if which == "all" else [which]
    if any(s not in STATES for s in states):
        print(f"unknown state; use one of {', '.join(STATES)} or all")
        return 2
    return 0 if all([probe(s) for s in states]) else 1


if __name__ == "__main__":
    sys.exit(main())
