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
const fakeIDB = require("./lib/fake-idb.cjs");
// A node-side copy of the per-run log module, sharing the same fake database
// as the pages, so seed() can build records (and their lines) with the real
// API and the tests can compute the expected text/size from the store.
globalThis.indexedDB = fakeIDB;
globalThis.IDBKeyRange = fakeIDB.IDBKeyRange;
require(path.join(E.EXT, "common/constants.js"));
require(path.join(E.EXT, "common/runlog.js"));
const RLNODE = globalThis.MGC_RUNLOG;

const FULL = { business_name: "b", business_website: "https://b.example", contact_email: "a@b.example", headquarters: "Elsewhere", industry: "Education", intended_users: "Internal employees", use_cases: "x", aup_additional_requirements: "no", aup_details: "", live_mode: false };
const MANIFEST_VERSION = JSON.parse(fs.readFileSync(path.join(E.EXT, "manifest.json"), "utf8")).version;

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
    runtime: { openOptionsPage: () => { store.__opened = (store.__opened || 0) + 1; }, sendMessage: (m, cb) => { (store.__messages = store.__messages || []).push(m); cb(store.__reply ? store.__reply(m) : { ok: true }); }, getURL: (p) => "chrome-extension://x/" + p, getManifest: () => ({ version: MANIFEST_VERSION }), lastError: undefined },
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
  win.indexedDB = fakeIDB; // the per-run logs (common/runlog.js); fakeIDB.reset() between pages that must start empty
  win.IDBKeyRange = fakeIDB.IDBKeyRange; // the line store's index cursors use it
  win.Blob = Blob; // Node's Blob (jsdom's has no text()); a download's content is read back from it
  win.URL.createObjectURL = (blob) => { (store.__blobs = store.__blobs || []).push(blob); return `blob:x/${store.__blobs.length}`; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () { (store.__downloads = store.__downloads || []).push({ href: this.href, download: this.download }); };
  win.fetch = async () => ({ json: async () => JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")) });
  const ctx = dom.getInternalVMContext();
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
  await new Promise((r) => setTimeout(r, 30)); // DOMContentLoaded + async load()
  return { dom, win, document: win.document, K: win.MGC, O: win.MGC_OPTIONS, RL: win.MGC_RUNLOG };
}

const OPTIONS_SCRIPTS = ["common/constants.js", "common/option-lists.js", "common/runlog.js", "options/options.js"];
const POPUP_SCRIPTS = ["common/constants.js", "popup/popup.js"];
const RUNS_SCRIPTS = ["common/constants.js", "common/runlog.js", "runs/runs.js"];
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
    ok(/model_ready_ms, api_dialog_close_ms, form_ready_ms, form_valid_ms, next_button_ms, nav_ms, agreements_ready_ms, confirm_ms, agree_grace_ms, poll_ms, settle_ms, watchdog_min/.test(p.document.getElementById("timing-keys").textContent), "the key list is shown (agree_grace_ms included, T1)");
    ok(K.TIMING_DEFAULTS.settle_ms === 0 && K.TIMING_DEFAULTS.poll_ms === 250 && K.TIMING_DEFAULTS.confirm_ms === 60000 && K.TIMING_DEFAULTS.agree_grace_ms === 15000 && K.TIMING_DEFAULTS.watchdog_min === 10, "defaults: settle 0, poll 250 ms, confirm 60 s, agree grace 15 s, watchdog 10 min", JSON.stringify(K.TIMING_DEFAULTS));
    ok(JSON.stringify(K.TIMING_BOUNDS.agree_grace_ms) === "[1000,600000]" && K.validateTiming({ agree_grace_ms: 500 }).errors.some((e) => /agree_grace_ms must be between 1000 and 600000/.test(e)) && K.validateTiming({ agree_grace_ms: 20000 }).ok, "agree_grace_ms is bounded 1000-600000 and validated like the other keys (T1)");
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
    const pairs = [["popup/popup.js", "popup/popup.html"], ["options/options.js", "options/options.html"], ["runs/runs.js", "runs/runs.html"]];
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
      for (const [rel, scripts] of [["popup/popup.html", POPUP_SCRIPTS], ["options/options.html", OPTIONS_SCRIPTS], ["runs/runs.html", RUNS_SCRIPTS]]) {
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
        dom.window.indexedDB = fakeIDB; // empty at this point: the runs page must render its empty state
        dom.window.fetch = async () => ({ json: async () => JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")) });
        const ctx = dom.getInternalVMContext();
        try {
          for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
        } catch (e) { errors.push(`thrown while loading: ${e.message}`); }
        await tick(); await tick(); await tick();
        process.off("unhandledRejection", onRejection);
        const d = dom.window.document;
        const rendered = rel.startsWith("popup") ? /MODE: DRY RUN/.test(d.getElementById("mode").textContent) && d.querySelectorAll("#models input").length === 12 && d.querySelectorAll("#models input:checked").length === 0 && (stateName === "idle" ? d.getElementById("status").textContent === "idle" : d.getElementById("summary").hidden === false && d.querySelectorAll("#results tbody tr").length === 2)
          : rel.startsWith("runs") ? d.getElementById("empty").hidden === false && d.getElementById("notice").hidden === true && d.getElementById("keep").textContent === "50"
          : d.getElementById("form").elements.business_name.value === "b" && d.getElementById("form").elements.industry_choice && d.getElementById("form").elements.industry_choice.value === "Education" && d.getElementById("form").elements.runs_keep.value === "50";
        ok(errors.length === 0 && rendered, `${rel} in the ${stateName} state: loaded, initialised and rendered with no thrown error and no unhandled rejection`, errors.join(" | ") || (rendered ? "" : "render check failed"));
        dom.window.close();
      }
    }
  }

  console.log("--- (T5) popup: no model is ticked by default; the last selection is remembered in storage.local");
  {
    const store = { settings: Object.assign({}, FULL), running: false };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    let d = p.document;
    ok(d.querySelectorAll("#models input").length === 12 && d.querySelectorAll("#models input:checked").length === 0 && store.popup_state && store.popup_state.models.length === 0 && store.popup_state.version === MANIFEST_VERSION, "first use (no popup_state): twelve models, none ticked; the version marker is stored with an empty selection", `${d.querySelectorAll("#models input:checked").length} ticked, ps ${JSON.stringify(store.popup_state)}`);
    d.getElementById("projects").value = "proj-one";
    d.getElementById("start").click(); await tick();
    ok(/select at least one model/.test(d.getElementById("error").textContent) && !(store.__messages || []).some((m) => m.type === p.K.MSG.START), "Start with nothing ticked is refused in the popup, no START message", d.getElementById("error").textContent);
    const haiku = Array.from(d.querySelectorAll("#models input")).find((cb) => cb.value === "claude-haiku-4-5");
    haiku.checked = true; haiku.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(store.popup_state && JSON.stringify(store.popup_state.models) === JSON.stringify(["claude-haiku-4-5"]) && store.popup_state.projects === "proj-one", "ticking one model stores exactly that selection (with the project text) under popup_state", JSON.stringify(store.popup_state));
    p.win.close();
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS); d = p.document;
    const ticked = Array.from(d.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(JSON.stringify(ticked) === JSON.stringify(["claude-haiku-4-5"]), "reopening the popup restores the one ticked model, the rest unticked", JSON.stringify(ticked));
    // loadPage stubs HTMLAnchorElement.prototype.click (download capture), so the links get a dispatched click.
    const clickLink = (id) => d.getElementById(id).dispatchEvent(new p.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    clickLink("models-all"); await tick();
    ok(d.querySelectorAll("#models input:checked").length === 12 && store.popup_state.models.length === 12, "the all link ticks every model and stores it", JSON.stringify(store.popup_state.models));
    clickLink("models-none"); await tick();
    ok(d.querySelectorAll("#models input:checked").length === 0 && store.popup_state.models.length === 0, "the none link unticks every model and stores the empty selection", JSON.stringify(store.popup_state.models));
    p.win.close();
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS); d = p.document;
    ok(d.querySelectorAll("#models input:checked").length === 0, "a stored empty selection reopens with nothing ticked (never all)");
    p.win.close();
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
    ok(creates.length === 3 && creates.filter((c) => /active:\s*true/.test(c)).length === 1 && creates.some((c) => /runs\/runs\.html/.test(c)), "tabs.create: the worker tab (opened in front right after Start), the Open-in-a-tab page and the Runs page only", creates.join(" | "));
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
    ok(manifest.version === "0.6.1", "the manifest version is 0.6.1", manifest.version);
    ok(JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "alarms"]) && !/"downloads"|"unlimitedStorage"|"notifications"|"tabs"/.test(JSON.stringify(manifest.permissions)), "0.6.1 added no permission: still exactly storage and alarms (no downloads, unlimitedStorage, notifications or tabs)", JSON.stringify(manifest.permissions));
    ok(!("web_accessible_resources" in manifest), "runs.html is an extension page opened by its extension URL: no web_accessible_resources");
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

  console.log('--- popup: the "Runs" link in the header, next to "Open in a tab"');
  {
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    const runs = doc.getElementById("runs");
    const openTab = doc.getElementById("open-tab");
    ok(runs && runs.tagName === "A" && runs.closest("header") && runs.textContent === "Runs" && /full log/.test(runs.title), 'the header has a "Runs" link whose title names the full log', runs && runs.title);
    ok(runs.parentElement === openTab.parentElement && runs.parentElement.classList.contains("header-links") && runs.nextElementSibling === openTab, 'it sits next to "Open in a tab" in the same header row');
    store.__closed = false; p.win.close = () => { store.__closed = true; };
    runs.dispatchEvent(new p.win.MouseEvent("click", { bubbles: true, cancelable: true })); // (loadPage stubs HTMLAnchorElement.prototype.click to capture downloads)
    ok(store.__tab === "chrome-extension://x/runs/runs.html" && store.__closed === false, "clicking it opens runs/runs.html in a new tab through chrome.tabs.create (the popup stays)", store.__tab);
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/header \.header-links\s*\{[^}]*display:\s*flex/.test(css), "popup.css lays the two links out in a row");
    p.win.close();
  }

  console.log("--- the Runs page: list newest first, download text format, delete and purge with confirm, no innerHTML");
  const RUN_A = { runId: "run-a", startedAt: Date.UTC(2026, 9, 8, 10, 5, 0), finishedAt: Date.UTC(2026, 9, 8, 10, 9, 30), live: false, stepByStep: false, reason: "all jobs processed",
    jobs: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5" }, { projectId: "proj-two", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5" }],
    results: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", status: "dry-run", message: "dry run: checkbox ticked", startedAt: Date.UTC(2026, 9, 8, 10, 5, 1), finishedAt: Date.UTC(2026, 9, 8, 10, 7, 0), productId: "anthropic/anthropic-867.cloudpartnerservices.goog", agreeClicked: false },
      { projectId: "proj-two", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5", status: "skipped", message: "skipped: already enabled", startedAt: Date.UTC(2026, 9, 8, 10, 7, 1), finishedAt: Date.UTC(2026, 9, 8, 10, 9, 29), productId: null, agreeClicked: false }],
    lines: [{ t: Date.UTC(2026, 9, 8, 10, 5, 0, 10), level: "info", src: "worker", msg: "run run-a started: 2 project(s) x 1 model(s) = 2 job(s), mode DRY RUN" },
      { t: Date.UTC(2026, 9, 8, 10, 5, 2), level: "info", src: "content", msg: "model page detected +1200ms" },
      { t: Date.UTC(2026, 9, 8, 10, 5, 3), level: "warn", src: "content", msg: "tick failed: TypeError: <script>alert(1)</script> & \"quoted\" text\nsecond line" },
      { t: Date.UTC(2026, 9, 8, 10, 9, 30), level: "info", src: "worker", msg: "run finished: all jobs processed" }] };
  const RUN_B = Object.assign({}, RUN_A, { runId: "run-b", startedAt: Date.UTC(2026, 9, 8, 12, 0, 0), finishedAt: Date.UTC(2026, 9, 8, 12, 3, 0), live: true, stepByStep: true, reason: "stopped by user",
    results: [Object.assign({}, RUN_A.results[0], { status: "done", message: "Successfully purchased" }), Object.assign({}, RUN_A.results[1], { status: "stopped", message: "stopped by user" })],
    lines: RUN_A.lines.slice(0, 2) });
  const RUN_C = { runId: "run-c", startedAt: Date.UTC(2026, 9, 8, 13, 0, 0), finishedAt: null, live: false, stepByStep: false, reason: null, jobs: RUN_A.jobs, results: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running" }, { projectId: "proj-two", modelSlug: "claude-haiku-4-5", status: "pending" }], lines: [RUN_A.lines[0]] };
  // Build each record (and its line records) with the real schema-v2 API:
  // create the run, append its lines (the counters follow), then close it
  // with its results and reason. The fake database is shared with the pages.
  async function seed(records) {
    fakeIDB.reset();
    for (const r of records) {
      await RLNODE.create({ runId: r.runId, startedAt: r.startedAt, live: r.live, finishedAt: r.finishedAt }, r.jobs || [], r.stepByStep);
      for (const ln of (r.lines || [])) await RLNODE.append(r.runId, ln);
      await RLNODE.update(r.runId, { finishedAt: r.finishedAt, reason: r.reason, results: r.results });
    }
  }
  {
    // Empty database.
    await seed([]);
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("runs/runs.html", store, RUNS_SCRIPTS);
    const doc = p.document;
    ok(doc.title === "Model Garden Clicker runs" && /href="\.\.\/common\/theme\.css"/.test(fs.readFileSync(path.join(E.EXT, "runs/runs.html"), "utf8")) && doc.querySelector("header img.photo"), "runs.html: titled, links common/theme.css, shows the avatar in its header");
    ok(doc.getElementById("empty").hidden === false && doc.getElementById("runs").hidden === true && doc.getElementById("purge-all").disabled === true && doc.getElementById("download-all").disabled === true, "with no records: the empty message shows, the table is hidden, Purge all and Download all are disabled");
    ok(doc.getElementById("keep").textContent === "50", "the intro names the retention (default 50)");
    ok(!/#[0-9a-f]{3,6}\b/i.test(fs.readFileSync(path.join(E.EXT, "runs/runs.css"), "utf8")), "runs.css carries no literal colours; every colour is a var(--mgc-*)");
    p.win.close();
  }
  {
    await seed([RUN_A, RUN_B, RUN_C]);
    const store = { settings: Object.assign({}, FULL), running: true, run: { runId: "run-c", live: false, startedAt: RUN_C.startedAt }, runs_keep: 7 };
    const p = await loadPage("runs/runs.html", store, RUNS_SCRIPTS);
    const { document: doc, RL, K } = p;
    const rows = Array.from(doc.querySelectorAll("#runs tbody tr"));
    ok(rows.length === 3 && rows.map((r) => r.dataset.runId).join() === "run-c,run-b,run-a" && doc.getElementById("empty").hidden === true && doc.getElementById("runs").hidden === false, "three runs listed newest first (by startedAt)", rows.map((r) => r.dataset.runId).join());
    ok(doc.getElementById("keep").textContent === "7", "the intro shows the stored runs_keep");
    const cells = (tr) => Array.from(tr.querySelectorAll("td")).map((td) => td.textContent);
    const a = cells(rows[2]);
    ok(a[0] === `${new Date(RUN_A.startedAt).toLocaleString()}ended ${new Date(RUN_A.finishedAt).toLocaleString()}: all jobs processed`, "started and ended with the reason", a[0]);
    ok(a[1] === "DRY RUN" && cells(rows[1])[1] === "FULL RUN · step-by-step" && rows[1].querySelector("td.mode .live") && !rows[2].querySelector("td.mode .live"), "the mode cell: DRY RUN, or FULL RUN in the warning colour, with the step-by-step mark", cells(rows[1])[1]);
    ok(a[2] === "2" && a[3] === "done 0 · dry-run 1 · skipped 1 · failed 0 · unverified 0 · stopped 0", "jobs and the six counts (as the popup's summary counts them)", a[3]);
    ok(cells(rows[1])[3] === "done 1 · dry-run 0 · skipped 0 · failed 0 · unverified 0 · stopped 1" && cells(rows[0])[3] === "done 0 · dry-run 0 · skipped 0 · failed 0 · unverified 0 · stopped 0 · pending 2", "counts of the other runs (a pending count only when some job is pending)", cells(rows[0])[3]);
    const recA = await RLNODE.get("run-a");
    const sizeA = RL.sizeOf(recA);
    ok(recA.lineCount === 4 && recA.byteCount > 0 && a[4] === `4 lines · ${RL.sizeText(sizeA)}` && sizeA > 800 && /^\d+(\.\d)? KB$/.test(RL.sizeText(sizeA)), "the log cell: the line count (from the counter) and the size from the counters (schema v2)", `${a[4]} (lineCount ${recA.lineCount}, byteCount ${recA.byteCount}, sizeOf ${sizeA})`);
    ok(/\(in progress\)/.test(cells(rows[0])[0]) && rows[0].querySelector("td.actions button.delete").disabled === true && rows[2].querySelector("td.actions button.delete").disabled === false, "the run in progress is marked and its Delete is disabled; an older run's Delete is enabled");
    ok(rows.every((r) => r.querySelectorAll("td.actions button").length === 2 && r.querySelector("button.download").textContent === "Download log" && r.querySelector("button.delete").textContent === "Delete"), 'every row has "Download log" and "Delete"');
    // The hostile log line was rendered as text, never as markup.
    ok(!doc.querySelector("script") || Array.from(doc.querySelectorAll("script")).every((s) => s.getAttribute("src")) , "no inline <script> element was created from a log line");
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(fs.readFileSync(path.join(E.EXT, "runs/runs.js"), "utf8")) && !/innerHTML|insertAdjacentHTML/.test(fs.readFileSync(path.join(E.EXT, "common/runlog.js"), "utf8")), "runs.js (and runlog.js) never use innerHTML, outerHTML, insertAdjacentHTML or document.write");

    // Download log: a text file in memory, saved through an anchor with the download attribute and an object URL.
    rows[2].querySelector("button.download").click(); await tick(); await tick();
    ok(store.__downloads && store.__downloads.length === 1 && store.__downloads[0].download === "model-garden-clicker-run-20261008-" + `${String(new Date(RUN_A.startedAt).getHours()).padStart(2, "0")}0500.txt` && /^blob:/.test(store.__downloads[0].href), "Download log clicks an anchor with download=model-garden-clicker-run-<YYYYMMDD-HHMMSS>.txt (local time of the start) and an object URL", JSON.stringify(store.__downloads));
    const blob = store.__blobs[0];
    const text = await blob.text();
    const expectedA = RLNODE.textOf(recA, await RLNODE.readLines("run-a"));
    ok(blob.type.startsWith("text/plain") && text === expectedA, "the file is text/plain holding MGC_RUNLOG.textOf(record, lines read by the index cursor)", blob.type);
    const lines = text.split("\n");
    ok(lines[0] === "Model Garden Clicker run log" && lines[1] === "run id:        run-a" && lines[2] === "started:       2026-10-08T10:05:00.000Z" && lines[3] === "ended:         2026-10-08T10:09:30.000Z" && lines[4] === "mode:          DRY RUN" && lines[5] === "step-by-step:  off" && lines[6] === "reason:        all jobs processed" && lines[7] === "jobs:          2 (done 0 · dry-run 1 · skipped 1 · failed 0 · unverified 0 · stopped 0)" && lines[8] === "log lines:     4",
      "the header block: run id, start, end (ISO), mode, step-by-step, reason, jobs with counts, line count", lines.slice(0, 9).join(" | "));
    const tableStart = lines.indexOf("job  project   model             status   started                   ended                     message");
    ok(tableStart === 10 && lines[11] === "1    proj-one  claude-haiku-4-5  dry-run  2026-10-08T10:05:01.000Z  2026-10-08T10:07:00.000Z  dry run: checkbox ticked" && lines[12] === "2    proj-two  claude-haiku-4-5  skipped  2026-10-08T10:07:01.000Z  2026-10-08T10:09:29.000Z  skipped: already enabled", "then the job results as a plain-text table", lines.slice(10, 13).join(" | "));
    const logStart = lines.indexOf("log:");
    ok(logStart === 14 && lines[15] === "2026-10-08T10:05:00.010Z worker [info] run run-a started: 2 project(s) x 1 model(s) = 2 job(s), mode DRY RUN" && lines[16] === "2026-10-08T10:05:02.000Z content [info] model page detected +1200ms",
      'then one line per entry: "<ISO timestamp> <source> [<level>] <message>"', lines.slice(14, 17).join(" | "));
    ok(lines[17] === "2026-10-08T10:05:03.000Z content [warn] tick failed: TypeError: <script>alert(1)</script> & \"quoted\" text second line" && lines[18] === "2026-10-08T10:09:30.000Z worker [info] run finished: all jobs processed" && lines[19] === "" && lines.length === 20,
      "a message's own newlines are folded into the line; markup in a message is kept as text; the file ends with one newline", lines.slice(17).join(" | "));
    for (const v of ["b.example", "a@b.example", "Elsewhere", "Education", "Internal employees"]) ok(!text.includes(v), `no questionnaire value in the log text: ${v}`);
    // Download all: every run under its own header, newest first.
    doc.getElementById("download-all").click(); await tick(); await tick();
    const all = await store.__blobs[1].text();
    ok(store.__downloads.length === 2 && /^model-garden-clicker-runs-\d{8}-\d{6}\.txt$/.test(store.__downloads[1].download), "Download all saves model-garden-clicker-runs-<now>.txt", store.__downloads[1].download);
    // The header is "run <id> started <ISO>"; a log line reads "run <id> started: N project(s)" (RUN_B's lines are copied from RUN_A), so the needle carries the date.
    const order = ["\nrun run-c started 2026-", "\nrun run-b started 2026-", "\nrun run-a started 2026-"].map((h) => all.indexOf(h));
    const allParts = { head: /^Model Garden Clicker: 3 run\(s\), newest first/.test(all), order: order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), textA: all.includes(expectedA), rules: (all.match(/^=+$/gm) || []).length };
    ok(allParts.head && allParts.order && allParts.textA && allParts.rules === 6, "one text with every run separated by headers, newest first, each run's full text included", JSON.stringify(allParts) + " " + JSON.stringify(all.slice(0, 120)));

    // Delete: confirm names the run; declined does nothing; accepted sends RUNS_DELETE to the worker; a refusal is shown.
    const confirms = [];
    p.win.confirm = (m) => { confirms.push(m); return false; };
    rows[2].querySelector("button.delete").click(); await tick();
    ok(confirms.length === 1 && confirms[0].includes(new Date(RUN_A.startedAt).toLocaleString()) && /4 lines/.test(confirms[0]) && !(store.__messages || []).length, "Delete asks (naming the run's start and line count); declined sends nothing", confirms[0]);
    p.win.confirm = (m) => { confirms.push(m); return true; };
    store.__reply = (m) => (m.type === K.MSG.RUNS_DELETE ? { ok: false, error: "that run is in progress; stop it first" } : { ok: true });
    rows[2].querySelector("button.delete").click(); await tick(); await tick();
    ok((store.__messages || []).filter((m) => m.type === K.MSG.RUNS_DELETE && m.runId === "run-a").length === 1 && doc.getElementById("notice").hidden === false && /in progress/.test(doc.getElementById("notice").textContent), "accepted: mgc:runs-delete with the run id goes to the worker; its refusal is shown in the notice", doc.getElementById("notice").textContent);
    ok(doc.querySelectorAll("#runs tbody tr").length === 3, "the list was re-read (nothing deleted by the page itself: the worker is the only writer)");
    // Purge all: the confirm states the number of runs; declined does nothing; accepted sends RUNS_PURGE.
    store.__reply = null; store.__messages = [];
    p.win.confirm = (m) => { confirms.push(m); return false; };
    doc.getElementById("purge-all").click(); await tick(); await tick();
    ok(/Delete the full logs of all 3 run\(s\)\?/.test(confirms[confirms.length - 1]) && !store.__messages.length, "Purge all asks with the number of runs (3); declined sends nothing", confirms[confirms.length - 1]);
    p.win.confirm = () => true;
    store.__reply = (m) => (m.type === K.MSG.RUNS_PURGE ? { ok: true, deleted: 2, kept: 1 } : { ok: true });
    doc.getElementById("purge-all").click(); await tick(); await tick();
    ok(store.__messages.filter((m) => m.type === K.MSG.RUNS_PURGE).length === 1 && /2 run log\(s\) deleted; the run in progress keeps its log/.test(doc.getElementById("notice").textContent), "accepted: mgc:runs-purge goes to the worker; the reply (2 deleted, the run in progress kept) is shown", doc.getElementById("notice").textContent);
    // A run ending re-renders the list (KEYS.RUNNING flips).
    await seed([RUN_A]);
    store.running = false;
    p.win.chrome.__fire({ running: { newValue: false } }); await tick(); await tick();
    ok(doc.querySelectorAll("#runs tbody tr").length === 1 && doc.querySelector("#runs tbody tr").dataset.runId === "run-a", "a change of KEYS.RUNNING re-reads the list");
    p.win.close();
  }
  {
    // A database that cannot be opened: the notice says so, nothing throws.
    fakeIDB.reset(); fakeIDB.openError = "blocked by policy";
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("runs/runs.html", store, RUNS_SCRIPTS);
    ok(p.document.getElementById("notice").hidden === false && /could not open the run log database: blocked by policy/.test(p.document.getElementById("notice").textContent) && p.document.getElementById("empty").hidden === false, "an unopenable database is reported in the notice; the page still renders", p.document.getElementById("notice").textContent);
    fakeIDB.reset();
    p.win.close();
  }

  console.log("--- (U4) the downloaded log replaces control characters (except tab and newline) and bidi controls with U+FFFD");
  {
    fakeIDB.reset();
    // The review's sample: ESC sequences, CR, NUL, BEL, line/paragraph
    // separators, a right-to-left override and a right-to-left mark, plus a
    // tab (kept) and a newline (folded to a space).
    const esc = String.fromCharCode(0x1b), cr = String.fromCharCode(0x0d), nul = String.fromCharCode(0x00), bel = String.fromCharCode(0x07);
    const ls = String.fromCharCode(0x2028), ps = String.fromCharCode(0x2029), rlo = String.fromCharCode(0x202e), rlm = String.fromCharCode(0x200f);
    const hostile = `tick failed: ${esc}[31mred${esc}[0m\tTAB${cr}CR${nul}NUL${bel}BEL${ls}LS${ps}PS${rlo}RLO${rlm}RLM\nsecond line`;
    const forbidden = [0x1b, 0x0d, 0x00, 0x07, 0x2028, 0x2029, 0x202e, 0x200f];
    await RLNODE.create({ runId: "r-clean", startedAt: Date.UTC(2026, 9, 8, 10, 0, 0), live: false }, [], false);
    await RLNODE.append("r-clean", { t: Date.UTC(2026, 9, 8, 10, 0, 0), level: "warn", src: "content", msg: hostile });
    const rec = await RLNODE.get("r-clean");
    const text = RLNODE.textOf(rec, await RLNODE.readLines("r-clean"));
    const line = text.split("\n").find((l) => /red/.test(l)) || "";
    const expectedFffd = Array.from(hostile).filter((c) => forbidden.includes(c.charCodeAt(0))).length; // two ESC, so 9
    const stillForbidden = Array.from(line).filter((c) => forbidden.includes(c.charCodeAt(0)));
    const fffd = (line.match(/�/g) || []).length;
    ok(stillForbidden.length === 0 && fffd === expectedFffd, `every control and bidi character is replaced with U+FFFD (${fffd} of ${expectedFffd}; none left)`, JSON.stringify(stillForbidden));
    ok(line.includes("\tTAB") && /red/.test(line) && /second line/.test(line), "a tab is kept, the message's own newline is folded to a space, and the readable text survives", JSON.stringify(line));
    fakeIDB.reset();
  }

  console.log("--- (U2 migration) a v1 database upgrades to v2: embedded lines move to the line store, counters filled, nothing lost");
  {
    fakeIDB.reset();
    const v1lines = [
      { t: Date.UTC(2026, 9, 8, 11, 0, 0), level: "info", src: "worker", msg: "run v1run started: 1 project(s) x 1 model(s) = 1 job(s), mode DRY RUN" },
      { t: Date.UTC(2026, 9, 8, 11, 0, 1), level: "info", src: "content", msg: "model page detected +900ms" },
      { t: Date.UTC(2026, 9, 8, 11, 0, 2), level: "info", src: "worker", msg: "run finished: all jobs processed" }
    ];
    const v1rec = { runId: "v1run", startedAt: Date.UTC(2026, 9, 8, 11, 0, 0), finishedAt: Date.UTC(2026, 9, 8, 11, 0, 2), live: false, stepByStep: false, reason: "all jobs processed",
      jobs: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5" }],
      results: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "dry-run", message: "checkbox ticked" }],
      lines: v1lines };
    // Write it as schema v1: database version 1, a single "runs" store, the
    // lines embedded on the record (no "lines" store, no counters).
    await new Promise((resolve, reject) => {
      const req = fakeIDB.open("mgc-runs", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("runs", { keyPath: "runId" });
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("runs", "readwrite");
        tx.objectStore("runs").put(v1rec);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    // First v2 access triggers the upgrade handler's migration.
    const rec = await RLNODE.get("v1run");
    const lines = await RLNODE.readLines("v1run");
    const lineStore = fakeIDB.dump("mgc-runs", "lines").filter((l) => l.runId === "v1run").sort((a, b) => a.seq - b.seq);
    ok(rec && !("lines" in rec) && rec.lineCount === 3 && rec.byteCount > 0, "the migrated record holds counters, not a lines array", JSON.stringify({ lineCount: rec && rec.lineCount, byteCount: rec && rec.byteCount, hasLines: rec && "lines" in rec }));
    ok(lineStore.length === 3 && lineStore.every((l, i) => l.seq === i) && lineStore.map((l) => l.msg).join("|") === v1lines.map((l) => l.msg).join("|"), "the three embedded lines moved to the line store, keyed by seq, in order, nothing lost", JSON.stringify(lineStore.map((l) => l.msg)));
    ok(lines.map((l) => l.msg).join("|") === v1lines.map((l) => l.msg).join("|") && rec.reason === "all jobs processed" && rec.results[0].status === "dry-run", "readLines returns the migrated lines and the record's metadata is intact");
    fakeIDB.reset();
  }

  console.log("--- (N5) the v1->v2 migration drops malformed lines (null, non-object) with one warning instead of aborting the versionchange");
  {
    fakeIDB.reset();
    const warns = []; const origWarn = console.warn; console.warn = (...a) => { warns.push(a.join(" ")); };
    try {
      const good0 = { t: Date.UTC(2026, 9, 8, 12, 0, 0), level: "info", src: "worker", msg: "good line zero" };
      const good2 = { t: Date.UTC(2026, 9, 8, 12, 0, 2), level: "info", src: "content", msg: "good line two" };
      // A v1 lines array with a null and a bare string between two good lines.
      const v1lines = [good0, null, "a bare string line", good2];
      const v1rec = { runId: "v1bad", startedAt: Date.UTC(2026, 9, 8, 12, 0, 0), finishedAt: Date.UTC(2026, 9, 8, 12, 0, 3), live: false, stepByStep: false, reason: "all jobs processed",
        jobs: [{ projectId: "proj-bad", modelSlug: "claude-haiku-4-5", modelName: "Claude Haiku 4.5" }],
        results: [{ projectId: "proj-bad", modelSlug: "claude-haiku-4-5", status: "dry-run", message: "checkbox ticked" }],
        lines: v1lines };
      await new Promise((resolve, reject) => {
        const req = fakeIDB.open("mgc-runs", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("runs", { keyPath: "runId" });
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction("runs", "readwrite");
          tx.objectStore("runs").put(v1rec);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      // The first v2 access runs the migration; it must resolve (not abort).
      const rec = await RLNODE.get("v1bad");
      const lines = await RLNODE.readLines("v1bad");
      const lineStore = fakeIDB.dump("mgc-runs", "lines").filter((l) => l.runId === "v1bad").sort((a, b) => a.seq - b.seq);
      ok(rec && !("lines" in rec) && rec.lineCount === 2, "(N5) the upgrade completed and the record holds only the two good lines (the null and the string dropped)", JSON.stringify({ lineCount: rec && rec.lineCount, hasLines: rec && "lines" in rec }));
      ok(lineStore.length === 2 && lineStore[0].seq === 0 && lineStore[1].seq === 1 && lineStore.map((l) => l.msg).join("|") === "good line zero|good line two", "(N5) the two surviving lines are contiguous from seq 0, in order, with the bad entries gone", JSON.stringify(lineStore.map((l) => [l.seq, l.msg])));
      ok(lines.length === 2 && lines.map((l) => l.msg).join("|") === "good line zero|good line two", "(N5) readLines returns the two good lines");
      ok(warns.some((w) => /migration/.test(w) && /dropped 2/.test(w)), "(N5) one warning names the dropped count", JSON.stringify(warns));
    } finally { console.warn = origWarn; }
    fakeIDB.reset();
  }

  console.log("--- (N6) the sanitiser also replaces C1 controls, zero-width characters, the soft hyphen and tag characters with U+FFFD");
  {
    fakeIDB.reset();
    // C1 (NEL U+0085, CSI U+009B, APC U+009F), soft hyphen U+00AD,
    // zero-width U+200B-U+200D, word joiner U+2060, BOM U+FEFF, and a tag
    // character U+E0041 (astral).
    const samples = [0x0085, 0x009b, 0x009f, 0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xe0041];
    const msg = "ZZSTART" + samples.map((c) => String.fromCodePoint(c)).join("") + "ZZEND";
    await RLNODE.create({ runId: "r-n6", startedAt: Date.UTC(2026, 9, 8, 13, 0, 0), live: false }, [], false);
    await RLNODE.append("r-n6", { t: Date.UTC(2026, 9, 8, 13, 0, 0), level: "warn", src: "content", msg });
    const rec = await RLNODE.get("r-n6");
    const text = RLNODE.textOf(rec, await RLNODE.readLines("r-n6"));
    const line = text.split("\n").find((l) => /ZZSTART/.test(l)) || "";
    const stillForbidden = Array.from(line).filter((c) => samples.includes(c.codePointAt(0)));
    const fffd = Array.from(line).filter((c) => c === "�").length;
    ok(stillForbidden.length === 0 && fffd === samples.length, `(N6) every C1, zero-width, soft-hyphen and tag sample is replaced with U+FFFD (${fffd} of ${samples.length}; none left)`, JSON.stringify(stillForbidden.map((c) => c.codePointAt(0).toString(16))));
    ok(/ZZSTART/.test(line) && /ZZEND/.test(line), "(N6) the readable text around the hidden characters survives", JSON.stringify(line));
    fakeIDB.reset();
  }

  console.log("--- (U3) first load of a new version resets the model selection to none, once; later loads keep it");
  {
    const models12 = JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")).map((m) => m.slug);
    // A 0.4.0-shaped popup_state: every model ticked, no version marker.
    const store = { settings: Object.assign({}, FULL), popup_state: { projects: "proj-one", models: models12.slice(), extra: "" } };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    let ticked = Array.from(p.document.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(models12.length >= 1 && ticked.length === 0 && store.popup_state.version === MANIFEST_VERSION && store.popup_state.models.length === 0, "a 0.4.0 popup_state (all models ticked, no version) loads with none ticked and records the version marker", `${ticked.length} ticked, version ${store.popup_state.version}`);
    p.win.close();
    // The user now picks one model; it is stored with the current version.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const one = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === models12[0]);
    one.checked = true; one.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(JSON.stringify(store.popup_state.models) === JSON.stringify([models12[0]]), "the user's pick is stored with the version marker");
    p.win.close();
    // A second load at the same version keeps the user's selection.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ticked = Array.from(p.document.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(JSON.stringify(ticked) === JSON.stringify([models12[0]]), "a later load at the same version keeps whatever the user picked (no second reset)", JSON.stringify(ticked));
    p.win.close();
    // The include-done box is a per-run choice: it defaults off, is NOT
    // written to popup_state, is still sent with Start, and is cleared after
    // a successful Start.
    const store2 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store2, POPUP_SCRIPTS);
    ok(p.document.getElementById("include-done") && p.document.getElementById("include-done").checked === false, 'the "Include pairs already done in earlier runs" box exists and is unchecked by default');
    const box = p.document.getElementById("include-done");
    box.checked = true; box.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    p.document.getElementById("projects").value = "proj-x";
    const haiku = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === models12[0]);
    haiku.checked = true; haiku.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(!("includeDone" in (store2.popup_state || {})), "(N1) ticking the box is NOT written to popup_state (it is a per-run choice, not a saved setting)", JSON.stringify(store2.popup_state));
    p.document.getElementById("start").click(); await tick();
    const startMsg = (store2.__messages || []).find((m) => m.type === p.K.MSG.START);
    ok(startMsg && startMsg.includeDone === true, "(N1) ticking the box is still sent with Start", JSON.stringify({ sent: startMsg && startMsg.includeDone }));
    ok(!("includeDone" in (store2.popup_state || {})) && box.checked === false, "(N1) after a successful Start the box state is not stored and the box is cleared", JSON.stringify({ stored: store2.popup_state.includeDone, boxChecked: box.checked }));
    p.win.close();
    // A stored legacy includeDone (from an older popup_state) is ignored: the
    // box loads unchecked regardless.
    const store3 = { settings: Object.assign({}, FULL), popup_state: { projects: "proj-y", models: [], extra: "", includeDone: true, version: MANIFEST_VERSION } };
    p = await loadPage("popup/popup.html", store3, POPUP_SCRIPTS);
    ok(p.document.getElementById("include-done").checked === false, "(N1) a stored legacy includeDone is ignored: the box loads unchecked");
    p.win.close();
    // The full-run confirmation names the override when the box is ticked.
    const store4 = { settings: Object.assign({}, FULL, { live_mode: true }) };
    p = await loadPage("popup/popup.html", store4, POPUP_SCRIPTS);
    const confirms = []; p.win.confirm = (m) => { confirms.push(m); return false; };
    p.document.getElementById("include-done").checked = true;
    p.document.getElementById("projects").value = "proj-z";
    const haiku4 = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === models12[0]);
    haiku4.checked = true; haiku4.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    p.document.getElementById("start").click(); await tick();
    ok(confirms.length === 1 && /FULL RUN/.test(confirms[0]) && /guard is off/.test(confirms[0]) && /pairs already done in earlier runs will be processed again/.test(confirms[0]), "(N1) the full-run confirm names the override when the box is ticked", confirms[0]);
    p.win.close();
    fakeIDB.reset();
  }

  console.log('--- options page: the Logs section ("Runs to keep", Purge all)');
  {
    await seed([RUN_A, RUN_B]);
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    const { document: doc, K } = p;
    const form = doc.getElementById("form");
    const field = form.elements.runs_keep;
    ok(field && field.type === "number" && field.min === "1" && field.max === "500" && field.closest("fieldset.logs") && doc.querySelector("fieldset.logs legend").textContent === "Logs", 'a "Logs" fieldset with a number input runs_keep bounded 1-500');
    ok(field.value === "50", "prefilled with the default 50 when nothing is stored", field.value);
    ok(/runs\/runs\.html/.test(doc.getElementById("runs-link").getAttribute("href")) && doc.getElementById("runs-link").target === "_blank", "the section links the Runs page (new tab)");
    for (const bad of ["0", "501", "abc", "2.5", "", "-3"]) {
      setText(p, "runs_keep", bad);
      const r = await submit(p);
      ok(r.error && /See the Logs section/.test(r.text) && !doc.getElementById("runs-keep-error").hidden && /between 1 and 500/.test(doc.getElementById("runs-keep-error").textContent) && !("runs_keep" in store), `runs_keep ${JSON.stringify(bad)} refuses Save with the reason under the field, nothing stored`, doc.getElementById("runs-keep-error").textContent);
    }
    setText(p, "runs_keep", "20");
    let r = await submit(p);
    ok(!r.error && store.runs_keep === 20 && doc.getElementById("runs-keep-error").hidden === true && field.value === "20", "runs_keep 20 saves KEYS.RUNS_KEEP = 20 (a number) and clears the error", JSON.stringify(store.runs_keep));
    ok(store.settings.business_name === "b" && !("runs_keep" in store.settings), "the value is its own storage key, not a settings field");
    setText(p, "runs_keep", "500");
    r = await submit(p);
    ok(!r.error && store.runs_keep === 500, "500 (the upper bound) saves");
    // Purge all: the confirm states the count from the database; the worker does the deleting.
    const confirms = [];
    p.win.confirm = (m) => { confirms.push(m); return false; };
    doc.getElementById("purge-runs").click(); await tick(); await tick();
    ok(confirms.length === 1 && /Delete the full logs of all 2 run\(s\)\?/.test(confirms[0]) && !(store.__messages || []).some((m) => m.type === K.MSG.RUNS_PURGE), "Purge all asks with the number of runs (2 in the database); declined sends nothing", confirms[0]);
    p.win.confirm = () => true;
    store.__reply = (m) => (m.type === K.MSG.RUNS_PURGE ? { ok: true, deleted: 2, kept: 0 } : { ok: true });
    doc.getElementById("purge-runs").click(); await tick(); await tick();
    ok((store.__messages || []).filter((m) => m.type === K.MSG.RUNS_PURGE).length === 1 && doc.getElementById("purge-note").hidden === false && /2 run log\(s\) deleted\.$/.test(doc.getElementById("purge-note").textContent), "accepted: mgc:runs-purge goes to the worker and the reply is shown", doc.getElementById("purge-note").textContent);
    p.win.close();
    const p2 = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    ok(p2.document.getElementById("form").elements.runs_keep.value === "500", "reloading shows the stored value");
    p2.win.close();
    fakeIDB.reset();
  }

  console.log("--- the release zip and the file table carry the runs page");
  {
    const zipScript = fs.readFileSync(path.join(E.EXT, "..", "scripts/build-extension-zip.sh"), "utf8");
    ok(/background common content icons options popup runs/.test(zipScript), "scripts/build-extension-zip.sh zips the runs directory with the others");
    const readme = fs.readFileSync(path.join(E.EXT, "README.md"), "utf8");
    ok(/`runs\/`/.test(readme) && /`common\/runlog\.js`/.test(readme) && /Runs to keep/.test(readme), "extension/README.md documents runs/, common/runlog.js and the retention setting");
  }

  E.finish("ui pages");
})();
