"""The Model Garden "Enable" flow as reusable step functions.

Shared by scripts/recon.py and scripts/gallery_recon.py so that both drivers
run the same steps and produce the same dump names. Each step dumps a
snapshot named after itself under the run directory and records its timing
in TIMING (written to <run>/timing.json by the caller).

Steps and their dump names:
  01-model-page         open the model page, find the "Enable" button
  02-after-enable       click Enable, wait for the questionnaire
  03-form-filled        fill the questionnaire from config.local.json
  04-agreements         click Next, wait for the "Purchase summary" page
  05-agreements-checked tick the terms checkbox
  06-after-agree        (approved runs only) dumped right after Agree was clicked
  07-post-agree-settled (approved runs only) confirmation / redirect / error settled
  08-model-page-after   (approved runs only) the model page reopened
  NN-<step>-api-dialog  the "Enable APIs" dialog, if it was open on that page

Nothing here clicks Agree except step_agree_approved, which exists for the
explicit opt-in (--i-approve-agree) and calls form.click_agree_approved.
"""
from __future__ import annotations

import time
from pathlib import Path

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By

from . import form
from .recon import snapshot
from .urls import is_login_page

ENABLE_WAIT_S = 60
PAGE_WAIT_S = 60
LOOK_SECONDS = 20
POST_AGREE_WAIT_S = 120
API_DIALOG_TITLE = "Enable APIs"
API_DIALOG_WAIT_S = 120

TIMING: dict[str, object] = {}
NAV_MARKER_JS = "window.__mgclick_marker = arguments[0];"
NAV_MARKER_READ_JS = "return window.__mgclick_marker || null;"


def mark_document(driver, token: str) -> None:
    """Plant a marker on window; it survives an in-app route change, not a reload."""
    driver.execute_script(NAV_MARKER_JS, token)


def document_reloaded(driver, token: str) -> bool:
    try:
        return driver.execute_script(NAV_MARKER_READ_JS) != token
    except Exception:  # noqa: BLE001 - mid-navigation
        return True


def record(step: str, **fields) -> None:
    TIMING[step] = fields
    print(f"[timing] {step}: " + ", ".join(f"{k}={v}" for k, v in fields.items()))


class StepFailed(Exception):
    def __init__(self, step: str, cause: BaseException):
        super().__init__(f"step {step!r} failed: {cause!r}")
        self.step = step
        self.cause = cause


def handle_api_dialog(driver, run_dir: Path, step: str, reload_once: bool = True) -> bool:
    """If the "Enable APIs" dialog is open, dump it, click ITS Enable, wait it out.

    The dialog (<mat-dialog-container> with <h1>Enable APIs</h1>, body text
    "The Agent Platform API must be enabled to use this page.") can sit on top
    of any of the three pages when the project has no Agent Platform API yet.
    Returns True if a dialog was handled. If it reappears after enabling, the
    page is reloaded once and the check repeats.
    """
    dlg = form.find_dialog(driver, API_DIALOG_TITLE)
    if dlg is None:
        return False
    print(f"[dialog] '{API_DIALOG_TITLE}' dialog open on {step}: {form.element_text(dlg)[:160]!r}")
    snapshot(driver, run_dir, f"{step}-api-dialog")
    t0 = time.monotonic()
    # "Enable" here is the dialog's own button (scoped with within=); it is not Agree.
    form.click_button(driver, "Enable", timeout=10, within=form.dialog_xpath(API_DIALOG_TITLE))
    deadline = time.monotonic() + API_DIALOG_WAIT_S
    last_text = ""
    while time.monotonic() < deadline:
        dlg = form.find_dialog(driver, API_DIALOG_TITLE)
        if dlg is None:
            break
        try:
            t = form.element_text(dlg)
        except Exception:  # noqa: BLE001
            t = ""
        if t != last_text:
            print(f"[dialog] still open: {t[:160]!r}")
            last_text = t
        time.sleep(1.0)
    else:
        raise TimeoutException(f"'{API_DIALOG_TITLE}' dialog did not close within {API_DIALOG_WAIT_S}s")
    record(f"{step}-api-dialog", closed_after_s=round(time.monotonic() - t0, 1), url=driver.current_url)
    time.sleep(2.0)
    if form.find_dialog(driver, API_DIALOG_TITLE) is not None:
        if not reload_once:
            raise TimeoutException(f"'{API_DIALOG_TITLE}' dialog came back after reload")
        print("[dialog] dialog reappeared after enabling; reloading the page once")
        driver.refresh()
        time.sleep(5.0)
        handle_api_dialog(driver, run_dir, step + "-reloaded", reload_once=False)
    snapshot(driver, run_dir, f"{step}-api-dialog-closed")
    return True


def model_enabled_state(driver) -> bool:
    """The post-purchase model page: "Open in Agent Studio" replaces "Enable"."""
    return (form.find_button_by_text(driver, "Open in Agent Studio", exact=True) is not None
            or form.find_button_by_text(driver, "Enabled", exact=True) is not None
            or form.page_text_contains(driver, "already enabled"))


def wait_model_page(driver, run_dir: Path, step: str = "01-model-page", t0: float | None = None) -> str:
    """Wait for the model page already being shown to render; dump it as `step`.

    Return 'enable', 'enabled' or 'login'. `t0` is the monotonic time the
    navigation started (defaults to now), for the render_s measurement.
    """
    t0 = time.monotonic() if t0 is None else t0
    deadline = time.monotonic() + ENABLE_WAIT_S
    while time.monotonic() < deadline:
        cur = driver.current_url
        if is_login_page(cur):
            snapshot(driver, run_dir, step)
            return "login"
        if form.find_button_by_text(driver, "Enable", exact=True) is not None:
            record(step, render_s=round(time.monotonic() - t0, 1), url=cur)
            handle_api_dialog(driver, run_dir, step)
            snapshot(driver, run_dir, step)
            return "enable"
        if model_enabled_state(driver):
            record(step, render_s=round(time.monotonic() - t0, 1), url=cur, state="enabled")
            handle_api_dialog(driver, run_dir, step)
            snapshot(driver, run_dir, step)
            return "enabled"
        time.sleep(1.0)
    snapshot(driver, run_dir, step)
    raise TimeoutException(f"no 'Enable' button within {ENABLE_WAIT_S}s on {driver.current_url}")


def step_open_model_page(driver, url: str, run_dir: Path) -> str:
    """driver.get(url), then wait for the model page. Return 'enable', 'enabled' or 'login'."""
    t0 = time.monotonic()
    driver.get(url)
    return wait_model_page(driver, run_dir, "01-model-page", t0=t0)


def step_click_enable(driver, run_dir: Path) -> None:
    before = driver.current_url
    mark_document(driver, "enable")
    t0 = time.monotonic()
    form.click_button(driver, "Enable", timeout=10)
    form.wait_for_any(driver, [lambda: driver.current_url != before], timeout=PAGE_WAIT_S, what="URL change after Enable")
    t_url = time.monotonic() - t0
    # The questionnaire is rendered when its first labelled input exists.
    try:
        form.wait_for_any(driver, [lambda: _business_name_input_present(driver)], timeout=PAGE_WAIT_S, what="Business name input")
    except TimeoutException:
        print("[warn] questionnaire URL reached but no 'Business name' input found yet; dumping anyway")
    record("02-after-enable", url_change_s=round(t_url, 1), form_ready_s=round(time.monotonic() - t0, 1),
           document_reloaded=document_reloaded(driver, "enable"), url=driver.current_url)
    handle_api_dialog(driver, run_dir, "02-after-enable")
    snapshot(driver, run_dir, "02-after-enable")


def _business_name_input_present(driver) -> bool:
    try:
        form.find_text_input(driver, "Business name")
        return True
    except form.FormError:
        return False


def step_fill_form(driver, cfg, run_dir: Path) -> None:
    form.fill_text(driver, "Business name", cfg.business_name)
    form.fill_text(driver, "Business website", cfg.business_website)
    form.fill_text(driver, "Contact email", cfg.contact_email)
    form.select_option(driver, "headquartered", cfg.headquarters)
    form.select_option(driver, "Industry", cfg.industry)
    form.select_option(driver, "intended users", cfg.intended_users)
    form.fill_text(driver, "intended use cases", cfg.use_cases)
    form.choose_radio(driver, "Yes" if cfg.aup_additional_requirements == "yes" else "No",
                      group_hint="Acceptable Use Policy")
    if cfg.aup_details:
        form.fill_text(driver, "If yes, please describe", cfg.aup_details)
    print("[form] form states: " + str(driver.execute_script(
        "return Array.from(document.querySelectorAll('form[raf-name]')).map(f => f.getAttribute('raf-name') + ': ' + f.className)")))
    snapshot(driver, run_dir, "03-form-filled")


def _agree_button_present(driver) -> bool:
    # Only LOOKS for the button; never clicks it.
    return form.find_button_by_text(driver, "Agree", exact=False) is not None


def step_next_to_agreements(driver, run_dir: Path) -> None:
    before = driver.current_url
    mark_document(driver, "next")
    t0 = time.monotonic()
    form.click_button(driver, "Next", timeout=15)
    which = form.wait_for_any(
        driver,
        [
            lambda: _agree_button_present(driver),
            lambda: form.find_checkboxes(driver) != [],
            lambda: form.page_text_contains(driver, "error"),
        ],
        timeout=PAGE_WAIT_S,
        what="Agreements page (Agree button or a checkbox)",
    )
    time.sleep(1.0)
    record("04-agreements", ready_s=round(time.monotonic() - t0, 1), matched=["agree-button", "checkbox", "error-text"][which],
           url_changed=driver.current_url != before, document_reloaded=document_reloaded(driver, "next"), url=driver.current_url)
    handle_api_dialog(driver, run_dir, "04-agreements")
    snapshot(driver, run_dir, "04-agreements")


def step_check_terms(driver, run_dir: Path) -> None:
    boxes = [b for b in form.find_checkboxes(driver) if b.tag_name.lower() == "mat-checkbox"] or form.find_checkboxes(driver)
    if not boxes:
        print("[warn] no visible checkbox found on the agreements page")
    else:
        if len(boxes) > 1:
            print(f"[warn] {len(boxes)} checkboxes visible; checking the first one only")
        form.ensure_checkbox_checked(driver, boxes[0])
    time.sleep(0.5)
    agree = form.find_button_by_text(driver, "Agree", exact=False)
    print(f"[form] Agree button present={agree is not None} text={form.element_text(agree) if agree else None!r}"
          f" disabled={agree.get_attribute('disabled') if agree else None!r}")
    snapshot(driver, run_dir, "05-agreements-checked")


def _post_agree_state(driver, before_url: str) -> str | None:
    """Return a label for whatever confirmation or error is visible, else None.

    Observed on a project whose billing account does not permit Marketplace
    purchases: the Agree button is replaced by a spinner for ~2 s, then
    <mat-dialog-container role="dialog" aria-label="Error dialog"> opens with
    a "Got it" button. So a dialog wins over "button gone", and the caller
    waits for the state to hold for 3 s.
    """
    if driver.current_url != before_url:
        return "redirect"
    dialogs = [d for d in driver.find_elements(By.CSS_SELECTOR, "mat-dialog-container, [role='dialog']") if form._safe_displayed(d)]
    if dialogs:
        return "dialog:" + form.element_text(dialogs[0])[:120]
    # Only a snackbar with visible text counts; the page always holds empty
    # role="alert" placeholders (monaco-alert) that must not match.
    toasts = [t for t in driver.find_elements(By.CSS_SELECTOR, "mat-snack-bar-container") if form._safe_displayed(t) and form.element_text(t)]
    if toasts:
        return "toast:" + form.element_text(toasts[0])[:120]
    if form.find_button_by_text(driver, "Agree", exact=False) is None:
        return "agree-button-gone"
    return None


def step_agree_approved(driver, run_dir: Path, model_url: str) -> None:
    """Only reached with --i-approve-agree. Clicks Agree once, never retries."""
    before = driver.current_url
    mark_document(driver, "agree")
    t0 = time.monotonic()
    form.click_agree_approved(driver, timeout=10)
    time.sleep(1.0)
    snapshot(driver, run_dir, "06-after-agree")

    state = None
    stable_since = None
    deadline = time.monotonic() + POST_AGREE_WAIT_S
    while time.monotonic() < deadline:
        cur = _post_agree_state(driver, before)
        if cur != state:
            state, stable_since = cur, time.monotonic()
            if cur:
                print(f"[recon] post-Agree state: {cur}")
        if state and time.monotonic() - stable_since >= 3.0:
            break
        time.sleep(1.0)
    t_state = time.monotonic() - t0
    # Let a redirect finish rendering before the dump.
    time.sleep(5.0)
    record("07-post-agree-settled", state=state, settled_s=round(t_state, 1), url_changed=driver.current_url != before,
           document_reloaded=document_reloaded(driver, "agree"), url=driver.current_url)
    snapshot(driver, run_dir, "07-post-agree-settled")

    t0 = time.monotonic()
    driver.get(model_url)
    which = form.wait_for_any(
        driver,
        [
            lambda: model_enabled_state(driver),
            lambda: form.find_button_by_text(driver, "Enable", exact=True) is not None,
        ],
        timeout=PAGE_WAIT_S,
        what="model page after Agree",
    )
    time.sleep(3.0)
    record("08-model-page-after", render_s=round(time.monotonic() - t0, 1),
           matched=["enabled-state", "Enable-button"][which], url=driver.current_url)
    handle_api_dialog(driver, run_dir, "08-model-page-after")
    print("[recon] visible buttons on model page: " + str(driver.execute_script(
        "return Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(t => t && t.length < 40)")))
    snapshot(driver, run_dir, "08-model-page-after")
