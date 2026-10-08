/*
 * The options page and the popup in jsdom with a fake chrome API:
 *   options: the three dropdown fields are <select>s from option-lists.js
 *   with an "Other" entry that reveals a text input; a stored value outside
 *   the list shows up in "Other"; the saved value is always the plain
 *   option text; the AUP details field is hidden for No and required for
 *   Yes (Save refused without it, ignored for No); typing in the "Other"
 *   input never hides it (only the select does); the advanced timing JSON
 *   is validated on Save with the error shown under the Advanced field,
 *   prototype-named keys are refused like any unknown key, a refused Save
 *   keeps every questionnaire edit in the form, the watchdog rule covers
 *   the model, questionnaire and agreements budgets, "Reset to defaults"
 *   restores the constants; a field whose list is empty stays a text input.
 *   popup: missing settings show a red notice with the field names (and
 *   only then: the box is hidden otherwise), Start is disabled with that
 *   reason; with every setting present Start is enabled; exactly one Options
 *   button, in the header next to the photo and the mode banner (MODE: DRY
 *   RUN / MODE: FULL RUN); popup and tab layouts; the running job's step line
 *   is mirrored into the status and a waiting job says so; the log opens
 *   while a run is active. Theme: the palette variables and their contrast
 *   (text pairs 4.5:1, the focus ring 3:1). Mode control: the DRY RUN box is
 *   stored inverted as live_mode, without a confirm(); step-by-step is a
 *   second box; neither changes during a run; the popup's header toggles
 *   (the MODE banner and the slow mode / kubardy mode button) write the same
 *   settings through the same path and are refused the same way; the options
 *   page's boxes follow a change made in the popup. Manifest: permissions
 *   are storage and alarms only (no "tabs": the install prompt must not
 *   mention browsing history), host access is the console origin only.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const E = require("./lib/env.cjs");
const { ok } = E;
const { JSDOM } = require("jsdom");

const FULL = { business_name: "b", business_website: "https://b.example", contact_email: "a@b.example", headquarters: "Elsewhere", industry: "Education", intended_users: "Internal employees", use_cases: "x", aup_additional_requirements: "no", aup_details: "", live_mode: false };

function fakeChrome(store, extra) {
  const listeners = [];
  return Object.assign({
    storage: {
      local: {
        get: async (keys) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); return o; },
        set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); }
      },
      onChanged: { addListener: (fn) => listeners.push(fn) }
    },
    /** Fire storage.onChanged the way Chrome does after a set: { key: { newValue } }. */
    __fire: (changes) => { for (const fn of listeners) fn(changes, "local"); },
    runtime: { openOptionsPage: () => { store.__opened = (store.__opened || 0) + 1; }, sendMessage: (m, cb) => { (store.__messages = store.__messages || []).push(m); cb(store.__reply ? store.__reply(m) : { ok: true }); }, getURL: (p) => "chrome-extension://x/" + p, lastError: undefined },
    tabs: { create: ({ url }) => { store.__tab = url; } }
  }, extra);
}

/** Load an extension page (html + its scripts) into jsdom with `store` behind chrome.storage.local. */
async function loadPage(rel, store, scripts, query) {
  const html = fs.readFileSync(path.join(E.EXT, rel), "utf8");
  const dom = new JSDOM(html, { url: "chrome-extension://x/" + rel + (query || ""), runScripts: "outside-only", pretendToBeVisual: true });
  const win = dom.window;
  win.chrome = fakeChrome(store);
  win.confirm = () => true;
  win.fetch = async () => ({ json: async () => JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")) });
  const ctx = dom.getInternalVMContext();
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
  await new Promise((r) => setTimeout(r, 30)); // DOMContentLoaded + async load()
  return { dom, win, document: win.document, K: win.MGC, O: win.MGC_OPTIONS };
}

const OPTIONS_SCRIPTS = ["common/constants.js", "common/option-lists.js", "options/options.js"];
const POPUP_SCRIPTS = ["common/constants.js", "popup/popup.js"];
const tick = () => new Promise((r) => setTimeout(r, 30));

async function submit(p) {
  p.document.getElementById("form").dispatchEvent(new p.win.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  const note = p.document.getElementById("saved");
  const adv = p.document.getElementById("timing-error");
  return { text: note.textContent, error: note.className === "error", hidden: note.hidden, timing: adv.hidden ? "" : adv.textContent };
}
/** One keystroke as the browser fires it: an input event, no change event. */
function typeInto(p, name, value) {
  const el = p.document.getElementById("form").elements[name];
  el.value = value;
  el.dispatchEvent(new p.win.Event("input", { bubbles: true }));
}
function setText(p, name, value) {
  const el = p.document.getElementById("form").elements[name];
  el.value = value;
  el.dispatchEvent(new p.win.Event("input", { bubbles: true }));
  el.dispatchEvent(new p.win.Event("change", { bubbles: true }));
}
function setSelect(p, name, value) {
  const el = p.document.getElementById("form").elements[name];
  el.value = value;
  el.dispatchEvent(new p.win.Event("change", { bubbles: true }));
}

(async () => {
  console.log("--- options page: dropdowns from option-lists.js");
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const { document: doc, O, K } = p;
    const form = doc.getElementById("form");
    ok(O.INDUSTRY.length === 16 && O.INTENDED_USERS.length === 3, "option-lists: 16 industries, 3 intended-users options", `${O.INDUSTRY.length}/${O.INTENDED_USERS.length}`);
    ok(O.INDUSTRY[0] === "Agriculture" && O.INDUSTRY[15] === "Transportation" && O.INTENDED_USERS[1] === "external customer or users", "option texts match docs/dom-map.md (including the lower-case one)");
    const sel = form.elements.industry_choice;
    ok(!!sel && sel.tagName === "SELECT" && sel.options.length === 16 + 2, "industry is a <select> with (choose), 16 options and Other", sel && sel.options.length);
    ok(sel && sel.options[sel.options.length - 1].value === O.OTHER && /^Other \(type the exact console option\)$/.test(O.OTHER), 'the last entry is "Other (type the exact console option)"');
    ok(sel.value === "Education" && form.elements.industry.hidden === true, "a stored listed value is selected and the Other input is hidden", sel.value);
    const users = form.elements.intended_users_choice;
    ok(users && users.tagName === "SELECT" && users.value === "Internal employees", "intended users select shows the stored value");
    const hqList = O.HEADQUARTERS;
    const hqSel = form.elements.headquarters_choice;
    if (hqList.length) {
      ok(hqSel && hqSel.tagName === "SELECT" && hqSel.value === O.OTHER && form.elements.headquarters.hidden === false && form.elements.headquarters.value === "Elsewhere", 'a stored value not in the list shows in "Other"', hqSel && hqSel.value);
      ok(hqList.length === 182 && hqList[0] === "United States of America" && hqList[1] === "Canada" && hqList[2] === "Afghanistan", "headquarters: 182 countries, United States of America and Canada first, then from Afghanistan", `${hqList.length}: ${hqList.slice(0, 3).join(", ")}`);
      const dups = hqList.filter((c, i) => hqList.indexOf(c) !== i);
      ok(dups.length === 1 && dups[0] === "Congo" && hqList.slice(2).every((c, i, a) => i === 0 || a[i - 1].localeCompare(c, "en") <= 0), 'headquarters list is alphabetical after the first two, with exactly the console\'s own duplicate ("Congo" twice)', `dups=${JSON.stringify(dups)}`);
    } else {
      ok(!hqSel && form.elements.headquarters.tagName === "INPUT" && form.elements.headquarters.hidden === false && form.elements.headquarters.value === "Elsewhere", "headquarters list empty: the field stays a text input holding the stored value");
    }

    // Pick Other for industry and type an exact text: saved as the plain string.
    setSelect(p, "industry_choice", O.OTHER);
    ok(form.elements.industry.hidden === false && form.elements.industry.required === true, 'choosing "Other" reveals the text input and makes it required');
    setText(p, "industry", "Space mining");
    let r = await submit(p);
    ok(!r.error && store.settings.industry === "Space mining", "saved the Other text as the plain industry value", JSON.stringify([r, store.settings.industry]));
    ok(typeof store.settings.headquarters === "string" && typeof store.settings.intended_users === "string" && !("industry_choice" in store.settings), "stored values are plain strings; no *_choice key is stored", JSON.stringify(Object.keys(store.settings)));
    // Typing a listed value into the text input (what the Selenium harness does) selects it.
    setText(p, "industry", "Gaming");
    ok(form.elements.industry_choice.value === "Gaming" && form.elements.industry.hidden === true, "a completed entry (change event) of a listed value selects it in the dropdown");
    r = await submit(p);
    ok(!r.error && store.settings.industry === "Gaming", "saved the selected value");
    // Keystrokes never hide the field: "Legal" is a listed option but "Legal t..." is being typed past it.
    setSelect(p, "industry_choice", O.OTHER);
    const seen = [];
    for (const typed of ["L", "Le", "Leg", "Lega", "Legal", "Legal ", "Legal t", "Legal tech"]) {
      typeInto(p, "industry", typed);
      seen.push(`${typed}:${form.elements.industry.hidden ? "hidden" : "shown"}/${form.elements.industry_choice.value === O.OTHER ? "Other" : form.elements.industry_choice.value}`);
    }
    ok(seen.every((x) => /:shown\/Other$/.test(x)), 'typing through "Legal" to "Legal tech" keeps the Other input visible and the select on Other', seen.join(" "));
    r = await submit(p);
    ok(!r.error && store.settings.industry === "Legal tech" && form.elements.industry.hidden === false, "Save stores the typed text and leaves the field visible", JSON.stringify([r.text, store.settings.industry]));
    form.elements.industry.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    ok(form.elements.industry.hidden === false && form.elements.industry_choice.value === O.OTHER, "a completed entry that is not a listed option stays Other and visible");
    typeInto(p, "industry", "Legal");
    form.elements.industry.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    ok(form.elements.industry_choice.value === "Legal" && form.elements.industry.hidden === true, "a completed entry that is a listed option moves the select off Other, which hides the input");
    // Picking a listed value after Other.
    setSelect(p, "industry_choice", "Legal");
    r = await submit(p);
    ok(store.settings.industry === "Legal", "picking a listed option saves its text", store.settings.industry);
    // Choosing nothing is a missing field.
    setSelect(p, "industry_choice", "");
    r = await submit(p);
    ok(r.error && /Industry/.test(r.text) && store.settings.industry === "Legal", "an unchosen dropdown refuses Save naming the field", r.text);
    p.win.close();
  }

  console.log("--- options page: Acceptable Use Policy details");
  {
    const store = { settings: Object.assign({}, FULL, { aup_additional_requirements: "yes", aup_details: "we check" }) };
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const form = p.document.getElementById("form");
    const wrap = p.document.getElementById("aup-details-wrap");
    ok(form.elements.aup_additional_requirements.value === "yes" && wrap.hidden === false && form.elements.aup_details.required === true && form.elements.aup_details.value === "we check", "stored Yes: details shown, required and filled");
    setText(p, "aup_details", "   ");
    let r = await submit(p);
    ok(r.error && /Acceptable Use Policy details/.test(r.text) && store.settings.aup_details === "we check", "Yes without details: Save refused naming the field, nothing stored", r.text);
    const no = form.querySelector('input[name="aup_additional_requirements"][value="no"]');
    no.checked = true; no.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    ok(wrap.hidden === true && form.elements.aup_details.required === false, "switching to No hides the details field and drops required");
    setText(p, "aup_details", "stale text");
    r = await submit(p);
    ok(!r.error && store.settings.aup_additional_requirements === "no" && store.settings.aup_details === "", "No: saved, details ignored (stored empty)", JSON.stringify(store.settings.aup_details));
    const yes = form.querySelector('input[name="aup_additional_requirements"][value="yes"]');
    yes.checked = true; yes.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    setText(p, "aup_details", "consumer chatbot with review");
    r = await submit(p);
    ok(!r.error && store.settings.aup_additional_requirements === "yes" && store.settings.aup_details === "consumer chatbot with review", "Yes with details: saved");
    p.win.close();
  }

  console.log("--- options page: advanced timing JSON");
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const { K } = p;
    const form = p.document.getElementById("form");
    const ta = form.elements.timing_json;
    ok(JSON.stringify(JSON.parse(ta.value)) === JSON.stringify(K.TIMING_DEFAULTS), "textarea prefilled with the defaults from constants.js", ta.value);
    ok(/model_ready_ms, api_dialog_close_ms, form_ready_ms, form_valid_ms, next_button_ms, nav_ms, agreements_ready_ms, confirm_ms, poll_ms, settle_ms, watchdog_min/.test(p.document.getElementById("timing-keys").textContent), "the key list is shown");
    ok(K.TIMING_DEFAULTS.settle_ms === 0 && K.TIMING_DEFAULTS.poll_ms === 250 && K.TIMING_DEFAULTS.confirm_ms === 60000 && K.TIMING_DEFAULTS.watchdog_min === 10, "defaults: settle 0, poll 250 ms, confirm 60 s, watchdog 10 min", JSON.stringify(K.TIMING_DEFAULTS));
    const advError = p.document.getElementById("timing-error");
    ok(advError && advError.closest("fieldset.advanced") && advError.hidden === true, "the Advanced section has its own error line, hidden until needed");
    setText(p, "timing_json", "{ not json");
    let r = await submit(p);
    ok(r.error && /See the Advanced section/.test(r.text) && /not valid JSON/.test(r.timing) && !("timing" in store), "invalid JSON refuses Save; the reason is shown under the Advanced field", r.timing);
    setText(p, "timing_json", JSON.stringify({ poll_ms: 10, bogus: 1, nav_ms: "x" }));
    r = await submit(p);
    ok(r.error && /poll_ms must be between 50 and 5000/.test(r.timing) && /unknown key "bogus"/.test(r.timing) && /nav_ms must be an integer/.test(r.timing) && !("timing" in store), "out-of-bounds, unknown and non-integer values refuse Save with every reason", r.timing);
    // Prototype-named keys are unknown keys, not a crash; the questionnaire edit made alongside survives the refusal.
    setText(p, "use_cases", "edited while fixing the timing");
    for (const bad of ['{"__proto__": 1}', '{"constructor": 1}', '{"toString": 1}', '{"__proto__": {"poll_ms": 50}}']) {
      setText(p, "timing_json", bad);
      r = await submit(p);
      const key = Object.keys(JSON.parse(bad))[0];
      ok(r.error && new RegExp(`unknown key "${key}"`).test(r.timing) && !("timing" in store) && store.settings.use_cases === "x", `${bad} refused as unknown key "${key}", nothing stored`, r.timing || r.text);
    }
    ok(form.elements.use_cases.value === "edited while fixing the timing" && form.elements.timing_json.value === '{"__proto__": {"poll_ms": 50}}', "a refused Save keeps the questionnaire edit and the timing text in the form");
    setText(p, "timing_json", JSON.stringify({ watchdog_min: 2 }));
    r = await submit(p);
    ok(r.error && /watchdog_min must exceed the longest phase budget/.test(r.timing), "a watchdog shorter than the longest phase refuses Save", r.timing);
    setText(p, "timing_json", JSON.stringify({ watchdog_min: 7, agreements_ready_ms: 600000, confirm_ms: 600000 }));
    r = await submit(p);
    ok(r.error && /watchdog_min must exceed the longest phase budget \(agreements phase/.test(r.timing) && /42 min/.test(r.timing), "the agreements budget (3 x agreements_ready + confirm) counts against the watchdog", r.timing);
    setText(p, "timing_json", JSON.stringify({ watchdog_min: 7, model_ready_ms: 600000 }));
    r = await submit(p);
    ok(r.error && /watchdog_min must exceed the longest phase budget \(model phase/.test(r.timing), "the model budget (3 x (model_ready + nav) + model_ready) counts against the watchdog", r.timing);
    setText(p, "timing_json", JSON.stringify({ watchdog_min: 7, form_ready_ms: 100000 }));
    r = await submit(p);
    ok(r.error && /questionnaire phase/.test(r.timing), "the questionnaire budget still counts", r.timing);
    ok(JSON.stringify(K.phaseBudgetsMs(K.TIMING_DEFAULTS)) === JSON.stringify({ model: 375000, questionnaire: 264000, agreements: 195000 }) && K.validateTiming({ watchdog_min: 9 }).ok && !K.validateTiming({ watchdog_min: 8 }).ok, "default budgets: model 375 s, questionnaire 264 s, agreements 195 s; plus the 120 s dialog wait the watchdog must exceed 8.25 min", JSON.stringify(K.phaseBudgetsMs(K.TIMING_DEFAULTS)));
    setText(p, "timing_json", JSON.stringify({ confirm_ms: 30000, settle_ms: 2000 }));
    r = await submit(p);
    ok(!r.error && r.timing === "" && store.timing && store.timing.confirm_ms === 30000 && store.timing.settle_ms === 2000 && store.timing.poll_ms === 250 && Object.keys(store.timing).length === Object.keys(K.TIMING_KEYS).length, "valid partial JSON saves the full object with defaults filled in and clears the Advanced error", JSON.stringify(store.timing));
    ok(store.settings.use_cases === "edited while fixing the timing", "the questionnaire edit from before the refusals was saved with it");
    ok(JSON.parse(ta.value).confirm_ms === 30000, "textarea shows the saved object");
    p.document.getElementById("timing-reset").click();
    ok(JSON.stringify(JSON.parse(ta.value)) === JSON.stringify(K.TIMING_DEFAULTS) && store.timing.confirm_ms === 30000, "Reset to defaults refills the textarea; nothing is stored until Save");
    r = await submit(p);
    ok(!r.error && store.timing.confirm_ms === 60000, "Save after reset stores the defaults");
    p.win.close();
  }

  console.log("--- options page: an empty list keeps a text input");
  {
    const store = { settings: Object.assign({}, FULL) };
    const html = fs.readFileSync(path.join(E.EXT, "options/options.html"), "utf8");
    const dom = new JSDOM(html, { url: "chrome-extension://x/options/options.html", runScripts: "outside-only" });
    dom.window.chrome = fakeChrome(store); dom.window.confirm = () => true;
    const ctx = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync(path.join(E.EXT, "common/constants.js"), "utf8"), ctx);
    vm.runInContext('globalThis.MGC_OPTIONS = { OTHER: "Other (type the exact console option)", BY_FIELD: { headquarters: [], industry: [], intended_users: [] } };', ctx);
    vm.runInContext(fs.readFileSync(path.join(E.EXT, "options/options.js"), "utf8"), ctx);
    await tick();
    const form = dom.window.document.getElementById("form");
    ok(!form.elements.industry_choice && form.elements.industry.tagName === "INPUT" && form.elements.industry.required === true && form.elements.industry.value === "Education", "with empty lists every field is a required text input holding the stored value");
    dom.window.close();
  }

  console.log("--- popup: missing settings notice and the single Options button");
  {
    const store = { settings: Object.assign({}, FULL, { business_website: "", industry: "" }) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    const notice = doc.getElementById("missing");
    ok(notice.hidden === false && notice.textContent === "Missing options: Business website, Industry. Fill them in on the Options page.", "red notice lists the two missing fields by label, in its own text", notice.textContent);
    ok(!doc.getElementById("missing-text") && !doc.getElementById("open-options"), "the notice has no separate text element and no second button");
    const start = doc.getElementById("start");
    ok(start.disabled === true && /fill these options first: Business website, Industry/.test(start.title), "Start is disabled with the reason in its title", start.title);
    const optionButtons = Array.from(doc.querySelectorAll("button")).filter((b) => /options/i.test(b.textContent));
    ok(optionButtons.length === 1 && optionButtons[0].id === "options" && optionButtons[0].closest("header"), "exactly one Options button, in the header", optionButtons.map((b) => b.id).join(","));
    optionButtons[0].click();
    ok(store.__opened === 1, "the Options button opens the options page");
    // Root cause of the empty red box in 0.2.0: `.missing { display: flex }`
    // (an author rule) overrode the UA `[hidden] { display: none }`, so the
    // box was painted even with nothing missing. jsdom's cascade does not
    // reproduce that, so the stylesheet is checked: no rule may set
    // `display` on .missing at all (the hidden attribute then always wins).
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    const displayRules = Array.from(css.matchAll(/([^{}]*\.missing[^{}]*)\{([^}]*)\}/g)).filter((m) => /display\s*:/.test(m[2]));
    ok(displayRules.length === 0, "no popup.css rule sets display on .missing (the hidden attribute wins; the 0.3.0 no-op :not([hidden]) rule is gone)", displayRules.map((m) => m[1].trim()).join(" | "));
    p.win.close();
  }
  {
    const store = { settings: Object.assign({}, FULL, { aup_additional_requirements: "yes", aup_details: "" }) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ok(p.document.getElementById("missing").hidden === false && /Acceptable Use Policy details/.test(p.document.getElementById("missing").textContent) && p.document.getElementById("start").disabled === true, "AUP Yes without details counts as missing in the popup");
    p.win.close();
  }
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const notice = p.document.getElementById("missing");
    ok(notice.hidden === true && notice.textContent === "" && p.document.getElementById("start").disabled === false && p.document.getElementById("start").title === "", "every setting present: notice hidden and empty, Start enabled");
    p.win.close();
  }

  console.log("--- popup: header with the photo, the mode banner for both modes");
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    const img = doc.querySelector("header img.photo");
    ok(img && /icons\/avatar96\.png$/.test(img.getAttribute("src")) && img.closest("header").querySelector("h1").textContent === "Model Garden Clicker", "the header shows the 96 px avatar (not the 512 px icon master) next to the title", img && img.getAttribute("src"));
    ok(fs.existsSync(path.join(E.EXT, "icons/avatar96.png")) && fs.statSync(path.join(E.EXT, "icons/avatar96.png")).size < 40000 && /icons\/avatar96\.png/.test(fs.readFileSync(path.join(E.EXT, "options/options.html"), "utf8")), "icons/avatar96.png exists, is small, and the options page uses it too");
    ok(/-x 'icons\/icon-master\.png'/.test(fs.readFileSync(path.join(E.EXT, "..", "scripts/build-extension-zip.sh"), "utf8")) && fs.existsSync(path.join(E.EXT, "icons/icon-master.png")), "the release zip leaves icons/icon-master.png out while the file stays in the repository");
    const mode = doc.getElementById("mode");
    ok(mode.closest("header") && mode.textContent === "MODE: DRY RUN" && mode.className === "mode dry", "banner reads MODE: DRY RUN with the neutral class", `${mode.textContent} / ${mode.className}`);
    ok(doc.getElementById("open-tab") && doc.getElementById("open-tab").closest("header") && /popup/.test(doc.documentElement.className), 'the header has an "Open in a tab" link; the page starts in popup layout');
    p.win.close();
  }
  {
    const store = { settings: Object.assign({}, FULL, { live_mode: true }) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const mode = p.document.getElementById("mode");
    ok(mode.textContent === "MODE: FULL RUN" && mode.className === "mode live", "banner reads MODE: FULL RUN with the red class", `${mode.textContent} / ${mode.className}`);
    const cssText = fs.readFileSync(path.join(E.EXT, "common/theme.css"), "utf8");
    const live = /\.mode\.live\s*\{([^}]*)\}/.exec(cssText);
    ok(live && /background:\s*var\(--mgc-warn\)/.test(live[1]) && /color:\s*#fff/.test(live[1]), "the live banner is white on the warning red", live && live[1]);
    p.win.close();
  }
  {
    // A page opened with ?tab (the header link) or living in a real tab gets the tab layout.
    const store = { settings: Object.assign({}, FULL) };
    const html = fs.readFileSync(path.join(E.EXT, "popup/popup.html"), "utf8");
    const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html?tab=1", runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.chrome = fakeChrome(store);
    dom.window.fetch = async () => ({ json: async () => [] });
    const ctx = dom.getInternalVMContext();
    for (const f of POPUP_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
    await tick();
    ok(dom.window.document.documentElement.className === "tab", "?tab=1 switches <html> to the tab layout", dom.window.document.documentElement.className);
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/html\.popup body\s*\{[^}]*width:\s*800px/.test(css) && /html\.popup body\s*\{[^}]*height:\s*600px/.test(css) && /html\.tab body\s*\{[^}]*height:\s*100vh/.test(css) && /\.scroll\s*\{[^}]*overflow:\s*auto/.test(css) && /body\s*\{[^}]*flex-direction:\s*column/.test(css),
      "popup.css: an 800 x 600 px flex column in the popup (Chrome's maximum popup size), 100vh in a tab, with the results and the log in the .scroll region", "");
    ok(/html\.tab body\s*\{[^}]*width:\s*auto/.test(css) && /html\.tab body\s*\{[^}]*min-width:\s*360px/.test(css) && /html\.tab body\s*\{[^}]*max-width:\s*900px/.test(css) && /html\.tab \.models\s*\{[^}]*repeat\(auto-fill, minmax\(190px, 1fr\)\)/.test(css),
      "popup.css: the tab layout stays fluid (auto width between 360 and 900 px, as many checklist columns as fit)", "");
    const inputsRule = /\.inputs\s*\{([^}]*)\}/.exec(css);
    ok(inputsRule && /flex:\s*none/.test(inputsRule[1]) && !/overflow:\s*auto|overflow:\s*scroll|overflow-y:\s*auto/.test(inputsRule[1]), "popup.css: the inputs column never shrinks and is not a scroll region", inputsRule && inputsRule[1]);
    ok(/\.models\s*\{[^}]*display:\s*grid/.test(css) && /\.models\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/.test(css) && /\.models\s*\{[^}]*max-height:\s*170px/.test(css) && /\.models\s*\{[^}]*overflow-y:\s*auto/.test(css) && !/\.models\s*\{[^}]*min-height/.test(css),
      "popup.css: the checklist is a four-column grid at its natural height (twelve models fit without a scrollbar; a longer list scrolls inside the 170 px box; geometry verified by python/scripts/popup_layout.py at 800 x 600)", "");
    ok(/\.scroll\s*\{[^}]*min-height:\s*120px/.test(css) && /\.scroll\s*\{[^}]*flex:\s*1 1 auto/.test(css), "popup.css: the results/log region takes the remaining height with its own scroll", "");
    ok(/<textarea id="projects"[^>]*rows="3"/.test(html), "the project text area is three rows", "");
    ok(dom.window.document.querySelector(".scroll #results") && dom.window.document.querySelector(".scroll #log") && !dom.window.document.querySelector(".scroll #projects") && !dom.window.document.querySelector(".scroll #models") && !dom.window.document.querySelector(".scroll #start"), "the results table and the log are inside .scroll; the inputs, the checklist and Start are above it");
    dom.window.close();
    const dom3 = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only", pretendToBeVisual: true });
    dom3.window.chrome = fakeChrome(store);
    delete dom3.window.chrome.tabs.getCurrent;
    dom3.window.fetch = async () => ({ json: async () => [] });
    dom3.window.close = () => { store.__closed = true; };
    const ctx3 = dom3.getInternalVMContext();
    for (const f of POPUP_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx3, { filename: f });
    await tick();
    ok(dom3.window.document.documentElement.className === "popup", "without ?tab the popup layout stays (no tabs.getCurrent probe any more)");
    dom3.window.document.getElementById("open-tab").click();
    ok(store.__tab === "chrome-extension://x/popup/popup.html?tab=1" && store.__closed === true, "Open in a tab creates a tab with popup.html?tab=1 through chrome.tabs.create and closes the popup", store.__tab);
    const popupJs = fs.readFileSync(path.join(E.EXT, "popup/popup.js"), "utf8");
    ok(!/getCurrent|window\.open/.test(popupJs), "popup.js has no tabs.getCurrent or window.open fallback left");
  }

  console.log("--- every element id popup.js and options.js reference exists in its HTML; a render survives a missing optional element");
  {
    const pairs = [["popup/popup.js", "popup/popup.html"], ["options/options.js", "options/options.html"]];
    for (const [js, htmlFile] of pairs) {
      const src = fs.readFileSync(path.join(E.EXT, js), "utf8");
      const page = new JSDOM(fs.readFileSync(path.join(E.EXT, htmlFile), "utf8")).window.document;
      const ids = [...new Set([...src.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)|getElementById\("([a-zA-Z0-9_-]+)"\)/g)].map((m) => m[1] || m[2]))].sort();
      const missing = ids.filter((id) => !page.getElementById(id));
      ok(ids.length >= 7 && missing.length === 0, `${js}: every id it references (${ids.length}) exists in ${htmlFile}`, `missing: ${missing.join(", ") || "none"}; referenced: ${ids.join(", ")}`);
    }
    // Robustness: popup.html without the optional #step, #icon-warning and #log-details elements still renders
    // the banner, the status, the results and wires Start (no TypeError aborts the render or init).
    const store = { settings: Object.assign({}, FULL), running: false, run: { runId: "r", live: false, finishedAt: 1, reason: "all jobs processed" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "dry-run", message: "dry run: stopped" }], log: [{ t: 1, level: "info", src: "worker", msg: "hello" }] };
    let html = fs.readFileSync(path.join(E.EXT, "popup/popup.html"), "utf8");
    for (const re of [/<div id="step"[^>]*><\/div>\s*/, /<svg id="icon-warning"[\s\S]*?<\/svg>\s*/, /<details id="log-details">[\s\S]*?<\/details>\s*/]) {
      ok(re.test(html), `the fixture removes an element that exists: ${re.source.slice(0, 24)}`);
      html = html.replace(re, "");
    }
    const dom = new JSDOM(html, { url: "chrome-extension://x/popup/popup.html", runScripts: "outside-only", pretendToBeVisual: true });
    const errors = [];
    dom.window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
    dom.window.chrome = fakeChrome(store);
    dom.window.fetch = async () => ({ json: async () => JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")) });
    const ctx = dom.getInternalVMContext();
    for (const f of POPUP_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
    await tick(); await tick();
    const d = dom.window.document;
    ok(!d.getElementById("step") && !d.getElementById("icon-warning") && !d.getElementById("log-details"), "fixture: the three optional elements are absent");
    ok(d.getElementById("mode").textContent === "MODE: DRY RUN" && /idle; last run all jobs processed/.test(d.getElementById("status").textContent), "the banner and the status rendered", d.getElementById("status").textContent);
    ok(d.querySelectorAll("#results tbody tr").length === 1 && d.querySelector("#results tbody td.st").textContent === "dry-run", "the results table rendered after the missing elements (the render did not abort)");
    ok(d.getElementById("step-toggle-label").textContent === "kubardy mode" && d.getElementById("start").disabled === false, "the step toggle label and Start were set");
    d.getElementById("start").click(); await tick();
    ok(d.getElementById("error").hidden === false && /enter at least one project ID/.test(d.getElementById("error").textContent), "Start is wired (its validation error shows)", d.getElementById("error").textContent);
    ok(errors.length === 0, "no unhandled rejection from the render or init", errors.join(" | "));
    dom.window.close();
  }

  console.log("--- the real popup.js and options.js against the real HTML: init and first render throw nothing, in the idle and the finished-run states");
  {
    const { VirtualConsole } = require("jsdom");
    const finishedRun = { running: false, run: { runId: "r-fin", live: false, startedAt: 1, finishedAt: 2, reason: "all jobs processed" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "dry-run", message: "dry run: stopped" }, { projectId: "proj-two", modelSlug: "claude-haiku-4-5", status: "skipped", message: "skipped: already enabled" }],
      summary_ack: { runId: "r-fin", tabId: 7, reason: "all jobs processed", ack: false }, log: [{ t: 1, level: "info", src: "worker", msg: "run finished: all jobs processed" }], current: null, stop_requested: false, timing: null };
    const states = { idle: { settings: Object.assign({}, FULL) }, "finished run": Object.assign({ settings: Object.assign({}, FULL) }, finishedRun) };
    for (const [stateName, base] of Object.entries(states)) {
      for (const [rel, scripts] of [["popup/popup.html", POPUP_SCRIPTS], ["options/options.html", OPTIONS_SCRIPTS]]) {
        const store = JSON.parse(JSON.stringify(base));
        const errors = [];
        const onRejection = (reason) => errors.push(`unhandled rejection: ${reason && reason.stack ? reason.stack.split("\n").slice(0, 2).join(" ") : reason}`);
        process.on("unhandledRejection", onRejection);
        const vc = new VirtualConsole();
        vc.on("jsdomError", (e) => errors.push(`jsdomError: ${e && e.message}`));
        const dom = new JSDOM(fs.readFileSync(path.join(E.EXT, rel), "utf8"), { url: "chrome-extension://x/" + rel, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
        dom.window.addEventListener("error", (e) => errors.push(`window error: ${e.message}`));
        dom.window.chrome = fakeChrome(store);
        dom.window.confirm = () => true;
        dom.window.fetch = async () => ({ json: async () => JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")) });
        const ctx = dom.getInternalVMContext();
        try {
          for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
        } catch (e) { errors.push(`thrown while loading: ${e.message}`); }
        await tick(); await tick(); await tick();
        process.off("unhandledRejection", onRejection);
        const d = dom.window.document;
        const rendered = rel.startsWith("popup") ? /MODE: DRY RUN/.test(d.getElementById("mode").textContent) && d.querySelectorAll("#models input").length === 12 && (stateName === "idle" ? d.getElementById("status").textContent === "idle" : d.getElementById("summary").hidden === false && d.querySelectorAll("#results tbody tr").length === 2)
          : d.getElementById("form").elements.business_name.value === "b" && d.getElementById("form").elements.industry_choice && d.getElementById("form").elements.industry_choice.value === "Education";
        ok(errors.length === 0 && rendered, `${rel} in the ${stateName} state: loaded, initialised and rendered with no thrown error and no unhandled rejection`, errors.join(" | ") || (rendered ? "" : "render check failed"));
        dom.window.close();
      }
    }
  }

  console.log("--- popup: the end-of-run summary block (shown until OK, mirrored from the worker tab), in the tab layout");
  {
    const jobs = (n) => Array.from({ length: n }, (_, i) => ({ projectId: `proj-${i + 1}`, modelSlug: "claude-haiku-4-5", status: i === 1 ? "failed" : "dry-run", message: i === 1 ? "tab shows project x" : "dry run: stopped on the Agreements page with the checkbox ticked; Agree was not clicked and this message is long enough to be cut" }));
    const store = { settings: Object.assign({}, FULL), running: false, run: { runId: "run-9", live: false, finishedAt: 1, reason: "all jobs processed" }, queue: jobs(14), summary_ack: { runId: "run-9", tabId: 5, reason: "all jobs processed", ack: false } };
    // (M1) the page opened with "Open in a tab": its OK goes to the worker the same way and is accepted there
    // (the worker treats a sender under the extension's origin as UI; worker-harness check 22); a refusal is shown.
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS, "?tab=1");
    const doc = p.document;
    ok(doc.documentElement.className === "tab", "the summary block test runs in the tab layout (popup.html?tab=1)");
    const box = doc.getElementById("summary");
    ok(box && box.hidden === false && box.closest(".scroll") && box.compareDocumentPosition(doc.getElementById("results")) & 4, "the summary block is visible, at the top of the results region, above the table");
    ok(/^Run all jobs processed: 14 job\(s\)$/.test(doc.querySelector("#summary .title").textContent) && doc.querySelector("#summary .counts").textContent === "done 0 · dry-run 13 · skipped 0 · failed 1 · unverified 0 · stopped 0", "title with the reason and the job count; the six counts", doc.querySelector("#summary .counts").textContent);
    const lines = Array.from(doc.querySelectorAll("#summary .line")).map((l) => l.textContent);
    ok(lines.length === 12 && doc.querySelector("#summary .more").textContent === "and 2 more", "twelve per-job lines, then \"and 2 more\"", `${lines.length} ${doc.querySelector("#summary .more") && doc.querySelector("#summary .more").textContent}`);
    const cut = lines[0].split(" · ").slice(3).join(" · ");
    ok(/^proj-2 · claude-haiku-4-5 · failed · tab shows project x$/.test(lines[1]) && /^proj-1 · claude-haiku-4-5 · dry-run · dry run: stopped on the Agreements page with the checkbox ticked; Agree was no/.test(lines[0]) && cut.endsWith("…") && cut.length === p.K.SUMMARY_MESSAGE_CHARS, `each line: project, model, status, message cut to ${p.K.SUMMARY_MESSAGE_CHARS} characters`, `${lines[0]} (${cut.length})`);
    let okBtn = doc.getElementById("summary-ok");
    ok(okBtn && okBtn.tagName === "BUTTON" && okBtn.textContent === "OK", "an OK button");
    store.__reply = (m) => (m.type === p.K.MSG.SUMMARY_ACK ? { ok: false, error: "not the tab the run used" } : { ok: true });
    okBtn.click(); await tick();
    ok((store.__messages || []).filter((m) => m.type === p.K.MSG.SUMMARY_ACK).length === 1 && doc.getElementById("error").hidden === false && /not the tab the run used/.test(doc.getElementById("error").textContent) && box.hidden === false && doc.getElementById("summary-ok"), "a refusal by the worker is shown in the error line and the block stays (with a fresh OK)", doc.getElementById("error").textContent);
    store.__reply = null;
    okBtn = doc.getElementById("summary-ok");
    okBtn.click(); await tick();
    const acks = (store.__messages || []).filter((m) => m.type === p.K.MSG.SUMMARY_ACK);
    ok(acks.length === 2 && acks.every((m) => m.runId === "run-9"), "OK sends mgc:summary-ack with the run id to the worker (the one write path), from the tab layout", JSON.stringify(acks));
    // The worker flips the flag; the popup follows storage.
    store.summary_ack.ack = true;
    p.win.chrome.__fire({ summary_ack: { newValue: store.summary_ack } }); await tick();
    ok(box.hidden === true && box.textContent === "", "acknowledged: the block is hidden and empty");
    store.summary_ack = { runId: "run-9", tabId: 5, ack: false };
    p.win.chrome.__fire({ summary_ack: { newValue: store.summary_ack } }); await tick();
    ok(box.hidden === false && doc.getElementById("summary-ok"), "the unacknowledged record (a reload) shows it again");
    store.running = true; store.run = { runId: "run-10", live: false }; store.summary_ack = null; store.queue = [{ projectId: "p", modelSlug: "m", status: "running", phase: "navigate" }];
    p.win.chrome.__fire({ running: { newValue: true } }); await tick();
    ok(box.hidden === true, "a new run (Start cleared the record): hidden");
    p.win.close();
    const p2 = await loadPage("popup/popup.html", { settings: Object.assign({}, FULL), running: false, run: { runId: "run-9", live: false, finishedAt: 1, reason: "stopped by user" }, queue: jobs(2), summary_ack: { runId: "other", ack: false } }, POPUP_SCRIPTS);
    ok(p2.document.getElementById("summary").hidden === true, "a record for another run id does not show for this run");
    p2.win.close();
  }

  console.log("--- no code focuses a tab or a window, opens the popup, or raises a notification");
  {
    const shipped = ["background/service-worker.js", "popup/popup.js", "options/options.js", "content/main.js", "content/actions.js", "content/badge.js", "content/selectors.js", "content/dom.js", "common/constants.js"].map((f) => fs.readFileSync(path.join(E.EXT, f), "utf8")).join("\n");
    const updates = Array.from(shipped.matchAll(/chrome\.tabs\.update\(([^;]*)\)/g)).map((m) => m[0]);
    ok(updates.length >= 1 && updates.every((u) => !/active\s*:\s*true/.test(u) && !/highlighted|selected/.test(u)), "no chrome.tabs.update carries active: true (a later job's navigation never pulls the tab to the front)", updates.join(" | "));
    ok(!/chrome\.windows\./.test(shipped) && !/windows\.update/.test(shipped), "no chrome.windows call at all (nothing focuses a window)");
    ok(!/chrome\.notifications/.test(shipped) && !/action\.openPopup/.test(shipped), "no chrome.notifications and no action.openPopup (the popup is never opened by the extension)");
    ok(!/"notifications"/.test(fs.readFileSync(path.join(E.EXT, "manifest.json"), "utf8")), "the manifest asks for no notifications permission");
    const creates = Array.from(shipped.matchAll(/chrome\.tabs\.create\([^;]*\)/g)).map((m) => m[0]);
    ok(creates.length === 2 && creates.filter((c) => /active:\s*true/.test(c)).length === 1, "tabs.create: the worker tab (opened in front right after Start) and the Open-in-a-tab page only", creates.join(" | "));
  }

  console.log("--- manifest: permissions are storage and alarms only, host access is the console origin only");
  {
    const manifest = JSON.parse(fs.readFileSync(path.join(E.EXT, "manifest.json"), "utf8"));
    ok(JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "alarms"]), 'permissions are exactly ["storage", "alarms"] (no "tabs": the install prompt must not say "Read your browsing history")', JSON.stringify(manifest.permissions));
    ok(JSON.stringify(manifest.host_permissions) === JSON.stringify(["https://console.cloud.google.com/*"]), "host_permissions are exactly the console origin", JSON.stringify(manifest.host_permissions));
    ok(!("optional_permissions" in manifest) && !("optional_host_permissions" in manifest), "no optional permissions");
    // Every chrome.tabs call in the shipped code works without the "tabs" permission: create, update, get, onRemoved.
    const shipped = ["background/service-worker.js", "popup/popup.js", "options/options.js", "content/main.js", "content/actions.js", "content/badge.js"].map((f) => fs.readFileSync(path.join(E.EXT, f), "utf8")).join("\n");
    const calls = [...new Set(Array.from(shipped.matchAll(/chrome\.tabs\.([a-zA-Z]+)/g)).map((m) => m[1]))].sort();
    ok(JSON.stringify(calls) === JSON.stringify(["create", "get", "onRemoved", "update"]), "the chrome.tabs calls in the shipped code are create, get, onRemoved and update, none of which needs the tabs permission", calls.join(","));
    ok(!/tab\.url|tabs\.query|tabs\.onUpdated/.test(shipped), "no code reads a tab's url or queries tabs (which the tabs permission would be needed for on non-console tabs)");
    ok(manifest.version === "0.4.0", "the manifest version is 0.4.0", manifest.version);
    // Chrome Web Store limits: the 0.3.0 upload was rejected for a 136-character description (limit 132).
    ok(typeof manifest.description === "string" && manifest.description.length <= 132, `the manifest description is at most 132 characters (store limit): ${manifest.description.length}`, manifest.description.length);
    ok(manifest.description === "Enables Anthropic Claude models in the Google Cloud Model Garden for many projects. Fills the questionnaire with values saved once.", "the description is the 131-character store text", manifest.description);
    ok(typeof manifest.name === "string" && manifest.name.length <= 75 && manifest.name.length > 0, `the manifest name is at most 75 characters (store limit): ${manifest.name.length}`);
    ok(typeof manifest.short_name === "string" && manifest.short_name.length <= 12 && manifest.short_name.length > 0, `the short_name is at most 12 characters (store limit): ${manifest.short_name.length}`);
  }

  console.log("--- theme: palette variables shared by the popup and the options page, with WCAG contrast");
  {
    const theme = fs.readFileSync(path.join(E.EXT, "common/theme.css"), "utf8");
    const vars = {};
    for (const m of theme.matchAll(/--mgc-([a-z-]+):\s*(#[0-9a-f]{6});/g)) vars[m[1]] = m[2];
    ok(["bg", "surface", "text", "muted", "border", "accent", "accent-dark", "neutral", "warn", "warn-bg"].every((k) => vars[k]), "theme.css defines the palette variables (bg, surface, text, muted, border, accent, accent-dark, neutral, warn, warn-bg)", Object.keys(vars).join(","));
    const popupHtml = fs.readFileSync(path.join(E.EXT, "popup/popup.html"), "utf8");
    const optionsHtml = fs.readFileSync(path.join(E.EXT, "options/options.html"), "utf8");
    ok(/href="\.\.\/common\/theme\.css"/.test(popupHtml) && /href="\.\.\/common\/theme\.css"/.test(optionsHtml), "both pages link common/theme.css");
    const popupCss = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    const optionsCss = fs.readFileSync(path.join(E.EXT, "options/options.css"), "utf8");
    ok(!/#[0-9a-f]{3,6}\b/i.test(popupCss) && !/#[0-9a-f]{3,6}\b/i.test(optionsCss), "popup.css and options.css carry no literal colours; every colour is a var(--mgc-*)");
    const lum = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const pairs = [["text", "bg"], ["text", "surface"], ["muted", "bg"], ["muted", "surface"], ["warn", "bg"], ["warn", "warn-bg"], ["text", "accent"], ["text", "neutral"],
      ["accent-dark", "bg"], ["accent-dark", "surface"], ["info", "bg"], ["info", "surface"], ["ok", "bg"], ["ok", "surface"]];
    const ratios = pairs.map(([f, b]) => `${f}/${b} ${contrast(vars[f], vars[b]).toFixed(2)}`);
    ok(pairs.every(([f, b]) => contrast(vars[f], vars[b]) >= 4.5) && contrast("#ffffff", vars.warn) >= 4.5 && contrast("#ffffff", vars["accent-dark"]) >= 4.5, "every text pair is at least 4.5:1 (body, muted, warning, button text, both banners, links in accent-dark, info and ok status text on both backgrounds)", ratios.join(", "));
    ok(contrast(vars.text, vars.bg) >= 15, "body text on the background is far above 4.5:1", contrast(vars.text, vars.bg).toFixed(2));
    // Non-text contrast (WCAG 1.4.11): the focus ring colour against both backgrounds.
    const ring = /:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--mgc-([a-z-]+)\)/.exec(theme);
    ok(ring && vars[ring[1]] && contrast(vars[ring[1]], vars.bg) >= 3 && contrast(vars[ring[1]], vars.surface) >= 3, "the focus ring is a palette colour at least 3:1 against the background and the surface", ring ? `${ring[1]} ${contrast(vars[ring[1]], vars.bg).toFixed(2)} / ${contrast(vars[ring[1]], vars.surface).toFixed(2)}` : "no focus rule");
    ok(/header \.photo\s*\{/.test(theme) && !/header \.photo/.test(fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8")) && !/header \.photo/.test(fs.readFileSync(path.join(E.EXT, "options/options.css"), "utf8")), "the header photo rule lives once, in theme.css");
    const hue = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b); if (max === min) return 0; let h; if (max === r) h = (g - b) / (max - min) + (g < b ? 6 : 0); else if (max === g) h = (b - r) / (max - min) + 2; else h = (r - g) / (max - min) + 4; return h * 60; };
    ok(Math.abs(hue(vars.warn) - hue(vars.accent)) >= 25 && hue(vars.warn) < 15, "the warning red is a red (hue under 15) at least 25 degrees from the amber accent", `${hue(vars.warn).toFixed(0)} vs ${hue(vars.accent).toFixed(0)}`);
  }

  console.log("--- options page: the DRY RUN box (stored inverted as live_mode) and step-by-step");
  {
    const store = { settings: Object.assign({}, FULL) };
    delete store.settings.live_mode; // a 0.2.0 store without the key, or a fresh install
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const form = p.document.getElementById("form");
    let confirms = 0; p.win.confirm = () => { confirms += 1; return true; };
    ok(!form.elements.live_mode && form.elements.dry_run && form.elements.dry_run.type === "checkbox" && form.elements.dry_run.checked === true, 'the mode control is one checkbox named dry_run, labelled DRY RUN, ticked by default', form.elements.dry_run && form.elements.dry_run.checked);
    const label = form.elements.dry_run.closest("label");
    ok(label && label.textContent.trim() === "DRY RUN", 'the box is labelled "DRY RUN"', label && label.textContent.trim());
    const explain = label.nextElementSibling;
    ok(explain && /never approves or enables anything, and stops on the Agreements page\./.test(explain.textContent) && /full run/.test(explain.textContent) && /bill the project/.test(explain.textContent) && explain.textContent.split(/\.\s/).length === 2, "two sentences explain dry run and full run", explain && explain.textContent);
    ok(p.document.getElementById("full-run-warning").hidden === true, "the red full-run note is hidden while the box is ticked");
    ok(form.elements.step_by_step && form.elements.step_by_step.type === "checkbox" && form.elements.step_by_step.checked === false, "the step-by-step box exists and is unticked by default");
    const sbs = form.elements.step_by_step.closest("label").nextElementSibling;
    ok(/fills each page and then waits for you/.test(sbs.textContent) && /Continue and Stop before Next and before Agree/.test(sbs.textContent) && /click the console's own button yourself/.test(sbs.textContent), "the step-by-step explanation names the panel, Continue/Stop, Next, Agree and the user's own click", sbs.textContent);
    let r = await submit(p);
    ok(!r.error && store.settings.live_mode === false && store.settings.step_by_step === false && confirms === 0, "Save with the box ticked stores live_mode=false, step_by_step=false, no confirm()", JSON.stringify([store.settings.live_mode, store.settings.step_by_step]));
    form.elements.dry_run.checked = false; form.elements.dry_run.dispatchEvent(new p.win.Event("change", { bubbles: true }));
    ok(p.document.getElementById("full-run-warning").hidden === false, "unticking shows the red full-run note at once");
    form.elements.step_by_step.checked = true;
    r = await submit(p);
    ok(!r.error && store.settings.live_mode === true && store.settings.step_by_step === true && confirms === 0, "Save with the box unticked stores live_mode=true (and step_by_step=true), still no confirm()", JSON.stringify(store.settings.live_mode));
    ok(!("dry_run" in store.settings), "dry_run itself is not stored; live_mode is the only mode key");
    p.win.close();
    const p2 = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    ok(p2.document.getElementById("form").elements.dry_run.checked === false && p2.document.getElementById("form").elements.step_by_step.checked === true && p2.document.getElementById("full-run-warning").hidden === false, "reloading shows the box unticked for live_mode=true and step-by-step ticked");
    p2.win.close();
  }
  {
    // While a run is active neither the mode nor step-by-step can change.
    const store = { settings: Object.assign({}, FULL, { live_mode: false, step_by_step: false }), running: true };
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const form = p.document.getElementById("form");
    form.elements.dry_run.checked = false;
    let r = await submit(p);
    ok(r.error && /run is in progress/.test(r.text) && store.settings.live_mode === false && form.elements.dry_run.checked === true, "unticking DRY RUN during a run is refused and the box is put back", r.text);
    form.elements.step_by_step.checked = true;
    r = await submit(p);
    ok(r.error && /step-by-step/.test(r.text) && store.settings.step_by_step === false && form.elements.step_by_step.checked === false, "ticking step-by-step during a run is refused too", r.text);
    setText(p, "use_cases", "edited during the run");
    r = await submit(p);
    ok(!r.error && store.settings.use_cases === "edited during the run", "a questionnaire edit with the boxes unchanged still saves during a run");
    // A change made elsewhere (the popup's toggles) is reflected in the boxes.
    p.win.chrome.__fire({ settings: { newValue: Object.assign({}, store.settings, { live_mode: true, step_by_step: true }) } });
    ok(form.elements.dry_run.checked === false && form.elements.step_by_step.checked === true && p.document.getElementById("full-run-warning").hidden === false, "a settings change in storage (the popup's toggles) moves both boxes and the red note");
    p.win.close();
  }

  console.log("--- popup: the MODE banner and the step-by-step button toggle their settings in place");
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    const mode = doc.getElementById("mode");
    const stepBtn = doc.getElementById("step-toggle");
    const shown = (id) => doc.getElementById(id).style.display !== "none";
    let confirms = []; p.win.confirm = (msg) => { confirms.push(msg); return true; };
    ok(mode.tagName === "BUTTON" && mode.type === "button" && mode.getAttribute("aria-pressed") === "false" && /Click to switch to FULL RUN/.test(mode.title), "the MODE banner is a button with aria-pressed false and a title that explains the switch", mode.title);
    ok(stepBtn && stepBtn.tagName === "BUTTON" && stepBtn.closest("header") && stepBtn.getAttribute("aria-pressed") === "false" && doc.getElementById("step-toggle-label").textContent === "kubardy mode", 'the step-by-step button sits in the header, aria-pressed false, labelled "kubardy mode" while step-by-step is off', stepBtn && stepBtn.textContent.trim());
    ok(shown("icon-warning") && !shown("icon-snail") && doc.querySelector("#icon-warning path") && doc.getElementById("icon-warning").getAttribute("aria-hidden") === "true", "the warning-sign SVG is displayed and the snail SVG is not (display style, not the hidden attribute: it does not apply to inline SVG)");
    const warningSvg = doc.getElementById("icon-warning");
    const triangle = warningSvg.querySelector("path");
    ok(!doc.getElementById("icon-dog") && /^M12 2\.5L22\.5 20\.5H1\.5z$/.test(triangle.getAttribute("d")) && triangle.getAttribute("stroke") === "currentColor" && warningSvg.querySelectorAll("path").length === 2 && warningSvg.querySelector("circle"),
      "the kubardy icon is a warning sign (a triangle outline with an exclamation mark: a bar and a dot), the running dog is gone", triangle.getAttribute("d"));
    const popupCssText = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/header \.step-toggle \.icon\s*\{[^}]*color:\s*var\(--mgc-accent-dark\)/.test(popupCssText) && warningSvg.classList.contains("icon") && doc.getElementById("icon-snail").classList.contains("icon"),
      "both icons take the same colour (currentColor from the .icon rule: the dark accent), as the dog did");
    ok(/kubardy mode: step-by-step confirmation is off/.test(stepBtn.title) && /runs each job through without pausing: no Continue before Next, and in a full run no Continue before Agree/.test(stepBtn.title) && /Click for slow mode/.test(stepBtn.title), "its title explains that kubardy mode runs without pauses, and the switch", stepBtn.title);
    ok(!doc.querySelector('header img[src*="icon-master"]') && doc.querySelectorAll("header svg").length === 2 && !/<img[^>]*icon-(snail|warning|dog)/.test(fs.readFileSync(path.join(E.EXT, "popup/popup.html"), "utf8")), "both icons are inline SVG, no external assets");

    mode.click(); await tick();
    ok(confirms.length === 1 && /Switch to FULL RUN\?/.test(confirms[0]) && /clicks Agree and makes Marketplace purchases that bill the project/.test(confirms[0]), "clicking the banner in DRY RUN asks for a confirmation that names the purchases", confirms[0]);
    ok(store.settings.live_mode === true && mode.textContent === "MODE: FULL RUN" && mode.className === "mode live" && mode.getAttribute("aria-pressed") === "true" && /Click to switch to DRY RUN/.test(mode.title), "confirmed: live_mode written true, banner MODE: FULL RUN in red, aria-pressed true", `${store.settings.live_mode} ${mode.textContent}`);
    ok(store.settings.business_name === "b" && store.settings.use_cases === "x", "the other settings survived the write (merged, not replaced)");
    mode.click(); await tick();
    ok(confirms.length === 1 && store.settings.live_mode === false && mode.textContent === "MODE: DRY RUN" && mode.getAttribute("aria-pressed") === "false", "clicking again switches back to DRY RUN without a confirm", mode.textContent);
    p.win.confirm = (msg) => { confirms.push(msg); return false; };
    mode.click(); await tick();
    ok(confirms.length === 2 && store.settings.live_mode === false && mode.textContent === "MODE: DRY RUN", "a declined confirm leaves DRY RUN", mode.textContent);

    stepBtn.click(); await tick();
    ok(store.settings.step_by_step === true && stepBtn.getAttribute("aria-pressed") === "true" && doc.getElementById("step-toggle-label").textContent === "slow mode" && shown("icon-snail") && !shown("icon-warning") && /slow mode: step-by-step confirmation is on/.test(stepBtn.title), 'clicking the step button writes step_by_step=true: "slow mode" with the snail only, aria-pressed true, title updated', stepBtn.textContent.trim());
    stepBtn.click(); await tick();
    ok(store.settings.step_by_step === false && stepBtn.getAttribute("aria-pressed") === "false" && doc.getElementById("step-toggle-label").textContent === "kubardy mode" && shown("icon-warning") && !shown("icon-snail"), 'clicking again writes false: "kubardy mode" with the warning sign only', stepBtn.textContent.trim());
    ok(doc.getElementById("error").hidden === true, "no error shown for an accepted toggle");
    p.win.close();
    const p2 = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    ok(p2.document.getElementById("form").elements.dry_run.checked === true && p2.document.getElementById("form").elements.step_by_step.checked === false, "the options page shows what the popup wrote");
    p2.win.close();
  }
  {
    // While a run is active both toggles are refused with a message; nothing is written.
    const store = { settings: Object.assign({}, FULL, { live_mode: false, step_by_step: false }), running: true, run: { runId: "r", live: false }, current: { jobIndex: 0, phase: "model" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "model", message: "" }] };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    let confirms = 0; p.win.confirm = () => { confirms += 1; return true; };
    doc.getElementById("mode").click(); await tick();
    const err = doc.getElementById("error");
    ok(store.settings.live_mode === false && doc.getElementById("mode").textContent === "MODE: DRY RUN" && err.hidden === false && /A run is in progress: stop it before changing the mode or step-by-step confirmation/.test(err.textContent), "toggling the mode during a run is refused with the message; nothing written", err.textContent);
    ok(/A run is in progress: stop it before changing the mode/.test(doc.getElementById("mode").title), "the banner's title says the mode is locked during the run", doc.getElementById("mode").title);
    doc.getElementById("step-toggle").click(); await tick();
    ok(store.settings.step_by_step === false && doc.getElementById("step-toggle-label").textContent === "kubardy mode" && err.hidden === false && /A run is in progress/.test(err.textContent), "toggling step-by-step during a run is refused the same way", err.textContent);
    const popupJs = fs.readFileSync(path.join(E.EXT, "popup/popup.js"), "utf8");
    const optionsJs = fs.readFileSync(path.join(E.EXT, "options/options.js"), "utf8");
    ok((popupJs.match(/K\.saveSettings\(/g) || []).length === 2 && (optionsJs.match(/K\.saveSettings\(/g) || []).length === 1 && !/storage\.local\.set\(\{\s*\[KEYS\.SETTINGS\]/.test(popupJs + optionsJs), "both pages write settings only through MGC.saveSettings (the one path)");
    p.win.close();
  }

  console.log("--- popup: the running job's step line is mirrored; waiting for confirmation; the log opens");
  {
    const store = {
      settings: Object.assign({}, FULL), running: true, run: { runId: "r", live: false },
      current: { jobIndex: 0, phase: "model" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "model", step: "waiting for Enable button (enabled, no dialog) or enabled state", message: "" }]
    };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const step = p.document.getElementById("step");
    ok(step.hidden === false && step.textContent === "step: waiting for Enable button (enabled, no dialog) or enabled state", "the popup shows the job's step line", step.textContent);
    ok(/running job 1\/1: proj-one \/ claude-haiku-4-5 \[model\]/.test(p.document.getElementById("status").textContent), "status line names the job and phase");
    ok(p.document.getElementById("start").disabled === true && p.document.getElementById("stop").disabled === false, "Start disabled and Stop enabled while running");
    ok(p.document.getElementById("log-details").open === true, "the log starts expanded while a run is active");
    p.win.close();
  }
  {
    const store = {
      settings: Object.assign({}, FULL, { step_by_step: true }), running: true, run: { runId: "r", live: false },
      current: { jobIndex: 1, phase: "awaiting_confirmation", awaiting: "next" },
      queue: [{ projectId: "proj-zero", modelSlug: "claude-haiku-4-5", status: "skipped", message: "skipped: already enabled" },
        { projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "awaiting_confirmation", awaiting: "next", step: "waiting for your confirmation before Next", message: "" }]
    };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ok(/^waiting for your confirmation on proj-one\/claude-haiku-4-5: Next \(job 2\/2\)/.test(p.document.getElementById("status").textContent), "awaiting_confirmation: the status says whose confirmation is awaited and for which step", p.document.getElementById("status").textContent);
    p.win.close();
  }
  {
    const store = { settings: Object.assign({}, FULL), running: false, run: { runId: "r", live: false, finishedAt: 1, reason: "all jobs processed" }, queue: [] };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ok(p.document.getElementById("log-details").open === false, "with no run active the log starts folded");
    p.win.close();
  }

  E.finish("ui pages");
})();
