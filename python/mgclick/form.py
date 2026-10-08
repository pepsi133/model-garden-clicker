"""Angular Material form helpers for the Model Garden questionnaire.

Validated against the live console (see docs/dom-map.md). What the DOM looks like:
  - every control sits in <raf-runtime-form-element raf-name="..."> and inside
    a <mat-form-field> whose <mat-label> holds the visible label text
  - text fields are plain <input matinput> (ids like _0rif_mat-input-3 are generated)
  - the dropdowns are <cfc-select role="combobox"> (a Cloud console wrapper, NOT
    mat-select); clicking its inner .cfc-select-trigger opens a panel in the
    body-level div.cdk-overlay-container holding <mat-option role="option">
    elements. mat-option.textContent is doubled ("CanadaCanada") because of a
    hidden collapsed copy; the visible text (innerText) is clean.
  - the Yes/No radios are <mat-radio-button> inside a <mat-radio-group
    role="radiogroup" aria-labelledby=...> whose label element holds the question
  - the terms checkbox on the Agreements page is a <mat-checkbox>
  - fast synthetic typing loses the first "/" to the console's global "/"
    keyboard shortcut, so text is set with the native value setter plus
    input/change/blur events, the same sequence the extension uses

Safety: no function in this module may click an element whose text contains
"agree" (case-insensitive). click_button() enforces this and raises instead.
"""
from __future__ import annotations

import time

from selenium.common.exceptions import (
    ElementClickInterceptedException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.remote.webelement import WebElement
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

DEFAULT_TIMEOUT = 20

FORBIDDEN_BUTTON_SUBSTRING = "agree"


class FormError(RuntimeError):
    pass


class ForbiddenClick(FormError):
    """Raised when something tries to click a button we must never click."""


# ---------------------------------------------------------------- utilities

def _xp_lower(expr: str) -> str:
    """XPath 1.0 lower-case of an expression (no lower-case() in XPath 1.0)."""
    return f"translate({expr}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')"


def _xp_lit(s: str) -> str:
    """Quote a Python string as an XPath literal."""
    if "'" not in s:
        return f"'{s}'"
    if '"' not in s:
        return f'"{s}"'
    parts = s.split("'")
    return "concat(" + ", \"'\", ".join(f"'{p}'" for p in parts) + ")"


def wait_visible(driver: WebDriver, xpath: str, timeout: float = DEFAULT_TIMEOUT) -> WebElement:
    return WebDriverWait(driver, timeout).until(EC.visibility_of_element_located((By.XPATH, xpath)))


def wait_clickable(driver: WebDriver, xpath: str, timeout: float = DEFAULT_TIMEOUT) -> WebElement:
    return WebDriverWait(driver, timeout).until(EC.element_to_be_clickable((By.XPATH, xpath)))


def scroll_into_view(driver: WebDriver, el: WebElement) -> None:
    driver.execute_script("arguments[0].scrollIntoView({block: 'center', inline: 'nearest'});", el)
    time.sleep(0.2)


def safe_click(driver: WebDriver, el: WebElement) -> None:
    """Scroll, then click; fall back to a JS click if something overlays it."""
    scroll_into_view(driver, el)
    try:
        el.click()
    except ElementClickInterceptedException:
        driver.execute_script("arguments[0].click();", el)


def element_text(el: WebElement) -> str:
    return " ".join((el.text or "").split())


# ------------------------------------------------------------------ buttons

DIALOG_XPATH = "//mat-dialog-container | //*[@role='dialog']"


def find_button_by_text(driver: WebDriver, text: str, exact: bool = True, within: str = "") -> WebElement | None:
    """Find a visible <button> (or role=button) whose stripped text matches.

    Matching is case-insensitive. With exact=False a substring match is used.
    `within` is an XPath prefix (e.g. a dialog) to search under. Without it,
    buttons inside dialogs are skipped: the "Enable APIs" dialog has its own
    "Enable" button, which must not be mistaken for the model's Enable button.
    """
    needle = text.strip().lower()
    xp_text = _xp_lower("normalize-space(.)")
    if exact:
        cond = f"{xp_text}={_xp_lit(needle)}"
    else:
        cond = f"contains({xp_text}, {_xp_lit(needle)})"
    if not within:
        cond += " and not(ancestor::mat-dialog-container) and not(ancestor::*[@role='dialog'])"
    xpath = f"{within}//button[{cond}] | {within}//*[@role='button'][{cond}] | {within}//a[{cond}]"
    for el in driver.find_elements(By.XPATH, xpath):
        try:
            if el.is_displayed():
                return el
        except StaleElementReferenceException:
            continue
    return None


def wait_button(driver: WebDriver, text: str, timeout: float = DEFAULT_TIMEOUT, exact: bool = True, within: str = "") -> WebElement:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        el = find_button_by_text(driver, text, exact=exact, within=within)
        if el is not None:
            return el
        time.sleep(0.5)
    raise TimeoutException(f"no visible button with text {text!r} after {timeout}s")


def click_button(driver: WebDriver, text: str, timeout: float = DEFAULT_TIMEOUT, within: str = "") -> None:
    """Click the visible button whose exact text matches, unless it is forbidden."""
    if FORBIDDEN_BUTTON_SUBSTRING in text.strip().lower():
        raise ForbiddenClick(f"refusing to click a button matching {text!r}")
    el = wait_button(driver, text, timeout=timeout, exact=True, within=within)
    actual = element_text(el).lower()
    if FORBIDDEN_BUTTON_SUBSTRING in actual:
        raise ForbiddenClick(f"refusing to click a button whose text is {actual!r}")
    safe_click(driver, el)


def click_agree_approved(driver: WebDriver, timeout: float = DEFAULT_TIMEOUT) -> WebElement:
    """THE ONLY PATH THAT CLICKS AGREE. Used solely by recon.py --i-approve-agree.

    click_button() keeps refusing "Agree"; this function exists so the one
    approved run is explicit in the code and in the console output.
    """
    el = wait_button(driver, "Agree", timeout=timeout, exact=True)
    print("=" * 72)
    print("[form] CLICKING AGREE NOW (explicitly approved by --i-approve-agree):", repr(element_text(el)))
    print("=" * 72)
    safe_click(driver, el)
    return el


# --------------------------------------------------------------- text input

def _form_field_xpath(label: str) -> str:
    """mat-form-field whose mat-label (or label) contains `label`, case-insensitive."""
    needle = _xp_lit(label.strip().lower())
    return (
        f"//mat-form-field[.//mat-label[contains({_xp_lower('normalize-space(.)')}, {needle})]"
        f" or .//label[contains({_xp_lower('normalize-space(.)')}, {needle})]]"
    )


def find_text_input(driver: WebDriver, label: str) -> WebElement:
    """Return the <input>/<textarea> inside the mat-form-field labelled `label`.

    Falls back to inputs whose aria-label or placeholder contains the label.
    """
    needle = _xp_lit(label.strip().lower())
    candidates = [
        _form_field_xpath(label) + "//input[not(@type='hidden')] | " + _form_field_xpath(label) + "//textarea",
        f"//input[contains({_xp_lower('@aria-label')}, {needle})] | //textarea[contains({_xp_lower('@aria-label')}, {needle})]",
        f"//input[contains({_xp_lower('@placeholder')}, {needle})] | //textarea[contains({_xp_lower('@placeholder')}, {needle})]",
        f"//label[contains({_xp_lower('normalize-space(.)')}, {needle})]/following::input[1]",
    ]
    for xp in candidates:
        for el in driver.find_elements(By.XPATH, xp):
            try:
                if el.is_displayed():
                    return el
            except StaleElementReferenceException:
                continue
    raise FormError(f"no visible text input with label containing {label!r}")


# The event sequence that makes an Angular (reactive forms) input register a
# value set from script. A bare `el.value = x` does not reach the FormControl.
# Observed on the live page: after `input` the mat-form-field flips from
# ng-pristine/ng-invalid to ng-dirty/ng-valid; after `blur` it gains ng-touched.
SET_TEXT_JS = """
const el = arguments[0], value = arguments[1];
el.focus();
const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
el.dispatchEvent(new Event('input', {bubbles: true}));
el.dispatchEvent(new Event('change', {bubbles: true}));
el.blur();
el.dispatchEvent(new Event('blur', {bubbles: true}));
const ff = el.closest('mat-form-field');
return {value: el.value, classes: ff ? ff.className : ''};
"""


def fill_text(driver: WebDriver, label: str, value: str, timeout: float = DEFAULT_TIMEOUT) -> None:
    """Set a text field the way the extension will: native setter + input/change/blur.

    send_keys is deliberately not used: the console binds "/" as a global
    "focus search" shortcut and fast synthetic typing lost the first "/" of
    "https://" (observed: "https:/example.com").
    """
    deadline = time.monotonic() + timeout
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            el = find_text_input(driver, label)
            scroll_into_view(driver, el)
            result = driver.execute_script(SET_TEXT_JS, el, value)
            if result["value"] != value:
                raise FormError(f"value readback mismatch: {result['value']!r}")
            if "ng-invalid" in result["classes"]:
                raise FormError(f"field still ng-invalid after input event: {result['classes']}")
            print(f"[form] text   {label!r} <- {len(value)} chars  ({_ng_state(result['classes'])})")
            return
        except (FormError, StaleElementReferenceException) as exc:
            last = exc
            time.sleep(0.5)
    raise FormError(f"could not fill {label!r}: {last}")


def _ng_state(classes: str) -> str:
    return " ".join(c for c in classes.split() if c.startswith("ng-"))


# --------------------------------------------------------------- mat-select

SELECT_TAGS = "cfc-select | mat-select"


def find_mat_select(driver: WebDriver, label: str) -> WebElement:
    """The <cfc-select> (or <mat-select>) inside the mat-form-field labelled `label`."""
    needle = _xp_lit(label.strip().lower())
    ff = _form_field_xpath(label)
    candidates = [
        f"{ff}//cfc-select | {ff}//mat-select",
        f"//*[@role='combobox'][contains({_xp_lower('@aria-label')}, {needle})]",
    ]
    for xp in candidates:
        for el in driver.find_elements(By.XPATH, xp):
            try:
                if el.is_displayed():
                    return el
            except StaleElementReferenceException:
                continue
    raise FormError(f"no visible mat-select with label containing {label!r}")


def _overlay_options(driver: WebDriver) -> list[WebElement]:
    """Options of the open panel. They live in body > div.cdk-overlay-container."""
    return driver.find_elements(By.XPATH, "//div[contains(@class,'cdk-overlay-container')]//*[@role='option']")


def choose_mat_option(driver: WebDriver, option_text: str, timeout: float = DEFAULT_TIMEOUT) -> None:
    """Click the mat-option in the open overlay whose VISIBLE text matches exactly.

    element_text() uses WebElement.text (innerText), which skips the hidden
    .cfc-select-option-collapsed copy; textContent would read "CanadaCanada".
    """
    want = option_text.strip().lower()
    deadline = time.monotonic() + timeout
    seen: list[str] = []
    while time.monotonic() < deadline:
        opts = _overlay_options(driver)
        seen = []
        for opt in opts:
            try:
                t = element_text(opt)
            except StaleElementReferenceException:
                continue
            seen.append(t)
            if t.lower() == want:
                safe_click(driver, opt)
                return
        time.sleep(0.4)
    raise FormError(f"no mat-option with text {option_text!r}; saw {seen[:40]}")


def select_option(driver: WebDriver, label: str, option_text: str, timeout: float = DEFAULT_TIMEOUT) -> None:
    sel = find_mat_select(driver, label)
    # Click the inner trigger: the floating <label> overlaps the host element's
    # centre and intercepts a click on the host itself.
    trigger = sel.find_elements(By.CSS_SELECTOR, ".cfc-select-trigger, .mat-mdc-select-trigger")
    safe_click(driver, trigger[0] if trigger else sel)
    # The panel opens in div.cdk-overlay-container; the host gets aria-expanded=true.
    WebDriverWait(driver, timeout).until(lambda d: len(_overlay_options(d)) > 0)
    try:
        choose_mat_option(driver, option_text, timeout=timeout)
    except FormError:
        driver.switch_to.active_element.send_keys(Keys.ESCAPE)
        raise
    WebDriverWait(driver, 5).until(lambda d: len([o for o in _overlay_options(d) if o.is_displayed()]) == 0)
    shown = element_text(sel)
    if shown.lower() != option_text.strip().lower():
        raise FormError(f"select {label!r} shows {shown!r} after choosing {option_text!r}")
    print(f"[form] select {label!r} <- {len(option_text)} chars  ({_ng_state(sel.get_attribute('class'))})")


# ---------------------------------------------------------------- mat-radio

def find_radio(driver: WebDriver, label_text: str, group_hint: str | None = None) -> WebElement:
    """mat-radio-button whose own label text equals label_text (case-insensitive).

    If group_hint is given, prefer a radio inside a mat-radio-group whose
    surrounding text contains the hint.
    """
    want = label_text.strip().lower()
    xps = []
    if group_hint:
        h = _xp_lit(group_hint.strip().lower())
        # The group's aria-labelledby points at the element holding the question text.
        xps.append(
            f"//mat-radio-group[@aria-labelledby=//*[contains({_xp_lower('normalize-space(.)')}, {h})]/@id]"
            f"//mat-radio-button[{_xp_lower('normalize-space(.)')}={_xp_lit(want)}]"
        )
        xps.append(
            f"//*[contains({_xp_lower('normalize-space(.)')}, {h})]/following::mat-radio-group[1]"
            f"//mat-radio-button[{_xp_lower('normalize-space(.)')}={_xp_lit(want)}]"
        )
    xps.append(f"//mat-radio-button[{_xp_lower('normalize-space(.)')}={_xp_lit(want)}]")
    xps.append(f"//*[@role='radio'][{_xp_lower('normalize-space(@aria-label)')}={_xp_lit(want)}]")
    xps.append(f"//label[{_xp_lower('normalize-space(.)')}={_xp_lit(want)}]/ancestor::mat-radio-button[1]")
    for xp in xps:
        for el in driver.find_elements(By.XPATH, xp):
            try:
                if el.is_displayed():
                    return el
            except StaleElementReferenceException:
                continue
    raise FormError(f"no visible mat-radio-button labelled {label_text!r}")


def choose_radio(driver: WebDriver, label_text: str, group_hint: str | None = None) -> None:
    el = find_radio(driver, label_text, group_hint=group_hint)
    # Clicking the inner <label> or <input> is more reliable than the host element.
    target = None
    for sub in ("label", "input[type='radio']", ".mdc-radio", ".mat-radio-container"):
        found = el.find_elements(By.CSS_SELECTOR, sub)
        if found:
            target = found[0]
            break
    safe_click(driver, target or el)
    time.sleep(0.2)
    print(f"[form] radio  {label_text!r}  ({_ng_state(el.get_attribute('class'))})")


# ------------------------------------------------------------- mat-checkbox

def find_checkboxes(driver: WebDriver) -> list[WebElement]:
    els = driver.find_elements(By.XPATH, "//mat-checkbox | //input[@type='checkbox'] | //*[@role='checkbox']")
    return [e for e in els if _safe_displayed(e)]


def _safe_displayed(el: WebElement) -> bool:
    try:
        return el.is_displayed()
    except StaleElementReferenceException:
        return False


def is_checkbox_checked(driver: WebDriver, el: WebElement) -> bool:
    return bool(driver.execute_script(
        """
        const el = arguments[0];
        if (el.tagName === 'INPUT') return !!el.checked;
        if (el.getAttribute('aria-checked') === 'true') return true;
        const inp = el.querySelector('input[type=checkbox]');
        if (inp) return !!inp.checked;
        return el.classList.contains('mat-mdc-checkbox-checked') || el.classList.contains('mat-checkbox-checked');
        """,
        el,
    ))


def ensure_checkbox_checked(driver: WebDriver, el: WebElement) -> bool:
    """Check the box if unchecked. Returns True if a click was made."""
    if is_checkbox_checked(driver, el):
        print("[form] checkbox already checked")
        return False
    target = el
    if el.tag_name.lower() == "mat-checkbox":
        for sub in ("input[type='checkbox']", "label", ".mdc-checkbox"):
            found = el.find_elements(By.CSS_SELECTOR, sub)
            if found:
                target = found[0]
                break
    safe_click(driver, target)
    time.sleep(0.3)
    if not is_checkbox_checked(driver, el):
        driver.execute_script("arguments[0].click();", target)
        time.sleep(0.3)
    print(f"[form] checkbox checked={is_checkbox_checked(driver, el)}")
    return True


# ------------------------------------------------------------------ dialogs

def find_dialog(driver: WebDriver, title_substring: str) -> WebElement | None:
    """Visible <mat-dialog-container role="dialog"> whose title (h1/h2) contains the text."""
    needle = _xp_lit(title_substring.strip().lower())
    xpath = (
        f"//mat-dialog-container[.//*[(self::h1 or self::h2)][contains({_xp_lower('normalize-space(.)')}, {needle})]]"
    )
    for el in driver.find_elements(By.XPATH, xpath):
        if _safe_displayed(el):
            return el
    return None


def dialog_xpath(title_substring: str) -> str:
    """XPath prefix for `within=` that scopes a button search to that dialog."""
    needle = _xp_lit(title_substring.strip().lower())
    return f"//mat-dialog-container[.//*[(self::h1 or self::h2)][contains({_xp_lower('normalize-space(.)')}, {needle})]]"


# ------------------------------------------------------------ page waiters

def wait_for_any(driver: WebDriver, predicates, timeout: float, poll: float = 0.5, what: str = "condition"):
    """Poll a list of zero-arg callables; return the index of the first truthy."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        for i, p in enumerate(predicates):
            try:
                if p():
                    return i
            except Exception:  # noqa: BLE001 - keep polling
                pass
        time.sleep(poll)
    raise TimeoutException(f"timed out after {timeout}s waiting for {what}")


def page_text_contains(driver: WebDriver, needle: str) -> bool:
    try:
        body = driver.find_element(By.TAG_NAME, "body").text
    except Exception:  # noqa: BLE001
        return False
    return needle.lower() in body.lower()
