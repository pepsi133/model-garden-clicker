#!/usr/bin/env python3
"""Layout and console probe of the extension's pages in a real headless Chrome.

jsdom has no layout engine, so the offline tests can only check the CSS
text. This script loads extension/popup/popup.html at Chrome's maximum
popup size, 800 x 600 px, in headless Chrome for Testing (the copy Selenium
Manager keeps under ~/.cache/selenium/), with a fake chrome.* injected
before the page scripts run so popup.js renders the real models.json, and
measures the result: every checklist row keeps its full line height and no
two rows overlap, the checklist shows every model without a scrollbar and
without truncating a name, in at least three columns, the inputs are not
inside any scroll region and do not overflow, the Start button and the
status line are visible without scrolling, the results/log region keeps
its floor, the page does not overflow 600 px, and exactly one step-by-step
icon is displayed. It also loads extension/options/options.html with the
same fake and checks that the form rendered (the Logs section included),
and extension/runs/runs.html at 900 x 700 and checks that its header, its
three buttons and either its empty state or its database notice rendered
(a file:// page may be refused IndexedDB; the page must say so in its
notice, not throw).

For every page it collects the browser console log (Selenium
goog:loggingPrefs, browser ALL) and fails on any SEVERE entry, printing
them: an element id that options.js references but the HTML no longer
has, or any other uncaught error during init and the first render, shows
up here (popup.js guards its ids and only warns; the offline id-existence
check in extension/test/ui-pages.cjs covers the popup).

Run:  python/.venv/bin/python python/scripts/popup_layout.py [idle|running|error|options|runs|all]

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
POPUP_W, POPUP_H = 800, 600  # Chrome's maximum action popup size
MIN_COLUMNS = 3
SCROLL_FLOOR = 120  # px, the results/log region's min-height in popup.css
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
PAGES = list(STATES) + ["options", "runs"]
RUNS_W, RUNS_H = 900, 700
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
const labels = Array.from(document.querySelectorAll('#models label'));
const rows = labels.map((el) => Object.assign(rect(el), { truncated: el.scrollWidth > el.clientWidth, text: el.textContent.trim() }));
const display = (id) => getComputedStyle(document.getElementById(id)).display;
const box = (sel) => { const el = document.querySelector(sel); return Object.assign(rect(el), { scrollH: el.scrollHeight, clientH: el.clientHeight, scrollW: el.scrollWidth, clientW: el.clientWidth }); };
return { rows, models: box('#models'), scroll: box('.scroll'), inputs: box('.inputs'),
  docScrollH: document.documentElement.scrollHeight, docScrollW: document.documentElement.scrollWidth, innerW: window.innerWidth, innerH: window.innerHeight,
  bodyW: document.body.getBoundingClientRect().width, start: rect(document.getElementById('start')), status: rect(document.getElementById('status')),
  snail: display('icon-snail'), warning: display('icon-warning'), label: document.getElementById('step-toggle-label').textContent,
  stop: rect(document.getElementById('stop')), pause: rect(document.getElementById('pause')), pauseShown: display('pause') !== 'none' && !document.getElementById('pause').hidden,
  pauseText: document.getElementById('pause').textContent,
  lineH: parseFloat(getComputedStyle(document.querySelector('#models label')).lineHeight), modelCount: JSON.parse(arguments[0]).length };
"""
OPTIONS_JS = """
const form = document.getElementById('form');
return { name: form.elements.business_name.value, industry: form.elements.industry_choice ? form.elements.industry_choice.tagName : null,
  dry: form.elements.dry_run.checked, timing: form.elements.timing_json.value.length, keys: document.getElementById('timing-keys').textContent,
  runsKeep: form.elements.runs_keep ? form.elements.runs_keep.value : null, purge: !!document.getElementById('purge-runs'),
  lastControl: (() => { const c = Array.from(document.querySelectorAll('input, button, select, textarea')); const l = c[c.length - 1]; return l ? l.name || l.id : null; })(),
  joke: (() => { const el = form.elements.inside_joke; if (!el) return null; const b = el.closest('label').getBoundingClientRect(); return { checked: el.checked, text: el.closest('label').textContent.trim(), w: b.width, h: b.height, right: b.right }; })(),
  offNames: Array.from(document.querySelectorAll('.step-off-name')).map((e) => e.textContent),
  configExport: !!document.getElementById('config-export'), configImport: (document.getElementById('config-import') || {}).type || null,
  innerW: window.innerWidth, docScrollW: document.documentElement.scrollWidth };
"""
RUNS_JS = """
const shown = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; };
return { title: document.title, h1: (document.querySelector('header h1') || {}).textContent || '', photo: !!document.querySelector('header img.photo'),
  buttons: ['refresh', 'download-all', 'purge-all'].map((id) => !!document.getElementById(id)),
  empty: shown('empty'), notice: shown('notice'), noticeText: document.getElementById('notice').textContent, table: shown('runs'),
  keep: document.getElementById('keep').textContent, idb: typeof indexedDB, innerW: window.innerWidth, innerH: window.innerHeight,
  docScrollW: document.documentElement.scrollWidth };
"""


def newest(pattern: str) -> str:
    found = sorted(glob.glob(os.path.expanduser(pattern)))
    if not found:
        print(f"nothing matches {pattern}; run ext_dryrun.py once so Selenium Manager downloads Chrome for Testing")
        sys.exit(2)
    return found[-1]


def start(store: dict, size: tuple[int, int] = (POPUP_W, POPUP_H)):
    opts = Options()
    opts.binary_location = newest("~/.cache/selenium/chrome/linux64/*/chrome")
    for arg in ("--headless=new", f"--window-size={size[0]},{size[1]}", "--allow-file-access-from-files", "--no-sandbox", "--disable-gpu"):
        opts.add_argument(arg)
    opts.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    driver = webdriver.Chrome(service=Service(newest("~/.cache/selenium/chromedriver/linux64/*/chromedriver")), options=opts)
    base = json.dumps(f"file://{EXTENSION_DIR}/")
    driver.execute_cdp_cmd("Page.addScriptToEvaluateOnNewDocument", {"source": FAKE_CHROME % (json.dumps(store), base)})
    return driver


CONTROL_MARKER = "mgc-probe-console-control"


def console_check(driver, page: str) -> bool:
    """Print the page's console log; any SEVERE entry fails.

    A zero must be a live zero: a console.error marker is written into the
    page first and the check fails when the log channel does not return it
    as a SEVERE entry (the marker itself is then excluded).
    """
    driver.execute_script("console.error(arguments[0])", CONTROL_MARKER)
    entries = driver.get_log("browser")
    control = [e for e in entries if CONTROL_MARKER in str(e.get("message")) and e.get("level") == "SEVERE"]
    entries = [e for e in entries if CONTROL_MARKER not in str(e.get("message"))]
    severe = [e for e in entries if e.get("level") == "SEVERE"]
    for e in entries:
        if e.get("level") != "SEVERE":
            print(f"    console {e.get('level')}: {str(e.get('message'))[:160]}")
    for e in severe:
        print(f"    SEVERE: {e.get('message')}")
    print(f"  {'PASS' if control else 'FAIL'} {page}: the console log channel is live (the control console.error came back as SEVERE)")
    print(f"  {'PASS' if not severe else 'FAIL'} {page}: no SEVERE browser console entry ({len(entries)} entries, {len(severe)} SEVERE)")
    return bool(control) and not severe


def probe(state: str) -> bool:
    driver = start(STATES[state])
    models_json = (EXTENSION_DIR / "models.json").read_text(encoding="utf-8")
    try:
        driver.get(f"file://{EXTENSION_DIR}/popup/popup.html")
        # --window-size is the outer window; the viewport the popup gets is
        # 800 x 600 exactly, so the window is grown by the difference.
        inner_w, inner_h = driver.execute_script("return [window.innerWidth, window.innerHeight]")
        if (inner_w, inner_h) != (POPUP_W, POPUP_H):
            driver.set_window_size(POPUP_W + (POPUP_W - inner_w), POPUP_H + (POPUP_H - inner_h))
            time.sleep(0.3)
        time.sleep(1.0)
        r = driver.execute_script(MEASURE_JS, models_json)
        RECON_DIR.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(RECON_DIR / f"popup-layout-{state}.png"))
        console_ok = console_check(driver, f"popup.html ({state})")
    finally:
        driver.quit()
    rows = r["rows"]
    problems = []
    for i, a in enumerate(rows):
        if a["h"] < r["lineH"] - 0.5:
            problems.append(f"row {i} height {a['h']:.1f} < line height {r['lineH']:.1f}")
        if a["truncated"]:
            problems.append(f"row {i} ({a['text']!r}) is truncated (ellipsis)")
        for j in range(i + 1, len(rows)):
            b = rows[j]
            ox = min(a["right"], b["right"]) - max(a["left"], b["left"])
            oy = min(a["bottom"], b["bottom"]) - max(a["top"], b["top"])
            if ox > 0.5 and oy > 0.5:
                problems.append(f"rows {i} and {j} overlap by {ox:.1f} x {oy:.1f} px")
    columns = len({round(x["left"]) for x in rows})
    m, s, inp = r["models"], r["scroll"], r["inputs"]
    checks = [
        (f"viewport is {POPUP_W} x {POPUP_H} and the body fills its width", r["innerW"] == POPUP_W and r["innerH"] == POPUP_H and abs(r["bodyW"] - POPUP_W) < 0.5),
        (f"every model of models.json has a checklist row ({r['modelCount']})", len(rows) == r["modelCount"] and len(rows) > 0),
        ("every checklist row keeps its full line height", not any("height" in p for p in problems)),
        ("no two checklist rows overlap", not any("overlap" in p for p in problems)),
        ("no model name is truncated", not any("truncated" in p for p in problems)),
        (f"checklist in at least {MIN_COLUMNS} columns (found {columns})", columns >= MIN_COLUMNS),
        ("checklist shows every row without a scrollbar", m["scrollH"] <= m["clientH"] + 0.5 and all(x["bottom"] <= m["bottom"] + 0.5 for x in rows)),
        ("inputs are not a scroll region (nothing hidden inside them)", inp["scrollH"] <= inp["clientH"] + 0.5 and inp["scrollW"] <= inp["clientW"] + 0.5),
        ("inputs do not overflow the viewport", inp["bottom"] <= r["innerH"] + 0.5 and inp["right"] <= r["innerW"] + 0.5),
        ("Start visible without scrolling", r["start"]["top"] >= 0 and r["start"]["bottom"] <= r["innerH"] and r["start"]["top"] >= m["bottom"] - 0.5),
        ("status line visible without scrolling", r["status"]["top"] >= 0 and r["status"]["bottom"] <= r["innerH"]),
        (f"results/log region below the inputs, at least {SCROLL_FLOOR} px, with its own scroll", s["top"] >= inp["bottom"] - 0.5 and s["h"] >= SCROLL_FLOOR - 0.5 and s["bottom"] <= r["innerH"] + 0.5),
        (f"page does not overflow {POPUP_W} x {POPUP_H}", r["docScrollH"] <= POPUP_H and r["docScrollW"] <= POPUP_W),
        ("exactly one step-by-step icon displayed", (r["snail"] == "none") != (r["warning"] == "none")),
        ("the icon matches the setting (snail for slow mode, warning sign for fast mode / kubardy mode)",
         (r["label"] == "slow mode" and r["snail"] != "none") or (r["label"] in ("fast mode", "kubardy mode") and r["warning"] != "none")),
        ("the label reads \"fast mode\" while the inside joke box is off (the default)" if state != "running" else "the label reads \"slow mode\" (step-by-step on in this state)",
         r["label"] == ("slow mode" if state == "running" else "fast mode")),
    ]
    if state == "running":
        p, st = r["pause"], r["stop"]
        checks.append(("the Pause button is shown next to Stop while a run is active: same row, to its right, no overlap, inside the viewport",
                       r["pauseShown"] and r["pauseText"] == "Pause" and abs(p["top"] - st["top"]) < 2 and p["left"] >= st["right"] - 0.5
                       and p["right"] <= r["innerW"] + 0.5 and p["bottom"] <= r["innerH"] + 0.5))
    else:
        checks.append(("the Pause button is hidden while no run is active", not r["pauseShown"]))
    print(f"state {state}: {len(rows)} rows in {columns} columns, line height {r['lineH']:.1f} px, row heights {sorted(set(round(x['h'], 1) for x in rows))}; "
          f"checklist {m['h']:.0f} px (scroll {m['scrollH']}/{m['clientH']}), inputs {inp['h']:.0f} px (bottom {inp['bottom']:.0f}), Start bottom {r['start']['bottom']:.0f}, "
          f"results/log {s['h']:.0f} px (top {s['top']:.0f}), document {r['docScrollW']} x {r['docScrollH']} in a {r['innerW']} x {r['innerH']} viewport; "
          f"icons snail={r['snail']} warning={r['warning']} label={r['label']!r}")
    ok = console_ok
    for label, good in checks:
        print(f"  {'PASS' if good else 'FAIL'} {label}")
        ok = ok and good
    for p in problems:
        print(f"    {p}")
    return ok


def probe_options() -> bool:
    """options.html with the fake chrome: the form renders from storage and the console stays clean."""
    driver = start({"settings": {"industry": "Education"}})
    try:
        driver.get(f"file://{EXTENSION_DIR}/options/options.html")
        time.sleep(1.0)
        r = driver.execute_script(OPTIONS_JS)
        RECON_DIR.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(RECON_DIR / "popup-layout-options.png"))
        console_ok = console_check(driver, "options.html")
    finally:
        driver.quit()
    checks = [
        ("the questionnaire fields show the stored values", r["name"] == "b"),
        ("the industry dropdown was built from option-lists.js", r["industry"] == "SELECT"),
        ("the DRY RUN box is ticked and the timing JSON is prefilled with its keys listed", r["dry"] is True and r["timing"] > 20 and "watchdog_min" in r["keys"]),
        ("the Logs section shows Runs to keep (default 50) and its Purge all button", r["runsKeep"] == "50" and r["purge"] is True),
        ("the \"inside joke\" checkbox is the last control on the page, unticked, rendered with its label", r["lastControl"] == "inside_joke" and r["joke"] is not None
         and r["joke"]["checked"] is False and r["joke"]["text"] == "inside joke" and r["joke"]["w"] > 0 and r["joke"]["h"] > 0),
        ("every step-by-step-off name on the page reads \"fast mode\"", len(r["offNames"]) == 2 and all(n == "fast mode" for n in r["offNames"])),
        ("Export settings and Import settings (a file input) are in the Advanced section", r["configExport"] is True and r["configImport"] == "file"),
        ("the page does not overflow its width", r["docScrollW"] <= r["innerW"]),
    ]
    print(f"state options: name={r['name']!r} industry control={r['industry']} dry_run={r['dry']} timing chars={r['timing']} runs_keep={r['runsKeep']!r} last control={r['lastControl']!r} inside joke={r['joke']}")
    ok = console_ok
    for label, good in checks:
        print(f"  {'PASS' if good else 'FAIL'} {label}")
        ok = ok and good
    return ok


def probe_runs() -> bool:
    """runs.html at 900 x 700 with the fake chrome: the page renders and the console stays clean.

    A file:// page may be refused IndexedDB (an opaque origin); the page
    then shows its database notice instead of the list. Either the empty
    state or that notice must be visible, never an uncaught error.
    """
    driver = start({"runs_keep": 25}, (RUNS_W, RUNS_H))
    try:
        driver.get(f"file://{EXTENSION_DIR}/runs/runs.html")
        inner_w, inner_h = driver.execute_script("return [window.innerWidth, window.innerHeight]")
        if (inner_w, inner_h) != (RUNS_W, RUNS_H):
            driver.set_window_size(RUNS_W + (RUNS_W - inner_w), RUNS_H + (RUNS_H - inner_h))
            time.sleep(0.3)
        time.sleep(1.0)
        r = driver.execute_script(RUNS_JS)
        RECON_DIR.mkdir(parents=True, exist_ok=True)
        driver.save_screenshot(str(RECON_DIR / "popup-layout-runs.png"))
        console_ok = console_check(driver, "runs.html")
    finally:
        driver.quit()
    checks = [
        (f"viewport is {RUNS_W} x {RUNS_H} and the page does not overflow its width", r["innerW"] == RUNS_W and r["innerH"] == RUNS_H and r["docScrollW"] <= RUNS_W),
        ("the title, the header with the avatar and the three buttons (Refresh, Download all, Purge all) rendered",
         r["title"] == "Model Garden Clicker runs" and r["h1"] == "Model Garden Clicker runs" and r["photo"] is True and all(r["buttons"])),
        ("the intro shows the stored Runs to keep (25)", r["keep"] == "25"),
        ("either the empty state (database open, no runs) or the database notice is shown, and the table is hidden",
         (r["empty"] != r["notice"]) and r["table"] is False and (not r["notice"] or "run log database" in r["noticeText"])),
    ]
    print(f"state runs: indexedDB={r['idb']} empty={r['empty']} notice={r['notice']} ({r['noticeText'][:80]!r}) keep={r['keep']!r} buttons={r['buttons']} document width {r['docScrollW']} in {r['innerW']} x {r['innerH']}")
    ok = console_ok
    for label, good in checks:
        print(f"  {'PASS' if good else 'FAIL'} {label}")
        ok = ok and good
    return ok


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    pages = PAGES if which == "all" else [which]
    if any(p not in PAGES for p in pages):
        print(f"unknown state; use one of {', '.join(PAGES)} or all")
        return 2
    results = [probe_options() if p == "options" else probe_runs() if p == "runs" else probe(p) for p in pages]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
