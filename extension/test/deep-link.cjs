/*
 * MGC.parseDeepLink (common/constants.js), the pure parser behind the deep
 * links of docs/scoping/03-deep-links.md, in node without jsdom. The
 * parser tests P1 to P8 of the feasibility review, each with a control
 * case: both syntaxes (the query string of form A and the fragment of form
 * B), every refusal of decision D2 (missing or wrong version, unknown,
 * repeated or prototype-named keys, the note key, invalid ids and slugs,
 * repeated ids, the 23 / 13 / 4096 limits), the percent-encoding rules
 * (split before decode, a bad sequence, an encoded separator, double
 * encoding), whitespace, upper case, "latest" and the extra-slugs split
 * over the packaged models.json. The popup, worker and content-script
 * sides are in ui-pages.cjs, worker-harness.mjs and main-loop.cjs.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const E = require("./lib/env.cjs");
const { ok } = E;
require(path.join(E.EXT, "common/constants.js"));
const K = globalThis.MGC;
const MODELS_FILE = JSON.parse(fs.readFileSync(path.join(E.EXT, "models.json"), "utf8"));
const parse = (raw, known) => K.parseDeepLink(raw, known);
const refused = (raw, re, label) => {
  const r = parse(raw);
  ok(r.ok === false && typeof r.error === "string" && re.test(r.error) && r.projects.length === 0 && r.models.length === 0 && r.latest === false && r.dropped.length === 0, `${label}: refused (${re.source})`, JSON.stringify(r));
};
const accepted = (raw, label, known) => {
  const r = parse(raw, known);
  ok(r.ok === true && r.error === null, `${label}: accepted`, JSON.stringify(r));
  return r;
};

console.log("--- constants: the keys, the message type and the limits");
ok(K.KEYS.PENDING_LINK === "pending_link" && K.MSG.DEEP_LINK === "mgc:deep-link", "KEYS.PENDING_LINK and MSG.DEEP_LINK exist");
ok(K.DEEP_LINK.VERSION === "1" && K.DEEP_LINK.MAX_RAW === 4096 && K.DEEP_LINK.MAX_PROJECTS === 23 && K.DEEP_LINK.MAX_MODELS === 13 && K.DEEP_LINK.MAX_AGE_MS === 600000 && K.DEEP_LINK.MIN_INTERVAL_MS === 2000 && K.DEEP_LINK.LOG_RAW_CHARS === 80 && K.DEEP_LINK.REFUSAL_LOG_WINDOW_MS === 10000 && K.DEEP_LINK.CONFIRM_ROWS === 24 && K.DEEP_LINK.CONFIRM_COLS === 80, "DEEP_LINK limits: version 1, 4096 characters, 23 projects, 13 models, 10 minutes, 2 seconds, 80 logged characters, one logged refusal per 10 s, a confirm of 24 rows x 80 columns", JSON.stringify(K.DEEP_LINK));
ok(typeof K.parseDeepLink === "function", "MGC.parseDeepLink is a function");

console.log("--- (P1) the ok case fills every field; a missing or wrong version, an unknown, note or repeated key refuse naming the key");
{
  const r = accepted("v=1&projects=p-one-1", "P1 v=1&projects=p-one-1");
  ok(JSON.stringify(r) === JSON.stringify({ ok: true, error: null, projects: ["p-one-1"], models: [], latest: false, dropped: [] }), "P1 the result holds ok, error null, one project, no models, latest false, nothing dropped", JSON.stringify(r));
  refused("projects=p-one-1", /no format version \(v=1\)/, "P1 without v");
  refused("v=2&projects=p-one-1", /format version must be 1/, "P1 v=2");
  refused("v=&projects=p-one-1", /format version must be 1/, "P1 v= (empty)");
  refused("v=1&projects=p-one-1&x=1", /the key "x" is not one of v, projects, models/, "P1 unknown key x");
  refused("v=1&projects=p-one-1&note=hi", /the key "note" is not one of v, projects, models/, "P1 note key (removed by D2)");
  refused("v=1&projects=p-one-1&models=latest&models=latest", /the key "models" is repeated/, "P1 repeated models");
  refused("v=1&projects=p-one-1&v=1", /the key "v" \(the format version\) is repeated/, "P1 repeated v");
  refused("v=1&projects=p-one-1&projects=p-two-2", /the key "projects" is repeated/, "P1 repeated projects");
  refused("v=1", /no "projects" key/, "P1 no projects key");
  refused("", /the link is empty/, "P1 empty text");
  refused(42, /not text/, "P1 a number");
  refused(undefined, /not text/, "P1 undefined");
  refused("v=1&projects", /has no "=" and no value/, "P1 a part without =");
  refused("v=1&&projects=p-one-1", /empty part/, "P1 an empty part");
  refused("v=1&projects=p-one-1&", /empty part/, "P1 a trailing separator");
  refused("v=1&projects=p-one-1&=x", /the key "" is not one of|is not one of v, projects, models/, "P1 an empty key is unknown");
}

console.log("--- (P2) ids and slugs are matched exactly as written: upper case, a confusable, NUL, newline, space, +, double encoding, a bad sequence and < refuse");
{
  refused("v=1&projects=P-one-1", /project ID "P-one-1" is not a valid/, "P2 upper-case id");
  refused("v=1&projects=p-one-1,P-ONE-2", /project ID "P-ONE-2" is not a valid/, "P2 a second id in upper case");
  refused("v=1&projects=р-one-1", /project ID \(not a plain name, so not shown\) is not a valid/, "P2 Cyrillic confusable (U+0440) refused and not echoed");
  refused("v=1&projects=%D1%80-one-1", /project ID \(not a plain name, so not shown\) is not a valid/, "P2 the same confusable percent-encoded");
  refused("v=1&projects=p-one-1%00", /project ID \(not a plain name, so not shown\)/, "P2 %00 in an id");
  refused("v=1&projects=p-one-1%0A", /project ID \(not a plain name, so not shown\)/, "P2 %0A (newline) in an id");
  refused("v=1&projects=p-one-1\n", /project ID \(not a plain name, so not shown\)/, "P2 a literal newline");
  refused("v=1&projects=p-one%201", /project ID \(not a plain name, so not shown\)/, "P2 %20 (space) in an id");
  refused("v=1&projects= p-one-1", /project ID \(not a plain name, so not shown\)/, "P2 a leading space is not trimmed");
  refused("v=1&projects=p-one-1 ", /project ID \(not a plain name, so not shown\)/, "P2 a trailing space is not trimmed");
  refused("v=1&projects=p-one+1", /project ID \(not a plain name, so not shown\)/, "P2 + is not a space and not valid");
  refused("v=1&projects=p-one-1%2541", /project ID \(not a plain name, so not shown\)/, "P2 double encoding (%2541 -> %41) fails the id rule");
  refused("v=1&projects=p-one-1%E0%A4%A", /percent-encoding that cannot be decoded/, "P2 a bad sequence (%E0%A4%A) refuses");
  refused("v=1&projects=p-one-1%", /percent-encoding that cannot be decoded/, "P2 a lone % refuses");
  refused("v=1&projects=p-one-1%E0%A4", /percent-encoding that cannot be decoded/, "P2 a truncated UTF-8 sequence refuses");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5<b>", /model slug \(not a plain name, so not shown\) is not a valid/, "P2 a slug with < refuses and is not echoed");
  refused("v=1&projects=p-one-1&models=%3Cb%3Ex", /model slug \(not a plain name, so not shown\) is not a valid/, "P2 %3Cb%3Ex (an encoded tag) refuses");
  refused("v=1&projects=p-one-1&models=claude@haiku", /model slug \(not a plain name, so not shown\) is not a valid/, "P2 a slug with @ refuses");
  refused("v=1&projects=p-one-1&models=Claude Haiku", /model slug \(not a plain name, so not shown\)/, "P2 a slug with a space refuses");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5,", /"models" list holds an empty entry/, "P2 an empty slug entry refuses");
  refused("v=1&projects=p-one-1,", /"projects" list holds an empty entry/, "P2 an empty id entry refuses");
  refused("v=1&projects=p-one-1&models=", /"models" list holds an empty entry/, "P2 models= with nothing refuses");
  refused("v=1&projects=", /"projects" list holds an empty entry/, "P2 projects= with nothing refuses");
  refused("v=1&projects=p-one-1&models=javascript:alert(1)", /model slug \(not a plain name, so not shown\)/, "P2 javascript: in a slug refuses");
  refused("v=1&projects=p-one-1&models=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", /model slug \(not a plain name, so not shown\)/, "P2 an encoded img tag refuses");
  refused("v=1&projects=p-one-1&%3Cb%3E=1", /the key \(not a plain name, so not shown\) is not one of/, "P2 a key with < refuses and is not echoed");
  refused("v=1&projects=p-one-1&" + "a".repeat(41) + "=1", /the key \(not a plain name, so not shown\) is not one of/, "P2 a 41-character key is not echoed");
  const r = accepted("v=1&projects=p-one-1&models=claude-haiku-4-5", "P2 control: p-one-1 and claude-haiku-4-5 pass");
  ok(r.projects[0] === "p-one-1" && r.models[0] === "claude-haiku-4-5" && r.dropped.length === 0, "P2 control: the id and the slug come back as written (no known list: nothing dropped)", JSON.stringify(r));
  ok(K.isValidProjectId("p-one-1") && !K.isValidProjectId("р-one-1") && !K.isValidProjectId("P-ONE-1") && K.isValidModelSlug("claude-haiku-4-5") && !K.isValidModelSlug("<b>x"), "P2 control: the validators themselves refuse the confusable, upper case and <");
}

console.log("--- (P3) ; and & both separate pairs; %3B, %26 and %2C stay inside their value (split before decode)");
{
  const a = accepted("v=1&projects=p-one-1&models=claude-haiku-4-5", "P3 & separates");
  const b = accepted("v=1;projects=p-one-1;models=claude-haiku-4-5", "P3 ; separates");
  const c = accepted("mgc=v1;projects=p-one-1;models=claude-haiku-4-5", "P3 form B (mgc=v1 with ;)");
  const d = accepted("v=1;projects=p-one-1&models=claude-haiku-4-5", "P3 mixed separators");
  ok([a, b, c, d].every((r) => JSON.stringify(r) === JSON.stringify(a)), "P3 all four spellings give the same result", JSON.stringify([a, b, c, d]));
  refused("v=1&projects=p-one-1%3Bmodels=claude-haiku-4-5", /project ID \(not a plain name, so not shown\)/, "P3 %3B stays in the value: the id ends up invalid, no models key appears");
  refused("v=1&projects=p-one-1%26models=claude-haiku-4-5", /project ID \(not a plain name, so not shown\)/, "P3 %26 stays in the value");
  refused("v=1&projects=p-one-1%2Cp-two-2", /project ID \(not a plain name, so not shown\)/, "P3 %2C does not split an id: the one id is invalid");
  refused("v=1&projects=p-one-1%3Dx", /project ID \(not a plain name, so not shown\)/, "P3 %3D stays in the value");
  refused("v=1&projects=p-one-1&models%3Dlatest=1", /the key "models=latest" is not one of|the key \(not a plain name, so not shown\) is not one of/, "P3 %3D in a key does not make it a known key");
  refused("mgc=v1&v=1&projects=p-one-1", /the key "v" \(the format version\) is repeated/, "P3 mgc=v1 and v=1 together count as a repeated version key");
  refused("mgc=1&projects=p-one-1", /format version must be 1/, "P3 mgc=1 (no v) is a wrong version");
  refused("v=v1&projects=p-one-1", /format version must be 1/, "P3 v=v1 is a wrong version");
  refused("%76=1&projects=p-one-1&v=1", /the key "v" \(the format version\) is repeated/, "P3 an encoded key (%76 = v) is decoded and counts as the same key");
  const e = accepted("%76=1&projects=p-one-1", "P3 control: %76=1 alone is v=1");
  ok(e.projects[0] === "p-one-1", "P3 control: the encoded key still parses");
}

console.log("--- (P4) 23 projects and 13 models pass, 24 and 14 refuse");
{
  const ids = (n) => Array.from({ length: n }, (_, i) => `p-link-${String(i).padStart(3, "0")}`);
  const slugs = (n) => Array.from({ length: n }, (_, i) => `claude-link-${i}`);
  let r = accepted(`v=1&projects=${ids(23).join(",")}`, "P4 23 projects");
  ok(r.projects.length === 23 && r.projects[22] === "p-link-022", "P4 the count in the result is 23", r.projects.length);
  refused(`v=1&projects=${ids(24).join(",")}`, /names 24 projects; at most 23 are accepted/, "P4 24 projects");
  r = accepted(`v=1&projects=p-one-1&models=${slugs(13).join(",")}`, "P4 13 models");
  ok(r.models.length === 13 && r.models[12] === "claude-link-12", "P4 the count in the result is 13", r.models.length);
  refused(`v=1&projects=p-one-1&models=${slugs(14).join(",")}`, /names 14 models; at most 13 are accepted/, "P4 14 models");
  // The settings import's 2000-character cap on the joined list can no longer
  // be reached through the project list within the 23-id count cap (23 ids of
  // 30 characters join to 712 characters), nor through the 13-slug model list
  // (13 slugs of 100 characters join to ~1324): the count cap always fires
  // first. 24 long ids are refused on the count, not on the length.
  const long = Array.from({ length: 24 }, (_, i) => `p-link-${String(i).padStart(3, "0")}-abcdefghijklmnop`);
  refused(`v=1&projects=${long.join(",")}`, /names 24 projects; at most 23 are accepted/, "P4 the count cap fires before the shared 2000-character cap (24 long ids)");
}

console.log("--- (P5) 4096 characters pass, 4097 refuse before any other check");
{
  // The raw limit counts characters before decoding; the shared
  // 2000-character cap counts the decoded ids (and slugs) joined. With the
  // 23-project and 13-model count caps a project list alone cannot reach
  // 4096 characters (23 fully percent-encoded 30-character ids are only
  // ~2100 characters), so the bulk of a 4096-character link is
  // percent-encoded model slugs (three characters per letter), as
  // extension/README.md notes. This fixture is exactly 4096 characters:
  // 10 fully-encoded 30-character ids, 10 fully-encoded 100-character slugs
  // and one 100-character tuning slug whose first 28 characters are encoded
  // (156 raw characters). 11 slugs and 10 ids are both within the caps, and
  // the decoded lists are well under the 2000-character joined cap.
  const hex = (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0");
  const encSome = (s, k) => s.split("").map((c, i) => (i < k ? hex(c) : c)).join("");
  let pn = 0, sn = 0;
  const mkId = () => ("p-link-" + String(pn++).padStart(3, "0") + "abcdefghijklmnopqrstuvwxyz").slice(0, 30);
  const mkSlug = () => ("claude-model-" + String(sn++).padStart(2, "0") + "-" + "x".repeat(100)).slice(0, 100);
  const ids = Array.from({ length: 10 }, () => encSome(mkId(), 30));
  const slugs = Array.from({ length: 10 }, () => encSome(mkSlug(), 100));
  slugs.push(encSome(mkSlug(), 28));
  const raw = `v=1&projects=${ids.join(",")}&models=${slugs.join(",")}`;
  ok(raw.length === 4096 && ids.length <= K.DEEP_LINK.MAX_PROJECTS && slugs.length <= K.DEEP_LINK.MAX_MODELS, `P5 fixture: the raw text is exactly 4096 characters with ${ids.length} ids and ${slugs.length} slugs, both within the caps`, raw.length);
  const r = parse(raw);
  ok(r.ok === true && r.projects.length === ids.length && r.projects.every((id) => K.isValidProjectId(id)) && r.models.length === slugs.length && r.models.every((s) => K.isValidModelSlug(s)), "P5 a 4096-character link that is otherwise valid passes (every id and slug decoded and valid)", JSON.stringify(r.error));
  refused(raw + "x", /longer than 4096 characters/, "P5 4097 characters");
  refused("\u0000".repeat(4097), /longer than 4096 characters/, "P5 4097 NULs refuse on the length, before any other check");
  refused("x".repeat(5000), /longer than 4096 characters/, "P5 5000 characters with no key: the length check comes first");
}

console.log("--- (P6) __proto__, constructor and hasOwnProperty are unknown keys; no prototype pollution");
{
  refused("v=1&projects=p-one-1&__proto__=1", /the key "__proto__" is not one of/, "P6 __proto__");
  refused("v=1&projects=p-one-1&constructor=1", /the key "constructor" is not one of/, "P6 constructor");
  refused("v=1&projects=p-one-1&hasOwnProperty=1", /the key "hasOwnProperty" is not one of/, "P6 hasOwnProperty");
  refused("v=1&projects=p-one-1&toString=1", /the key "toString" is not one of/, "P6 toString");
  refused("__proto__=polluted&v=1&projects=p-one-1", /the key "__proto__" is not one of/, "P6 __proto__ first");
  refused("v=1&projects=p-one-1&__proto__[polluted]=1", /the key \(not a plain name, so not shown\) is not one of/, "P6 __proto__[polluted]");
  ok(({}).polluted === undefined && Object.prototype.polluted === undefined && ({}).__proto__ === Object.prototype, "P6 no prototype pollution after the parses");
  const r = accepted("v=1&projects=p-one-1", "P6 control: the parser still works after the prototype-named keys");
  ok(Object.keys(r).sort().join() === "dropped,error,latest,models,ok,projects", "P6 the result carries exactly ok, error, projects, models, latest, dropped", Object.keys(r).join());
}

console.log("--- (P7) a repeated id refuses, under one spelling or two; two distinct ids pass");
{
  refused("v=1&projects=p-one-1,p-one-1", /project ID "p-one-1" is repeated/, "P7 p-one-1 twice");
  refused("v=1&projects=p-one-1,P-ONE-1", /project ID "P-ONE-1" is not a valid/, "P7 p-one-1 and P-ONE-1 (the case rule refuses the second)");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5,claude-haiku-4-5", /model slug "claude-haiku-4-5" is repeated/, "P7 a repeated slug");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5,Claude-Haiku-4-5", /model slug "Claude-Haiku-4-5" is repeated/, "P7 a slug repeated under another case (slugs are case-insensitive) refuses");
  const r = accepted("v=1&projects=p-one-1,p-two-2", "P7 control: two distinct ids");
  ok(JSON.stringify(r.projects) === '["p-one-1","p-two-2"]', "P7 control: both ids, in link order", JSON.stringify(r.projects));
  const s = accepted("v=1&projects=p-two-2,p-one-1", "P7 control: the other order");
  ok(JSON.stringify(s.projects) === '["p-two-2","p-one-1"]', "P7 the link's order is kept, not sorted", JSON.stringify(s.projects));
}

console.log("--- (P8) a slug not in models.json goes to dropped; models=latest gives latest true and an empty list");
{
  let r = accepted("v=1&projects=p-one-1&models=claude-haiku-4-5,my-own-slug", "P8 one known and one unknown slug", MODELS_FILE);
  ok(JSON.stringify(r.models) === '["claude-haiku-4-5"]' && JSON.stringify(r.dropped) === '["my-own-slug"]' && r.latest === false, "P8 models [claude-haiku-4-5], dropped [my-own-slug]", JSON.stringify(r));
  r = accepted("v=1&projects=p-one-1&models=Claude-Haiku-4-5", "P8 a known slug in another case", MODELS_FILE);
  ok(JSON.stringify(r.models) === '["claude-haiku-4-5"]' && r.dropped.length === 0, "P8 a known slug is matched case-insensitively and takes the list's spelling (as the import does)", JSON.stringify(r));
  r = accepted("v=1&projects=p-one-1&models=claude-haiku-4-5,my-own-slug", "P8 the same without a known list");
  ok(JSON.stringify(r.models) === '["claude-haiku-4-5","my-own-slug"]' && r.dropped.length === 0, "P8 without a known list every slug stays in models (the worker's parse)", JSON.stringify(r));
  r = accepted("v=1&projects=p-one-1&models=claude-haiku-4-5,my-own-slug", "P8 with a list of slugs", MODELS_FILE.map((m) => m.slug));
  ok(JSON.stringify(r.models) === '["claude-haiku-4-5"]' && JSON.stringify(r.dropped) === '["my-own-slug"]', "P8 the known list may be plain slugs too", JSON.stringify(r));
  r = accepted("v=1&projects=p-one-1&models=latest", "P8 models=latest", MODELS_FILE);
  ok(r.latest === true && r.models.length === 0 && r.dropped.length === 0, "P8 latest true, empty models (the popup resolves it)", JSON.stringify(r));
  r = accepted("mgc=v1;projects=p-one-1;models=latest", "P8 models=latest in form B", MODELS_FILE);
  ok(r.latest === true && r.models.length === 0, "P8 form B latest");
  refused("v=1&projects=p-one-1&models=latest,claude-haiku-4-5", /"latest" cannot be combined with a list/, "P8 latest plus a list refuses");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5,latest", /"latest" cannot be combined with a list/, "P8 a list plus latest refuses");
  refused("v=1&projects=p-one-1&models=Latest", /"latest" is a keyword, written alone and in lower case/, "P8 Latest (capital) is refused, not taken as a slug");
  refused("v=1&projects=p-one-1&models=claude-haiku-4-5,LATEST", /"latest" is a keyword, written alone and in lower case/, "P8 LATEST inside a list is refused");
  r = accepted("v=1&projects=p-one-1", "P8 models absent", MODELS_FILE);
  ok(r.latest === false && r.models.length === 0 && r.dropped.length === 0, "P8 models absent: nothing ticked, latest false");
}

console.log("--- purity: no DOM, no storage, no chrome in the parser");
{
  const src = fs.readFileSync(path.join(E.EXT, "common/constants.js"), "utf8");
  const start = src.indexOf("MGC.parseDeepLink = function");
  const end = src.indexOf("\n  };", start);
  const body = src.slice(start, end);
  ok(start > 0 && end > start && body.length > 500, "the parser body was located in constants.js", body.length);
  ok(!/document\.|window\.|chrome\.|localStorage|fetch\(|new URL\(|RegExp\(|eval\(|Function\(|setTimeout\(|innerHTML/.test(body), "the parser body touches no document, window, chrome, storage, URL, RegExp, eval, Function or timer");
  ok(/decodeURIComponent\(s\)/.test(body) && /try \{ return decodeURIComponent/.test(body), "decoding is decodeURIComponent inside a try/catch");
  ok(/split\(\/\[&;\]\/\)/.test(body) && /split\(","\)\.map\(decode\)/.test(body), "the pairs are split on & and ; and the lists on , before the decode");
  ok(/MGC\.parseConfig\(\{ popup: \{ projects, models \} \}\)/.test(body) && /MGC\.isValidProjectId\(id\)/.test(body) && /MGC\.isValidModelSlug\(slug\)/.test(body), "the parser reuses parseConfig and the two validators");
}

console.log("--- (finding 4) MGC.linkConfirmText fits the rows Chromium's dialog shows: the models and the nothing-starts sentence are never cut off by a long id list");
{
  const ROWS = K.DEEP_LINK.CONFIRM_ROWS, COLS = K.DEEP_LINK.CONFIRM_COLS;
  /**
   * A port of gfx::ElideRectangleString(input, max_rows, max_cols, strict=false): paragraphs on "\n", words wrapped at
   * max_cols columns, a word longer than a row broken at character boundaries (strict=false). Returns the rows the text
   * takes and the text the first max_rows rows hold; `truncated` is what Chromium's dialog would do to the rest.
   */
  const elide = (text, maxRows, maxCols) => {
    const rows = [];
    for (const para of text.split("\n")) {
      let row = "";
      for (const word of para.split(" ")) {
        let w = word;
        if (row && row.length + 1 + w.length > maxCols) { rows.push(row); row = ""; }
        while (w.length > maxCols) { if (row) { rows.push(row); row = ""; } rows.push(w.slice(0, maxCols)); w = w.slice(maxCols); }
        row = row ? `${row} ${w}` : w;
      }
      rows.push(row);
    }
    return { rows: rows.length, truncated: rows.length > maxRows, shown: rows.slice(0, maxRows).join("\n") };
  };
  // Port controls: a 25-row text is truncated at 24 rows, an 81-character word takes two rows, a 160-character line three words wide wraps to two.
  ok(elide(Array.from({ length: 25 }, (_, i) => `r${i}`).join("\n"), ROWS, COLS).truncated === true && elide(Array.from({ length: 24 }, (_, i) => `r${i}`).join("\n"), ROWS, COLS).truncated === false, "port control: 25 lines are truncated at 24 rows, 24 are not");
  ok(elide("a".repeat(81), ROWS, COLS).rows === 2 && elide("a".repeat(80), ROWS, COLS).rows === 1 && elide(`${"a".repeat(50)} ${"b".repeat(50)}`, ROWS, COLS).rows === 2, "port control: an 81-character word takes two rows, two 50-character words wrap to two rows");
  const ids = (n, len) => Array.from({ length: n }, (_, i) => `p${String(i).padStart(3, "0")}abcdefghijklmnopqrstuvwxyz`.slice(0, len));
  const slugs = (n, len) => Array.from({ length: n }, (_, i) => `claude-model-${String(i).padStart(2, "0")}-${"x".repeat(100)}`.slice(0, len));
  const SENTENCE = "Nothing starts until you press Start";
  const text = (projects, ticked, extra, latest) => K.linkConfirmText({ ok: true, error: null, projects, models: ticked, latest: !!latest, dropped: extra }, { ticked, extra });
  const cases = [
    ["23 ids x 13 slugs (30 and 100 characters, the maxima)", ids(23, 30), slugs(13, 100), []],
    ["23 ids x 6 slugs + 7 extra slugs, all 100 characters", ids(23, 30), slugs(6, 100), slugs(7, 100).map((s) => `extra-${s}`.slice(0, 100))],
    ["23 ids x 13 extra slugs (nothing ticked)", ids(23, 30), [], slugs(13, 100)],
    ["1 id x 13 slugs", ids(1, 30), slugs(13, 40), []],
    ["23 short ids x 1 slug", ids(23, 6), slugs(1, 20), []],
    ['23 ids x "latest" resolved to 4 slugs', ids(23, 30), slugs(4, 40), [], true],
    ["23 ids x no models", ids(23, 30), [], []]
  ];
  for (const [label, projects, ticked, extra, latest] of cases) {
    const t = text(projects, ticked, extra, latest);
    const e = elide(t, ROWS, COLS);
    const sentenceAt = t.indexOf(SENTENCE), idsAt = t.indexOf("Project IDs:");
    const shownSlugs = ticked.slice(0, 1).concat(extra.slice(0, 1));
    ok(e.truncated === false && e.rows <= ROWS, `${label}: the confirm text is not truncated at ${ROWS} rows x ${COLS} columns (${e.rows} rows)`, t);
    ok(sentenceAt > 0 && idsAt > sentenceAt && shownSlugs.every((s) => t.indexOf(s) > 0 && t.indexOf(s) < sentenceAt), `${label}: the slugs, then "${SENTENCE}", then the ids`, t);
    ok(t.includes(`with ${projects.length} project(s) and ${latest ? `"latest" (${ticked.length} model(s) on this machine)` : ticked.length + extra.length ? `${ticked.length + extra.length} model(s)` : "no models"}.`), `${label}: the first line carries the project count and the model count`, t.split("\n")[0]);
    ok(t.split("\n").every((l) => l.length <= COLS - 1 || /^OK replaces/.test(l) || (!l.includes(", ") && !l.includes(": ") && l.length <= 100)), `${label}: no line exceeds ${COLS - 1} characters except the fixed sentence and a single slug that is longer by itself, alone on its line`, t.split("\n").filter((l) => l.length > COLS - 1).join(" | "));
    const shownIds = projects.filter((id) => t.includes(id)).length;
    ok(shownIds === Math.min(projects.length, 16) && (projects.length <= 16 ? !/and \d+ more \(every id/.test(t) : t.includes(`and ${projects.length - 16} more (every id is listed in the banner and the textarea after OK).`)), `${label}: the first ${Math.min(projects.length, 16)} ids are listed${projects.length > 16 ? ` and "and ${projects.length - 16} more"` : ', no "and more" line'}`, t);
  }
  // Every slug fits in the two-row budget when there are few: 8 short slugs are all named, the 9th is counted.
  ok(slugs(8, 20).every((s) => text(ids(2, 10), slugs(8, 20), []).includes(s)) && !/and \d+ more model/.test(text(ids(2, 10), slugs(8, 20), [])) && / and 1 more model\(s\) /.test(text(ids(2, 10), slugs(9, 20), [])) && !text(ids(2, 10), slugs(9, 20), []).includes(slugs(9, 20)[8]), 'eight 20-character slugs are all named; a ninth is "and 1 more model(s)" and not named', text(ids(2, 10), slugs(9, 20), []));
  ok(/^OK replaces[^\n]{0,239}$/m.test(text(ids(1, 10), [], [])) && /Models: "latest", which on this machine resolves to nothing/.test(text(ids(1, 10), [], [], true)) && /No models: nothing will be ticked\./.test(text(ids(1, 10), [], [])), "the fixed sentence is under 240 characters; latest resolving to nothing and no models each have their line");
  // Control: the one-id-per-line layout the popup used before, with 25 ids, is truncated by the port (the sentence and the models were last).
  const old = (projects, ticked) => [`A link wants to fill this form with ${projects.length} project(s):`, ...projects.map((id) => `  ${id}`), "", `Models: ${ticked.join(", ")}`, "", "OK replaces the project IDs, the model selection and the extra slugs with these. Nothing starts until you press Start. The mode, step-by-step and the other settings are not changed."].join("\n");
  const o = elide(old(ids(25, 30), slugs(1, 20)), ROWS, COLS);
  ok(o.truncated === true && !o.shown.includes(SENTENCE) && !o.shown.includes(slugs(1, 20)[0]), "control: the former layout (every id on its own line, the models and the sentence last) with 25 ids is truncated and loses both the sentence and the slug", `${o.rows} rows`);
  ok(elide(old(ids(10, 30), slugs(1, 20)), ROWS, COLS).truncated === false, "control: the former layout with 10 ids fits (the port is not flagging everything)");
  // Pure: the function reads no document, window, chrome or storage.
  const src = fs.readFileSync(path.join(E.EXT, "common/constants.js"), "utf8");
  const s = src.indexOf("MGC.linkConfirmText = function"), e2 = src.indexOf("\n  };", s);
  ok(s > 0 && e2 > s && !/document\.|window\.|chrome\.|localStorage|innerHTML|RegExp\(|setTimeout\(/.test(src.slice(s, e2)), "linkConfirmText is pure: no document, window, chrome, storage, innerHTML, RegExp or timer in its body");
}

E.finish("deep link parser");
