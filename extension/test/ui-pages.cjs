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
 *   page's boxes follow a change made in the popup. Model list: the recency
 *   helpers in constants.js (release date, model line, version key, the
 *   comparator and the latest set), the checklist sorted newest first with
 *   the date in the tooltip and the stage markers, the latest link with its
 *   note, the pair count line, the parse tolerance for bad fields and the
 *   full-run confirm sentences. Manifest: permissions
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
// The packaged model list: the popup fixtures read it, so a changed file never leaves a hard-coded count behind.
const MODELS_FILE = JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8"));

function fakeChrome(store, extra) {
  const listeners = [];
  return Object.assign({
    storage: {
      local: {
        get: async (keys) => { const ks = Array.isArray(keys) ? keys : [keys]; const o = {}; for (const k of ks) if (k in store) o[k] = JSON.parse(JSON.stringify(store[k])); return o; },
        set: async (obj) => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
        remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; }
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
/*
 * Every page load collects window "error" events, unhandled rejections and
 * jsdom virtual-console errors (jsdomError and console.error); closing the
 * page (win.close) records one check that none occurred, and the end of
 * the file checks that every loaded page was closed that way.
 */
const openPages = new Set();
let pageSeq = 0;
/** `models` (optional) replaces the models.json the page fetches, so a test can inject a shuffled or synthetic list; `confirmFn` (optional) replaces window.confirm before the scripts run (a deep link asks during init); `origin` (optional) replaces the chrome-extension://x/ origin of the page's URL (jsdom refuses history.replaceState on that opaque origin, so a check of the URL after it loads the page under http://x/). */
async function loadPage(rel, store, scripts, query, models, confirmFn, origin) {
  const { VirtualConsole } = require("jsdom");
  const html = fs.readFileSync(path.join(E.EXT, rel), "utf8");
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(`jsdomError: ${e && e.message}`));
  vc.on("error", (...a) => errors.push(`console.error: ${a.map(String).join(" ")}`));
  const dom = new JSDOM(html, { url: (origin || "chrome-extension://x/") + rel + (query || ""), runScripts: "outside-only", pretendToBeVisual: true, virtualConsole: vc });
  const win = dom.window;
  win.addEventListener("error", (e) => errors.push(`window error: ${e.message}`));
  // jsdom fires no window "unhandledrejection": a rejection nobody handled
  // reaches node's process event, which this page listens to while open.
  const onRejection = (reason) => errors.push(`unhandled rejection: ${reason && reason.message ? reason.message : reason}`);
  process.on("unhandledRejection", onRejection);
  const label = rel + (query || "");
  const caller = ((new Error().stack || "").split("\n")[2] || "").match(/ui-pages\.cjs:(\d+)/);
  const key = `${label}#${++pageSeq} (loaded at ui-pages.cjs:${caller ? caller[1] : "?"})`;
  openPages.add(key);
  const close = win.close.bind(win);
  win.close = () => {
    process.off("unhandledRejection", onRejection);
    if (openPages.delete(key)) ok(errors.length === 0, `${label}: no window error, unhandled rejection or jsdom/console error while the page was open`, errors.join(" | "));
    close();
  };
  win.chrome = fakeChrome(store);
  win.confirm = confirmFn || (() => true);
  win.indexedDB = fakeIDB; // the per-run logs (common/runlog.js); fakeIDB.reset() between pages that must start empty
  win.IDBKeyRange = fakeIDB.IDBKeyRange; // the line store's index cursors use it
  win.Blob = Blob; // Node's Blob (jsdom's has no text()); a download's content is read back from it
  win.URL.createObjectURL = (blob) => { (store.__blobs = store.__blobs || []).push(blob); return `blob:x/${store.__blobs.length}`; };
  win.URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () { (store.__downloads = store.__downloads || []).push({ href: this.href, download: this.download }); };
  win.fetch = async () => ({ json: async () => (models ? JSON.parse(JSON.stringify(models)) : JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8"))) });
  const ctx = dom.getInternalVMContext();
  for (const f of scripts) vm.runInContext(fs.readFileSync(path.join(E.EXT, f), "utf8"), ctx, { filename: f });
  await new Promise((r) => setTimeout(r, 30)); // DOMContentLoaded + async load()
  return { dom, win, document: win.document, K: win.MGC, O: win.MGC_OPTIONS, RL: win.MGC_RUNLOG, pageErrors: errors };
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
      // $("id"), getElementById("id"), and popup.js's on("id", ...) and setIf("id", ...) helpers (which look the id up through $()).
      const ids = [...new Set([...src.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)|getElementById\("([a-zA-Z0-9_-]+)"\)|\bon\("([a-zA-Z0-9_-]+)",|\bsetIf\("([a-zA-Z0-9_-]+)",/g)].map((m) => m[1] || m[2] || m[3] || m[4]))].sort();
      const missing = ids.filter((id) => !page.getElementById(id));
      ok(ids.length >= 7 && missing.length === 0, `${js}: every id it references (${ids.length}) exists in ${htmlFile}`, `missing: ${missing.join(", ") || "none"}; referenced: ${ids.join(", ")}`);
      if (js === "popup/popup.js") ok(["models-latest", "pairs", "models-note"].every((id) => ids.includes(id)), "popup.js references models-latest, pairs and models-note, so the coverage check above covers the latest link, the pair line and the note", ids.join(", "));
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
    ok(d.getElementById("step-toggle-label").textContent === "fast mode" && d.getElementById("start").disabled === false, "the step toggle label and Start were set");
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
        const rendered = rel.startsWith("popup") ? /MODE: DRY RUN/.test(d.getElementById("mode").textContent) && d.querySelectorAll("#models input").length === MODELS_FILE.length && d.querySelectorAll("#models input:checked").length === 0 && (stateName === "idle" ? d.getElementById("status").textContent === "idle" : d.getElementById("summary").hidden === false && d.querySelectorAll("#results tbody tr").length === 2)
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
    ok(d.querySelectorAll("#models input").length === MODELS_FILE.length && d.querySelectorAll("#models input:checked").length === 0 && store.popup_state && store.popup_state.models.length === 0 && store.popup_state.version === MANIFEST_VERSION, `first use (no popup_state): every model of the file (${MODELS_FILE.length}), none ticked; the version marker is stored with an empty selection`, `${d.querySelectorAll("#models input").length} rendered, ${d.querySelectorAll("#models input:checked").length} ticked, ps ${JSON.stringify(store.popup_state)}`);
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
    ok(d.querySelectorAll("#models input:checked").length === MODELS_FILE.length && store.popup_state.models.length === MODELS_FILE.length, "the all link ticks every model and stores it", JSON.stringify(store.popup_state.models));
    clickLink("models-none"); await tick();
    ok(d.querySelectorAll("#models input:checked").length === 0 && store.popup_state.models.length === 0, "the none link unticks every model and stores the empty selection", JSON.stringify(store.popup_state.models));
    p.win.close();
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS); d = p.document;
    ok(d.querySelectorAll("#models input:checked").length === 0, "a stored empty selection reopens with nothing ticked (never all)");
    p.win.close();
  }

  console.log("--- (latest) constants.js: parseReleaseDate, modelFamily, modelVersionKey, compareModelsByRecency, sortModelsByRecency, latestModelSlugs");
  {
    const K = globalThis.MGC;
    const EXPECTED = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-4-6", "claude-opus-4-5", "claude-haiku-4-5"];
    const slugs = (list) => list.map((m) => m.slug);
    ok(["parseReleaseDate", "modelFamily", "modelVersionKey", "compareModelsByRecency", "sortModelsByRecency", "latestModelSlugs"].every((f) => typeof K[f] === "function") && !("MODEL_FAMILY_RANK" in K), "the six helpers exist on MGC and the family rank table is not a public member");
    ok(K.parseReleaseDate("2026-10-07") === "2026-10-07" && K.parseReleaseDate("2028-02-29") === "2028-02-29" && K.parseReleaseDate("0000-01-01") === "0000-01-01" && K.parseReleaseDate("0099-12-31") === "0099-12-31", "parseReleaseDate accepts a strict YYYY-MM-DD calendar date (a leap day and the years 0000-0099 included)");
    const badDates = ["2026-13-40", "2026-02-30", "2027-02-29", "", 123, "soon", "2026-1-7", "2026/10/07", "2026-10-07T00:00", null, undefined, "20261007"];
    ok(badDates.every((d) => K.parseReleaseDate(d) === null), "parseReleaseDate returns null for a bad month or day, a non-leap 29 February, an empty string, a number, a word, a short, slashed or timestamped form, null and undefined", JSON.stringify(badDates.map((d) => [d, K.parseReleaseDate(d)])));
    ok(K.modelFamily("claude-fable-5-1") === "fable" && K.modelFamily("claude-opus-4-8") === "opus" && K.modelFamily("Claude-Haiku-5-5") === "haiku" && K.modelFamily("claude-mythos-5-1") === "mythos", "modelFamily is the lower-cased second slug token (a new line like mythos included)");
    ok(K.modelFamily("claude-3-opus") === null && K.modelFamily("my-custom-model") === null && K.modelFamily("claude-opus") === null && K.modelFamily("claude-opus-5-5@20260922") === null && K.modelFamily("") === null && K.modelFamily(undefined) === null, "modelFamily is null for claude-3-opus, my-custom-model, a slug without a version, a pinned slug, an empty string and undefined");
    ok(JSON.stringify([K.modelVersionKey("claude-opus-4-8"), K.modelVersionKey("claude-sonnet-5"), K.modelVersionKey("claude-fable-5-1"), K.modelVersionKey("claude-haiku-5-5"), K.modelVersionKey("my-custom-model"), K.modelVersionKey("claude-3-opus")]) === "[[4,8],[5],[5,1],[5,5],[],[]]", "modelVersionKey: integers from the version part, [] when unparseable");
    const versions = K.sortModelsByRecency([{ slug: "claude-opus-5" }, { slug: "claude-opus-4-8" }, { slug: "claude-opus-5-5" }, { slug: "claude-opus-5-1" }]);
    ok(slugs(versions).join(",") === "claude-opus-5-5,claude-opus-5-1,claude-opus-5,claude-opus-4-8", "the version key orders 4-8 < 5 < 5-1 < 5-5 (newest first in the sort)", slugs(versions).join(","));

    const real = JSON.parse(JSON.stringify(MODELS_FILE));
    const before = JSON.stringify(real);
    ok(JSON.stringify(slugs(K.sortModelsByRecency(real))) === JSON.stringify(EXPECTED), `sortModelsByRecency on the ${MODELS_FILE.length} real entries gives the release order, haiku-5-5 first and haiku-4-5 last`, slugs(K.sortModelsByRecency(real)).join(","));
    // A deterministic shuffle: odd positions, then even positions reversed.
    const shuffled = real.filter((_, i) => i % 2).concat(real.filter((_, i) => !(i % 2)).reverse());
    ok(slugs(shuffled).join() !== slugs(real).join() && JSON.stringify(slugs(K.sortModelsByRecency(shuffled))) === JSON.stringify(EXPECTED), "a shuffled copy sorts to the same order", slugs(shuffled).join(","));
    const once = K.sortModelsByRecency(shuffled);
    ok(JSON.stringify(real) === before && slugs(shuffled).join() !== slugs(once).join() && once !== shuffled, "the input array is not mutated and a new array comes back");
    ok(JSON.stringify(slugs(K.sortModelsByRecency(once))) === JSON.stringify(slugs(once)), "sorting twice gives the same output");
    ok(JSON.stringify(slugs(K.sortModelsByRecency(real.slice().reverse()))) === JSON.stringify(EXPECTED), "the file reversed sorts back to the release order");
    ok(K.sortModelsByRecency(null).length === 0 && K.sortModelsByRecency(undefined).length === 0 && K.sortModelsByRecency("x").length === 0, "a non-array gives an empty array");
    const sameDate = K.sortModelsByRecency([{ slug: "claude-opus-5", releaseDate: "2026-07-24", apiOrder: 2 }, { slug: "claude-sonnet-5", releaseDate: "2026-07-24", apiOrder: 9 }, { slug: "claude-haiku-5", releaseDate: "2026-07-24" }]);
    ok(slugs(sameDate).join(",") === "claude-sonnet-5,claude-opus-5,claude-haiku-5", "equal dates fall back to apiOrder desc, and an entry without apiOrder sorts below those with one", slugs(sameDate).join(","));
    const undated = K.sortModelsByRecency([{ slug: "claude-opus-5-5" }, { slug: "claude-haiku-4-5", releaseDate: "2025-10-15", apiOrder: 1 }, { slug: "claude-opus-6" }, { slug: "claude-sonnet-5-5" }]);
    ok(slugs(undated).join(",") === "claude-haiku-4-5,claude-opus-6,claude-opus-5-5,claude-sonnet-5-5", "undated entries sort below every dated entry, and among them opus-6 is above opus-5-5 (version desc) and opus above sonnet at the same version (family rank)", slugs(undated).join(","));
    const malformed = K.sortModelsByRecency([{ slug: "claude-test" }, { slug: "claude-opus-5-5", releaseDate: "2026-13-40" }, { slug: "claude-haiku-4-5", releaseDate: "2025-10-15", apiOrder: 1 }, { slug: "claude-sonnet-5-5", releaseDate: "" }, { slug: "claude-fable-5-1", releaseDate: 123 }, { slug: "claude-opus-5", releaseDate: "soon" }]);
    ok(slugs(malformed)[0] === "claude-haiku-4-5" && slugs(malformed)[slugs(malformed).length - 1] === "claude-test" && slugs(malformed).join(",") === "claude-haiku-4-5,claude-opus-5-5,claude-sonnet-5-5,claude-fable-5-1,claude-opus-5,claude-test", "malformed dates (2026-13-40, empty, 123, soon) sink below the dated entry and sort by version, and the undated non-numeric slug claude-test sinks last", slugs(malformed).join(","));
    const tie = K.sortModelsByRecency([{ slug: "claude-zeta-5" }, { slug: "claude-alpha-5" }, { slug: "claude-beta-5" }, { slug: "zz-custom" }, { slug: "aa-custom" }]);
    ok(slugs(tie).join(",") === "claude-alpha-5,claude-beta-5,claude-zeta-5,aa-custom,zz-custom", "slug asc is the final tie (unknown families at the same version, then the unparseable slugs)", slugs(tie).join(","));
    ok(K.compareModelsByRecency({ slug: "claude-opus-5" }, { slug: "claude-opus-5" }) === 0 && K.compareModelsByRecency({ slug: "claude-opus-5-5", releaseDate: "2026-09-22" }, { slug: "claude-haiku-5-5", releaseDate: "2026-10-07" }) > 0, "compareModelsByRecency: 0 for equal entries, positive when the first is older");
    const oldShape = K.sortModelsByRecency(MODELS_FILE.map((m) => ({ slug: m.slug, name: m.name, launchStage: m.launchStage })));
    ok(slugs(oldShape).join(",") === "claude-opus-5-5,claude-sonnet-5-5,claude-haiku-5-5,claude-fable-5-1,claude-opus-5,claude-sonnet-5,claude-fable-5,claude-opus-4-8,claude-opus-4-7,claude-opus-4-6,claude-sonnet-4-6,claude-opus-4-5,claude-haiku-4-5", "the 0.8.0 file shape (no dates, no apiOrder) keeps the 0.8.0 order: version desc with the family rank", slugs(oldShape).join(","));

    let latest = K.latestModelSlugs(real);
    ok(JSON.stringify(latest.ticked) === JSON.stringify(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]) && JSON.stringify(latest.leftOut) === JSON.stringify([{ slug: "claude-fable-5-1", name: "Claude Fable 5.1" }]), "latestModelSlugs on the real file with fable-5-1 flagged: haiku-5-5, sonnet-5-5 and opus-5-5 ticked (recency order), Fable 5.1 left out by name", JSON.stringify(latest));
    ok(JSON.stringify(K.latestModelSlugs(shuffled)) === JSON.stringify(latest), "the same set from a shuffled list");
    const unflagged = real.map((m) => Object.assign({}, m, { requiresManualConsent: false }));
    latest = K.latestModelSlugs(unflagged);
    ok(JSON.stringify(latest.ticked) === JSON.stringify(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) && latest.leftOut.length === 0, "unflagged, fable-5-1 joins the ticked set and nothing is left out", JSON.stringify(latest));
    const deprecated = unflagged.map((m) => (m.slug === "claude-haiku-5-5" ? Object.assign({}, m, { deprecated: true }) : m));
    ok(JSON.stringify(K.latestModelSlugs(deprecated).ticked) === JSON.stringify(["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-haiku-4-5"]), "deprecated: true excludes the entry and the line falls to the next dated GA entry (haiku-4-5)", JSON.stringify(K.latestModelSlugs(deprecated)));
    const preview = unflagged.map((m) => (m.slug === "claude-sonnet-5-5" ? Object.assign({}, m, { launchStage: "PREVIEW" }) : m));
    ok(JSON.stringify(K.latestModelSlugs(preview).ticked) === JSON.stringify(["claude-haiku-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5"]), 'launchStage "PREVIEW" excludes the entry and the sonnet line falls to sonnet-5', JSON.stringify(K.latestModelSlugs(preview)));
    const undatedOpus6 = unflagged.concat([{ slug: "claude-opus-6", name: "Claude Opus 6", launchStage: "GA" }]);
    ok(JSON.stringify(K.latestModelSlugs(undatedOpus6).ticked) === JSON.stringify(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]), "an undated newer opus-6 is never latest, and dated opus-5-5 stays", JSON.stringify(K.latestModelSlugs(undatedOpus6)));
    const mythos = real.concat([{ slug: "claude-mythos-5-1", name: "Claude Mythos 5.1", launchStage: "GA", releaseDate: "2026-10-01", apiOrder: 14 }]);
    latest = K.latestModelSlugs(mythos);
    ok(latest.ticked.length + latest.leftOut.length === 5 && latest.ticked.includes("claude-mythos-5-1") && JSON.stringify(latest.ticked) === JSON.stringify(["claude-haiku-5-5", "claude-mythos-5-1", "claude-sonnet-5-5", "claude-opus-5-5"]), "a dated claude-mythos-5-1 forms its own line (5 lines in all) and auto-joins the ticked set in recency order", JSON.stringify(latest));
    const custom = real.concat([{ slug: "my-custom-model", name: "Custom", launchStage: "GA", releaseDate: "2026-12-01", apiOrder: 15 }, { slug: "claude-3-opus", launchStage: "GA", releaseDate: "2026-12-02" }]);
    latest = K.latestModelSlugs(custom);
    ok(!latest.ticked.includes("my-custom-model") && !latest.ticked.includes("claude-3-opus") && latest.ticked.length === 3, "a slug without a model line (my-custom-model, claude-3-opus) is never latest even when dated and GA", JSON.stringify(latest));
    ok(JSON.stringify(K.latestModelSlugs(oldShape)) === JSON.stringify({ ticked: [], leftOut: [] }) && JSON.stringify(K.latestModelSlugs([])) === JSON.stringify({ ticked: [], leftOut: [] }) && JSON.stringify(K.latestModelSlugs(null)) === JSON.stringify({ ticked: [], leftOut: [] }), "an undated list, an empty list and a non-array give nothing ticked and nothing left out");
    ok(JSON.stringify(K.latestModelSlugs([{ slug: "claude-opus-5-5", launchStage: "GA", releaseDate: "2026-09-22", requiresManualConsent: true }]).leftOut) === JSON.stringify([{ slug: "claude-opus-5-5", name: "claude-opus-5-5" }]), "a left-out entry without a name is named by its slug");
  }

  console.log("--- (latest) popup: the checklist in recency order with the date in the tooltip and the stage markers, the latest link, its note and the pair count line");
  {
    const K = globalThis.MGC;
    const EXPECTED = K.sortModelsByRecency(MODELS_FILE).map((m) => m.slug);
    // A shuffled copy of the real file, plus a deprecated entry: the page must sort it itself.
    const shuffled = MODELS_FILE.filter((_, i) => i % 2).concat(MODELS_FILE.filter((_, i) => !(i % 2)).reverse());
    const store = { settings: Object.assign({}, FULL), running: false };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS, "", shuffled);
    let d = p.document;
    const labels = () => Array.from(d.querySelectorAll("#models label"));
    const rendered = () => Array.from(d.querySelectorAll("#models input")).map((cb) => cb.value);
    const ticked = () => Array.from(d.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(rendered().length === MODELS_FILE.length && JSON.stringify(rendered()) === JSON.stringify(EXPECTED), `the shuffled file renders ${MODELS_FILE.length} models in recency order (sorted at load, not in the file)`, rendered().join(","));
    ok(rendered()[0] === "claude-haiku-5-5" && rendered()[rendered().length - 1] === "claude-haiku-4-5" && labels()[0].textContent.trim().startsWith("Claude Haiku 5.5") && labels()[labels().length - 1].textContent.trim().startsWith("Claude Haiku 4.5"), "the first rendered label is the newest date (Claude Haiku 5.5, 2026-10-07) and the last the oldest (Claude Haiku 4.5, 2025-10-15)", `${labels()[0].textContent.trim()} ... ${labels()[labels().length - 1].textContent.trim()}`);
    ok(labels()[0].title === "claude-haiku-5-5 · released 2026-10-07" && labels().every((l) => /^claude-[a-z]+-[0-9-]+ · released \d{4}-\d{2}-\d{2}( · manual step)?$/.test(l.title)), 'label.title is "<slug> · released <releaseDate>" on every row', labels()[0].title);
    const fable = labels().find((l) => l.querySelector("input").value === "claude-fable-5-1");
    ok(fable && fable.querySelector(".stage") && fable.querySelector(".stage").textContent === " (GA · manual step)", 'the flagged Fable 5.1 row shows "(GA · manual step)" in its stage span', fable && fable.querySelector(".stage") && fable.querySelector(".stage").textContent);
    // The four-column grid cuts the stage span with an ellipsis, so the tooltip repeats the flag (the plain rows carry none).
    ok(fable && fable.title === "claude-fable-5-1 · released 2026-09-01 · manual step" && labels().filter((l) => / · manual step$/.test(l.title)).length === 1, 'the Fable 5.1 tooltip repeats the flag: "<slug> · released <date> · manual step", no other row does', fable && fable.title);
    const plainRows = MODELS_FILE.filter((m) => m.requiresManualConsent !== true && m.deprecated !== true).length;
    ok(labels().filter((l) => l.querySelector(".stage") && l.querySelector(".stage").textContent === " (GA)").length === plainRows && plainRows === MODELS_FILE.length - 1, "every other row shows the launch stage as before (today every row but Fable 5.1)", labels().map((l) => l.querySelector(".stage") && l.querySelector(".stage").textContent).join("|"));
    ok(d.querySelectorAll(".models label").length === MODELS_FILE.length && !d.querySelector("#models .date"), "no new column: the rows hold the checkbox, the name and the stage span only");
    const link = d.getElementById("models-latest");
    const links = d.querySelector(".models-section .links");
    ok(link && link.tagName === "A" && link.textContent === "latest" && link.title === "newest GA model of each line (opus, sonnet, haiku, fable)" && links.contains(link) && link.previousElementSibling === d.getElementById("models-none") && /none<\/a> · <a/.test(links.innerHTML), 'the third link "latest" follows "none", separated by " · ", with the title that names the lines', links && links.textContent);
    const pairs = d.getElementById("pairs");
    const note = d.getElementById("models-note");
    ok(pairs && note && note.hidden === true && pairs.textContent === "" && pairs.closest(".models-section") && note.closest(".models-section") && pairs.previousElementSibling === d.getElementById("models") && note.previousElementSibling === pairs && note.nextElementSibling.getAttribute("for") === "extra-models", "the pairs line and the hidden note sit under the checklist, before the extra-models label, both empty at first use");
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/\.pairs, \.models-note\s*\{[^}]*color:\s*var\(--mgc-muted\)[^}]*font-size:\s*11px/.test(css) && !/\.models-note[^{]*\{[^}]*display\s*:/.test(css.replace(/\.pairs:empty[^}]*\}/, "")), "popup.css styles both lines like .stage (muted, 11px) and sets no display on the note (the hidden attribute wins)");
    // loadPage stubs HTMLAnchorElement.prototype.click (download capture), so the links get a dispatched click.
    const clickLink = (id) => d.getElementById(id).dispatchEvent(new p.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    d.getElementById("extra-models").value = "claude-x-1"; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    clickLink("models-latest"); await tick();
    const LATEST = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
    ok(JSON.stringify(ticked()) === JSON.stringify(LATEST), "the latest link ticks exactly the latest set: haiku-5-5, sonnet-5-5, opus-5-5 (Fable 5.1 left out)", ticked().join(","));
    ok(JSON.stringify(store.popup_state.models) === JSON.stringify(LATEST) && store.popup_state.version === MANIFEST_VERSION, "popup_state.models stores the same three concrete slugs in the file's spelling (no latest marker)", JSON.stringify(store.popup_state));
    ok(d.getElementById("extra-models").value === "claude-x-1" && store.popup_state.extra === "claude-x-1", "the extra slugs field is untouched");
    ok(note.hidden === false && note.textContent === "latest: 3 ticked, Claude Fable 5.1 left out, needs a manual step on its model page" && note.title === note.textContent, "the note names the count and the left-out model, and its tooltip repeats the text (the line is cut with an ellipsis)", note.textContent);
    ok(pairs.textContent === "", "no project ID yet: the pairs line stays empty");
    d.getElementById("projects").value = "proj-one\nproj-two"; d.getElementById("projects").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    ok(pairs.textContent === "2 project(s) × 4 model(s) = 8 pair(s)", "with two projects, three ticked models and one extra slug the pairs line reads 2 × 4 = 8", pairs.textContent);
    d.getElementById("extra-models").value = ""; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    ok(pairs.textContent === "2 project(s) × 3 model(s) = 6 pair(s)" && note.hidden === false, "clearing the extra slugs updates the pairs line (2 × 3 = 6), the note stays", pairs.textContent);
    // A model checkbox change hides the note.
    const opus5 = Array.from(d.querySelectorAll("#models input")).find((cb) => cb.value === "claude-opus-5");
    opus5.checked = true; opus5.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(note.hidden === true && note.textContent === "" && pairs.textContent === "2 project(s) × 4 model(s) = 8 pair(s)", "ticking another model hides the note and updates the pairs line", `${note.hidden} ${pairs.textContent}`);
    clickLink("models-all"); await tick();
    ok(ticked().length === MODELS_FILE.length && note.hidden === true && pairs.textContent === `2 project(s) × ${MODELS_FILE.length} model(s) = ${2 * MODELS_FILE.length} pair(s)`, "all ticks every model (the flagged one included, unchanged) and the note stays hidden", pairs.textContent);
    clickLink("models-latest"); await tick();
    ok(JSON.stringify(ticked()) === JSON.stringify(LATEST) && note.hidden === false, "latest after all unticks the models that are not the newest of their line", ticked().join(","));
    clickLink("models-none"); await tick();
    ok(ticked().length === 0 && store.popup_state.models.length === 0 && note.hidden === true && pairs.textContent === "", "none unticks everything, hides the note and empties the pairs line");
    clickLink("models-latest"); await tick();
    ok(JSON.stringify(ticked()) === JSON.stringify(LATEST), "latest again ticks the set again");
    p.win.close();
    // Reopening restores the stored latest set and shows the pairs line at once. The note is gone.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS, "", shuffled); d = p.document;
    ok(JSON.stringify(ticked()) === JSON.stringify(LATEST) && d.getElementById("models-note").hidden === true && d.getElementById("pairs").textContent === "2 project(s) × 3 model(s) = 6 pair(s)", "reopening restores the three ticked models and renders the pairs line at init, the note is hidden", `${ticked().join(",")} | ${d.getElementById("pairs").textContent}`);
    p.win.close();
    // (U3) a version change resets the selection even when the stored set is the latest set.
    const storeOld = { settings: Object.assign({}, FULL), popup_state: { projects: "proj-one", models: LATEST.slice(), extra: "", version: "0.0.1" } };
    p = await loadPage("popup/popup.html", storeOld, POPUP_SCRIPTS); d = p.document;
    ok(ticked().length === 0 && storeOld.popup_state.models.length === 0 && storeOld.popup_state.version === MANIFEST_VERSION, "after a version change none is ticked, even when the stored set is the latest set, and the marker is updated");
    p.win.close();
    // The 0.8.0 file shape: nothing dated, so latest ticks nothing and says so. The tooltip is the bare slug, and the order is the 0.8.0 order.
    const oldShape = MODELS_FILE.map((m) => ({ slug: m.slug, name: m.name, launchStage: m.launchStage }));
    const store2 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store2, POPUP_SCRIPTS, "", oldShape); d = p.document;
    ok(rendered()[0] === "claude-opus-5-5" && rendered()[rendered().length - 1] === "claude-haiku-4-5" && labels()[0].title === "claude-opus-5-5", "an undated file (the 0.8.0 shape) renders in the 0.8.0 order with the bare slug as tooltip", `${rendered()[0]} / ${labels()[0].title}`);
    clickLink("models-latest"); await tick();
    ok(ticked().length === 0 && store2.popup_state.models.length === 0 && d.getElementById("models-note").hidden === false && d.getElementById("models-note").textContent === "latest: nothing ticked, no model carries a release date", "latest on an undated file ticks nothing and the note says why", d.getElementById("models-note").textContent);
    p.win.close();
    // Parse tolerance: a bad releaseDate gives "", a non-integer apiOrder null, non-boolean flags false. A "@" slug and an invalid slug drop.
    const tolerant = [
      { slug: "claude-opus-5-5", name: "Claude Opus 5.5", launchStage: "GA", releaseDate: "2026-13-40", apiOrder: 11 },
      { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", launchStage: "GA", releaseDate: "2026-09-28", apiOrder: "12", requiresManualConsent: "yes", deprecated: 1 },
      { slug: "claude-haiku-5-5", name: "Claude Haiku 5.5", launchStage: "GA", releaseDate: "2026-10-07", apiOrder: 13, deprecated: true },
      { slug: "claude-haiku-5-5@20261005", name: "pinned", launchStage: "GA", releaseDate: "2026-10-07", apiOrder: 14 },
      { slug: "bad slug!", name: "bad", launchStage: "GA" },
      { slug: "claude-fable-5-1", name: "Claude Fable 5.1", launchStage: "GA", releaseDate: "2026-09-01", apiOrder: 10, requiresManualConsent: true },
      { slug: "claude-opus-5", name: "Claude Opus 5", launchStage: "GA", releaseDate: "2026-07-24", apiOrder: 9.5 }
    ];
    const store3 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store3, POPUP_SCRIPTS, "", tolerant); d = p.document;
    ok(rendered().length === 5 && !rendered().some((s) => s.includes("@")) && !rendered().includes("bad slug!"), 'the "@" slug and the invalid slug are dropped; the five others render', rendered().join(","));
    ok(JSON.stringify(rendered()) === JSON.stringify(["claude-haiku-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-opus-5", "claude-opus-5-5"]), "a bad releaseDate makes the entry undated (sorted last, by its apiOrder), a non-integer apiOrder still sorts by date", rendered().join(","));
    const byValue = (v) => labels().find((l) => l.querySelector("input").value === v);
    ok(byValue("claude-opus-5-5").title === "claude-opus-5-5" && byValue("claude-opus-5").title === "claude-opus-5 · released 2026-07-24", "a bad releaseDate leaves the bare slug as tooltip, a non-integer apiOrder does not touch the date", byValue("claude-opus-5-5").title);
    ok(byValue("claude-haiku-5-5").title === "claude-haiku-5-5 · released 2026-10-07 · deprecated" && byValue("claude-sonnet-5-5").title === "claude-sonnet-5-5 · released 2026-09-28", 'a deprecated entry\'s tooltip ends with "· deprecated"; a non-boolean flag adds nothing', byValue("claude-haiku-5-5").title);
    ok(byValue("claude-sonnet-5-5").querySelector(".stage").textContent === " (GA)" && byValue("claude-haiku-5-5").querySelector(".stage").textContent === " (deprecated)" && byValue("claude-fable-5-1").querySelector(".stage").textContent === " (GA · manual step)", 'non-boolean flags count as false ("(GA)"), deprecated: true shows "(deprecated)", the manual-step marker shows for the flagged entry', labels().map((l) => l.querySelector(".stage").textContent).join("|"));
    clickLink("models-latest"); await tick();
    ok(JSON.stringify(ticked()) === JSON.stringify(["claude-sonnet-5-5", "claude-opus-5"]) && d.getElementById("models-note").textContent === "latest: 2 ticked, Claude Fable 5.1 left out, needs a manual step on its model page", "latest on the tolerant fixture: the deprecated haiku and the undated opus-5-5 are never latest, sonnet-5-5 (flag not boolean) and opus-5 are, Fable 5.1 is left out", `${ticked().join(",")} | ${d.getElementById("models-note").textContent}`);
    p.win.close();
    // Two left-out lines: a flagged new line (mythos) next to Fable 5.1. The names are joined with " and " and the verb is plural.
    const twoFlagged = MODELS_FILE.concat([{ slug: "claude-mythos-5-1", name: "Claude Mythos 5.1", launchStage: "GA", releaseDate: "2026-10-10", apiOrder: 14, requiresManualConsent: true }]);
    const store4 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store4, POPUP_SCRIPTS, "", twoFlagged); d = p.document;
    const mythos = labels().find((l) => l.querySelector("input").value === "claude-mythos-5-1");
    ok(rendered()[0] === "claude-mythos-5-1" && mythos.querySelector(".stage").textContent === " (GA · manual step)", "a flagged new line renders first (newest date) with the manual-step marker", rendered()[0]);
    clickLink("models-latest"); await tick();
    ok(JSON.stringify(ticked()) === JSON.stringify(LATEST) && d.getElementById("models-note").textContent === "latest: 3 ticked, Claude Mythos 5.1 and Claude Fable 5.1 left out, need a manual step on their model pages", 'two left-out lines: the note joins the names with " and " and takes the plural verb', d.getElementById("models-note").textContent);
    p.win.close();
    // A flagged entry whose launch stage is not GA: the marker keeps the stage it has.
    const stages = [
      { slug: "claude-opus-5-5", name: "Claude Opus 5.5", launchStage: "PREVIEW", releaseDate: "2026-09-22", apiOrder: 11, requiresManualConsent: true },
      { slug: "claude-opus-5", name: "Claude Opus 5", releaseDate: "2026-07-24", apiOrder: 9, requiresManualConsent: true }
    ];
    const store5 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store5, POPUP_SCRIPTS, "", stages); d = p.document;
    ok(byValue("claude-opus-5-5").querySelector(".stage").textContent === " (PREVIEW · manual step)" && byValue("claude-opus-5").querySelector(".stage").textContent === " (manual step)", 'a flagged PREVIEW entry reads "(PREVIEW · manual step)" and a flagged entry without a stage "(manual step)"', labels().map((l) => l.querySelector(".stage").textContent).join("|"));
    clickLink("models-latest"); await tick();
    ok(ticked().length === 0 && d.getElementById("models-note").textContent === "latest: 0 ticked", "neither flagged non-GA entry is latest or left out: the note reads 0 ticked", d.getElementById("models-note").textContent);
    p.win.close();
  }

  console.log("--- (latest) popup: the full-run confirm names the models that are not the newest of their line and the manual-step model, a dry run asks nothing");
  {
    const LATEST = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
    const store = { settings: Object.assign({}, FULL, { live_mode: true }), popup_state: { projects: "proj-z", models: LATEST.concat(["claude-fable-5-1", "claude-opus-5"]), extra: "", version: MANIFEST_VERSION } };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    let d = p.document;
    const confirms = []; p.win.confirm = (m) => { confirms.push(m); return false; };
    store.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 5, done: 0, skipped: 0 } : { ok: true });
    ok(d.getElementById("pairs").textContent === "1 project(s) × 5 model(s) = 5 pair(s)", "the pairs line shows the stored selection at init", d.getElementById("pairs").textContent);
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 1 && /for up to 5 of 5 project\/model pair\(s\)/.test(confirms[0]), "a full run asks once with the pair count", confirms[0]);
    ok(/ The selection includes 2 model\(s\) that are not the newest of their line\./.test(confirms[0]), "the confirm says the selection includes 2 models that are not the newest of their line (a strict superset of the latest set)", confirms[0]);
    ok(/ Claude Fable 5\.1 needs a manual step on its model page and will fail, not enable\./.test(confirms[0]) && / not enable\. Continue\?$/.test(confirms[0]), "it names Claude Fable 5.1 as a job that fails, right before Continue?", confirms[0]);
    ok(!(store.__messages || []).some((m) => m.type === p.K.MSG.START), "cancelled: no START sent");
    // Exactly the latest set: neither sentence.
    const clickLink = (id) => d.getElementById(id).dispatchEvent(new p.win.MouseEvent("click", { bubbles: true, cancelable: true }));
    clickLink("models-latest"); await tick();
    store.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 3, done: 0, skipped: 0 } : { ok: true });
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 2 && !/not the newest of their line/.test(confirms[1]) && !/manual step/.test(confirms[1]) && / Continue\?$/.test(confirms[1]), "with exactly the latest set ticked the confirm carries neither sentence", confirms[1]);
    // A subset of the latest set (not a superset): no superset sentence, a flagged model alone still names it.
    clickLink("models-none"); await tick();
    const fable = Array.from(d.querySelectorAll("#models input")).find((cb) => cb.value === "claude-fable-5-1");
    fable.checked = true; fable.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 3 && !/not the newest of their line/.test(confirms[2]) && / Claude Fable 5\.1 needs a manual step on its model page and will fail, not enable\. Continue\?$/.test(confirms[2]), "Fable 5.1 alone: no superset sentence (the latest set is not included), the manual-step sentence stays", confirms[2]);
    // The same flagged model typed as an extra slug in another case: the worker runs it lowercased, so the sentence stays.
    clickLink("models-none"); await tick();
    d.getElementById("extra-models").value = "Claude-Fable-5-1"; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 4 && / Claude Fable 5\.1 needs a manual step on its model page and will fail, not enable\. Continue\?$/.test(confirms[3]), "an extra slug typed as Claude-Fable-5-1 (another case) still names the manual step, as the worker runs it lowercased", confirms[3]);
    d.getElementById("extra-models").value = ""; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    // Extra slugs count as models that are not the newest of their line.
    clickLink("models-latest"); await tick();
    d.getElementById("extra-models").value = "claude-x-1"; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 5 && / The selection includes 1 model\(s\) that are not the newest of their line\./.test(confirms[4]) && !/manual step/.test(confirms[4]), "the latest set plus one extra slug: 1 model that is not the newest of its line, no manual-step sentence", confirms[3]);
    // Duplicates and case variants collapse the way the worker's uniqueTrimmed does, so the pair count and the superset sentence match what runs.
    clickLink("models-none"); await tick();
    const opus55 = Array.from(d.querySelectorAll("#models input")).find((cb) => cb.value === "claude-opus-5-5");
    opus55.checked = true; opus55.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    d.getElementById("projects").value = "proj-a\nproj-a\n Proj-A "; d.getElementById("projects").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    d.getElementById("extra-models").value = "Claude-Opus-5-5, claude-opus-5-5"; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    ok(d.getElementById("pairs").textContent === "1 project(s) × 1 model(s) = 1 pair(s)", "a project typed three times (one in another case) and a ticked slug repeated as an extra slug count once: 1 × 1 = 1", d.getElementById("pairs").textContent);
    store.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 1, done: 0, skipped: 0 } : { ok: true });
    d.getElementById("start").click(); await tick();
    ok(confirms.length === 6 && /for up to 1 of 1 project\/model pair\(s\)/.test(confirms[5]) && !/not the newest of their line/.test(confirms[5]) && !/manual step/.test(confirms[5]), "the confirm counts the same single pair and carries no superset sentence (the duplicate spelling is not a second model)", confirms[5]);
    // Control: a genuinely different extra slug still counts.
    d.getElementById("extra-models").value = "claude-opus-5-5, claude-x-1"; d.getElementById("extra-models").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    ok(d.getElementById("pairs").textContent === "1 project(s) × 2 model(s) = 2 pair(s)", "control: a different extra slug makes it 1 × 2 = 2", d.getElementById("pairs").textContent);
    // Back to the stored latest set and one project for the checks below.
    d.getElementById("projects").value = "proj-z"; d.getElementById("projects").dispatchEvent(new p.win.Event("input", { bubbles: true })); await tick();
    clickLink("models-latest"); await tick();
    p.win.close();
    // An undated list (the 0.8.0 file shape) has no latest set, so a live run says nothing about the newest of a line.
    const oldShape = MODELS_FILE.map((m) => ({ slug: m.slug, name: m.name, launchStage: m.launchStage }));
    const storeOld = { settings: Object.assign({}, FULL, { live_mode: true }), popup_state: { projects: "proj-z", models: ["claude-opus-5-5", "claude-haiku-5-5"], extra: "", version: MANIFEST_VERSION } };
    p = await loadPage("popup/popup.html", storeOld, POPUP_SCRIPTS, "", oldShape); d = p.document;
    const askedOld = []; p.win.confirm = (m) => { askedOld.push(m); return false; };
    storeOld.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 2, done: 0, skipped: 0 } : { ok: true });
    d.getElementById("start").click(); await tick();
    ok(askedOld.length === 1 && /for up to 2 of 2 project\/model pair\(s\)/.test(askedOld[0]) && !/not the newest of their line/.test(askedOld[0]) && !/manual step/.test(askedOld[0]) && / Continue\?$/.test(askedOld[0]), "on an undated list the full-run confirm carries neither sentence (no line has a known newest model)", askedOld[0]);
    p.win.close();
    // Two flagged models ticked: the names are joined with " and " and the verb is plural.
    const twoFlagged = MODELS_FILE.concat([{ slug: "claude-mythos-5-1", name: "Claude Mythos 5.1", launchStage: "GA", releaseDate: "2026-10-10", apiOrder: 14, requiresManualConsent: true }]);
    const storeTwo = { settings: Object.assign({}, FULL, { live_mode: true }), popup_state: { projects: "proj-z", models: LATEST.concat(["claude-fable-5-1", "claude-mythos-5-1"]), extra: "", version: MANIFEST_VERSION } };
    p = await loadPage("popup/popup.html", storeTwo, POPUP_SCRIPTS, "", twoFlagged); d = p.document;
    const askedTwo = []; p.win.confirm = (m) => { askedTwo.push(m); return false; };
    storeTwo.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 5, done: 0, skipped: 0 } : { ok: true });
    d.getElementById("start").click(); await tick();
    ok(askedTwo.length === 1 && / The selection includes 2 model\(s\) that are not the newest of their line\. Claude Mythos 5\.1 and Claude Fable 5\.1 need a manual step on their model pages and will fail, not enable\. Continue\?$/.test(askedTwo[0]), 'two flagged models ticked: the confirm joins the names with " and " and takes the plural verb, in recency order', askedTwo[0]);
    p.win.close();
    // Dry run: no confirm, START sent with the selection.
    store.settings.live_mode = false; store.__messages = []; store.popup_state.extra = "";
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS); d = p.document;
    const asked = []; p.win.confirm = (m) => { asked.push(m); return false; };
    const opus5 = Array.from(d.querySelectorAll("#models input")).find((cb) => cb.value === "claude-opus-5");
    opus5.checked = true; opus5.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    d.getElementById("start").click(); await tick();
    const started = (store.__messages || []).filter((m) => m.type === p.K.MSG.START);
    ok(asked.length === 0 && started.length === 1 && started[0].live === false && started[0].models.length === 4, "a dry run asks nothing and sends START with the four models", JSON.stringify(started.map((m) => m.models)));
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
    ok(/^Run all jobs processed: 14 job\(s\)$/.test(doc.querySelector("#summary .title").textContent) && doc.querySelector("#summary .counts").textContent === "done 0 · dry-run 13 · skipped 0 · skipped-by-you 0 · not-enabled 0 · failed 1 · unverified 0 · stopped 0", "title with the reason and the job count; the eight counts", doc.querySelector("#summary .counts").textContent);
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

  console.log("--- popup: the progress line (bar, N/T jobs, percent, elapsed, estimate) and the summary's total time");
  {
    const T0 = 1700000000000;
    const J = (status, startedAt, finishedAt, extra) => Object.assign({ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status, startedAt: startedAt === undefined ? null : startedAt, finishedAt: finishedAt === undefined ? null : finishedAt }, extra);
    const store = { settings: Object.assign({}, FULL) };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const doc = p.document;
    const prog = doc.getElementById("progress");
    const text = () => doc.querySelector("#progress .text").textContent;
    const width = () => doc.querySelector("#progress .bar > .fill").style.width;
    ok(prog && prog.hidden === true && prog.previousElementSibling === doc.getElementById("status") && text() === "", "idle (no run): the #progress line sits right under the status and is hidden", prog && prog.outerHTML);
    let now = T0 + 45000;
    p.win.Date.now = () => now;
    const intervals = [], cleared = [];
    const realSet = p.win.setInterval.bind(p.win), realClear = p.win.clearInterval.bind(p.win);
    p.win.setInterval = (fn, ms) => { const id = realSet(fn, ms); intervals.push({ id, ms }); return id; };
    p.win.clearInterval = (id) => { cleared.push(id); return realClear(id); };
    // A run: one guard-left-out job (finished, not in the mean) and nothing navigated finished yet: estimating.
    Object.assign(store, { running: true, run: { runId: "rp", live: false, startedAt: T0, finishedAt: null }, current: { jobIndex: 1, phase: "model" },
      queue: [J("skipped", T0, T0, { leftOut: "done" }), J("running", T0 + 1000), J("pending"), J("pending")] });
    p.win.chrome.__fire({ running: { newValue: true } }); await tick();
    ok(prog.hidden === false && text() === "1/4 jobs · 25 % · elapsed 00:45 · estimating…", "a run, no navigated job finished yet: \"N/T jobs · P %\", elapsed, \"estimating…\" (the guard-left-out job counts as finished)", text());
    ok(width() === "25%", "the bar's width equals the percent", width());
    ok(intervals.length === 1 && intervals[0].ms === 1000, "a run is active: one one-second interval refreshes the line", JSON.stringify(intervals));
    // One navigated job of 30 s finished: two left -> ~01:00 left.
    store.queue[1] = J("dry-run", T0 + 1000, T0 + 31000); store.queue[2] = J("running", T0 + 31000); store.current = { jobIndex: 2, phase: "model" };
    p.win.chrome.__fire({ queue: { newValue: store.queue } }); await tick();
    ok(text() === "2/4 jobs · 50 % · elapsed 00:45 · ~01:00 left" && width() === "50%", "after a navigated job of 30 s: 2/4 jobs · 50 %, elapsed, ~01:00 left (the mean x the jobs left), the bar at 50%", `${text()} ${width()}`);
    ok(intervals.length === 1, "control: a render while running starts no second interval", JSON.stringify(intervals));
    // The interval alone moves the elapsed time (no storage change).
    now = T0 + 75000;
    await new Promise((r) => setTimeout(r, 1100));
    ok(text() === "2/4 jobs · 50 % · elapsed 01:15 · ~01:00 left", "one second later the interval recomputed the line from the last state: elapsed 01:15", text());
    store.paused = true;
    p.win.chrome.__fire({ paused: { newValue: true } }); await tick();
    ok(text() === "2/4 jobs · 50 % · elapsed 01:15 · paused", "while KEYS.PAUSED: \"paused\" instead of the estimate", text());
    store.paused = false;
    p.win.chrome.__fire({ paused: { newValue: false } }); await tick();
    ok(/~01:00 left$/.test(text()), "control: resumed, the estimate is back", text());
    // The run ends: the summary shows the finished run with its total time, the line reads finished (no estimate), the interval is cleared.
    store.queue[2] = J("dry-run", T0 + 31000, T0 + 61000); store.queue[3] = J("dry-run", T0 + 61000, T0 + 91000);
    Object.assign(store, { running: false, current: null, run: { runId: "rp", live: false, startedAt: T0, finishedAt: T0 + 760000, reason: "all jobs processed" }, summary_ack: { runId: "rp", tabId: 1, reason: "all jobs processed", ack: false } });
    p.win.chrome.__fire({ running: { newValue: false } }); await tick();
    ok(prog.hidden === false && text() === "4/4 jobs · 100 % · elapsed 12:40" && width() === "100%", "finished (summary shown): 4/4 jobs · 100 % · elapsed 12:40, no estimate, the bar full", `${text()} ${width()}`);
    ok(cleared.includes(intervals[0].id), "the run ended: the interval is cleared", JSON.stringify(cleared));
    ok(doc.querySelector("#summary .title").textContent === "Run all jobs processed: 4 job(s) in 12:40", "the summary title ends with \" in mm:ss\" (finishedAt - startedAt)", doc.querySelector("#summary .title").textContent);
    store.summary_ack.ack = true;
    p.win.chrome.__fire({ summary_ack: { newValue: store.summary_ack } }); await tick();
    ok(prog.hidden === true && /^idle; last run/.test(doc.getElementById("status").textContent), "control: the summary acknowledged, idle again: the progress line is hidden", doc.getElementById("status").textContent);
    p.win.close();
    // An hour-long run spells h:mm:ss in the title; a run without startedAt on record gets no time (the older summary tests cover that spelling).
    const p2 = await loadPage("popup/popup.html", { settings: Object.assign({}, FULL), running: false, run: { runId: "rh", live: false, startedAt: T0, finishedAt: T0 + 3723000, reason: "stopped by user" }, queue: [J("stopped", T0, T0 + 5000)], summary_ack: { runId: "rh", ack: false } }, POPUP_SCRIPTS);
    ok(p2.document.querySelector("#summary .title").textContent === "Run stopped by user: 1 job(s) in 1:02:03", "a run of 1 h 2 min 3 s: \" in 1:02:03\"", p2.document.querySelector("#summary .title").textContent);
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
    ok(creates.length === 3 && creates.filter((c) => /active:\s*true/.test(c)).length === 1 && creates.some((c) => /runs\/runs\.html/.test(c)) && !creates.some((c) => /link=/.test(c)), "tabs.create: the worker tab (opened in front right after Start), the Open-in-a-tab page and the Runs page only (no deep-link tab: the console-link path was dropped)", creates.join(" | "));
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
    ok(manifest.version === "1.0.0", "the manifest version is 1.0.0", manifest.version);
    ok(JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "alarms"]) && !/"downloads"|"unlimitedStorage"|"notifications"|"tabs"/.test(JSON.stringify(manifest.permissions)), "0.8.0 and 0.9.0 added no permission (Pause, export and import, the latest link included): still exactly storage and alarms (no downloads, unlimitedStorage, notifications or tabs)", JSON.stringify(manifest.permissions));
    ok(!("web_accessible_resources" in manifest), "runs.html is an extension page opened by its extension URL: no web_accessible_resources");
    // Chrome Web Store limits: the 0.3.0 upload was rejected for a 136-character description (limit 132).
    ok(typeof manifest.description === "string" && manifest.description.length <= 132, `the manifest description is at most 132 characters (store limit): ${manifest.description.length}`, manifest.description.length);
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
    ok(/fills each page and then waits for you/.test(sbs.textContent) && /Continue, Skip and Stop before Next and before Agree \(Skip ends the job without clicking and the run moves on\)/.test(sbs.textContent) && /click the console's own button yourself/.test(sbs.textContent), "the step-by-step explanation names the panel, Continue/Stop, Next, Agree and the user's own click", sbs.textContent);
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
    ok(mode.tagName === "BUTTON" && mode.type === "button" && mode.getAttribute("role") === "switch" && mode.getAttribute("aria-checked") === "false" && !mode.hasAttribute("aria-pressed") && /Click to switch to FULL RUN/.test(mode.title), "the MODE control is a button with role=switch, aria-checked false and a title that explains the switch", mode.title);
    ok(stepBtn && stepBtn.tagName === "BUTTON" && stepBtn.closest("header") && stepBtn.getAttribute("role") === "switch" && stepBtn.getAttribute("aria-checked") === "true" && !stepBtn.hasAttribute("aria-pressed") && doc.getElementById("step-toggle-label").textContent === "fast mode", 'the step-by-step switch sits in the header, aria-checked true (on = fast mode), labelled "fast mode" while step-by-step is off (inside joke off, the default)', stepBtn && stepBtn.textContent.trim());
    {
      const knobOf = (el) => { const t = el.firstElementChild; return t && t.tagName === "SPAN" && t.classList.contains("track") && t.getAttribute("aria-hidden") === "true" && t.children.length === 1 && t.firstElementChild.classList.contains("knob") && t.textContent === ""; };
      ok(knobOf(mode) && knobOf(stepBtn) && stepBtn.querySelector(".track ~ #step-toggle-label"), "both switches start with an aria-hidden .track > .knob (no text), followed by the label", `${mode.innerHTML.slice(0, 80)} | ${stepBtn.firstElementChild && stepBtn.firstElementChild.outerHTML}`);
      ok(mode.textContent === "MODE: DRY RUN" && mode.className === "mode dry" && !mode.classList.contains("locked") && !stepBtn.classList.contains("locked") && mode.disabled === false && stepBtn.disabled === false, "with no run: #mode.textContent is exactly MODE: DRY RUN, no .locked class on either switch, neither disabled", `${JSON.stringify(mode.textContent)} ${mode.className} / ${stepBtn.className}`);
      const swCss = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
      ok(/header #mode \.track, header #step-toggle \.track\s*\{[^}]*width:\s*34px;[^}]*height:\s*18px;[^}]*border-radius:\s*9px;[^}]*transition:\s*background-color 150ms/.test(swCss)
        && /\.knob\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;[^}]*border-radius:\s*50%;[^}]*transition:\s*transform 150ms/.test(swCss)
        && /\[aria-checked="true"\] \.knob\s*\{\s*transform:\s*translateX\(16px\)/.test(swCss)
        && /header #mode\[aria-checked="true"\] \.track\s*\{\s*background:\s*var\(--mgc-warn\)/.test(swCss)
        && /header #step-toggle\[aria-checked="true"\] \.track\s*\{\s*background:\s*var\(--mgc-accent\)/.test(swCss)
        && /header #mode\.live\s*\{\s*color:\s*var\(--mgc-warn\)/.test(swCss)
        && /header #mode\.locked, header #step-toggle\.locked\s*\{\s*opacity:\s*0\.5;\s*cursor:\s*default/.test(swCss)
        && /header #mode:focus-visible, header #step-toggle:focus-visible\s*\{[^}]*outline:/.test(swCss),
        "popup.css: 34 x 18 px track (9 px radius), 14 px round knob sliding 16 px when aria-checked is true, 150 ms; red track and red label for FULL RUN, accent track for fast mode; .locked has the disabled look; a focus-visible ring");
    }
    ok(shown("icon-warning") && !shown("icon-snail") && doc.querySelector("#icon-warning path") && doc.getElementById("icon-warning").getAttribute("aria-hidden") === "true", "the warning-sign SVG is displayed and the snail SVG is not (display style, not the hidden attribute: it does not apply to inline SVG)");
    const warningSvg = doc.getElementById("icon-warning");
    const triangle = warningSvg.querySelector("path");
    ok(!doc.getElementById("icon-dog") && /^M12 2\.5L22\.5 20\.5H1\.5z$/.test(triangle.getAttribute("d")) && triangle.getAttribute("stroke") === "currentColor" && warningSvg.querySelectorAll("path").length === 2 && warningSvg.querySelector("circle"),
      "the kubardy icon is a warning sign (a triangle outline with an exclamation mark: a bar and a dot), the running dog is gone", triangle.getAttribute("d"));
    const popupCssText = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/header \.step-toggle \.icon\s*\{[^}]*color:\s*var\(--mgc-accent-dark\)/.test(popupCssText) && warningSvg.classList.contains("icon") && doc.getElementById("icon-snail").classList.contains("icon"),
      "both icons take the same colour (currentColor from the .icon rule: the dark accent), as the dog did");
    ok(/^fast mode: step-by-step confirmation is off/.test(stepBtn.title) && !/kubardy/.test(stepBtn.title) && /runs each job through without pausing: no Continue before Next, and in a full run no Continue before Agree/.test(stepBtn.title) && /Click for slow mode/.test(stepBtn.title), "its title explains that fast mode runs without pauses, and the switch (no \"kubardy\" text)", stepBtn.title);
    ok(!doc.querySelector('header img[src*="icon-master"]') && doc.querySelectorAll("header svg").length === 2 && !/<img[^>]*icon-(snail|warning|dog)/.test(fs.readFileSync(path.join(E.EXT, "popup/popup.html"), "utf8")), "both icons are inline SVG, no external assets");

    mode.click(); await tick();
    ok(confirms.length === 1 && /Switch to FULL RUN\?/.test(confirms[0]) && /clicks Agree and makes Marketplace purchases that bill the project/.test(confirms[0]), "clicking the banner in DRY RUN asks for a confirmation that names the purchases", confirms[0]);
    ok(store.settings.live_mode === true && mode.textContent === "MODE: FULL RUN" && mode.className === "mode live" && mode.getAttribute("aria-checked") === "true" && /Click to switch to DRY RUN/.test(mode.title), "confirmed: live_mode written true, banner MODE: FULL RUN in red, aria-checked true", `${store.settings.live_mode} ${mode.textContent}`);
    ok(store.settings.business_name === "b" && store.settings.use_cases === "x", "the other settings survived the write (merged, not replaced)");
    mode.click(); await tick();
    ok(confirms.length === 1 && store.settings.live_mode === false && mode.textContent === "MODE: DRY RUN" && mode.getAttribute("aria-checked") === "false", "clicking again switches back to DRY RUN without a confirm, aria-checked false", mode.textContent);
    p.win.confirm = (msg) => { confirms.push(msg); return false; };
    mode.click(); await tick();
    ok(confirms.length === 2 && store.settings.live_mode === false && mode.textContent === "MODE: DRY RUN" && mode.getAttribute("aria-checked") === "false", "a declined confirm leaves DRY RUN (the switch stays off, aria-checked false)", mode.textContent);

    stepBtn.click(); await tick();
    ok(store.settings.step_by_step === true && stepBtn.getAttribute("aria-checked") === "false" && doc.getElementById("step-toggle-label").textContent === "slow mode" && shown("icon-snail") && !shown("icon-warning") && /slow mode: step-by-step confirmation is on/.test(stepBtn.title), 'clicking the step button writes step_by_step=true: "slow mode" with the snail only, aria-checked false (off = slow mode), title updated', stepBtn.textContent.trim());
    stepBtn.click(); await tick();
    ok(store.settings.step_by_step === false && stepBtn.getAttribute("aria-checked") === "true" && doc.getElementById("step-toggle-label").textContent === "fast mode" && shown("icon-warning") && !shown("icon-snail"), 'clicking again writes false: "fast mode" with the warning sign only, aria-checked true', stepBtn.textContent.trim());
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
    ok(store.settings.step_by_step === false && doc.getElementById("step-toggle-label").textContent === "fast mode" && err.hidden === false && /A run is in progress/.test(err.textContent), "toggling step-by-step during a run is refused the same way", err.textContent);
    {
      const m = doc.getElementById("mode"), s = doc.getElementById("step-toggle");
      ok(m.classList.contains("locked") && s.classList.contains("locked") && m.disabled === false && s.disabled === false && m.getAttribute("aria-checked") === "false" && s.getAttribute("aria-checked") === "true",
        "during a run both switches carry .locked (the disabled look) but stay enabled, so a click reaches the refusal; aria-checked unchanged", `${m.className} / ${s.className}`);
      ok(/A run is in progress: stop it before changing the mode\.$/.test(m.title) && /A run is in progress: stop it before changing this\.$/.test(s.title), "both titles end with the lock text, unchanged", `${m.title} | ${s.title}`);
    }
    const popupJs = fs.readFileSync(path.join(E.EXT, "popup/popup.js"), "utf8");
    const optionsJs = fs.readFileSync(path.join(E.EXT, "options/options.js"), "utf8");
    ok((popupJs.match(/K\.saveSettings\(/g) || []).length === 2 && (optionsJs.match(/K\.saveSettings\(/g) || []).length === 2 && !/storage\.local\.set\(\{\s*\[KEYS\.SETTINGS\]/.test(popupJs + optionsJs), "both pages write settings only through MGC.saveSettings (the one path)");
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
    // The API-enablement panel (policy "ask"): the step reads "Enable the API".
    const store = {
      settings: Object.assign({}, FULL, { api_enable_policy: "ask" }), running: true, run: { runId: "r", live: false },
      current: { jobIndex: 0, phase: "awaiting_confirmation", awaiting: "api-enable" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "awaiting_confirmation", awaiting: "api-enable", step: "waiting for your confirmation before Enable the API", message: "" }]
    };
    const p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ok(/^waiting for your confirmation on proj-one\/claude-haiku-4-5: Enable the API \(job 1\/1\)/.test(p.document.getElementById("status").textContent), "(api policy) awaiting_confirmation(api-enable): the popup status reads Enable the API", p.document.getElementById("status").textContent);
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
    const realClose = p.win.close;
    store.__closed = false; p.win.close = () => { store.__closed = true; };
    runs.dispatchEvent(new p.win.MouseEvent("click", { bubbles: true, cancelable: true })); // (loadPage stubs HTMLAnchorElement.prototype.click to capture downloads)
    ok(store.__tab === "chrome-extension://x/runs/runs.html" && store.__closed === false, "clicking it opens runs/runs.html in a new tab through chrome.tabs.create (the popup stays)", store.__tab);
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/header \.header-links\s*\{[^}]*display:\s*flex/.test(css), "popup.css lays the two links out in a row");
    p.win.close = realClose;
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
    ok(a[2] === "2" && a[3] === "done 0 · dry-run 1 · skipped 1 · skipped-by-you 0 · not-enabled 0 · failed 0 · unverified 0 · stopped 0", "jobs and the eight counts (as the popup's summary counts them)", a[3]);
    ok(cells(rows[1])[3] === "done 1 · dry-run 0 · skipped 0 · skipped-by-you 0 · not-enabled 0 · failed 0 · unverified 0 · stopped 1" && cells(rows[0])[3] === "done 0 · dry-run 0 · skipped 0 · skipped-by-you 0 · not-enabled 0 · failed 0 · unverified 0 · stopped 0 · pending 2", "counts of the other runs (a pending count only when some job is pending)", cells(rows[0])[3]);
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
    ok(lines[0] === "Model Garden Clicker run log" && lines[1] === "run id:        run-a" && lines[2] === "started:       2026-10-08T10:05:00.000Z" && lines[3] === "ended:         2026-10-08T10:09:30.000Z" && lines[4] === "mode:          DRY RUN" && lines[5] === "step-by-step:  off" && lines[6] === "reason:        all jobs processed" && lines[7] === "jobs:          2 (done 0 · dry-run 1 · skipped 1 · skipped-by-you 0 · not-enabled 0 · failed 0 · unverified 0 · stopped 0)" && lines[8] === "log lines:     4",
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

  console.log("--- (N6/P4) the sanitiser also replaces C1 controls, zero-width and other invisible characters, the soft hyphen, variation selectors, Hangul fillers and tag characters with U+FFFD");
  {
    fakeIDB.reset();
    // C1 (NEL U+0085, CSI U+009B, APC U+009F), soft hyphen U+00AD,
    // zero-width U+200B-U+200D, word joiner U+2060, BOM U+FEFF, a tag
    // character U+E0041 (astral); and (P4) the Hangul fillers U+115F, U+1160,
    // U+3164, U+FFA0, the Mongolian vowel separator U+180E, the invisible
    // operators U+2061 and U+2064, the variation selectors U+FE00, U+FE0F,
    // U+E0100 and U+E01EF (astral), the interlinear annotation anchors
    // U+FFF9 and U+FFFB.
    const samples = [0x0085, 0x009b, 0x009f, 0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xe0041,
      0x115f, 0x1160, 0x3164, 0xffa0, 0x180e, 0x2061, 0x2064, 0xfe00, 0xfe0f, 0xe0100, 0xe01ef, 0xfff9, 0xfffb];
    const msg = "ZZSTART" + samples.map((c) => String.fromCodePoint(c)).join("") + "ZZEND";
    await RLNODE.create({ runId: "r-n6", startedAt: Date.UTC(2026, 9, 8, 13, 0, 0), live: false }, [], false);
    await RLNODE.append("r-n6", { t: Date.UTC(2026, 9, 8, 13, 0, 0), level: "warn", src: "content", msg });
    const rec = await RLNODE.get("r-n6");
    const text = RLNODE.textOf(rec, await RLNODE.readLines("r-n6"));
    const line = text.split("\n").find((l) => /ZZSTART/.test(l)) || "";
    const stillForbidden = Array.from(line).filter((c) => samples.includes(c.codePointAt(0)));
    const fffd = Array.from(line).filter((c) => c === "�").length;
    ok(stillForbidden.length === 0 && fffd === samples.length, `(N6/P4) every one of the ${samples.length} samples is replaced with U+FFFD (${fffd} replaced; none left)`, JSON.stringify(stillForbidden.map((c) => c.codePointAt(0).toString(16))));
    ok(/ZZSTART/.test(line) && /ZZEND/.test(line), "(N6) the readable text around the hidden characters survives", JSON.stringify(line));
    // Controls: a tab, CJK text, an astral emoji and combining marks outside the class pass through.
    const kept = "\t漢字😀é";
    ok(RLNODE.textOf({ runId: "x", startedAt: 1 }, [{ t: 1, level: "info", src: "worker", msg: "K" + kept + "K" }]).includes("K" + kept + "K"), "(P4) control: a tab, CJK, an astral emoji and a combining acute are kept as they are");
    fakeIDB.reset();
  }

  console.log("--- (U3) first load of a new version resets the model selection to none, once; later loads keep it");
  {
    const modelSlugs = JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8")).map((m) => m.slug);
    // A 0.4.0-shaped popup_state: every model ticked, no version marker.
    const store = { settings: Object.assign({}, FULL), popup_state: { projects: "proj-one", models: modelSlugs.slice(), extra: "" } };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    let ticked = Array.from(p.document.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(modelSlugs.length >= 1 && ticked.length === 0 && store.popup_state.version === MANIFEST_VERSION && store.popup_state.models.length === 0, "a 0.4.0 popup_state (all models ticked, no version) loads with none ticked and records the version marker", `${ticked.length} ticked, version ${store.popup_state.version}`);
    p.win.close();
    // The user now picks one model; it is stored with the current version.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const one = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === modelSlugs[0]);
    one.checked = true; one.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(JSON.stringify(store.popup_state.models) === JSON.stringify([modelSlugs[0]]), "the user's pick is stored with the version marker");
    p.win.close();
    // A second load at the same version keeps the user's selection.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    ticked = Array.from(p.document.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    ok(JSON.stringify(ticked) === JSON.stringify([modelSlugs[0]]), "a later load at the same version keeps whatever the user picked (no second reset)", JSON.stringify(ticked));
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
    const first = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === modelSlugs[0]);
    first.checked = true; first.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
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
    const first4 = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === modelSlugs[0]);
    first4.checked = true; first4.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    store4.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 1, done: 1, skipped: 0 } : { ok: true });
    p.document.getElementById("start").click(); await tick();
    ok(confirms.length === 1 && /FULL RUN/.test(confirms[0]) && /guard is off/.test(confirms[0]) && /pairs already done or skipped in earlier runs will be processed again \(1 done, 0 skipped\)/.test(confirms[0]), "(N1) the full-run confirm names the override when the box is ticked, with the counts of each kind", confirms[0]);
    const pv4 = (store4.__messages || []).filter((m) => m.type === p.K.MSG.GUARD_PREVIEW);
    ok(pv4.length === 1 && JSON.stringify(pv4[0].projects) === '["proj-z"]' && pv4[0].models.length === 1, "(0.8.0) the confirm's counts come from one mgc:guard-preview for the pairs the Start would send", JSON.stringify(pv4));
    ok(p.document.getElementById("include-done").checked === false && !(store4.__messages || []).some((m) => m.type === p.K.MSG.START), "(P1) a cancelled full-run confirm spends the tick: the box is cleared and no START was sent");
    // (0.8.0) box not ticked: the confirm names how many pairs the guard leaves out, of each kind.
    store4.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: true, total: 3, done: 1, skipped: 1 } : { ok: true });
    p.document.getElementById("projects").value = "proj-z\nproj-y\nproj-x";
    p.document.getElementById("start").click(); await tick();
    ok(confirms.length === 2 && /for up to 1 of 3 project\/model pair\(s\)/.test(confirms[1]) && /leaves out 1 pair\(s\) done and 1 pair\(s\) skipped \(already enabled\) in earlier runs/.test(confirms[1]), "(0.8.0) box not ticked: the full-run confirm names the pairs left out, done and skipped, and the remaining count", confirms[1]);
    store4.__reply = (m) => (m.type === p.K.MSG.GUARD_PREVIEW ? { ok: false, error: "database cannot be opened" } : { ok: true });
    p.document.getElementById("start").click(); await tick();
    ok(confirms.length === 3 && /could not be counted \(database cannot be opened\)/.test(confirms[2]), "(0.8.0) a preview that fails says so in the confirm (the worker still refuses the full run at Start)", confirms[2]);
    p.win.close();
    // (P1) every Start click spends the tick: a refusal by the popup's own check and a refusal by the worker clear it too.
    const store5 = { settings: Object.assign({}, FULL) };
    p = await loadPage("popup/popup.html", store5, POPUP_SCRIPTS);
    const box5 = p.document.getElementById("include-done");
    box5.checked = true;
    p.document.getElementById("start").click(); await tick();
    ok(/enter at least one project ID/.test(p.document.getElementById("error").textContent) && box5.checked === false && !(store5.__messages || []).some((m) => m.type === p.K.MSG.START), "(P1) a Start refused by the popup's own check (no project ID) clears the box; no START sent");
    p.document.getElementById("projects").value = "Bad_ID";
    const first5 = Array.from(p.document.querySelectorAll("#models input")).find((cb) => cb.value === modelSlugs[0]);
    first5.checked = true; first5.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    box5.checked = true;
    store5.__reply = (m) => (m.type === p.K.MSG.START ? { ok: false, error: "invalid project ID: Bad_ID" } : { ok: true });
    p.document.getElementById("start").click(); await tick();
    const sent5 = (store5.__messages || []).filter((m) => m.type === p.K.MSG.START);
    ok(sent5.length === 1 && sent5[0].includeDone === true && JSON.stringify(sent5[0].projects) === JSON.stringify(["Bad_ID"]), "(D12) the popup no longer pre-validates the IDs: the START message carries the typed ID and the tick to the worker", JSON.stringify(sent5));
    ok(/invalid project ID: Bad_ID/.test(p.document.getElementById("error").textContent) && box5.checked === false && p.document.getElementById("start").disabled === false, "(P1) a Start refused by the worker (its reply carries the reason) clears the box and re-enables Start", p.document.getElementById("error").textContent);
    p.win.close();
    fakeIDB.reset();
  }

  console.log("--- (T6/T7) popup: the per-run \"Check only\" box, its refusal with FULL RUN, CHECK ONLY in the status and the summary, not-enabled in the counts");
  {
    const slug0 = JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8"))[0].slug;
    const fill = async (p, projects) => {
      p.document.getElementById("projects").value = projects;
      const cb = Array.from(p.document.querySelectorAll("#models input")).find((x) => x.value === slug0);
      cb.checked = true; cb.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    };
    // (T6) the box exists next to include-done, unticked by default, with a tooltip.
    const store = { settings: Object.assign({}, FULL) };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    const box = p.document.getElementById("check-only");
    const label = box && box.closest("label");
    ok(box && box.type === "checkbox" && box.checked === false && label && /^ Check only: read whether each model is enabled; click nothing$/.test(label.textContent) && /click/i.test(label.title || "") && label.previousElementSibling && label.previousElementSibling.contains(p.document.getElementById("include-done")),
      "(T6) the \"Check only\" box exists under the include-done box, unticked by default, with its label and a tooltip", label && label.textContent);
    // (T6) ticked: START carries checkOnly true; the box is spent and never stored.
    box.checked = true; box.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    await fill(p, "proj-c");
    p.document.getElementById("start").click(); await tick();
    let starts = (store.__messages || []).filter((m) => m.type === p.K.MSG.START);
    ok(starts.length === 1 && starts[0].checkOnly === true && starts[0].live === false, "(T6) a ticked box travels as checkOnly true in MSG.START", JSON.stringify(starts));
    ok(box.checked === false && !("checkOnly" in (store.popup_state || {})), "(T6) the Start click spends the box (unticked after) and nothing is stored in popup_state", JSON.stringify(store.popup_state));
    // (T6 control) unticked: START does not carry checkOnly true; include-done behaves as before.
    p.document.getElementById("include-done").checked = true;
    p.document.getElementById("start").click(); await tick();
    starts = (store.__messages || []).filter((m) => m.type === p.K.MSG.START);
    ok(starts.length === 2 && starts[1].checkOnly !== true && starts[1].includeDone === true && p.document.getElementById("include-done").checked === false, "(T6 control) an unticked box sends no checkOnly true; the include-done box still travels and is spent", JSON.stringify(starts[1]));
    p.win.close();
    // (T6) FULL RUN plus the box: the error line, no MSG.START, no guard preview, no confirm; the box is spent.
    const storeF = { settings: Object.assign({}, FULL, { live_mode: true }) };
    p = await loadPage("popup/popup.html", storeF, POPUP_SCRIPTS);
    const confirmsF = []; p.win.confirm = (m) => { confirmsF.push(m); return true; };
    await fill(p, "proj-f");
    p.document.getElementById("check-only").checked = true;
    p.document.getElementById("start").click(); await tick();
    const err = p.document.getElementById("error");
    ok(err.hidden === false && err.textContent === "Check only cannot be combined with FULL RUN: switch to DRY RUN or untick the box" && !(storeF.__messages || []).some((m) => m.type === p.K.MSG.START || m.type === p.K.MSG.GUARD_PREVIEW) && confirmsF.length === 0 && p.document.getElementById("check-only").checked === false,
      "(T6) MODE: FULL RUN with the box ticked: the error line, nothing sent (no START, no preview), no confirm, the box spent", `${err.textContent} ${JSON.stringify(storeF.__messages || [])}`);
    // (T6 control) FULL RUN without the box: the confirm and START as before.
    p.document.getElementById("start").click(); await tick();
    ok(confirmsF.length === 1 && (storeF.__messages || []).some((m) => m.type === p.K.MSG.START && m.live === true && m.checkOnly !== true), "(T6 control) FULL RUN without the box: the confirm, then START (no checkOnly)", JSON.stringify(storeF.__messages || []));
    p.win.close();
    // (T7) a running check-only run: the status line reads CHECK ONLY next to the mode; a not-enabled row has its class.
    const running = (checkOnly) => ({
      settings: Object.assign({}, FULL), running: true, run: { runId: "r", live: false, checkOnly },
      current: { jobIndex: 1, phase: "model" },
      queue: [{ projectId: "proj-a", modelSlug: "claude-haiku-4-5", status: "not-enabled", message: "not enabled: the Enable button is offered; nothing was clicked (check only)" },
        { projectId: "proj-b", modelSlug: "claude-haiku-4-5", status: "running", phase: "model", message: "" }]
    });
    p = await loadPage("popup/popup.html", running(true), POPUP_SCRIPTS);
    const status = p.document.getElementById("status").textContent;
    ok(/^\[DRY RUN · CHECK ONLY\] running job 2\/2: proj-b \/ claude-haiku-4-5 \[model\]/.test(status) && /not-enabled 1/.test(status), "(T7) the status line of a running check-only run reads [DRY RUN · CHECK ONLY] and counts not-enabled", status);
    const row = p.document.querySelector("#results tbody tr");
    ok(row && row.className === "not-enabled" && row.querySelector("td.st").textContent === "not-enabled", "(T7) a not-enabled job's row carries the not-enabled class", row && row.outerHTML.slice(0, 120));
    p.win.close();
    p = await loadPage("popup/popup.html", running(false), POPUP_SCRIPTS);
    ok(!/CHECK ONLY/.test(p.document.getElementById("status").textContent), "(T7 control) a run without checkOnly says nothing of it", p.document.getElementById("status").textContent);
    p.win.close();
    const css = fs.readFileSync(path.join(E.EXT, "popup/popup.css"), "utf8");
    ok(/tr\.not-enabled td\.st\s*\{\s*color:\s*var\(--mgc-info\);\s*\}/.test(css), "(T7) popup.css colours the not-enabled status with --mgc-info");
    // (T7) the end-of-run summary of a check-only run: CHECK ONLY in its title, not-enabled in the eight counts.
    const fin = (checkOnly) => ({ settings: Object.assign({}, FULL), running: false, run: { runId: "rs", live: false, checkOnly, finishedAt: 1, reason: "all jobs processed" }, summary_ack: { runId: "rs", tabId: 1, reason: "all jobs processed", ack: false },
      queue: [{ projectId: "proj-a", modelSlug: "claude-haiku-4-5", status: "not-enabled", message: "x" }, { projectId: "proj-b", modelSlug: "claude-haiku-4-5", status: "skipped", message: "skipped: already enabled (check only)" }] });
    p = await loadPage("popup/popup.html", fin(true), POPUP_SCRIPTS);
    ok(p.document.querySelector("#summary .title").textContent === "Run all jobs processed: 2 job(s) [DRY RUN · CHECK ONLY]" && p.document.querySelector("#summary .counts").textContent === "done 0 · dry-run 0 · skipped 1 · skipped-by-you 0 · not-enabled 1 · failed 0 · unverified 0 · stopped 0",
      "(T7) the summary of a check-only run names CHECK ONLY and counts not-enabled among the eight counts", `${p.document.querySelector("#summary .title").textContent} | ${p.document.querySelector("#summary .counts").textContent}`);
    p.win.close();
    p = await loadPage("popup/popup.html", fin(false), POPUP_SCRIPTS);
    ok(p.document.querySelector("#summary .title").textContent === "Run all jobs processed: 2 job(s)", "(T7 control) the summary of a run without checkOnly has no CHECK ONLY", p.document.querySelector("#summary .title").textContent);
    p.win.close();
    // The run log's text header names a check-only run in the mode line (the Runs page shows "· check only").
    const head = RLNODE.textOf({ runId: "x", startedAt: 0, finishedAt: 1, live: false, checkOnly: true, stepByStep: false, reason: "r", jobs: [], results: [], lineCount: 0 }, []).split("\n");
    const headC = RLNODE.textOf({ runId: "x", startedAt: 0, finishedAt: 1, live: false, stepByStep: false, reason: "r", jobs: [], results: [], lineCount: 0 }, []).split("\n");
    ok(head[4] === "mode:          DRY RUN · check only" && headC[4] === "mode:          DRY RUN", "the downloaded log's mode line says \"· check only\" for a check-only run, nothing for another (control)", `${head[4]} | ${headC[4]}`);
    const runsJs = fs.readFileSync(path.join(E.EXT, "runs/runs.js"), "utf8");
    ok(/rec\.checkOnly === true\) span\(td, "sbs", " · check only"\)/.test(runsJs), "the Runs page's mode cell adds \"· check only\" for a check-only record");
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

  console.log('--- (0.8.0) the "inside joke" box: the last control on the options page; off shows "fast mode", on shows "kubardy mode" (text only)');
  {
    const store = { settings: Object.assign({}, FULL) };
    let p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    let doc = p.document;
    const controls = Array.from(doc.querySelectorAll("input, button, select, textarea"));
    const last = controls[controls.length - 1];
    ok(last && last.name === "inside_joke" && last.type === "checkbox" && last.closest("label").textContent.trim() === "inside joke", 'the last control on the options page is a checkbox labelled "inside joke"', last && last.outerHTML);
    ok(last.checked === false && p.K.DEFAULT_SETTINGS.inside_joke === false, "unticked by default (DEFAULT_SETTINGS.inside_joke false)");
    const names = () => Array.from(doc.querySelectorAll(".step-off-name")).map((e) => e.textContent);
    ok(names().length === 2 && names().every((t) => t === "fast mode") && !/kubardy/i.test(doc.body.textContent), 'off: every step-by-step-off name on the page reads "fast mode", no "kubardy" text anywhere', names().join(","));
    // An unsaved DRY RUN edit survives the box's own instant save.
    doc.getElementById("form").elements.dry_run.checked = false;
    last.checked = true; last.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    p.win.chrome.__fire({ settings: { oldValue: Object.assign({}, FULL), newValue: store.settings } }); await tick();
    ok(store.settings.inside_joke === true && store.settings.live_mode === false && names().every((t) => t === "kubardy mode"), 'ticking stores inside_joke true at once (the mode untouched) and the page reads "kubardy mode"', JSON.stringify(store.settings));
    ok(doc.getElementById("form").elements.dry_run.checked === false, "an unsaved DRY RUN edit in the form is left as it was by that instant save");
    p.win.close();
    // The popup follows the setting; the icon stays the warning sign.
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    doc = p.document;
    const stepBtn = doc.getElementById("step-toggle");
    ok(doc.getElementById("step-toggle-label").textContent === "kubardy mode" && /^kubardy mode: step-by-step confirmation is off/.test(stepBtn.title) && doc.getElementById("icon-warning").style.display !== "none", 'popup with the box ticked: "kubardy mode", same warning-sign icon', stepBtn.title);
    stepBtn.click(); await tick();
    ok(/Click for kubardy mode \(no pauses\)/.test(stepBtn.title), "slow mode's title names kubardy mode as the other choice", stepBtn.title);
    p.win.close();
    store.settings.inside_joke = false; store.settings.step_by_step = false;
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    doc = p.document;
    const allText = doc.body.textContent + Array.from(doc.querySelectorAll("[title]")).map((e) => e.title).join(" ");
    ok(doc.getElementById("step-toggle-label").textContent === "fast mode" && !/kubardy/i.test(allText), 'popup with the box unticked: "fast mode", no "kubardy" in any text or title', doc.getElementById("step-toggle-label").textContent);
    p.win.close();
    // During a run the box still saves (text only, not a mode).
    const storeRun = { settings: Object.assign({}, FULL), running: true, run: { runId: "r", live: false } };
    p = await loadPage("options/options.html", storeRun, OPTIONS_SCRIPTS);
    const box = p.document.getElementById("form").elements.inside_joke;
    box.checked = true; box.dispatchEvent(new p.win.Event("change", { bubbles: true })); await tick();
    ok(storeRun.settings.inside_joke === true && storeRun.settings.live_mode === false, "during a run the inside joke box saves (it changes no mode)");
    p.win.close();
  }

  console.log("--- (0.8.0) popup: Pause next to Stop while a run is active, Resume while paused");
  {
    const store = { settings: Object.assign({}, FULL) };
    let p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    let doc = p.document;
    const pause = () => doc.getElementById("pause");
    ok(pause() && pause().hidden === true && pause().previousElementSibling === doc.getElementById("stop"), "idle: the Pause button sits right after Stop and is hidden");
    p.win.close();
    Object.assign(store, { running: true, run: { runId: "r", live: false }, current: { jobIndex: 0, phase: "model" },
      queue: [{ projectId: "proj-one", modelSlug: "claude-haiku-4-5", status: "running", phase: "model" }, { projectId: "proj-two", modelSlug: "claude-haiku-4-5", status: "pending" }] });
    p = await loadPage("popup/popup.html", store, POPUP_SCRIPTS);
    doc = p.document;
    ok(pause().hidden === false && pause().disabled === false && pause().textContent === "Pause" && doc.getElementById("stop").disabled === false, "a run is active: Pause shown and enabled next to an enabled Stop");
    store.__reply = (m) => { if (m.type === p.K.MSG.PAUSE) store.paused = true; if (m.type === p.K.MSG.RESUME) store.paused = false; return { ok: true }; };
    pause().click(); await tick();
    ok((store.__messages || []).some((m) => m.type === p.K.MSG.PAUSE) && store.settings.live_mode === false, "Pause sends mgc:pause (the mode untouched)");
    p.win.chrome.__fire({ paused: { newValue: true } }); await tick();
    ok(pause().textContent === "Resume" && /\(PAUSED after this job\)/.test(doc.getElementById("status").textContent), "while job 1 runs: the button reads Resume and the status says PAUSED after this job", doc.getElementById("status").textContent);
    store.current = { jobIndex: 0, phase: "finished" }; store.queue[0].status = "dry-run";
    p.win.chrome.__fire({ current: { newValue: store.current } }); await tick();
    ok(/^PAUSED before job 2\/2: proj-two \/ claude-haiku-4-5; Resume continues, Stop ends the run/.test(doc.getElementById("status").textContent) && doc.getElementById("stop").disabled === false && doc.getElementById("start").disabled === true, "paused between jobs: the status names the next job; Stop stays enabled, Start disabled", doc.getElementById("status").textContent);
    pause().click(); await tick();
    ok((store.__messages || []).some((m) => m.type === p.K.MSG.RESUME) && store.paused === false, "Resume sends mgc:resume");
    store.__reply = () => ({ ok: false, error: "no run in progress" });
    p.win.chrome.__fire({ paused: { newValue: false } }); await tick();
    pause().click(); await tick();
    ok(/no run in progress/.test(doc.getElementById("error").textContent), "a refused pause shows the worker's reason");
    p.win.close();
  }

  console.log("--- (0.8.0) options page: Export settings / Import settings in the Advanced section");
  {
    const stored = () => ({
      settings: Object.assign({}, FULL, { live_mode: true, step_by_step: true, inside_joke: true }),
      timing: Object.assign({}, globalThis.MGC.TIMING_DEFAULTS, { poll_ms: 400 }),
      runs_keep: 30,
      popup_state: { projects: "proj-one\nproj-two\n", models: ["claude-haiku-4-5", "claude-opus-5-5"], extra: "claude-x-1", version: MANIFEST_VERSION },
      running: true, run: { runId: "r-act", live: true }, queue: [{ projectId: "proj-run", modelSlug: "claude-haiku-4-5", status: "running" }]
    });
    let store = stored();
    let p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    let doc = p.document;
    const adv = doc.querySelector("fieldset.advanced");
    ok(adv.contains(doc.getElementById("config-export")) && adv.contains(doc.getElementById("config-import")) && doc.getElementById("config-import").type === "file", "Export settings (a button) and Import settings (a file input) sit in the Advanced section");
    doc.getElementById("config-export").click(); await tick(); await tick();
    const dl = (store.__downloads || [])[0];
    ok(dl && /^model-garden-clicker-settings-\d{8}-\d{6}\.json$/.test(dl.download) && /^blob:/.test(dl.href), "Export saves a file through a blob link (no downloads permission)", JSON.stringify(dl));
    const exported = JSON.parse(await store.__blobs[0].text());
    ok(exported.app === "model-garden-clicker" && exported.schema === 1 && exported.settings.business_name === "b" && exported.settings.step_by_step === true && exported.settings.inside_joke === true, "the file holds the schema, the questionnaire, step-by-step and the inside joke box", JSON.stringify(exported.settings));
    ok(JSON.stringify(exported.popup) === JSON.stringify({ projects: ["proj-one", "proj-two"], models: ["claude-haiku-4-5", "claude-opus-5-5"], extra: "claude-x-1" }) && exported.timing.poll_ms === 400 && exported.runs_keep === 30, "the file holds the project IDs, the ticked models, the extra slugs, the timing and runs to keep", JSON.stringify(exported.popup));
    ok(!/live_mode|dry_run|include_?done/i.test(JSON.stringify(exported)), "the file never holds the mode (live_mode) or the per-run include box", JSON.stringify(exported).slice(0, 200));
    p.win.close();

    /** Choose `text` as the import file and wait for the reader. */
    const choose = async (pg, text, name) => {
      const input = pg.document.getElementById("config-import");
      Object.defineProperty(input, "files", { configurable: true, value: [new pg.win.File([text], name || "settings.json", { type: "application/json" })] });
      input.dispatchEvent(new pg.win.Event("change", { bubbles: true }));
      await tick(); await tick();
      const n = pg.document.getElementById("config-note");
      return { text: n.hidden ? "" : n.textContent, error: n.className === "error" };
    };
    // Import into a page whose store is in DRY RUN, during an active run: everything but the mode is filled; Save keeps it.
    store = { settings: Object.assign({}, FULL, { business_name: "old", live_mode: false }), popup_state: { projects: "keep-me-1", models: [], extra: "", version: MANIFEST_VERSION },
      running: true, run: { runId: "r-act", live: false }, queue: [{ projectId: "proj-run", modelSlug: "claude-haiku-4-5", status: "running" }] };
    p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    doc = p.document;
    const form = doc.getElementById("form");
    const file = Object.assign({}, exported, { settings: Object.assign({}, exported.settings, { live_mode: true, business_website: "", favourite: "x" }), popup: Object.assign({}, exported.popup, { includeDone: true }), dry_run: false, extra_top: 1 });
    let r = await choose(p, JSON.stringify(file));
    ok(!r.error && /Imported \d+ value\(s\) from settings\.json\. Click Save to keep them\./.test(r.text) && /written to the popup on Save/.test(r.text), "a full file imports with a notice to Save", r.text);
    ok(/Ignored: /.test(r.text) && /settings\.live_mode is never imported/.test(r.text) && /popup\.includeDone is never imported/.test(r.text) && /dry_run is never imported/.test(r.text) && /settings\.favourite is not a known key/.test(r.text) && /extra_top is not a known key/.test(r.text), "unknown keys and the mode keys are ignored with a visible notice naming each", r.text);
    ok(form.elements.business_name.value === "b" && form.elements.business_website.value === FULL.business_website && form.elements.step_by_step.checked === true && form.elements.inside_joke.checked === true && form.elements.runs_keep.value === "30" && JSON.parse(form.elements.timing_json.value).poll_ms === 400, "the fields are filled; an empty value (business_website \"\") leaves the current one", form.elements.business_website.value);
    ok(form.elements.dry_run.checked === true && store.settings.live_mode === false, "the DRY RUN box is untouched by the import (live_mode true in the file is ignored)");
    ok(store.settings.business_name === "old" && store.popup_state.projects === "keep-me-1", "nothing is stored before Save");
    ok(/if the popup is open, reopen it to see them/.test(r.text), "the notice says an open popup must be reopened to show the imported projects and models", r.text);
    ok(/A run is in progress and the imported step-by-step setting differs from the current one: Save is refused while the run is active\. Stop the run first, then Save\./.test(r.text), "importing a different step-by-step value during a run says that Save is refused while the run is active", r.text);
    const refused = await submit(p);
    ok(refused.error && /A run is in progress/.test(refused.text) && store.settings.business_name === "old", "and Save is indeed refused while the run is active; nothing stored", refused.text);
    // With step-by-step put back as stored, the rest saves.
    form.elements.step_by_step.checked = false;
    const sv = await submit(p);
    ok(!sv.error && store.settings.business_name === "b" && store.settings.live_mode === false && store.settings.inside_joke === true && store.timing.poll_ms === 400 && store.runs_keep === 30, "Save keeps the imported values, still DRY RUN", JSON.stringify(sv));
    ok(store.popup_state.projects === "proj-one\nproj-two" && JSON.stringify(store.popup_state.models) === '["claude-haiku-4-5","claude-opus-5-5"]' && store.popup_state.extra === "claude-x-1" && store.popup_state.version === MANIFEST_VERSION, "Save writes the project IDs, models and extra slugs to the popup's state (with the version marker)", JSON.stringify(store.popup_state));
    ok(store.queue.length === 1 && store.queue[0].projectId === "proj-run" && store.running === true && store.run.runId === "r-act", "the active run's queue and run are untouched");
    // Invalid values: refused as a whole, each key named, nothing filled.
    form.elements.business_name.value = "typed";
    r = await choose(p, JSON.stringify({ schema: 1, settings: { business_name: "new", step_by_step: "yes" }, timing: { poll_ms: 1 }, runs_keep: 0, popup: { projects: ["Bad_ID"] } }));
    ok(r.error && /^Not imported, nothing changed: /.test(r.text) && /settings\.step_by_step must be true or false/.test(r.text) && /timing\.poll_ms must be an integer between 50 and 5000/.test(r.text) && /runs_keep must be an integer between 1 and 500/.test(r.text) && /popup\.projects holds an invalid project ID: "Bad_ID"/.test(r.text) && form.elements.business_name.value === "typed", "invalid values refuse the import with a message naming every key; nothing is filled", r.text);
    r = await choose(p, JSON.stringify({ schema: 2 }));
    ok(r.error && /schema must be an integer from 1 to 1/.test(r.text), "a newer schema is refused naming the key", r.text);
    r = await choose(p, "{ not json", "broken.json");
    ok(r.error && /broken\.json is not valid JSON/.test(r.text), "a file that is not JSON is refused", r.text);
    // The old format: a timing-only object, as the Advanced field takes it.
    form.elements.timing_json.value = JSON.stringify(Object.assign({}, globalThis.MGC.TIMING_DEFAULTS, { nav_ms: 50000 }));
    r = await choose(p, JSON.stringify({ poll_ms: 300, live_mode: true }), "timing.json");
    const tj = JSON.parse(form.elements.timing_json.value);
    ok(!r.error && /\(a timing-only file\)/.test(r.text) && tj.poll_ms === 300 && tj.nav_ms === 50000 && /live_mode is never imported/.test(r.text) && form.elements.dry_run.checked === true, "the old timing-only format imports into the timing field (other keys kept); live_mode in it is ignored", r.text);
    p.win.close();
    // A file with no popup part, or an empty project list, leaves the popup's state alone.
    store = { settings: Object.assign({}, FULL), popup_state: { projects: "keep-me-1", models: ["claude-haiku-4-5"], extra: "", version: MANIFEST_VERSION } };
    p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    r = await choose(p, JSON.stringify({ schema: 1, popup: { projects: [], models: [], extra: "" }, settings: { industry: "Education" } }));
    await submit(p);
    ok(!r.error && store.popup_state.projects === "keep-me-1" && JSON.stringify(store.popup_state.models) === '["claude-haiku-4-5"]' && !/written to the popup/.test(r.text), "an empty project list and empty models leave the popup's state unchanged", JSON.stringify(store.popup_state));
    // Ticked models that are not in models.json move to the extra slugs, named in the notice.
    r = await choose(p, JSON.stringify({ schema: 1, popup: { models: ["claude-haiku-5-5", "claude-private-9", "claude-other-2"], extra: "claude-x-1" } }));
    await submit(p);
    ok(!r.error && /Not in the model list, so moved to the extra slugs: claude-private-9, claude-other-2\./.test(r.text) && JSON.stringify(store.popup_state.models) === '["claude-haiku-5-5"]' && store.popup_state.extra === "claude-x-1, claude-private-9, claude-other-2", "ticked models not in models.json are moved to the extra slugs and named in the notice", `${r.text} | ${JSON.stringify(store.popup_state)}`);
    // null means missing for every key: nothing changes, no notice.
    const form2 = p.document.getElementById("form");
    const before = { name: form2.elements.business_name.value, step: form2.elements.step_by_step.checked, timing: form2.elements.timing_json.value, keep: form2.elements.runs_keep.value };
    r = await choose(p, JSON.stringify({ app: null, schema: null, exported: null, settings: { business_name: null, step_by_step: null, inside_joke: null, unknown_key: null }, popup: null, timing: { poll_ms: null }, runs_keep: null, other: null }));
    ok(!r.error && /Imported 0 value\(s\)/.test(r.text) && !/Ignored/.test(r.text) && form2.elements.business_name.value === before.name && form2.elements.step_by_step.checked === before.step && form2.elements.timing_json.value === before.timing && form2.elements.runs_keep.value === before.keep, "null is missing for every key: nothing filled, nothing refused, no notice", r.text);
    r = await choose(p, JSON.stringify({ poll_ms: null, nav_ms: 50000 }), "timing.json");
    ok(!r.error && JSON.parse(form2.elements.timing_json.value).nav_ms === 50000 && /Imported 1 value/.test(r.text), "null is missing in a timing-only file too", r.text);
    // Text values are capped at 2,000 characters.
    r = await choose(p, JSON.stringify({ schema: 1, settings: { use_cases: "x".repeat(2001), business_name: "fine" }, popup: { extra: "a".repeat(2001) } }));
    ok(r.error && /settings\.use_cases is longer than 2000 characters/.test(r.text) && /popup\.extra is longer than 2000 characters/.test(r.text) && form2.elements.business_name.value === before.name, "a text value over 2,000 characters refuses the file, naming each key; nothing is filled", r.text);
    r = await choose(p, JSON.stringify({ schema: 1, settings: { use_cases: "y".repeat(2000) } }));
    ok(!r.error && form2.elements.use_cases.value.length === 2000, "2,000 characters is accepted", r.text);
    // Ticked models are matched to the model list case-insensitively and keep the list's spelling; null entries in a list are dropped.
    r = await choose(p, JSON.stringify({ schema: 1, popup: { models: ["Claude-Haiku-5-5", null, "claude-haiku-5-5", "Claude-Private-9"], projects: [null, "proj-one"] } }));
    await submit(p);
    ok(!r.error && JSON.stringify(store.popup_state.models) === '["claude-haiku-5-5"]' && /moved to the extra slugs: Claude-Private-9\./.test(r.text) && store.popup_state.projects === "proj-one", "ticked models match the list case-insensitively (the list's spelling kept, once); null entries in a list are dropped", `${r.text} | ${JSON.stringify(store.popup_state)}`);
    // The project and model lists are capped at 8,192 characters joined (CONFIG_LIST_MAX), and the extra slugs at 2,000 again after the move.
    // 350 ids of 24 characters join to 8,749 characters; 400 slugs joined with ", " pass 8,192 too.
    const capIds = Array.from({ length: 350 }, (_, i) => `proj-cap-${String(i).padStart(4, "0")}-abcdefghij`);
    r = await choose(p, JSON.stringify({ schema: 1, popup: { projects: capIds } }));
    ok(r.error && /popup\.projects is longer than 8192 characters/.test(r.text), "a project list over 8,192 characters joined is refused naming the key", r.text);
    const capSlugs = Array.from({ length: 400 }, (_, i) => `claude-cap-${i}-abcdefg`);
    r = await choose(p, JSON.stringify({ schema: 1, popup: { models: capSlugs } }));
    ok(r.error && /popup\.models is longer than 8192 characters/.test(r.text), "a model list over 8,192 characters joined is refused naming the key", r.text);
    r = await choose(p, JSON.stringify({ schema: 1, popup: { models: capSlugs.slice(0, 60), extra: capSlugs.slice(60, 100).join(",") } }));
    ok(r.error && /popup\.extra is longer than 2000 characters once the ticked models not in the model list are moved into it/.test(r.text), "the extra slugs are capped again after the unknown ticked models move into them", r.text);
    // The project list cap applies to the trimmed IDs joined, in the text form too; padding alone does not trip it.
    r = await choose(p, JSON.stringify({ schema: 1, popup: { projects: capIds.join("\n") } }));
    ok(r.error && /popup\.projects is longer than 8192 characters/.test(r.text), "a project text over 8,192 characters (trimmed IDs joined) is refused naming the key", r.text);
    r = await choose(p, JSON.stringify({ schema: 1, popup: { projects: "   proj-pad-one   \n" + " ".repeat(8300) + "\n   proj-pad-two   " } }));
    await submit(p);
    ok(!r.error && store.popup_state.projects === "proj-pad-one\nproj-pad-two", "a project text padded past 8,192 characters with blanks is accepted (the cap counts the trimmed IDs)", `${r.text} | ${JSON.stringify(store.popup_state.projects)}`);
    // A list that empties to nothing leaves the current value, with a notice.
    r = await choose(p, JSON.stringify({ schema: 1, popup: { projects: [null, "  "], models: [null] } }));
    ok(!r.error && /popup\.projects holds no project ID, so the current ones are kept/.test(r.text) && /popup\.models holds no model slug, so the current selection is kept/.test(r.text), "a project or model list that empties to nothing keeps the current value and says so", r.text);
    p.win.close();
  }

  console.log("--- (api policy) constants.js: parseApiEnableOverrides and apiEnablePolicyFor");
  {
    const K = globalThis.MGC;
    let o = K.parseApiEnableOverrides("my-proj-1: never\n\n   \nOther-Proj : ask\r\nthird-proj:enable\n");
    ok(o.ok && o.errors.length === 0 && JSON.stringify(o.map) === '{"my-proj-1":"never","other-proj":"ask","third-proj":"enable"}', "parseApiEnableOverrides: three lines, blank lines ignored, spaces around the colon allowed, the map keyed by the lower-cased ID", JSON.stringify(o));
    o = K.parseApiEnableOverrides("good-proj: never\nnot a project: never\n1proj: never\nmy-proj-1: maybe\nno colon here");
    ok(!o.ok && o.errors.length === 4 && /^line 2 "not a project: never"/.test(o.errors[0]) && /^line 3 "1proj: never"/.test(o.errors[1]) && /^line 4 "my-proj-1: maybe": the policy must be enable, ask or never/.test(o.errors[2]) && /^line 5 "no colon here"/.test(o.errors[3]), "parseApiEnableOverrides: one error per bad line naming its number and text", JSON.stringify(o.errors));
    ok(K.parseApiEnableOverrides("").ok && K.parseApiEnableOverrides(undefined).ok, "control: an empty or missing text parses to no overrides");
    const s = { api_enable_policy: "ask", api_enable_overrides: "My-Proj-1: never" };
    ok(JSON.stringify(K.apiEnablePolicyFor(s, "my-proj-1")) === '{"policy":"never","source":"override"}' && JSON.stringify(K.apiEnablePolicyFor(s, "MY-PROJ-1")) === '{"policy":"never","source":"override"}', "apiEnablePolicyFor: the override beats the default, matched case-insensitively", JSON.stringify(K.apiEnablePolicyFor(s, "my-proj-1")));
    ok(JSON.stringify(K.apiEnablePolicyFor(s, "other-proj")) === '{"policy":"ask","source":"default"}', "control: a project without a line gets the default with source default");
    ok(JSON.stringify(K.apiEnablePolicyFor({ api_enable_policy: "never", api_enable_overrides: "my-proj-1: enable\nbad line" }, "my-proj-1")) === '{"policy":"never","source":"default"}', "an unparsable overrides text falls back to the default policy as a whole");
    ok(JSON.stringify(K.apiEnablePolicyFor({}, "my-proj-1")) === '{"policy":"enable","source":"default"}' && JSON.stringify(K.apiEnablePolicyFor({ api_enable_policy: "sometimes" }, "my-proj-1")) === '{"policy":"enable","source":"default"}', "no setting, or an unknown one: enable (today's behaviour)");
    ok(K.missingSettings(Object.assign({}, FULL, { api_enable_policy: "", api_enable_overrides: "" })).length === 0 && !K.REQUIRED_SETTINGS.includes("api_enable_policy"), "the two keys are never required");
    ok(K.SETTINGS_LABELS.api_enable_policy && K.SETTINGS_LABELS.api_enable_overrides && K.CONFIRM_STEP.API_ENABLE === "api-enable" && K.CONFIRM_STEP_LABEL["api-enable"] === "Enable the API", "labels for both keys; the step api-enable is labelled Enable the API");
  }

  console.log("--- (api policy) options page: the API enablement section, Save validation, export and import");
  {
    let store = { settings: Object.assign({}, FULL) };
    let p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    let doc = p.document;
    const form = doc.getElementById("form");
    const sec = doc.querySelector("fieldset.api-enable");
    const fieldsets = Array.from(doc.querySelectorAll("fieldset"));
    ok(sec && sec.querySelector("legend").textContent === "API enablement" && fieldsets.indexOf(sec) === fieldsets.indexOf(doc.querySelector("fieldset.advanced")) - 1, "the API enablement section sits right above Advanced");
    const sel = form.elements.api_enable_policy;
    ok(sel && sel.tagName === "SELECT" && Array.from(sel.options).map((x) => x.value).join() === "enable,ask,never" && sel.value === "enable", "the policy select offers enable, ask, never and shows enable by default", sel && sel.value);
    const ta = form.elements.api_enable_overrides;
    ok(ta && ta.tagName === "TEXTAREA" && ta.placeholder === "my-terraform-project: never" && /Terraform/.test(sec.textContent) && /Enable APIs/.test(sec.textContent), "the overrides textarea with its placeholder; the paragraph names the dialog and Terraform");
    const errLine = () => { const e = doc.getElementById("api-enable-error"); return e.hidden ? "" : e.textContent; };
    ta.value = "not a project: never\n1proj: never\nmy-proj-1: maybe";
    let sv = await submit(p);
    ok(sv.error && /API enablement/.test(sv.text) && /line 1 "not a project: never"/.test(errLine()) && /line 2 "1proj: never"/.test(errLine()) && /line 3 "my-proj-1: maybe"/.test(errLine()) && store.settings.api_enable_overrides === undefined, "Save refuses bad lines, naming each line; nothing stored", errLine());
    ta.value = "My-Proj-1: never\n";
    setSelect(p, "api_enable_policy", "ask");
    sv = await submit(p);
    ok(!sv.error && store.settings.api_enable_overrides === "My-Proj-1: never\n" && store.settings.api_enable_policy === "ask" && errLine() === "", "Save accepts My-Proj-1: never and stores the text as typed with the policy", JSON.stringify(store.settings));
    p.win.close();
    // Reload: both fields show what is stored; export carries both keys.
    p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    doc = p.document;
    ok(doc.getElementById("form").elements.api_enable_policy.value === "ask" && doc.getElementById("form").elements.api_enable_overrides.value === "My-Proj-1: never\n", "a reload shows the stored policy and overrides");
    doc.getElementById("config-export").click(); await tick(); await tick();
    const exported = JSON.parse(await store.__blobs[store.__blobs.length - 1].text());
    ok(exported.settings.api_enable_policy === "ask" && exported.settings.api_enable_overrides === "My-Proj-1: never\n", "Export carries api_enable_policy and api_enable_overrides", JSON.stringify(exported.settings));
    p.win.close();
    // Import: an unknown policy is refused naming the key; never is accepted and saved; the overrides round-trip.
    store = { settings: Object.assign({}, FULL) };
    p = await loadPage("options/options.html", store, OPTIONS_SCRIPTS);
    doc = p.document;
    const choose = async (pg, text) => {
      const input = pg.document.getElementById("config-import");
      Object.defineProperty(input, "files", { configurable: true, value: [new pg.win.File([text], "settings.json", { type: "application/json" })] });
      input.dispatchEvent(new pg.win.Event("change", { bubbles: true }));
      await tick(); await tick();
      const n = pg.document.getElementById("config-note");
      return { text: n.hidden ? "" : n.textContent, error: n.className === "error" };
    };
    let r = await choose(p, JSON.stringify({ schema: 1, settings: { api_enable_policy: "sometimes" } }));
    ok(r.error && /settings\.api_enable_policy must be "enable", "ask" or "never"/.test(r.text) && doc.getElementById("form").elements.api_enable_policy.value === "enable", "import of api_enable_policy \"sometimes\" is refused naming the key; nothing filled", r.text);
    r = await choose(p, JSON.stringify({ schema: 1, settings: { api_enable_overrides: "my-proj-1: maybe" } }));
    ok(r.error && /settings\.api_enable_overrides/.test(r.text) && /line 1 "my-proj-1: maybe"/.test(r.text), "import of an overrides text with a bad line is refused naming the key and the line", r.text);
    r = await choose(p, JSON.stringify(exported).replace('"api_enable_policy":"ask"', '"api_enable_policy":"never"'));
    ok(!r.error && doc.getElementById("form").elements.api_enable_policy.value === "never" && doc.getElementById("form").elements.api_enable_overrides.value === "My-Proj-1: never", "import of \"never\" and the exported overrides is accepted and fills both fields", r.text);
    sv = await submit(p);
    ok(!sv.error && store.settings.api_enable_policy === "never" && store.settings.api_enable_overrides === "My-Proj-1: never", "Save keeps the imported policy and overrides", JSON.stringify(store.settings));
    p.win.close();
  }

  console.log("--- (U1-U12) deep links in the popup tab: confirm, fill, banner, Clear; a link never starts a run or touches a setting");
  {
    const K = globalThis.MGC;
    const recorder = (answer) => { const calls = []; const fn = (m) => { calls.push(m); return typeof answer === "function" ? answer(m) : answer; }; fn.calls = calls; return fn; };
    const base = () => ({ settings: Object.assign({}, FULL), popup_state: { projects: "old-proj-1", models: ["claude-opus-5"], extra: "old-x-1", version: MANIFEST_VERSION } });
    const open = (query, store, confirmFn, models) => loadPage("popup/popup.html", store, POPUP_SCRIPTS, query, models, confirmFn);
    const ticked = (d) => Array.from(d.querySelectorAll("#models input:checked")).map((cb) => cb.value);
    const banner = (d) => ({ hidden: d.getElementById("link-banner").hidden, text: d.getElementById("link-text").textContent });
    const err = (d) => ({ hidden: d.getElementById("error").hidden, text: d.getElementById("error").textContent });
    const LATEST = K.latestModelSlugs(K.sortModelsByRecency(MODELS_FILE)).ticked;
    // U1: OK fills; nothing is sent; Start is still a button the person must press.
    let store = base();
    let c = recorder(true);
    let p = await open("?tab=1&v=1&projects=p-one-1,p-two-2&models=claude-haiku-4-5", store, c); await tick();
    let d = p.document;
    ok(c.calls.length === 1 && /^A link wants to fill this form with 2 project\(s\) and 1 model\(s\)\.\n/.test(c.calls[0]) && /\nProject IDs: p-one-1, p-two-2$/.test(c.calls[0]) && /\nModels: claude-haiku-4-5\n/.test(c.calls[0]) && /Nothing starts until you press Start/.test(c.calls[0]), "(U1) the confirm names 2 projects and 1 model first, the slug, that nothing starts until Start, and both ids last", c.calls[0]);
    ok(c.calls[0].indexOf("Models:") < c.calls[0].indexOf("Nothing starts") && c.calls[0].indexOf("Nothing starts") < c.calls[0].indexOf("Project IDs:"), "(U1) order: the models, then the sentence that nothing starts, then the ids (what a dialog cut short would lose)");
    ok(/The mode, step-by-step and the other settings are not changed/.test(c.calls[0]) && /OK replaces the project IDs, the model selection and the extra slugs/.test(c.calls[0]), "(U1) the confirm says what OK replaces and what it leaves alone");
    ok(d.getElementById("projects").value === "p-one-1\np-two-2" && JSON.stringify(ticked(d)) === '["claude-haiku-4-5"]' && d.getElementById("extra-models").value === "", "(U1) OK fills the textarea and ticks the one box; the extra field is emptied (the link had no extra slug)", `${JSON.stringify(d.getElementById("projects").value)} ${ticked(d)}`);
    ok(banner(d).hidden === false && banner(d).text === "Filled from a link: 2 project(s): p-one-1, p-two-2; models: claude-haiku-4-5. Nothing starts until you press Start.", 'the banner reads "Filled from a link" with the ids and the slug', banner(d).text);
    ok(d.getElementById("link-banner").closest(".inputs") && d.getElementById("link-clear").tagName === "BUTTON" && d.getElementById("link-clear").textContent === "Clear" && d.getElementById("link-text").childNodes.length === 1 && d.getElementById("link-text").firstChild.nodeType === 3, "(U1) the banner sits in the inputs column with a Clear button; its text is one text node (textContent)");
    ok(store.popup_state.projects === "p-one-1\np-two-2" && JSON.stringify(store.popup_state.models) === '["claude-haiku-4-5"]' && store.popup_state.extra === "" && store.popup_state.version === MANIFEST_VERSION, "(U1) popup_state holds the filled values, saved as a manual edit is", JSON.stringify(store.popup_state));
    ok(!(store.__messages || []).length, "(U1) no message was sent to the worker at all (no START, no GUARD_PREVIEW)", JSON.stringify(store.__messages));
    ok(d.getElementById("start").disabled === false && d.getElementById("start").title === "" && err(d).hidden === true, "(U1) control: Start is enabled and untouched, no error line; the person must press it");
    ok(d.getElementById("pairs").textContent === "2 project(s) × 1 model(s) = 2 pair(s)", "(U1) the pair line follows the fill", d.getElementById("pairs").textContent);
    // U3: the settings, the include-done box and the timing are untouched.
    ok(JSON.stringify(store.settings) === JSON.stringify(FULL) && d.getElementById("include-done").checked === false && !("timing" in store) && d.getElementById("mode").textContent === "MODE: DRY RUN" && d.getElementById("step-toggle").getAttribute("aria-checked") === "true", "(U3) after the fill: settings deep-equal the values before, include-done unchecked, no timing key, DRY RUN and fast mode as before");
    ok(Object.keys(store).filter((k) => !k.startsWith("__")).sort().join() === "popup_state,settings", "(U3) storage holds popup_state and settings only; the link wrote nothing else", Object.keys(store).join());
    // U12: Clear empties the three inputs, hides the banner, saves the empty state; the settings are unchanged.
    d.getElementById("link-clear").click(); await tick();
    ok(d.getElementById("projects").value === "" && ticked(d).length === 0 && d.getElementById("extra-models").value === "" && banner(d).hidden === true && banner(d).text === "", "(U12) Clear empties the textarea, the checklist and the extra field and hides the banner");
    ok(store.popup_state.projects === "" && store.popup_state.models.length === 0 && store.popup_state.extra === "" && JSON.stringify(store.settings) === JSON.stringify(FULL) && d.getElementById("pairs").textContent === "", "(U12) the empty state is saved; the settings are unchanged; the pair line is empty", JSON.stringify(store.popup_state));
    p.win.close();
    // U2: Cancel leaves everything as it was before the load.
    store = base();
    const before = JSON.stringify(store.popup_state);
    c = recorder(false);
    p = await open("?tab=1&v=1&projects=p-one-1,p-two-2&models=claude-haiku-4-5", store, c); await tick(); d = p.document;
    ok(c.calls.length === 1, "(U2) the confirm was asked once");
    ok(d.getElementById("projects").value === "old-proj-1" && JSON.stringify(ticked(d)) === '["claude-opus-5"]' && d.getElementById("extra-models").value === "old-x-1", "(U2) Cancel: the textarea, the checklist and the extra field are as they were", `${d.getElementById("projects").value} ${ticked(d)} ${d.getElementById("extra-models").value}`);
    ok(JSON.stringify(store.popup_state) === before && banner(d).hidden === true && banner(d).text === "" && err(d).hidden === true && !(store.__messages || []).length, "(U2) Cancel: popup_state, the banner and the error line unchanged; no message sent");
    p.win.close();
    // U4: an encoded tag in a value is refused through textContent; no element from the link appears.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=%3Cb%3Ex", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && err(d).hidden === false && /^link refused: the model slug \(not a plain name, so not shown\) is not a valid model slug$/.test(err(d).text), "(U4) models=%3Cb%3Ex: refused with the reason in the error line, the confirm not called", err(d).text);
    ok(!d.querySelector("b") && d.getElementById("error").childNodes.length === 1 && d.getElementById("error").firstChild.nodeType === 3 && d.getElementById("projects").value === "old-proj-1" && banner(d).hidden === true, "(U4) no b element exists, the error line is one text node, nothing filled, no banner");
    p.win.close();
    const hostile = encodeURIComponent("<img src=x onerror=alert(1)>");
    const imgsBefore = (await (async () => { const q = await open("?tab=1", base(), recorder(true)); const n = q.document.querySelectorAll("img").length; q.win.close(); return n; })());
    for (const [label, query] of [
      ["every value an img tag", `?tab=1&v=${hostile}&projects=${hostile}&models=${hostile}`],
      ["every value javascript:", "?tab=1&v=javascript:alert(1)&projects=javascript:alert(1)&models=javascript:alert(1)"],
      ["an img tag as a key", `?tab=1&v=1&projects=p-one-1&${hostile}=1`],
      ["an img tag under the dropped link= key", `?tab=1&link=${hostile}`],
      ["a raw img tag unencoded", "?tab=1&v=1&projects=<img src=x onerror=alert(1)>"]
    ]) {
      store = base(); c = recorder(true);
      p = await open(query, store, c); await tick(); d = p.document;
      const e = d.getElementById("error");
      ok(c.calls.length === 0 && e.hidden === false && /^link refused: /.test(e.textContent) && !/<|javascript:|onerror|alert/.test(e.textContent) && d.querySelectorAll("img").length === imgsBefore && !d.querySelector("b") && e.childNodes.length === 1 && e.firstChild.nodeType === 3 && d.getElementById("projects").value === "old-proj-1" && banner(d).hidden === true && !(store.__messages || []).length,
        `(U4) ${label}: refused, the error line is one text node that echoes none of it, no element added, nothing filled, nothing sent`, e.textContent);
      p.win.close();
    }
    // U5: no ?tab: the popup layout, no confirm, nothing filled.
    store = { settings: Object.assign({}, FULL) }; c = recorder(true);
    p = await open("?v=1&projects=p-one-1", store, c); await tick(); d = p.document;
    ok(d.documentElement.className === "popup" && c.calls.length === 0 && d.getElementById("projects").value === "" && banner(d).hidden === true && err(d).hidden === true, "(U5) popup.html?v=1&projects=p-one-1 without tab: the popup layout, the confirm not called, the textarea empty, no error", d.documentElement.className);
    p.win.close();
    // U6/U7: the console-link path (a ?link=<token> tab and a stored pending_link record) was dropped in 0.9.0.
    // link= is now an unknown key like any other: refused by the parser; a leftover record in storage is neither read nor touched.
    store = base(); store.pending_link = { token: "tok-1", raw: "v=1&projects=p-nine-9", receivedAt: Date.now() }; c = recorder(true);
    p = await open("?tab=1&link=tok-1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && err(d).hidden === false && /^link refused: the key "link" is not one of v, projects, models$/.test(err(d).text) && d.getElementById("projects").value === "old-proj-1" && banner(d).hidden === true && !(store.__messages || []).length, "(U7) ?tab=1&link=tok-1 (the dropped console-link tab): refused as an unknown key, confirm not called, nothing filled, nothing sent", err(d).text);
    ok(JSON.stringify(store.pending_link) === JSON.stringify({ token: "tok-1", raw: "v=1&projects=p-nine-9", receivedAt: store.pending_link.receivedAt }) && !d.getElementById("projects").value.includes("p-nine-9"), "(U7) a leftover pending_link record is not read, not used and not deleted (the popup no longer knows the key)", JSON.stringify(store.pending_link));
    p.win.close();
    store = base(); c = recorder(true);
    p = await open("?tab=1&link=abc&v=1&projects=p-one-1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && /^link refused: the key "link" is not one of/.test(err(d).text) && d.getElementById("projects").value === "old-proj-1", "(U6) link= next to valid values: the whole link is refused (any bad item refuses all)", err(d).text);
    p.win.close();
    // U8: 200 projects.
    const projects200 = Array.from({ length: 200 }, (_, i) => `p-link-${String(i).padStart(3, "0")}`);
    store = base(); c = recorder(true);
    p = await open(`?tab=1&v=1&projects=${projects200.join(",")}&models=claude-haiku-4-5`, store, c); await tick(); d = p.document;
    ok(c.calls.length === 1 && /200 project\(s\)/.test(c.calls[0]) && projects200.slice(0, 16).every((id) => c.calls[0].includes(id)) && !projects200.slice(16).some((id) => c.calls[0].includes(id)) && /\n  \.\.\. and 184 more \(every id is listed in the banner and textarea after OK\)\.$/.test(c.calls[0]) && c.calls[0].split("\n").length <= K.DEEP_LINK.CONFIRM_ROWS && c.calls[0].split("\n").every((l) => l.length <= K.DEEP_LINK.CONFIRM_COLS - 1 || /^OK replaces/.test(l)), '(U8) 200 projects: the confirm names "200 project(s)", lists the first 16 ids and "and 184 more", within the row budget (the row test itself is in deep-link.cjs)', c.calls[0]);
    ok(d.getElementById("pairs").textContent === "200 project(s) × 1 model(s) = 200 pair(s)" && d.getElementById("projects").value === projects200.join("\n") && projects200.every((id) => banner(d).text.includes(id)), "(U8) the pair line reads 200 project(s) × 1 model(s) = 200 pair(s); the banner lists every id", d.getElementById("pairs").textContent);
    p.win.close();
    store = base(); c = recorder(true);
    p = await open(`?tab=1&v=1&projects=${projects200.concat(["p-link-200"]).join(",")}`, store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && /names 201 projects; at most 200 are accepted/.test(err(d).text) && d.getElementById("projects").value === "old-proj-1", "(U8) 201 projects: refused, nothing filled", err(d).text);
    p.win.close();
    // U9: verbatim, in link order.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-zeta-9,p-alpha-1,p-mid-5", store, c); await tick(); d = p.document;
    ok(c.calls[0].indexOf("p-zeta-9") < c.calls[0].indexOf("p-alpha-1") && c.calls[0].indexOf("p-alpha-1") < c.calls[0].indexOf("p-mid-5") && /3 project\(s\): p-zeta-9, p-alpha-1, p-mid-5;/.test(banner(d).text) && d.getElementById("projects").value === "p-zeta-9\np-alpha-1\np-mid-5", "(U9) the confirm, the banner and the textarea show each id verbatim in the link's order", banner(d).text);
    ok(/No models: nothing will be ticked\./.test(c.calls[0]) && /; no models ticked\./.test(banner(d).text) && ticked(d).length === 0 && store.popup_state.models.length === 0, "(U9) models absent: the confirm and the banner say no models are ticked, the stored selection is empty", banner(d).text);
    p.win.close();
    // U10: models=latest resolves over the rendered list.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=latest", store, c); await tick(); d = p.document;
    ok(c.calls.length === 1 && new RegExp(`Models: "latest", which on this machine is ${LATEST.length} model\\(s\\): ${LATEST.join("(, |\\n)")}\\n`).test(c.calls[0]) && !/Models: latest\b/.test(c.calls[0]), "(U10) the confirm names the slugs latestModelSlugs(currentModels).ticked returns (wrapped to the row width), never the word latest alone", c.calls[0]);
    ok(JSON.stringify(ticked(d)) === JSON.stringify(LATEST) && JSON.stringify(store.popup_state.models) === JSON.stringify(LATEST), "(U10) the boxes of the latest set are ticked and the stored selection holds the concrete slugs", ticked(d).join(","));
    ok(d.getElementById("models-note").hidden === false && d.getElementById("models-note").textContent === "latest: 3 ticked, Claude Fable 5.1 left out, needs a manual step on its model page", "(U10) the models note reads as the latest link writes it", d.getElementById("models-note").textContent);
    ok(banner(d).text === `Filled from a link: 1 project(s): p-one-1; models (latest on this machine): ${LATEST.join(", ")}. Nothing starts until you press Start.`, "(U10) the banner names the resolved slugs", banner(d).text);
    p.win.close();
    const undated = MODELS_FILE.map((m) => ({ slug: m.slug, name: m.name, launchStage: m.launchStage }));
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=latest", store, c, undated); await tick(); d = p.document;
    ok(c.calls.length === 1 && /resolves to nothing \(no model carries a release date\): no models ticked\./.test(c.calls[0]) && ticked(d).length === 0 && store.popup_state.models.length === 0, "(U10) a synthetic undated list: the confirm says no models ticked, nothing is ticked", c.calls[0]);
    ok(/no models ticked \(latest resolves to nothing here: no model carries a release date\)/.test(banner(d).text) && d.getElementById("models-note").textContent === "latest: nothing ticked, no model carries a release date", '(U10) the banner says "no models ticked" and the note says why', banner(d).text);
    p.win.close();
    // U11: a slug not in models.json goes to the extra field, named as extra.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=claude-haiku-4-5,my-own-slug", store, c); await tick(); d = p.document;
    ok(c.calls.length === 1 && /Models: claude-haiku-4-5\n/.test(c.calls[0]) && /Extra slugs \(not in the model list\): my-own-slug/.test(c.calls[0]), "(U11) the confirm names the ticked slug and the extra slug as extra", c.calls[0]);
    ok(JSON.stringify(ticked(d)) === '["claude-haiku-4-5"]' && d.getElementById("extra-models").value === "my-own-slug" && store.popup_state.extra === "my-own-slug" && /models: claude-haiku-4-5; extra slugs \(not in the model list\): my-own-slug\./.test(banner(d).text), "(U11) the box is ticked, #extra-models holds my-own-slug, the banner names it as extra", banner(d).text);
    ok(d.getElementById("pairs").textContent === "1 project(s) × 2 model(s) = 2 pair(s)", "(U11) the pair line counts the extra slug (Start reads it)", d.getElementById("pairs").textContent);
    p.win.close();
    // The 16384 limit on the page's own query string; a long link (1,500 slugs, about 16,500 characters) refused on the length first.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=" + "claude-x-1,".repeat(1500) + "claude-y-1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && /longer than 16384 characters/.test(err(d).text) && d.getElementById("projects").value === "old-proj-1", "a link over 16384 characters in the query string is refused (by the parser's own cap, ?tab=1& not counted)", err(d).text);
    p.win.close();
    // A link while the popup tab shows an active run is dropped (D4): no confirm, nothing filled.
    store = Object.assign(base(), { running: true, run: { runId: "r-act", live: false }, queue: [{ projectId: "proj-run", modelSlug: "claude-haiku-4-5", status: "running" }], current: { jobIndex: 0, phase: "model" } }); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && /link refused: a run is active; the link is dropped/.test(err(d).text) && d.getElementById("projects").value === "old-proj-1" && d.getElementById("start").disabled === true && store.running === true && store.queue.length === 1 && !(store.__messages || []).length, "with a run active, the link is dropped: no confirm, nothing filled, one error line; the run, its queue and the worker are untouched", err(d).text);
    p.win.close();
    // (finding 5) the link leaves the tab's URL once it is read: a reload or a session restore of the
    // tab shows the form as it is instead of asking again (and overwriting edits made since). Under http://x/ because
    // jsdom refuses replaceState on the chrome-extension: origin (Chrome does not; the popup catches the refusal either way).
    const openHttp = (query, st, confirmFn) => loadPage("popup/popup.html", st, POPUP_SCRIPTS, query, undefined, confirmFn, "http://x/");
    for (const [label, query, answer, filled] of [
      ["OK", "?tab=1&v=1&projects=p-one-1&models=claude-haiku-4-5", true, "p-one-1"],
      ["Cancel", "?tab=1&v=1&projects=p-one-1&models=claude-haiku-4-5", false, "old-proj-1"],
      ["a refused link", "?tab=1&v=1&projects=p-one-1&x=1", true, "old-proj-1"],
      ["the dropped link= token", "?tab=1&link=tok-1", true, "old-proj-1"]
    ]) {
      store = base(); c = recorder(answer);
      p = await openHttp(query, store, c); await tick(); d = p.document;
      ok(p.win.location.search === "?tab=1" && p.win.location.pathname === "/popup/popup.html" && d.documentElement.classList.contains("tab") && d.getElementById("projects").value === filled, `(finding 5) after ${label} the URL is popup.html?tab=1 exactly (the link is gone, the tab layout stays)`, `${p.win.location.href} ${d.getElementById("projects").value}`);
      p.win.close();
    }
    store = base(); c = recorder(true);
    p = await openHttp("?tab=1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 0 && p.win.location.search === "?tab=1" && err(d).hidden === true && d.getElementById("projects").value === "old-proj-1", "(finding 5) control: a page opened with ?tab=1 alone asks nothing and keeps its URL");
    p.win.close();
    store = base(); c = recorder(true);
    p = await openHttp("?tab=1&v=1&projects=p-one-1", store, c); await tick(); d = p.document;
    ok(c.calls.length === 1 && d.getElementById("projects").value === "p-one-1" && p.win.location.search === "?tab=1", "(finding 5) control: the fill itself still happens under http://x/ (the origin is not what the link path keys on)");
    p.win.close();
    ok(/if \(!rest\.length\) return null;\n\s*try \{ history\.replaceState\(null, "", location\.pathname \+ "\?tab=1"\); \} catch \(e\) \{ \/\* ignore \*\/ \}\n\s*return rest\.join\("&"\);/.test(fs.readFileSync(path.join(E.EXT, "popup/popup.js"), "utf8")), "(finding 5) source: pendingLinkText strips the query before the text is returned (before the parse and the confirm), so a refusal is one-shot too");
    // The banner goes with the Start it announced.
    store = base(); c = recorder(true);
    p = await open("?tab=1&v=1&projects=p-one-1&models=claude-haiku-4-5", store, c); await tick(); d = p.document;
    ok(banner(d).hidden === false, "fixture: the banner shows");
    d.getElementById("start").click(); await tick();
    ok(banner(d).hidden === true && (store.__messages || []).filter((m) => m.type === K.MSG.START).length === 1 && store.__messages[0].projects.join() === "p-one-1" && store.__messages[0].live === false, "pressing Start yourself sends one START with the filled values (DRY RUN) and hides the banner");
    p.win.close();
  }

  console.log("--- (S1-S5) deep links, static: the link path sends nothing and clicks nothing, no innerHTML in popup.js, the worker and the content script hold no deep-link path, no link value reaches a URL, a selector or a timer, the manifest is unchanged");
  {
    const popupJs = fs.readFileSync(path.join(E.EXT, "popup/popup.js"), "utf8");
    const workerJs = fs.readFileSync(path.join(E.EXT, "background/service-worker.js"), "utf8");
    const mainJs = fs.readFileSync(path.join(E.EXT, "content/main.js"), "utf8");
    /** The source of a top-level function in an IIFE-style module (two-space indent): from its first line to its closing "  }" line. */
    const fnBody = (src, head, indent) => { const s = src.indexOf(head); if (s < 0) return null; const e = src.indexOf(`\n${indent}}\n`, s); return e < 0 ? null : src.slice(s, e); };
    const popupFns = ["function pendingLinkText()", "function linkBannerText(", "function showLinkBanner(", "function clearLinkFill()", "async function applyDeepLink()"].map((h) => [h, fnBody(popupJs, h, "  ")]);
    ok(!/function linkConfirmText\(/.test(popupJs) && /K\.linkConfirmText\(parsed, resolved\)/.test(popupJs), "(S1) the confirm text comes from K.linkConfirmText (constants.js, pure and tested in deep-link.cjs), not from a closure in popup.js");
    ok(popupFns.every(([, b]) => b && b.length > 40), "(S1) every deep-link function of popup.js was located", popupFns.map(([h, b]) => `${h}:${b ? b.length : "none"}`).join(" "));
    const linkPath = popupFns.map(([, b]) => b).join("\n");
    ok(!/MSG\.START/.test(linkPath) && !/\.click\(\)/.test(linkPath) && !/\bsend\(/.test(linkPath) && !/sendMessage/.test(linkPath) && !/#start|"start"/.test(linkPath), "(S1) the deep-link functions contain no MSG.START, no click(), no send( and no reference to #start");
    ok(!/KEYS\.SETTINGS|KEYS\.TIMING|live_mode|step_by_step|include-done|saveSettings/.test(linkPath), "(S1) the deep-link functions never name the settings, the timing, the mode, step-by-step or the include-done box");
    ok(/applyDeepLink\(\)/.test(fnBody(popupJs, "async function init()", "  ")) && (popupJs.match(/applyDeepLink\(\)/g) || []).length === 2, "(S1) applyDeepLink is defined once and called once, from init");
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(popupJs), "(S2) popup.js matches none of innerHTML, outerHTML, insertAdjacentHTML, document.write");
    ok(/el\.textContent = text \|\| ""/.test(fnBody(popupJs, "function showLinkBanner(", "  ")) && (linkPath.match(/textContent/g) || []).length >= 1 && !/\.title =|setAttribute/.test(linkPath), "(S2) the banner is written with textContent only (no title, no attribute from the link)");
    ok(!/deepLinkUnsafe|DEEP_LINK|PENDING_LINK|parseDeepLink|popup\/popup\.html|link=/.test(workerJs), "(S3) the worker holds no deep-link handler: no deepLinkUnsafe, no DEEP_LINK message, no pending-link key, no parse, no popup tab opened for a link (the console-link path was dropped in 0.9.0)");
    ok(!/mgc=|location\.hash|DEEP_LINK|parseDeepLink/.test(mainJs), "(S3) the content script reads no fragment and sends no link");
    const sinks = /chrome\.tabs\.create\(|URL\(|fetch\(|setAttribute\(|querySelector\(|RegExp\(|eval\(|Function\(|setTimeout\(/;
    const linkValues = /parsed|projects|models|dropped|latest|resolved|\braw\b|\btext\b|rec\.|token/;
    const bad = linkPath.split("\n").filter((l) => sinks.test(l) && linkValues.test(l));
    ok(bad.length === 0 && !sinks.test(linkPath), "(S4) popup.js: the link path contains none of tabs.create, URL(, fetch(, setAttribute(, querySelector(, RegExp(, eval(, Function( or setTimeout( at all", bad.join(" | "));
    ok(!/PENDING_LINK|pending_link/.test(linkPath) && !/chrome\.storage\.local\.(get|remove)\(KEYS\.PENDING/.test(popupJs), "(S4) the link path reads no stored link record: the query string is the only source");
    const manifest = JSON.parse(fs.readFileSync(path.join(E.EXT, "manifest.json"), "utf8"));
    const baseline = { permissions: ["storage", "alarms"], host_permissions: ["https://console.cloud.google.com/*"], content_scripts: [{ matches: ["https://console.cloud.google.com/*"], run_at: "document_end", js: ["common/constants.js", "content/dom.js", "content/selectors.js", "content/badge.js", "content/actions.js", "content/main.js"] }] };
    ok(JSON.stringify(manifest.permissions) === JSON.stringify(baseline.permissions) && JSON.stringify(manifest.host_permissions) === JSON.stringify(baseline.host_permissions) && JSON.stringify(manifest.content_scripts) === JSON.stringify(baseline.content_scripts), "(S5) the manifest deep-equals the 0.8.0 baseline on permissions, host_permissions and content_scripts", JSON.stringify([manifest.permissions, manifest.host_permissions, manifest.content_scripts]));
    ok(["web_accessible_resources", "externally_connectable", "omnibox", "protocol_handlers", "optional_permissions", "optional_host_permissions"].every((k) => !(k in manifest)), "(S5) no web_accessible_resources, externally_connectable, omnibox or protocol_handlers");
    ok(Object.keys(manifest).sort().join() === "action,background,content_scripts,description,host_permissions,icons,manifest_version,minimum_chrome_version,name,options_ui,permissions,short_name,version", "(S5) the manifest's keys are exactly the 0.8.0 set", Object.keys(manifest).sort().join());
  }

  console.log("--- the release zip and the file table carry the runs page");
  {
    const zipScript = fs.readFileSync(path.join(E.EXT, "..", "scripts/build-extension-zip.sh"), "utf8");
    ok(/background common content icons options popup runs/.test(zipScript), "scripts/build-extension-zip.sh zips the runs directory with the others");
    const readme = fs.readFileSync(path.join(E.EXT, "README.md"), "utf8");
    ok(/`runs\/`/.test(readme) && /`common\/runlog\.js`/.test(readme) && /Runs to keep/.test(readme), "extension/README.md documents runs/, common/runlog.js and the retention setting");
  }

  {
    // Control: the capture is live (a console.error, a window error event and an unhandled rejection in the page are collected).
    const p = await loadPage("popup/popup.html", { settings: Object.assign({}, FULL) }, POPUP_SCRIPTS);
    p.win.console.error("control console.error");
    p.win.dispatchEvent(new p.win.ErrorEvent("error", { message: "control window error" }));
    p.win.Promise.reject(new p.win.Error("control rejection"));
    await tick();
    const seen = p.pageErrors.join(" | ");
    ok(/console\.error: control console\.error/.test(seen) && /window error: control window error/.test(seen) && /unhandled rejection: control rejection/.test(seen), "control: the page loader's error capture is live (console.error, window error events and unhandled rejections are collected)", seen);
    p.pageErrors.length = 0; // the control's own errors are not a failure of the page
    p.win.close();
  }
  ok(openPages.size === 0, "every page loaded by loadPage was closed, so each one's error check ran", [...openPages].join(", "));
  E.finish("ui pages");
})();
