/*
 * Lint of extension/models.json (node only, no jsdom): the file the popup,
 * the options page and the worker read. It fails on a value that is not an
 * array, an empty array, an entry that is not an object, a duplicate slug,
 * a slug that fails MGC.isValidModelSlug, "@" in a slug (a pinned version,
 * which renders and queues twice next to the bare slug), a non-empty
 * releaseDate that is not a strict YYYY-MM-DD calendar date (an empty
 * string means undated, the shape scripts/models/fetch_models.py writes
 * for an unknown date), a duplicate, non-positive or non-integer apiOrder,
 * requiresManualConsent or deprecated present but not a boolean, and a file
 * not sorted by MGC.compareModelsByRecency (the order the popup shows, so a
 * reviewer reads the file in the same order).
 *
 * Usage: node models-json.cjs [path/to/models.json]   (default: ../models.json)
 */
"use strict";
const fs = require("fs");
const path = require("path");
const EXT = path.resolve(__dirname, "..");
require(path.join(EXT, "common/constants.js"));
const K = globalThis.MGC;

const file = process.argv[2] ? path.resolve(process.argv[2]) : path.join(EXT, "models.json");
const problems = [];
let passed = 0;
function check(cond, label, detail) {
  if (cond) { passed += 1; console.log("ok   " + label); } else { problems.push(label); console.log("FAIL " + label + (detail !== undefined ? " -> " + String(detail).slice(0, 300) : "")); }
  return !!cond;
}

let data;
try {
  data = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (e) {
  console.log(`FAIL ${file} is not readable JSON -> ${e.message}`);
  console.log("FAILED models.json lint: 0 passed, 1 failed, 0 skipped");
  process.exit(1);
}

if (check(Array.isArray(data), `${path.relative(process.cwd(), file)} is an array`, typeof data)) {
  check(data.length > 0, "the file holds at least one entry", "empty array");
  const entries = data.filter((e) => e && typeof e === "object" && !Array.isArray(e));
  check(entries.length === data.length, "every entry is an object", `${data.length - entries.length} non-object entry(ies)`);
  const slugs = entries.map((e) => e.slug);
  check(slugs.every((s) => typeof s === "string" && K.isValidModelSlug(s)), "every slug is a string that passes isValidModelSlug", JSON.stringify(slugs.filter((s) => typeof s !== "string" || !K.isValidModelSlug(s))));
  check(slugs.every((s) => typeof s !== "string" || !s.includes("@")), 'no slug carries "@" (a pinned version)', JSON.stringify(slugs.filter((s) => typeof s === "string" && s.includes("@"))));
  const lower = slugs.map((s) => String(s).toLowerCase());
  const dupSlugs = lower.filter((s, i) => lower.indexOf(s) !== i);
  check(dupSlugs.length === 0, "no duplicate slug (case-insensitive)", JSON.stringify(dupSlugs));
  const badDates = entries.filter((e) => "releaseDate" in e && e.releaseDate !== "" && !K.parseReleaseDate(e.releaseDate));
  check(badDates.length === 0, "every non-empty releaseDate is a strict YYYY-MM-DD calendar date (an empty string means undated)", JSON.stringify(badDates.map((e) => [e.slug, e.releaseDate])));
  const withOrder = entries.filter((e) => "apiOrder" in e);
  const badOrder = withOrder.filter((e) => !(Number.isInteger(e.apiOrder) && e.apiOrder > 0));
  check(badOrder.length === 0, "every apiOrder present is a positive integer", JSON.stringify(badOrder.map((e) => [e.slug, e.apiOrder])));
  const orders = withOrder.map((e) => e.apiOrder);
  const dupOrder = orders.filter((o, i) => orders.indexOf(o) !== i);
  check(dupOrder.length === 0, "no duplicate apiOrder", JSON.stringify(dupOrder));
  for (const flag of ["requiresManualConsent", "deprecated"]) {
    const bad = entries.filter((e) => flag in e && typeof e[flag] !== "boolean");
    check(bad.length === 0, `${flag}, when present, is a boolean`, JSON.stringify(bad.map((e) => [e.slug, e[flag]])));
  }
  const sorted = K.sortModelsByRecency(entries).map((e) => e.slug);
  check(JSON.stringify(sorted) === JSON.stringify(slugs), "the file is sorted by compareModelsByRecency (newest first)", `file: ${slugs.join(", ")} | sorted: ${sorted.join(", ")}`);
  const dated = entries.filter((e) => K.parseReleaseDate(e.releaseDate)).length;
  console.log(`note ${entries.length} entry(ies), ${dated} dated, first ${slugs[0] || "(none)"}, last ${slugs[slugs.length - 1] || "(none)"}`);
}

const line = `${passed} passed, ${problems.length} failed, 0 skipped`;
if (problems.length) { console.log("FAILED models.json lint: " + line); process.exit(1); }
console.log(`ALL MODELS.JSON LINT CHECKS PASSED (${line})`);
