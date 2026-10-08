"""Dump the current page state into a run directory for later selector work."""
from __future__ import annotations

import json
from pathlib import Path

from selenium.webdriver.remote.webdriver import WebDriver

# Runs in the page. Walks document plus everything in the cdk-overlay-container
# (which is part of document.body anyway, but we also descend into open shadow
# roots so overlay content rendered inside web components is not missed).
_COLLECT_JS = r"""
const SEL = 'input, textarea, mat-select, mat-radio-button, mat-checkbox, button, [role=button], [role=combobox], [role=radio], [role=checkbox]';

function txt(el) { return (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' '); }

function fieldLabel(el) {
  const ff = el.closest('mat-form-field');
  if (ff) {
    const ml = ff.querySelector('mat-label');
    if (ml) return txt(ml);
    const lab = ff.querySelector('label');
    if (lab) return txt(lab);
  }
  if (el.id) {
    const lab = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
    if (lab) return txt(lab);
  }
  const wrap = el.closest('label');
  if (wrap) return txt(wrap);
  const lb = el.getAttribute('aria-labelledby');
  if (lb) {
    return lb.split(/\s+/).map(id => { const n = document.getElementById(id); return n ? txt(n) : ''; }).filter(Boolean).join(' ');
  }
  // mat-radio-button / mat-checkbox render their own label
  if (/^MAT-(RADIO-BUTTON|CHECKBOX)$/.test(el.tagName)) {
    const l = el.querySelector('label');
    if (l) return txt(l);
  }
  return '';
}

function groupLabel(el) {
  const grp = el.closest('mat-radio-group, [role=radiogroup], fieldset');
  if (!grp) return '';
  const lb = grp.getAttribute('aria-labelledby');
  if (lb) { const n = document.getElementById(lb); if (n) return txt(n); }
  const al = grp.getAttribute('aria-label'); if (al) return al;
  const leg = grp.querySelector('legend'); if (leg) return txt(leg);
  // Heuristic: nearest preceding block of text
  let p = grp.previousElementSibling;
  while (p && !txt(p)) p = p.previousElementSibling;
  return p ? txt(p).slice(0, 200) : '';
}

function isDisplayed(el) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
}

function selectedText(el) {
  if (el.tagName === 'MAT-SELECT') {
    const v = el.querySelector('.mat-mdc-select-value-text, .mat-select-value-text');
    return v ? txt(v) : '';
  }
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    if (el.type === 'checkbox' || el.type === 'radio') return String(el.checked);
    return el.value;
  }
  return '';
}

function collect(root, out, where) {
  root.querySelectorAll(SEL).forEach(el => {
    out.push({
      where: where,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      id: el.id || '',
      name: el.getAttribute('name') || '',
      aria_label: el.getAttribute('aria-label') || '',
      aria_labelledby: el.getAttribute('aria-labelledby') || '',
      placeholder: el.getAttribute('placeholder') || '',
      text: txt(el).slice(0, 300),
      field_label: fieldLabel(el),
      group_label: groupLabel(el),
      value: selectedText(el),
      checked: el.classList.contains('mat-mdc-checkbox-checked') || el.classList.contains('mat-checkbox-checked')
               || el.classList.contains('mat-mdc-radio-checked') || el.classList.contains('mat-radio-checked')
               || el.getAttribute('aria-checked') === 'true' || (el.checked === true),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      displayed: isDisplayed(el),
      classes: el.className && typeof el.className === 'string' ? el.className.slice(0, 200) : '',
      in_overlay: !!el.closest('.cdk-overlay-container'),
      data_test: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || el.getAttribute('track-name') || '',
      path: cssPath(el),
    });
  });
  root.querySelectorAll('*').forEach(n => { if (n.shadowRoot) collect(n.shadowRoot, out, where + '>shadow(' + n.tagName.toLowerCase() + ')'); });
}

function cssPath(el) {
  const parts = [];
  let n = el;
  while (n && n.nodeType === 1 && parts.length < 8) {
    let s = n.tagName.toLowerCase();
    if (n.id) { parts.unshift(s + '#' + n.id); break; }
    const sib = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName) : [];
    if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
    parts.unshift(s);
    n = n.parentElement;
  }
  return parts.join('>');
}

const out = [];
collect(document, out, 'document');
const overlay = document.querySelector('.cdk-overlay-container');
return {
  title: document.title,
  url: location.href,
  overlay_present: !!overlay,
  overlay_text: overlay ? txt(overlay).slice(0, 2000) : '',
  headings: Array.from(document.querySelectorAll('h1,h2,h3')).map(h => txt(h)).filter(Boolean).slice(0, 50),
  elements: out,
};
"""


def dump_page(driver: WebDriver, out_dir: str | Path, label: str = "") -> Path:
    """Write page.html, screenshot.png, url.txt and forms.json into out_dir."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    url = driver.current_url
    (out / "url.txt").write_text(url + "\n", encoding="utf-8")
    try:
        (out / "page.html").write_text(driver.page_source, encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 - recon must be best-effort
        (out / "page.html.error").write_text(repr(exc), encoding="utf-8")
    try:
        driver.save_screenshot(str(out / "screenshot.png"))
    except Exception as exc:  # noqa: BLE001
        (out / "screenshot.error").write_text(repr(exc), encoding="utf-8")
    try:
        data = driver.execute_script(_COLLECT_JS)
    except Exception as exc:  # noqa: BLE001
        data = {"error": repr(exc), "url": url}
    if label:
        data["label"] = label
    (out / "forms.json").write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return out


def snapshot(driver: WebDriver, run_dir: str | Path, name: str) -> Path:
    """Dump into <run_dir>/<name>/ and print where it went."""
    path = dump_page(driver, Path(run_dir) / name, label=name)
    print(f"[recon] dumped {name} -> {path}  ({driver.current_url})")
    return path
