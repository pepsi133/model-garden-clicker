#!/usr/bin/env python3
"""Reach a model page THROUGH THE MODEL GARDEN GALLERY, then run the Enable flow.

One browser session. Dumps a snapshot after every step under
python/recon/<timestamp>-gallery-<project>-<model>/:

  00-gallery             the gallery (agent-platform/model-garden) rendered
  01-search              the gallery's own search box typed into, results updated
  02-results             every visible result card recorded (cards.json)
  03-model-page          the card clicked, model page rendered
  02-after-enable ...    the existing flow (mgclick.flow), same dump names as
  05-agreements-checked  scripts/recon.py
  06/07/08-...           only with --i-approve-agree: Agree clicked once,
                         result settled, model page revisited
  99-failure             whatever the page looked like when a step failed

Extra files: 00-gallery/ready.json, 01-search/search-candidates.json,
01-search/search.json (debounce, URL before/after), 02-results/cards.json,
03-model-page/click.json, timing.json.

By default the Agree button is never clicked (mgclick.form.click_button refuses
it). Only --i-approve-agree calls flow.step_agree_approved.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import _bootstrap  # noqa: F401

from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from mgclick import flow, form
from mgclick.browser import make_driver
from mgclick.config import load_config
from mgclick.paths import DEFAULT_PROFILE_DIR, RECON_DIR
from mgclick.recon import snapshot
from mgclick.urls import CONSOLE_BASE, anthropic_model_url, is_login_page

GALLERY_WAIT_S = 90
SEARCH_UPDATE_WAIT_S = 12
SEARCH_ENTER_WAIT_S = 15
STABLE_S = 2.0
CARD_CLICK_WAIT_S = 60


def gallery_url(project: str) -> str:
    return f"{CONSOLE_BASE}/agent-platform/model-garden?project={project}"


# --------------------------------------------------------------- page scripts

# Every visible text-entry control on the page, with enough context to tell
# the gallery's own search box from the console's global top search bar.
SEARCH_CANDIDATES_JS = r"""
const TOPBAR = 'header, [role="banner"], pcc-platform-bar, cfc-platform-bar, pcc-search, cfc-search, cfc-search-input, [class*="platform-bar"], [class*="platformbar"], [class*="PlatformBar"], mat-toolbar';
function txt(el) { return (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' '); }
function vis(el) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
function cssPath(el) {
  const parts = []; let n = el;
  while (n && n.nodeType === 1 && parts.length < 10) {
    let s = n.tagName.toLowerCase();
    if (n.id) { parts.unshift(s + '#' + n.id); break; }
    const sib = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName) : [];
    if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
    parts.unshift(s); n = n.parentElement;
  }
  return parts.join('>');
}
function ancestors(el) {
  const out = []; let n = el.parentElement;
  while (n && out.length < 12) { out.push(n.tagName.toLowerCase() + (n.className && typeof n.className === 'string' ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '')); n = n.parentElement; }
  return out;
}
const out = [];
document.querySelectorAll('input, textarea, [role="searchbox"], [role="combobox"], [contenteditable="true"]').forEach((el, i) => {
  if (!vis(el)) return;
  const r = el.getBoundingClientRect();
  const ff = el.closest('mat-form-field');
  const lab = ff ? (ff.querySelector('mat-label, label') ? txt(ff.querySelector('mat-label, label')) : '') : '';
  const lb = el.getAttribute('aria-labelledby');
  const lbText = lb ? lb.split(/\s+/).map(id => { const n = document.getElementById(id); return n ? txt(n) : ''; }).filter(Boolean).join(' ') : '';
  el.setAttribute('data-mgclick-input', String(i));
  out.push({
    index: i, tag: el.tagName.toLowerCase(), type: el.getAttribute('type') || '', role: el.getAttribute('role') || '',
    id: el.id || '', name: el.getAttribute('name') || '', aria_label: el.getAttribute('aria-label') || '',
    aria_labelledby: lb || '', aria_labelledby_text: lbText, placeholder: el.getAttribute('placeholder') || '',
    field_label: lab, value: el.value || '', classes: (typeof el.className === 'string' ? el.className : '').slice(0, 200),
    in_topbar: !!el.closest(TOPBAR), in_main: !!el.closest('main, [role="main"]'),
    in_dialog: !!el.closest('mat-dialog-container, [role="dialog"], .cdk-overlay-container'),
    rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
    data_test: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || el.getAttribute('track-name') || el.getAttribute('jslog') || '',
    path: cssPath(el), ancestors: ancestors(el),
  });
});
return out;
"""

# Result cards. Three strategies, first one that finds something wins:
#   A  anchors whose href points at a model page (/model-garden/<slug>; the
#      action bar's /model-garden/locations/... link and the questionnaire are excluded)
#   B  elements whose tag or class says "card", containing some text
#   C  role=link/button elements containing a publisher/model-looking text
# Each card gets data-mgclick-card="<n>" so Python can click it by CSS later.
CARDS_JS = r"""
function txt(el) { return (el && (el.innerText || el.textContent) || '').trim().replace(/\s+/g, ' '); }
function lines(el) { return (el && el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12); }
function vis(el) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
function cssPath(el) {
  const parts = []; let n = el;
  while (n && n.nodeType === 1 && parts.length < 10) {
    let s = n.tagName.toLowerCase();
    if (n.id) { parts.unshift(s + '#' + n.id); break; }
    const sib = n.parentElement ? Array.from(n.parentElement.children).filter(c => c.tagName === n.tagName) : [];
    if (sib.length > 1) s += ':nth-of-type(' + (sib.indexOf(n) + 1) + ')';
    parts.unshift(s); n = n.parentElement;
  }
  return parts.join('>');
}
function outerHead(el) { return el.outerHTML.slice(0, 400); }
function cardOf(el) {
  // climb to the nearest ancestor that looks like a card container
  let n = el;
  for (let i = 0; i < 6 && n; i++) {
    const tag = n.tagName.toLowerCase(); const cls = (typeof n.className === 'string' ? n.className : '').toLowerCase();
    if (/card/.test(tag) || /card/.test(cls) || tag === 'mat-card' || n.getAttribute('role') === 'listitem') return n;
    n = n.parentElement;
  }
  return el;
}
function titleEl(card) {
  const q = card.querySelector('h1,h2,h3,h4,h5,[class*="title"],[class*="Title"],[class*="name"],[class*="headline"],[class*="heading"]');
  return q;
}
function publisherEl(card) {
  const q = card.querySelector('[class*="publisher"],[class*="Publisher"],[class*="owner"],[class*="author"],[class*="provider"],[class*="subtitle"],[class*="caption"]');
  return q;
}
function describe(card, link, strategy, n) {
  card.setAttribute('data-mgclick-card', String(n));
  if (link) link.setAttribute('data-mgclick-link', String(n));
  const t = titleEl(card), p = publisherEl(card);
  const r = card.getBoundingClientRect();
  const href = link ? link.getAttribute('href') : (card.getAttribute('href') || '');
  return {
    n: n, strategy: strategy, tag: card.tagName.toLowerCase(), role: card.getAttribute('role') || '',
    classes: (typeof card.className === 'string' ? card.className : '').slice(0, 200),
    title: t ? txt(t) : '', title_tag: t ? t.tagName.toLowerCase() : '', title_classes: t ? (typeof t.className === 'string' ? t.className : '').slice(0, 120) : '',
    publisher: p ? txt(p) : '', publisher_tag: p ? p.tagName.toLowerCase() : '', publisher_classes: p ? (typeof p.className === 'string' ? p.className : '').slice(0, 120) : '',
    lines: lines(card), text: txt(card).slice(0, 300),
    link_tag: link ? link.tagName.toLowerCase() : '', href: href || '', link_classes: link ? (typeof link.className === 'string' ? link.className : '').slice(0, 120) : '',
    link_text: link ? txt(link).slice(0, 120) : '',
    jslog: card.getAttribute('jslog') || (link ? link.getAttribute('jslog') : '') || '',
    data_test: card.getAttribute('data-test-id') || card.getAttribute('data-testid') || card.getAttribute('track-name') || '',
    rect: {x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)},
    in_viewport: r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth,
    path: cssPath(card), html_head: outerHead(card),
  };
}
const seen = new Set(); const out = []; let n = 0;
// A
document.querySelectorAll('a[href]').forEach(a => {
  const h = a.getAttribute('href') || '';
  if (!/\/model-garden\/[^\/?#]+/.test(h) || /\/model-garden\/(questionnaire|locations)\b/.test(h)) return;
  if (!vis(a)) return;
  const card = cardOf(a);
  if (seen.has(card)) return; seen.add(card);
  out.push(describe(card, a, 'A:anchor-href', n++));
});
if (out.length === 0) {
  // B
  document.querySelectorAll('mat-card, [class*="model-card"], [class*="ModelCard"], [class*="-card"], [class*="card-"], [role="listitem"]').forEach(c => {
    if (!vis(c) || txt(c).length < 3) return;
    if (c.closest('.cdk-overlay-container')) return;
    if (Array.from(seen).some(s => s.contains(c))) return;  // keep outermost
    seen.add(c);
    out.push(describe(c, c.querySelector('a[href]'), 'B:card-class', n++));
  });
}
if (out.length === 0) {
  // C
  document.querySelectorAll('[role="link"], [role="button"], a').forEach(c => {
    if (!vis(c)) return;
    const t = txt(c);
    if (!/claude|anthropic|gemini|llama|gemma|mistral/i.test(t)) return;
    if (c.closest('.cdk-overlay-container, header, [role="banner"], nav')) return;
    if (seen.has(c)) return; seen.add(c);
    out.push(describe(c, c.tagName === 'A' ? c : c.querySelector('a[href]'), 'C:role-text', n++));
  });
}
return out;
"""

GALLERY_READY_JS = r"""
function vis(el) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }
const custom = Array.from(document.querySelectorAll('body *')).map(e => e.tagName.toLowerCase()).filter(t => /model-garden|modelgarden|mg-/.test(t));
return {
  title: document.title,
  h1: Array.from(document.querySelectorAll('h1')).map(h => (h.innerText || '').trim()).filter(Boolean).slice(0, 5),
  model_garden_tags: Array.from(new Set(custom)).slice(0, 40),
  spinners: Array.from(document.querySelectorAll('mat-spinner, mat-progress-spinner, [role="progressbar"], cfc-progress-indicator, .cfc-loading')).filter(vis).length,
  anchors_to_models: Array.from(document.querySelectorAll('a[href]')).filter(a => /\/model-garden\/[^\/?#]+/.test(a.getAttribute('href') || '') && vis(a)).length,
};
"""


# ------------------------------------------------------------------ helpers

def profile_guard(profile: Path) -> None:
    """Abort if a Chrome holds the profile; else remove stale Singleton* symlinks."""
    needle = f"--user-data-dir={profile}"
    try:
        out = subprocess.run(["pgrep", "-af", "chrome"], capture_output=True, text=True, check=False).stdout
    except FileNotFoundError:
        out = ""
    holders = [ln for ln in out.splitlines() if needle in ln and "pgrep" not in ln]
    if holders:
        raise SystemExit(f"a Chrome process already holds {profile}:\n" + "\n".join(holders))
    for p in profile.glob("Singleton*"):
        if p.is_symlink() or p.exists():
            print(f"[profile] removing stale {p.name} (no Chrome holds the profile)")
            p.unlink()


def cards(driver) -> list[dict]:
    return driver.execute_script(CARDS_JS)


def card_signature(cs: list[dict]) -> str:
    return json.dumps([(c["title"], c["href"], c["text"][:60]) for c in cs])


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def wait_stable_cards(driver, hold_s: float, timeout: float) -> list[dict]:
    """Return the card list once it has not changed for hold_s seconds."""
    deadline = time.monotonic() + timeout
    last_sig, since = None, time.monotonic()
    cs = []
    while time.monotonic() < deadline:
        cs = cards(driver)
        sig = card_signature(cs)
        if sig != last_sig:
            last_sig, since = sig, time.monotonic()
        elif time.monotonic() - since >= hold_s:
            return cs
        time.sleep(0.3)
    return cs


# -------------------------------------------------------------------- steps

def step_gallery(driver, project: str, run_dir: Path) -> str:
    """Open the gallery, wait for it to render. Return 'ok' or 'login'."""
    url = gallery_url(project)
    t0 = time.monotonic()
    driver.get(url)
    matched = None
    deadline = time.monotonic() + GALLERY_WAIT_S
    while time.monotonic() < deadline:
        cur = driver.current_url
        if is_login_page(cur):
            snapshot(driver, run_dir, "00-gallery")
            return "login"
        try:
            info = driver.execute_script(GALLERY_READY_JS)
            cands = driver.execute_script(SEARCH_CANDIDATES_JS)
        except Exception:  # noqa: BLE001 - mid-load
            time.sleep(1.0)
            continue
        own_search = [c for c in cands if not c["in_topbar"] and not c["in_dialog"]
                      and re.search(r"search|filter|model", (c["aria_label"] + " " + c["placeholder"] + " " + c["field_label"] + " " + c["aria_labelledby_text"]), re.I)]
        if info["anchors_to_models"] > 0:
            matched = "anchors-to-model-pages"
        elif own_search:
            matched = "own-search-box"
        if matched:
            break
        time.sleep(1.0)
    t_first = time.monotonic() - t0
    if not matched:
        snapshot(driver, run_dir, "00-gallery")
        raise TimeoutException(f"gallery did not render within {GALLERY_WAIT_S}s on {driver.current_url}")
    cs = wait_stable_cards(driver, STABLE_S, 30)
    info = driver.execute_script(GALLERY_READY_JS)
    flow.record("00-gallery", first_ready_s=round(t_first, 1), stable_s=round(time.monotonic() - t0, 1), matched=matched,
                cards=len(cs), url=driver.current_url)
    info.update({"matched": matched, "url": driver.current_url, "first_ready_s": round(t_first, 1)})
    write_json(run_dir / "00-gallery" / "ready.json", info)
    write_json(run_dir / "00-gallery" / "cards.json", cs)
    print(f"[gallery] title={info['title']!r} h1={info['h1']} tags={info['model_garden_tags'][:12]} cards={len(cs)}")
    flow.handle_api_dialog(driver, run_dir, "00-gallery")
    snapshot(driver, run_dir, "00-gallery")
    return "ok"


def pick_search_box(cands: list[dict]) -> dict | None:
    def text(c):
        return " ".join([c["aria_label"], c["placeholder"], c["field_label"], c["aria_labelledby_text"], c["name"], c["id"]]).lower()
    pool = [c for c in cands if not c["in_topbar"] and not c["in_dialog"] and "(/)" not in c["aria_label"]
            and c["type"] not in ("checkbox", "radio", "hidden", "file", "submit", "button")]
    for pat in (r"search.*model|model.*search", r"search", r"filter"):
        for c in pool:
            if re.search(pat, text(c)):
                return c
    pool = [c for c in pool if c["in_main"] or c["rect"]["y"] > 120]
    return pool[0] if pool else None


def step_search(driver, query: str, run_dir: Path) -> list[dict]:
    cands = driver.execute_script(SEARCH_CANDIDATES_JS)
    write_json(run_dir / "01-search" / "search-candidates.json", cands)
    for c in cands:
        print(f"[search] candidate {c['index']}: <{c['tag']} type={c['type']!r} aria-label={c['aria_label']!r} placeholder={c['placeholder']!r}"
              f" label={c['field_label']!r}> topbar={c['in_topbar']} main={c['in_main']} y={c['rect']['y']} path={c['path']}")
    box = pick_search_box(cands)
    if box is None:
        raise form.FormError("no gallery search box found among the visible inputs (see 01-search/search-candidates.json)")
    print(f"[search] using candidate {box['index']}: aria-label={box['aria_label']!r} placeholder={box['placeholder']!r} path={box['path']}")
    el = driver.find_element(By.CSS_SELECTOR, f"[data-mgclick-input='{box['index']}']")
    form.scroll_into_view(driver, el)
    before_cards = cards(driver)
    url_before = driver.current_url
    try:
        el.click()
    except Exception as exc:  # noqa: BLE001 - overlay in the way; focus from script instead
        print(f"[search] click on the box failed ({exc.__class__.__name__}); focusing from script")
    time.sleep(0.3)
    focused = driver.execute_script("return document.activeElement === arguments[0];", el)
    if not focused:
        driver.execute_script("arguments[0].focus();", el)
        time.sleep(0.2)
        focused = driver.execute_script("return document.activeElement === arguments[0];", el)
    if not focused:
        raise form.FormError("search box did not take focus; refusing to type into the page (global shortcuts)")
    if "/" in query:
        raise form.FormError("query contains '/', which the console binds as a global shortcut")
    # Real keystrokes into the focused box, so whatever listener the gallery
    # uses (input / keyup / valueChanges) fires the way it does for a human.
    el.send_keys(query)
    t_typed = time.monotonic()
    readback = el.get_attribute("value")
    print(f"[search] typed {query!r}; readback {readback!r}")

    before_sig = card_signature(before_cards)
    first_change = None
    deadline = time.monotonic() + SEARCH_UPDATE_WAIT_S
    while time.monotonic() < deadline:
        if card_signature(cards(driver)) != before_sig:
            first_change = time.monotonic() - t_typed
            break
        time.sleep(0.2)
    pressed_enter = False
    if first_change is None:
        print(f"[search] cards unchanged {SEARCH_UPDATE_WAIT_S}s after typing; pressing Enter in the search box")
        if driver.execute_script("return document.activeElement === arguments[0];", el):
            el.send_keys(Keys.ENTER)
            pressed_enter = True
            t_typed = time.monotonic()
            deadline = time.monotonic() + SEARCH_ENTER_WAIT_S
            while time.monotonic() < deadline:
                if card_signature(cards(driver)) != before_sig:
                    first_change = time.monotonic() - t_typed
                    break
                time.sleep(0.2)
    after_cards = wait_stable_cards(driver, STABLE_S, 20)
    t_stable = time.monotonic() - t_typed
    url_after = driver.current_url
    result = {
        "query": query, "readback": readback, "box": box,
        "cards_before": len(before_cards), "cards_after": len(after_cards),
        "first_change_after_last_key_s": None if first_change is None else round(first_change, 2),
        "stable_after_last_key_s": round(t_stable, 2),
        "pressed_enter": pressed_enter,
        "url_before": url_before, "url_after": url_after, "url_changed": url_before != url_after,
        "page_state_before": _page_state(url_before), "page_state_after": _page_state(url_after),
    }
    write_json(run_dir / "01-search" / "search.json", result)
    flow.record("01-search", first_change_s=result["first_change_after_last_key_s"], stable_s=result["stable_after_last_key_s"],
                cards_before=len(before_cards), cards_after=len(after_cards), url_changed=result["url_changed"], pressed_enter=pressed_enter,
                url=url_after)
    snapshot(driver, run_dir, "01-search")
    return after_cards


def _page_state(url: str) -> str | None:
    m = re.search(r"[?&]pageState=([^&#]*)", url)
    return m.group(1) if m else None


def step_results(driver, run_dir: Path) -> list[dict]:
    cs = cards(driver)
    write_json(run_dir / "02-results" / "cards.json", cs)
    print(f"[results] {len(cs)} card(s):")
    for c in cs:
        print(f"  [{c['n']}] {c['strategy']} <{c['tag']}> title={c['title']!r} publisher={c['publisher']!r} href={c['href']!r} "
              f"lines={c['lines'][:4]} viewport={c['in_viewport']}")
    flow.record("02-results", cards=len(cs), url=driver.current_url)
    snapshot(driver, run_dir, "02-results")
    return cs


def pick_card(cs: list[dict], title: str, slug: str) -> tuple[dict | None, str]:
    for c in cs:
        if c["title"].strip() == title:
            return c, "exact-title"
    for c in cs:
        if c["lines"] and c["lines"][0].strip() == title:
            return c, "exact-first-line"
    for c in cs:
        if re.search(rf"/model-garden/{re.escape(slug)}(?:[?#]|$)", c["href"] or ""):
            return c, "href-slug"
    for c in cs:
        if title.lower() in (c["text"] or "").lower():
            return c, "text-contains-title"
    return None, "none"


def step_click_card(driver, cs: list[dict], title: str, slug: str, run_dir: Path) -> str:
    card, how = pick_card(cs, title, slug)
    if card is None:
        raise form.FormError(f"no card for {title!r} / slug {slug!r} among {[c['title'] or c['lines'][:1] for c in cs]}")
    if how != "exact-title":
        print(f"[click] NOTE: card chosen by {how}; its title text is {card['title']!r}, lines {card['lines'][:3]}")
    # Click the link element if the card has one, else the card itself.
    sel = f"[data-mgclick-link='{card['n']}']" if card["link_tag"] else f"[data-mgclick-card='{card['n']}']"
    el = driver.find_element(By.CSS_SELECTOR, sel)
    print(f"[click] clicking {sel} <{el.tag_name}> text={form.element_text(el)[:80]!r} href={card['href']!r} (chosen by {how})")
    before = driver.current_url
    flow.mark_document(driver, "card")
    t0 = time.monotonic()
    form.safe_click(driver, el)
    form.wait_for_any(driver, [lambda: driver.current_url != before], timeout=CARD_CLICK_WAIT_S, what="URL change after card click")
    t_url = time.monotonic() - t0
    # Let any redirect settle.
    time.sleep(1.0)
    cur = driver.current_url
    path = re.sub(r"[?#].*$", "", cur)
    url_ok = path.endswith(f"/model-garden/{slug}")
    reloaded = flow.document_reloaded(driver, "card")
    info = {"chosen_by": how, "card": card, "clicked_selector": sel, "url_before": before, "url_after": cur,
            "url_change_s": round(t_url, 1), "url_ends_with_slug": url_ok, "document_reloaded": reloaded,
            "window_handles": len(driver.window_handles)}
    write_json(run_dir / "03-model-page" / "click.json", info)
    print(f"[click] URL after {t_url:.1f}s: {cur}  ends-with-/model-garden/{slug}={url_ok} reloaded={reloaded} tabs={len(driver.window_handles)}")
    if len(driver.window_handles) > 1:
        print("[click] WARNING: the click opened a new tab; switching to the last one")
        driver.switch_to.window(driver.window_handles[-1])
        cur = driver.current_url
        path = re.sub(r"[?#].*$", "", cur)
        url_ok = path.endswith(f"/model-garden/{slug}")
    if not url_ok:
        snapshot(driver, run_dir, "03-model-page")
        raise form.FormError(f"URL after card click does not end with /model-garden/{slug}: {cur}")
    state = flow.wait_model_page(driver, run_dir, "03-model-page", t0=t0)
    flow.TIMING["03-model-page"].update({"url_change_s": round(t_url, 1), "document_reloaded": reloaded, "chosen_by": how})
    return state


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="GCP project id")
    ap.add_argument("--model", default="claude-sonnet-5", help="model slug the card link must end with (default: %(default)s)")
    ap.add_argument("--title", default="Claude Sonnet 5", help="exact card title to click (default: %(default)r)")
    ap.add_argument("--query", default="claude sonnet 5", help="text typed into the gallery search box (default: %(default)r)")
    ap.add_argument("--out", default=None, help="run directory (default: python/recon/<ts>-gallery-<project>-<model>/)")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE_DIR), help="Chrome user-data-dir")
    ap.add_argument("--config", default=None, help="path to config.local.json")
    ap.add_argument("--i-approve-agree", action="store_true",
                    help="EXPLICIT OPT-IN: after 05, click Agree once and record steps 06-08. Default: never.")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = Path(args.out) if args.out else RECON_DIR / f"{ts}-gallery-{args.project}-{args.model}"
    run_dir.mkdir(parents=True, exist_ok=True)
    model_url = anthropic_model_url(args.project, args.model)
    profile = Path(args.profile).resolve()
    print(f"[recon] run dir: {run_dir}")
    print(f"[recon] gallery: {gallery_url(args.project)}")
    print(f"[recon] expected model page: {model_url}")
    print(f"[recon] DISPLAY={os.environ.get('DISPLAY')!r}")
    profile_guard(profile)

    driver = make_driver(profile, headless=False)
    current_step = "00-gallery"
    try:
        try:
            if step_gallery(driver, args.project, run_dir) == "login":
                print("not logged in, run scripts/login.py")
                return 3

            current_step = "01-search"
            cs = step_search(driver, args.query, run_dir)

            current_step = "02-results"
            cs = step_results(driver, run_dir)

            current_step = "03-model-page"
            state = step_click_card(driver, cs, args.title, args.model, run_dir)
            if state == "login":
                print("not logged in, run scripts/login.py")
                return 3
            if state == "enabled":
                print("Model appears to be ALREADY ENABLED ('Open in Agent Studio' replaces 'Enable'). Nothing to do.")
                return 0

            current_step = "02-after-enable"
            flow.step_click_enable(driver, run_dir)

            current_step = "03-form-filled"
            flow.step_fill_form(driver, cfg, run_dir)

            current_step = "04-agreements"
            flow.step_next_to_agreements(driver, run_dir)

            current_step = "05-agreements-checked"
            flow.step_check_terms(driver, run_dir)

            if args.i_approve_agree:
                current_step = "06-after-agree"
                flow.step_agree_approved(driver, run_dir, model_url)
        except Exception as exc:  # noqa: BLE001
            print(f"[recon] FAILED at step {current_step}: {exc!r}")
            try:
                snapshot(driver, run_dir, "99-failure")
            except Exception as dump_exc:  # noqa: BLE001
                print(f"[recon] could not dump failure page: {dump_exc!r}")
            return 1

        print()
        print("=" * 72)
        if args.i_approve_agree:
            print("AGREE WAS CLICKED BECAUSE --i-approve-agree WAS GIVEN. SEE 06/07/08 DUMPS.")
        else:
            print("THE AGREE BUTTON WAS NOT CLICKED. THE MODEL HAS NOT BEEN ENABLED.")
        print("REVIEW THE PAGE IN THE BROWSER; IT CLOSES IN %d SECONDS." % flow.LOOK_SECONDS)
        print("=" * 72)
        time.sleep(flow.LOOK_SECONDS)
        return 0
    finally:
        (run_dir / "timing.json").write_text(json.dumps(flow.TIMING, indent=2) + "\n", encoding="utf-8")
        driver.quit()
        print(f"[recon] done; dumps in {run_dir}")


if __name__ == "__main__":
    sys.exit(main())
