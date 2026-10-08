/*
 * Shared test environment: loads the extension's content scripts into a
 * jsdom window, optionally built from a saved console page under
 * python/recon/<run>/<step>/page.html (gitignored recon dumps; tests skip
 * with a message when a dump is absent).
 *
 * jsdom has no layout engine and its getComputedStyle takes about a second
 * on a 4 MB console page, so MGC_DOM.isVisible is replaced with a walker
 * that only honours the `hidden` attribute and inline display/visibility
 * styles. That is enough for the dumps: the console hides things inline
 * (style="display: none;", raf-hidden="true").
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXT = path.resolve(__dirname, "..", "..");
const RECON = path.resolve(EXT, "..", "python", "recon");
const CONTENT_SCRIPTS = ["common/constants.js", "content/dom.js", "content/selectors.js", "content/badge.js", "content/actions.js"];

let jsdom = null;
try { jsdom = require("jsdom"); } catch (e) { jsdom = null; }

function requireJsdom() {
  if (!jsdom) {
    console.error("jsdom is not installed. Run: cd extension/test && npm install");
    process.exit(2);
  }
  return jsdom;
}

function reconPath(...parts) {
  return path.join(RECON, ...parts);
}

/* ------------------------------------------------------------ run discovery */

/**
 * The tests use four kinds of recon run (see python/README.md). Their
 * directory names carry the project id and a timestamp, so they are found
 * by shape under python/recon/ (newest first) instead of by name; an
 * environment variable MGC_RUN_<letter> names a run directory explicitly.
 *   A  a dry run that stopped at 05-agreements-checked (no 06-after-agree)
 *   B  a run that met the "Enable APIs" dialog (01-model-page-api-dialog)
 *   C  a run that found the model already enabled (01-model-page only, timing state "enabled")
 *   D  a run whose 07-post-agree-settled holds the billing error dialog
 *   E  a model-page-only dump whose page holds a mat-checkbox (a consent
 *      control next to a disabled Enable)
 *   F  a gallery run (00-gallery) with 03-model-page: a model page with
 *      radio cards and an enabled Enable, no checkbox
 */
function listRuns() {
  if (!fs.existsSync(RECON)) return [];
  return fs.readdirSync(RECON).filter((d) => fs.statSync(path.join(RECON, d)).isDirectory()).sort().reverse();
}

function has(run, rel) { return fs.existsSync(path.join(RECON, run, rel)); }
function fileHas(run, rel, needle) {
  const f = path.join(RECON, run, rel);
  return fs.existsSync(f) && fs.readFileSync(f, "utf8").includes(needle);
}

const RUN_SHAPES = {
  A: (r) => has(r, "05-agreements-checked/page.html") && !has(r, "06-after-agree") && !has(r, "00-gallery"),
  B: (r) => has(r, "01-model-page-api-dialog/page.html"),
  C: (r) => has(r, "01-model-page/page.html") && fileHas(r, "timing.json", '"state": "enabled"'),
  D: (r) => fileHas(r, "07-post-agree-settled/page.html", "behavior-failure-dialog"),
  E: (r) => has(r, "01-model-page/page.html") && !has(r, "02-after-enable") && fileHas(r, "01-model-page/page.html", "<mat-checkbox"),
  F: (r) => has(r, "00-gallery") && has(r, "03-model-page/page.html")
};

const runCache = {};
/** Directory name of run <letter>, or null when no dump of that shape exists. */
function findRun(letter) {
  if (letter in runCache) return runCache[letter];
  const forced = process.env[`MGC_RUN_${letter}`];
  const found = forced || listRuns().find(RUN_SHAPES[letter]) || null;
  runCache[letter] = found;
  return found;
}

/** { html, url, dir } for a recon step, or null when the dump is missing. */
function readSnapshot(run, step) {
  const dir = reconPath(run, step);
  const htmlFile = path.join(dir, "page.html");
  if (!fs.existsSync(htmlFile)) return null;
  const urlFile = path.join(dir, "url.txt");
  const url = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, "utf8").trim() : "https://console.cloud.google.com/";
  const formsFile = path.join(dir, "forms.json");
  let forms = null;
  if (fs.existsSync(formsFile)) {
    try { forms = JSON.parse(fs.readFileSync(formsFile, "utf8")); } catch (e) { forms = null; }
  }
  return { html: fs.readFileSync(htmlFile, "utf8"), url, forms, dir: path.relative(process.cwd(), dir) };
}

/**
 * page.html is driver.page_source: attributes only. The live `value` and
 * `checked` properties of inputs were recorded in forms.json (keyed by the
 * generated id, which is consistent within one dump), so put them back.
 */
function rehydrate(document, forms) {
  if (!forms || !Array.isArray(forms.elements)) return 0;
  let n = 0;
  for (const e of forms.elements) {
    if (!e.id || (e.tag !== "input" && e.tag !== "textarea")) continue;
    const el = document.getElementById(e.id);
    if (!el) continue;
    if (e.type === "checkbox" || e.type === "radio") el.checked = e.checked === true || e.value === "true";
    else if (typeof e.value === "string") el.value = e.value;
    n += 1;
  }
  return n;
}

function inlineVisible(el) {
  if (!el || !el.isConnected) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hasAttribute("hidden")) return false;
    const st = n.getAttribute("style") || "";
    if (/display\s*:\s*none/i.test(st) || /visibility\s*:\s*hidden/i.test(st)) return false;
  }
  return true;
}

/**
 * Build a window from `html` at `url` and load the content scripts into it.
 * Returns { dom, win, document, K, D, S, A, B, jsdomErrors }. jsdomErrors
 * collects "not implemented" reports (jsdom cannot navigate, so a
 * location.reload() shows up there instead of reloading).
 */
function makeEnv(opts) {
  const { JSDOM, VirtualConsole } = requireJsdom();
  const o = opts || {};
  const jsdomErrors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => { jsdomErrors.push(String(err && err.message || err)); });
  const dom = new JSDOM(o.html || "<!doctype html><html><head></head><body></body></html>", {
    url: o.url || "https://console.cloud.google.com/",
    runScripts: "outside-only",
    virtualConsole: vc
  });
  const win = dom.window;
  const ctx = dom.getInternalVMContext();
  for (const f of CONTENT_SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(EXT, f), "utf8"), ctx, { filename: f });
  }
  win.MGC_DOM.isVisible = inlineVisible;
  return { dom, win, document: win.document, K: win.MGC, D: win.MGC_DOM, S: win.MGC_SELECTORS, A: win.MGC_ACTIONS, B: win.MGC_BADGE, jsdomErrors };
}

/** makeEnv() from a recon dump (run given by name or letter), or null when the dump is missing. */
function envFromSnapshot(run, step) {
  if (/^[A-F]$/.test(run)) run = findRun(run);
  if (!run) return null;
  const snap = readSnapshot(run, step);
  if (!snap) return null;
  const env = makeEnv(snap);
  env.rehydrated = rehydrate(env.document, snap.forms);
  return Object.assign(env, { snapshot: snap });
}

/* ------------------------------------------------------------ trusted events */

/**
 * Fire an event on `el` the way the browser does for a real pointer or
 * key: through jsdom's internal dispatch, which marks the event trusted
 * (isTrusted true), unlike element.click() or dispatchEvent(). Throws
 * when the internals are not where jsdom 30 keeps them, so a moved module
 * fails the test file instead of silently skipping the trusted-click proof.
 */
function fireTrusted(el, type, init) {
  let implForWrapper, fireAnEvent, Ctor;
  try {
    ({ implForWrapper } = require("jsdom/lib/generated/idl/utils"));
    ({ fireAnEvent } = require("jsdom/lib/jsdom/living/helpers/events"));
    Ctor = require(type === "keydown" || type === "keyup" ? "jsdom/lib/generated/idl/KeyboardEvent" : "jsdom/lib/generated/idl/MouseEvent");
  } catch (e) {
    throw new Error(`jsdom internals for a trusted ${type} not found (jsdom moved them; update lib/env.cjs fireTrusted): ${e.message}`);
  }
  if (typeof implForWrapper !== "function" || typeof fireAnEvent !== "function" || !Ctor) throw new Error("jsdom internals for a trusted event have an unexpected shape");
  fireAnEvent(type, implForWrapper(el), Ctor, Object.assign({ bubbles: true, cancelable: true, composed: true }, init || {}));
}
const trustedClick = (el) => fireTrusted(el, "click");
const trustedKeydown = (el, key) => fireTrusted(el, "keydown", { key });
const trustedKeyup = (el, key) => fireTrusted(el, "keyup", { key });

/* ------------------------------------------------------------ tiny test reporter */

const counts = { passed: 0, failed: 0, skipped: 0 };

function ok(cond, label, detail) {
  if (cond) {
    counts.passed += 1;
    console.log("ok   " + label);
  } else {
    counts.failed += 1;
    console.log("FAIL " + label + (detail !== undefined ? " -> " + String(detail).slice(0, 300) : ""));
  }
  return !!cond;
}

function skip(label, reason) {
  counts.skipped += 1;
  console.log("skip " + label + " (" + reason + ")");
}

function finish(name) {
  const line = `${name}: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`;
  if (counts.failed) {
    console.log("FAILED " + line);
    process.exit(1);
  }
  console.log("ALL " + line.toUpperCase().replace(/: .*/, "") + " CHECKS PASSED (" + line.split(": ")[1] + ")");
}

module.exports = { EXT, RECON, reconPath, readSnapshot, rehydrate, makeEnv, envFromSnapshot, findRun, listRuns, inlineVisible, fireTrusted, trustedClick, trustedKeydown, trustedKeyup, ok, skip, finish, counts, hasJsdom: () => !!jsdom };
