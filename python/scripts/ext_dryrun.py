#!/usr/bin/env python3
"""End-to-end DRY RUN of the Chrome extension, driven by Selenium.

Starts Chrome on the dedicated profile with the unpacked extension loaded,
fills the extension's options page from python/config.local.json with the
DRY RUN box ticked, starts a run from the extension's popup page and watches
the results in chrome.storage until the run ends or a timeout hits.
Screenshots of the worker tab, the popup page and the extension log land in
python/recon/ext-<ts>/.

The extension itself never clicks Agree in a dry run; this script does not
touch the console pages at all, it only reads extension storage and takes
screenshots. With --step-by-step the extension's own confirmation panel is
switched on and this script clicks its buttons (a Selenium click is a
trusted event): Continue when the job waits before Next, and Next job on
the dry-run end panel of the Agreements page (where the box is ticked and
Agree is not clicked). It never clicks Continue before Agree (a dry run
never asks) and stops the run if that is ever asked.

Browser attempts, in order (Google Chrome 137+ ignores --load-extension):
  a  /usr/bin/google-chrome with --load-extension / --disable-extensions-except
  b  Chrome for Testing of the same major version via Selenium Manager
     (downloaded once into ~/.cache/selenium/chrome/), same profile
  c  if (b) cannot open the profile or the profile is signed out: report, stop

Expectations: every job must end as `dry-run` or `skipped`; `--expect
PROJECT=dry-run` or `--expect PROJECT=skipped` pins the status for a project
(a project where the model is not enabled ends dry-run with the terms
checkbox ticked, a project where it is already enabled ends skipped).

Exit codes: 0 every expectation holds, 1 a job ended differently, 2 config or
extension problem, 3 profile signed out / browser could not be started.

Run:  python/.venv/bin/python python/scripts/ext_dryrun.py --projects a,b [--models claude-haiku-4-5]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import _bootstrap  # noqa: F401

from selenium.common.exceptions import WebDriverException

from mgclick.browser import CHROME_BINARY, make_driver
from mgclick.config import Config, load_config
from mgclick.paths import DEFAULT_PROFILE_DIR, PYTHON_DIR, RECON_DIR
from mgclick.urls import is_login_page

EXTENSION_DIR = PYTHON_DIR.parent / "extension"
OPTIONS_TITLE = "Model Garden Clicker options"
POPUP_TITLE = "Model Garden Clicker"
DEFAULT_MODELS = ("claude-haiku-4-5",)
TERMINAL = {"done", "unverified", "dry-run", "skipped", "failed", "stopped"}
STORAGE_KEYS = ["settings", "queue", "current", "running", "stop_requested", "tab_id", "log", "run"]
WINDOW = (1400, 1000)
POPUP_SHOTS = ((800, 600),)  # viewport sizes for the popup page screenshots (Chrome's maximum popup size)

# Message fragment that must accompany each acceptable status.
EXPECTED_MESSAGE = {"dry-run": "checkbox ticked", "skipped": "already enabled"}

GET_STORAGE_JS = "const cb = arguments[arguments.length - 1]; chrome.storage.local.get(arguments[0], (o) => cb(o));"


def unpacked_extension_id(path: Path) -> str:
    """Chrome derives an unpacked extension's id from the sha256 of its absolute path."""
    digest = hashlib.sha256(str(path.resolve()).encode("utf-8")).hexdigest()[:32]
    return "".join(chr(ord("a") + int(c, 16)) for c in digest)


def log(msg: str) -> None:
    print(f"[ext-dryrun {datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------------ browser

def extension_loaded(driver, ext_id: str) -> bool:
    """Open the options page: a loaded extension serves it with its title and runtime id."""
    try:
        driver.get(f"chrome-extension://{ext_id}/options/options.html")
    except WebDriverException as exc:
        log(f"options page navigation failed: {exc.msg[:120] if hasattr(exc, 'msg') else exc}")
        return False
    time.sleep(1.0)
    title = driver.title
    runtime_id = None
    try:
        runtime_id = driver.execute_script("return (window.chrome && chrome.runtime && chrome.runtime.id) || null")
    except WebDriverException:
        pass
    log(f"options page title={title!r} chrome.runtime.id={runtime_id!r}")
    return title == OPTIONS_TITLE and runtime_id == ext_id


def chrome_major(binary: str = CHROME_BINARY) -> str:
    """Major version of the installed branded Chrome ("Google Chrome 123.0.x" -> "123")."""
    try:
        out = subprocess.run([binary, "--version"], capture_output=True, text=True, timeout=20, check=False).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        log(f"could not run {binary} --version: {exc}")
        sys.exit(3)
    m = re.search(r"(\d+)\.\d+\.\d+", out)
    if not m:
        log(f"could not parse the Chrome version from {out!r}")
        sys.exit(3)
    return m.group(1)


def drop_service_worker_cache(profile: str) -> None:
    """Delete the profile's service worker registrations and script cache.

    Chrome keeps an unpacked extension's service worker script in the
    profile (Default/Service Worker/ScriptCache) and serves it from there
    while the manifest version is unchanged, so an edited
    background/service-worker.js would otherwise not be the one that runs.
    The content scripts are always read from disk. Site service workers
    re-register on the next visit.
    """
    sw_dir = Path(profile) / "Default" / "Service Worker"
    if sw_dir.is_dir():
        shutil.rmtree(sw_dir)
        log(f"removed {sw_dir} so the extension's service worker is loaded from disk")


def start_browser(profile: str, ext_id: str, attempts: str, major: str | None):
    """Return (driver, attempt_letter). Exits 3 when nothing works."""
    drop_service_worker_cache(profile)
    if "a" in attempts:
        log(f"attempt (a): {CHROME_BINARY} with --load-extension={EXTENSION_DIR}")
        driver = make_driver(profile, extension_dir=EXTENSION_DIR)
        log(f"attempt (a): browserVersion={driver.capabilities.get('browserVersion')}")
        if extension_loaded(driver, ext_id):
            log("attempt (a): extension loaded")
            return driver, "a"
        log("attempt (a): extension NOT loaded (branded Chrome ignores --load-extension); closing")
        driver.quit()
    if "b" in attempts:
        major = major or chrome_major()
        log(f"attempt (b): Chrome for Testing {major} via Selenium Manager, same profile")
        try:
            driver = make_driver(profile, extension_dir=EXTENSION_DIR, browser_version=major)
        except WebDriverException as exc:
            log(f"attempt (b): could not start Chrome for Testing on the profile: {str(exc)[:300]}")
            log("attempt (c): stopping")
            sys.exit(3)
        log(f"attempt (b): browserVersion={driver.capabilities.get('browserVersion')} (Chrome for Testing from ~/.cache/selenium/chrome/)")
        if extension_loaded(driver, ext_id):
            log("attempt (b): extension loaded")
            return driver, "b"
        log("attempt (b): extension NOT loaded; closing")
        driver.quit()
    log("attempt (c): no browser could load the extension; stopping")
    sys.exit(3)


VERSION_JS = "const cb = arguments[arguments.length - 1]; chrome.runtime.sendMessage({type: 'mgc:version'}, (r) => cb(r || null));"


def check_worker_fresh(driver, ext_id: str) -> None:
    """Refuse to run against a cached, stale service worker.

    The options page (always read from disk) asks the running worker for its
    manifest version and storage keys; they must match the files on disk.
    """
    driver.get(f"chrome-extension://{ext_id}/options/options.html")
    time.sleep(0.5)
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))["version"]
    keys = sorted(driver.execute_script("return Object.values(MGC.KEYS)"))  # constants.js as loaded by the options page from disk
    reply = driver.execute_async_script(VERSION_JS)
    if not reply or reply.get("ok") is not True:
        log(f"REFUSING TO CONTINUE: the running service worker did not answer the version message ({reply!r}); it is a stale cached worker")
        sys.exit(2)
    if reply.get("manifest") != manifest or sorted(reply.get("keys") or []) != keys:
        log(f"REFUSING TO CONTINUE: running worker reports manifest {reply.get('manifest')!r} keys {reply.get('keys')!r}, disk has {manifest!r} {keys!r}")
        sys.exit(2)
    log(f"service worker is the one on disk: manifest {manifest}, storage keys {keys}")


def check_signed_in(driver, timeout: float = 60.0) -> bool:
    driver.get("https://console.cloud.google.com/")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        time.sleep(1.0)
        url = driver.current_url
        if is_login_page(url):
            log(f"profile is SIGNED OUT: {url[:120]}")
            try:
                log("page says: " + " ".join(driver.execute_script("return document.body.innerText").split())[:200])
            except WebDriverException:
                pass
            return False
        if url.startswith("https://console.cloud.google.com/") and driver.execute_script("return document.readyState") == "complete":
            if time.monotonic() > deadline - timeout + 8:  # give a late redirect to the login page a chance
                log(f"profile is signed in: {url[:100]}")
                return True
    log(f"could not determine the sign-in state in {timeout}s (url {driver.current_url[:100]})")
    return False


# ------------------------------------------------------------------ extension pages

def storage(driver, keys=STORAGE_KEYS) -> dict:
    return driver.execute_async_script(GET_STORAGE_JS, keys)


SET_FIELD_JS = """
const form = document.getElementById('form'); const [name, value] = [arguments[0], arguments[1]];
const els = form.elements[name];
if (!els) return 'missing';
if (els instanceof RadioNodeList) { els.value = value; return els.value; }
if (els.type === 'checkbox') { els.checked = value === true; return els.checked; }
const proto = els instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto, 'value').set.call(els, value);
els.dispatchEvent(new Event('input', {bubbles: true}));
els.dispatchEvent(new Event('change', {bubbles: true}));
return els.value;
"""


def fill_options(driver, ext_id: str, cfg: Config, step_by_step: bool) -> dict:
    driver.get(f"chrome-extension://{ext_id}/options/options.html")
    time.sleep(1.0)
    if driver.title != OPTIONS_TITLE:
        log(f"options page did not load (title {driver.title!r})")
        sys.exit(2)
    values = {
        "business_name": cfg.business_name,
        "business_website": cfg.business_website,
        "contact_email": cfg.contact_email,
        "headquarters": cfg.headquarters,
        "industry": cfg.industry,
        "intended_users": cfg.intended_users,
        "use_cases": cfg.use_cases,
        "aup_additional_requirements": cfg.aup_additional_requirements,
        "aup_details": cfg.aup_details,
    }
    for name, value in values.items():
        got = driver.execute_script(SET_FIELD_JS, name, value)
        if got != value:
            log(f"options field {name}: could not set (got {got!r})")
            sys.exit(2)
    # The mode control is the "DRY RUN" box (stored inverted as live_mode).
    if driver.execute_script(SET_FIELD_JS, "dry_run", True) is not True:
        log("options page has no dry_run checkbox; refusing")
        sys.exit(2)
    if driver.execute_script(SET_FIELD_JS, "step_by_step", step_by_step) is not step_by_step:
        log("options page has no step_by_step checkbox; refusing")
        sys.exit(2)
    # The timing is written on every run so a value from an earlier run
    # never lingers: the defaults (the dry-run end panel waits for a click,
    # so no settle pause is needed to see it).
    timing = driver.execute_script("return Object.assign({}, MGC.TIMING_DEFAULTS)")
    driver.execute_script(SET_FIELD_JS, "timing_json", json.dumps(timing))
    driver.execute_script("document.querySelector('#form button[type=submit]').click()")
    time.sleep(0.8)
    saved = storage(driver, ["settings", "timing"]).get("settings") or {}
    if saved.get("live_mode") is not False:
        log(f"REFUSING TO CONTINUE: saved settings have live_mode={saved.get('live_mode')!r}")
        sys.exit(2)
    if saved.get("step_by_step") is not step_by_step:
        log(f"saved settings have step_by_step={saved.get('step_by_step')!r}, wanted {step_by_step!r}")
        sys.exit(2)
    mismatch = [k for k, v in values.items() if str(saved.get(k, "")) != str(v)]
    if mismatch:
        log(f"saved settings differ from config for: {mismatch}")
        sys.exit(2)
    log(f"options saved: all questionnaire fields set, live_mode=false, step_by_step={str(step_by_step).lower()}, settle_ms={timing['settle_ms']} (verified in chrome.storage)")
    return saved


SET_TEXTAREA_JS = """
const el = document.getElementById(arguments[0]);
Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, arguments[1]);
el.dispatchEvent(new Event('input', {bubbles: true}));
return el.value;
"""


def start_run(driver, ext_id: str, projects: list[str], models: list[str]) -> None:
    driver.get(f"chrome-extension://{ext_id}/popup/popup.html")
    time.sleep(1.0)
    if driver.title != POPUP_TITLE:
        log(f"popup page did not load (title {driver.title!r})")
        sys.exit(2)
    mode = driver.execute_script("return document.getElementById('mode').textContent.trim()")
    if mode != "MODE: DRY RUN":
        log(f"REFUSING TO START: popup banner reads {mode!r}, not 'MODE: DRY RUN'")
        sys.exit(2)
    driver.execute_script(SET_TEXTAREA_JS, "projects", "\n".join(projects))
    ticked = driver.execute_script(
        "const want = new Set(arguments[0]); const seen = [];"
        "for (const cb of document.querySelectorAll('#models input')) { cb.checked = want.has(cb.value); if (cb.checked) seen.push(cb.value); }"
        "return seen;", models)
    listed = set(ticked)
    extra = [m for m in models if m not in listed]
    driver.execute_script(
        "const el = document.getElementById('extra-models');"
        "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, arguments[0]);"
        "el.dispatchEvent(new Event('input', {bubbles: true}));", ", ".join(extra))
    log(f"popup: projects={projects} models ticked={ticked} extra={extra}; clicking Start")
    driver.execute_script("document.getElementById('start').click()")
    time.sleep(1.5)
    err = driver.execute_script("const e = document.getElementById('error'); return e.hidden ? '' : e.textContent")
    if err:
        log(f"popup refused to start: {err}")
        sys.exit(2)
    st = storage(driver, ["running", "queue", "settings"])
    if st.get("running") is not True:
        log(f"run did not start (running={st.get('running')!r})")
        sys.exit(2)
    if (st.get("settings") or {}).get("live_mode") is not False:
        log("REFUSING: live_mode flipped between save and start")
        driver.execute_script("document.getElementById('stop').click()")
        sys.exit(2)
    log(f"run started with {len(st.get('queue') or [])} job(s), mode DRY RUN")


# ------------------------------------------------------------------ polling

def find_worker_handle(driver, known: set[str]) -> str | None:
    """The handle of the tab showing the console (the extension's worker tab)."""
    for h in driver.window_handles:
        if h in known:
            continue
        try:
            driver.switch_to.window(h)
            if driver.current_url.startswith("https://console.cloud.google.com/") or driver.current_url.startswith("https://accounts.google.com/"):
                return h
        except WebDriverException:
            continue
    return None


PANEL_JS = """
const p = document.getElementById('mgc-panel'); if (!p) return null;
const b = p.querySelector('button[data-action="' + arguments[0] + '"]');
return { title: (p.querySelector('.mgc-panel-title') || {}).textContent || '', buttons: Array.from(p.querySelectorAll('button')).map((x) => x.textContent), hasButton: !!b && !b.disabled };
"""

# The panel button this script presses per awaited step, with the screenshot
# suffix: Continue before Next, Next job on the dry-run end panel. Nothing
# for "agree": a dry run never asks, and being asked means the mode is wrong.
PANEL_ACTIONS = {"next": ("continue", "panel-before-next"), "next-job": ("next-job", "panel-dry-run-end")}


def click_panel(driver, worker: str | None, out_dir: Path, tag: str, action: str, shot: str) -> bool:
    """Click a step-by-step panel button in the worker tab with a real (trusted) Selenium click."""
    if not worker:
        return False
    driver.switch_to.window(worker)
    panel = driver.execute_script(PANEL_JS, action)
    if not panel or not panel.get("hasButton"):
        return False
    (out_dir / f"{tag}-{shot}.png").write_bytes(driver.get_screenshot_as_png())
    log(f"{tag}: confirmation panel {panel['title']!r} with buttons {panel['buttons']}; clicking {action!r} (Selenium click: trusted event)")
    driver.find_element("css selector", f'#mgc-panel button[data-action="{action}"]').click()
    return True


def watch_run(driver, reader_handle: str, own_handles: set[str], out_dir: Path, timeout_s: float, step_by_step: bool) -> dict:
    """Poll storage from the reader tab, screenshot the worker tab, until the run ends."""
    deadline = time.monotonic() + timeout_s
    own = set(own_handles) | {reader_handle}
    worker: str | None = None
    last_phase: dict[int, str] = {}
    last_shot: dict[int, bytes] = {}
    finished: set[int] = set()
    continued: set[tuple] = set()
    final: dict = {}
    while time.monotonic() < deadline:
        t_iter = time.monotonic()
        driver.switch_to.window(reader_handle)
        st = storage(driver)
        t_read = time.monotonic() - t_iter
        queue = st.get("queue") or []
        current = st.get("current") or {}
        running = st.get("running") is True
        final = st
        if worker is None or worker not in driver.window_handles:
            worker = find_worker_handle(driver, own)
        # Step-by-step: the job waits for Continue before Next and for Next
        # job on the dry-run end panel; this script presses each once per
        # job. Before Agree it never presses anything: a dry run cannot ask
        # for it, so being asked means the mode is wrong.
        if running and current.get("phase") == "awaiting_confirmation":
            idx = current.get("jobIndex")
            job = queue[idx] if isinstance(idx, int) and idx < len(queue) else {}
            tag = f"job{idx + 1}-{job.get('projectId')}-{job.get('modelSlug')}" if job else "job?"
            awaiting = current.get("awaiting")
            if awaiting in PANEL_ACTIONS:
                action, shot = PANEL_ACTIONS[awaiting]
                key = (idx, awaiting)
                if key not in continued and click_panel(driver, worker, out_dir, tag, action, shot):
                    continued.add(key)
            else:
                log(f"REFUSING: the extension asks for confirmation before {current.get('awaiting')!r} in what should be a dry run; sending Stop")
                driver.switch_to.window(reader_handle)
                driver.get(f"chrome-extension://{unpacked_extension_id(EXTENSION_DIR)}/popup/popup.html")
                time.sleep(1.0)
                driver.execute_script("document.getElementById('stop').click()")
                time.sleep(1.5)
                return storage(driver)
        # A screenshot blocks until the tab has painted, which during a cold
        # console load can take 15-30 s; slow iterations are logged so the
        # gap between a result and its screenshot can be explained.
        t_shot = time.monotonic()
        if worker:
            try:
                driver.switch_to.window(worker)
                png = driver.get_screenshot_as_png()
            except WebDriverException:
                png = b""
        else:
            png = b""
        t_shot = time.monotonic() - t_shot
        if t_read + t_shot > 3.0:
            log(f"slow poll iteration: storage read {t_read:.1f}s, screenshot {t_shot:.1f}s")
        for i, job in enumerate(queue):
            tag = f"job{i + 1}-{job['projectId']}-{job['modelSlug']}"
            status = job.get("status")
            phase = job.get("phase") or ""
            if status == "running":
                if png:
                    last_shot[i] = png
                if phase and last_phase.get(i) != phase:
                    last_phase[i] = phase
                    if png:
                        (out_dir / f"{tag}-phase-{phase}.png").write_bytes(png)
                    log(f"{tag}: phase {phase}")
            if status in TERMINAL and i not in finished:
                finished.add(i)
                if last_shot.get(i):
                    (out_dir / f"{tag}-final.png").write_bytes(last_shot[i])
                if png:
                    (out_dir / f"{tag}-after.png").write_bytes(png)
                log(f"{tag}: {status} - {job.get('message', '')}")
        if not running and (queue and all(j.get("status") in TERMINAL for j in queue) or st.get("run", {}) and st["run"].get("finishedAt")):
            break
        time.sleep(1.0)
    else:
        log(f"timeout after {timeout_s:.0f}s; sending Stop")
        driver.switch_to.window(reader_handle)
        driver.get(f"chrome-extension://{unpacked_extension_id(EXTENSION_DIR)}/popup/popup.html")
        time.sleep(1.0)
        driver.execute_script("document.getElementById('stop').click()")
        time.sleep(1.5)
        final = storage(driver)
    return final


def write_evidence(out_dir: Path, st: dict) -> list[str]:
    lines = []
    for entry in st.get("log") or []:
        t = datetime.fromtimestamp(entry.get("t", 0) / 1000).strftime("%H:%M:%S")
        lines.append(f"{t} [{entry.get('level')}] {entry.get('src')}: {entry.get('msg')}")
    (out_dir / "extension-log.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / "results.json").write_text(json.dumps({"queue": st.get("queue"), "run": st.get("run")}, indent=2) + "\n", encoding="utf-8")
    return lines


STEP_LOG_MARKS = (
    "confirmation panel shown before Next: Continue / Stop",
    "Continue clicked (trusted); proceeding with Next",
    "confirmation panel shown before Next job: Next job / Stop",
    "Next job clicked (trusted); the job ends dry-run",
)


def check_step_log(lines: list[str], run_id: str | None) -> bool:
    """With --step-by-step: the run's log must carry the panel and Continue lines."""
    start = next((i for i, l in enumerate(lines) if run_id and f"run {run_id} started" in l), 0)
    run_lines = lines[start:]
    ok = True
    print()
    for mark in STEP_LOG_MARKS:
        hits = [l for l in run_lines if mark in l]
        print(f"{'PASS' if hits else 'FAIL'} log line {mark!r}: {len(hits)} hit(s)")
        for l in hits:
            print(f"     {l}")
        ok = ok and bool(hits)
    return ok


def set_viewport(driver, width: int, height: int) -> tuple[int, int]:
    """Size the window so the page's viewport (not the outer window) is width x height; returns what it got."""
    driver.set_window_rect(x=0, y=0, width=width, height=height)
    time.sleep(0.3)
    inner_w, inner_h = driver.execute_script("return [window.innerWidth, window.innerHeight]")
    if (inner_w, inner_h) != (width, height):
        driver.set_window_rect(x=0, y=0, width=width + (width - inner_w), height=height + (height - inner_h))
        time.sleep(0.3)
        inner_w, inner_h = driver.execute_script("return [window.innerWidth, window.innerHeight]")
    return inner_w, inner_h


def screenshot_pages(driver, ext_id: str, out_dir: Path) -> list[Path]:
    """The popup page at the popup's viewport size, in a tab, and the options page, for the theme and layout."""
    shots = []
    for w, h in POPUP_SHOTS:
        driver.get(f"chrome-extension://{ext_id}/popup/popup.html")
        got = set_viewport(driver, w, h)
        time.sleep(1.2)
        f = out_dir / f"popup-{w}x{h}.png"
        driver.save_screenshot(str(f))
        log(f"popup screenshot at a {got[0]} x {got[1]} viewport (wanted {w} x {h}): {f}")
        shots.append(f)
    driver.get(f"chrome-extension://{ext_id}/popup/popup.html?tab=1")
    driver.set_window_rect(x=0, y=0, width=900, height=800)
    time.sleep(1.2)
    f = out_dir / "popup-tab-900x800.png"
    driver.save_screenshot(str(f))
    shots.append(f)
    driver.get(f"chrome-extension://{ext_id}/options/options.html")
    time.sleep(1.2)
    f = out_dir / "options-900x800.png"
    driver.save_screenshot(str(f))
    shots.append(f)
    return shots


def collect_console(driver, ext_id: str, out_dir: Path) -> bool:
    """Drain the browser console log of every open page (worker tab, popup page, options page).

    SEVERE entries whose source is one of the extension's own scripts or
    pages (a chrome-extension://<id>/ URL in the entry's message, which
    chromedriver prefixes with the source URL) fail the run and are
    printed; SEVERE entries from console.cloud.google.com itself (the
    console's own CSP reports, failed requests and the like) are reported
    but do not fail. The log is per session, not per window, so the window
    an entry is drained from says nothing about where it came from: only
    the message attributes it. Every entry lands in console-log.txt.
    """
    control_marker = "mgc-dryrun-console-control"
    entries: list[dict] = []
    for h in list(driver.window_handles):
        try:
            driver.switch_to.window(h)
            # A zero must be a live zero: a console.error marker written into
            # the page must come back as a SEVERE entry, or the channel is dead.
            driver.execute_script("console.error(arguments[0])", control_marker)
            entries.extend(dict(e) for e in driver.get_log("browser"))
        except WebDriverException as exc:
            log(f"console log of a window could not be read: {str(exc)[:120]}")
    control = [e for e in entries if control_marker in str(e.get("message")) and e.get("level") == "SEVERE"]
    entries = [e for e in entries if control_marker not in str(e.get("message"))]
    marker = f"chrome-extension://{ext_id}/"
    lines = [f"{e.get('level')}\t{e.get('source')}\t{e.get('message')}" for e in entries]
    (out_dir / "console-log.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    severe = [e for e in entries if e.get("level") == "SEVERE"]
    ours = [e for e in severe if marker in str(e.get("message", ""))]
    theirs = [e for e in severe if e not in ours]
    print()
    print(f"browser console: {len(entries)} entries, {len(severe)} SEVERE ({len(ours)} from the extension's own scripts or pages, {len(theirs)} from the console pages)")
    for e in ours:
        print(f"FAIL SEVERE from the extension: [{e.get('source')}] {e.get('message')}")
    for e in theirs:
        print(f"note SEVERE from the console page (not a failure): [{e.get('source')}] {str(e.get('message'))[:200]}")
    print(f"{'PASS' if control else 'FAIL'} the console log channel is live (the control console.error came back as SEVERE from {len(control)} page(s))")
    print(f"{'PASS' if not ours else 'FAIL'} no SEVERE console entry from the extension's own scripts (details in console-log.txt)")
    return bool(control) and not ours


def parse_expectations(items: list[str], projects: list[str]) -> dict[str, str]:
    """--expect PROJECT=STATUS, STATUS in dry-run | skipped."""
    out: dict[str, str] = {}
    for item in items:
        project, _, status = item.partition("=")
        if status not in EXPECTED_MESSAGE or project not in projects:
            log(f"bad --expect {item!r}: use PROJECT=dry-run or PROJECT=skipped for a project in --projects")
            sys.exit(2)
        out[project] = status
    return out


def evaluate(queue: list[dict], expectations: dict[str, str]) -> bool:
    """Every job must end dry-run or skipped (never done/unverified); pinned projects must match."""
    ok = True
    print()
    print("job  project                          model              status      message")
    for i, j in enumerate(queue):
        print(f"{i + 1:<4} {j['projectId']:<32} {j['modelSlug']:<18} {j.get('status', ''):<11} {j.get('message', '')}")
    print()
    for j in queue:
        project = j["projectId"]
        status = j.get("status")
        message = j.get("message") or ""
        want = expectations.get(project)
        if want:
            good = status == want and EXPECTED_MESSAGE[want] in message
            wanted = f"status {want!r} with {EXPECTED_MESSAGE[want]!r} in the message"
        else:
            good = status in EXPECTED_MESSAGE and EXPECTED_MESSAGE[status] in message
            wanted = "status 'dry-run' or 'skipped'"
        ok = ok and good
        print(f"{'PASS' if good else 'FAIL'} {project}/{j['modelSlug']}: expected {wanted}; got {status!r} - {message!r}")
    return ok


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--projects", required=True, help="comma-separated project ids")
    ap.add_argument("--models", default=",".join(DEFAULT_MODELS), help="comma-separated model slugs (default: %(default)s)")
    ap.add_argument("--expect", action="append", default=[], metavar="PROJECT=STATUS",
                    help="pin the expected status (dry-run or skipped) of a project; repeatable")
    ap.add_argument("--chrome-major", default=None, help="Chrome for Testing major version for attempt (b) (default: the installed Chrome's)")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE_DIR), help="Chrome user-data-dir")
    ap.add_argument("--config", default=None, help="path to config.local.json")
    ap.add_argument("--attempts", default="ab", help="browser attempts to try, in order (default: ab)")
    ap.add_argument("--timeout-min", type=float, default=8.0, help="max minutes to wait for the run (default: %(default)s)")
    ap.add_argument("--out", default=None, help="evidence directory (default: python/recon/ext-<timestamp>/)")
    ap.add_argument("--step-by-step", action="store_true", help="tick the extension's step-by-step box; this script clicks Continue before Next and Next job on the dry-run end panel")
    args = ap.parse_args()

    cfg = load_config(args.config)
    projects = [p.strip() for p in args.projects.split(",") if p.strip()]
    models = [m.strip() for m in args.models.split(",") if m.strip()]
    if not projects:
        log("--projects is empty")
        return 2
    expectations = parse_expectations(args.expect, projects)
    ext_id = unpacked_extension_id(EXTENSION_DIR)
    out_dir = Path(args.out) if args.out else RECON_DIR / f"ext-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    out_dir.mkdir(parents=True, exist_ok=True)
    log(f"extension {EXTENSION_DIR} id {ext_id}; evidence in {out_dir}")

    driver, attempt = start_browser(args.profile, ext_id, args.attempts, args.chrome_major)
    try:
        log(f"browser attempt ({attempt}) is in use: {driver.capabilities.get('browserVersion')}")
        check_worker_fresh(driver, ext_id)
        if not check_signed_in(driver):
            log("attempt (c): the profile is signed out; sign in with python/scripts/login.py and rerun. Stopping.")
            driver.save_screenshot(str(out_dir / "signed-out.png"))
            return 3
        # Reader window: the options page stays the active tab of its own
        # window and is used for every storage read, so the worker tab (which
        # the extension opens in the popup's window) is never backgrounded.
        fill_options(driver, ext_id, cfg, args.step_by_step)
        reader = driver.current_window_handle
        driver.set_window_rect(x=1420, y=0, width=1100, height=WINDOW[1])
        driver.switch_to.new_window("window")
        driver.set_window_rect(x=0, y=0, width=WINDOW[0], height=WINDOW[1])
        start_run(driver, ext_id, projects, models)
        popup = driver.current_window_handle
        driver.switch_to.window(reader)
        driver.get(f"chrome-extension://{ext_id}/options/options.html")
        st = watch_run(driver, reader, {popup}, out_dir, args.timeout_min * 60, args.step_by_step)
        lines = write_evidence(out_dir, st)
        run = st.get("run") or {}
        log(f"run {run.get('runId')!r} finished: {run.get('reason')!r} (mode snapshot live={run.get('live')!r})")
        ok = evaluate(st.get("queue") or [], expectations)
        if args.step_by_step:
            ok = check_step_log(lines, run.get("runId")) and ok
        driver.switch_to.window(popup)
        for shot in screenshot_pages(driver, ext_id, out_dir):
            log(f"screenshot {shot}")
        # After the popup and options pages were loaded too: the console log
        # of every open page, failing on SEVERE entries from the extension.
        ok = collect_console(driver, ext_id, out_dir) and ok
        print()
        print(f"evidence: {out_dir}")
        for p in sorted(out_dir.iterdir()):
            print(f"  {p}")
        return 0 if ok else 1
    finally:
        try:
            driver.quit()
        except WebDriverException:
            pass
        log("browser closed")


if __name__ == "__main__":
    sys.exit(main())
