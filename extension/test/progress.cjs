/*
 * MGC.runProgress, formatDuration and progressText (common/constants.js),
 * the pure helpers behind the popup's progress line and the badge's
 * percent, elapsed time and estimate, in node without jsdom. Each case has
 * a control: an empty queue, all pending, jobs the cross-run guard left out
 * (finished, but not in the mean), the mean of two navigated jobs, paused,
 * finished; the duration spellings; the progress text's tails. The popup
 * and badge sides are in ui-pages.cjs and main-loop.cjs.
 */
"use strict";
const path = require("path");
const E = require("./lib/env.cjs");
const { ok } = E;
require(path.join(E.EXT, "common/constants.js"));
const K = globalThis.MGC;
const J = (status, startedAt, finishedAt, extra) => Object.assign({ projectId: "p", modelSlug: "m", status, startedAt: startedAt === undefined ? null : startedAt, finishedAt: finishedAt === undefined ? null : finishedAt }, extra);
const T0 = 1700000000000;
const RUN = { runId: "r", startedAt: T0, finishedAt: null };
const js = (o) => JSON.stringify(o);

console.log("--- runProgress: empty queue, all pending");
{
  const p = K.runProgress([], RUN, T0 + 5000, false);
  ok(p.total === 0 && p.finished === 0 && p.percent === 0 && p.elapsedMs === 5000 && p.perJobMs === null && p.remainingMs === null && p.state === "estimating", "empty queue: 0/0, 0 %, elapsed from the run's start, no estimate (estimating)", js(p));
  const q = K.runProgress(null, null, T0, false);
  ok(q.total === 0 && q.elapsedMs === 0 && q.state === "estimating", "control: no queue and no run: zeros, elapsed 0", js(q));
  const r = K.runProgress([J("pending"), J("pending"), J("running", T0)], RUN, T0 + 61000, false);
  ok(r.total === 3 && r.finished === 0 && r.percent === 0 && r.elapsedMs === 61000 && r.perJobMs === null && r.remainingMs === null && r.state === "estimating", "all pending (and one running): 0/3, 0 %, estimating", js(r));
  const s = K.runProgress([J("pending")], { runId: "r" }, T0, false);
  ok(s.elapsedMs === 0, "control: a run without startedAt has elapsed 0", js(s));
}

console.log("--- runProgress: guard-left-out jobs count as finished but not in the mean");
{
  const q = [J("skipped", T0, T0, { leftOut: "done" }), J("skipped", T0, T0, { leftOut: "skipped" }), J("pending"), J("pending")];
  const p = K.runProgress(q, RUN, T0 + 1000, false);
  ok(p.finished === 2 && p.percent === 50 && p.perJobMs === null && p.remainingMs === null && p.state === "estimating", "two guard-left-out jobs: 2/4 finished, 50 %, no mean (estimating)", js(p));
  const q2 = q.concat([J("dry-run", T0, T0 + 30000)]);
  const p2 = K.runProgress(q2, RUN, T0 + 31000, false);
  ok(p2.finished === 3 && p2.percent === 60 && p2.perJobMs === 30000 && p2.remainingMs === 60000 && p2.state === "running", "control: one navigated job of 30 s: the mean is 30 s (the guard's jobs excluded), 2 jobs left -> 60 s", js(p2));
  const q3 = [J("skipped", T0, T0 + 4000, { leftOut: "done" }), J("pending")];
  ok(K.runProgress(q3, RUN, T0, false).perJobMs === null, "a job with a leftOut field is excluded even with a duration");
  const q4 = [J("failed", null, T0 + 4000), J("failed", T0 + 4000, T0 + 4000), J("pending")];
  ok(K.runProgress(q4, RUN, T0, false).perJobMs === null && K.runProgress(q4, RUN, T0, false).finished === 2, "a finished job without a numeric startedAt, or with no duration, is counted finished but not in the mean");
}

console.log("--- runProgress: two finished navigated jobs give the mean");
{
  const q = [J("dry-run", T0, T0 + 20000), J("failed", T0 + 20000, T0 + 60000), J("running", T0 + 60000), J("pending"), J("pending"), J("pending")];
  const p = K.runProgress(q, RUN, T0 + 70000, false);
  ok(p.total === 6 && p.finished === 2 && p.percent === 33 && p.elapsedMs === 70000 && p.perJobMs === 30000 && p.remainingMs === 120000 && p.state === "running", "2 of 6 finished (20 s and 40 s): 33 % (floored), mean 30 s, 4 left -> 120 s, running", js(p));
  const q2 = [J("dry-run", T0, T0 + 1001), J("dry-run", T0, T0 + 1002), J("pending")];
  ok(K.runProgress(q2, RUN, T0, false).remainingMs === 1002, "remainingMs is rounded (1001.5 -> 1002)", js(K.runProgress(q2, RUN, T0, false)));
}

console.log("--- runProgress: paused and finished");
{
  const q = [J("dry-run", T0, T0 + 20000), J("pending")];
  const p = K.runProgress(q, RUN, T0 + 30000, true);
  ok(p.state === "paused" && p.remainingMs === 20000 && p.elapsedMs === 30000, "paused: state paused (the estimate still computed)", js(p));
  ok(K.runProgress(q, RUN, T0 + 30000, false).state === "running", "control: the same run not paused is running");
  ok(K.runProgress([J("pending")], RUN, T0, true).state === "paused", "paused wins over estimating");
  const fin = { runId: "r", startedAt: T0, finishedAt: T0 + 760000 };
  const f = K.runProgress([J("dry-run", T0, T0 + 20000), J("stopped", T0 + 20000, T0 + 30000), J("pending")], fin, T0 + 999999999, true);
  ok(f.state === "finished" && f.percent === 100 && f.elapsedMs === 760000 && f.finished === 2, "finished: state finished (over paused), 100 %, elapsed = finishedAt - startedAt (now ignored)", js(f));
}

console.log("--- formatDuration");
{
  const cases = [[0, "00:00"], [59000, "00:59"], [59999, "00:59"], [60000, "01:00"], [3599999, "59:59"], [3600000, "1:00:00"], [36000000, "10:00:00"], [36061000, "10:01:01"], [-1, "00:00"], [-60000, "00:00"], [NaN, "00:00"], ["60000", "00:00"], [null, "00:00"], [undefined, "00:00"], [Infinity, "00:00"]];
  const bad = cases.filter(([ms, want]) => K.formatDuration(ms) !== want).map(([ms, want]) => `${String(ms)} -> ${K.formatDuration(ms)} (want ${want})`);
  ok(bad.length === 0, "formatDuration: 0, 59 s, 1 h, 10 h, negative, NaN and non-numbers spelled as mm:ss / h:mm:ss / 00:00", bad.join(" | "));
}

console.log("--- progressText spellings");
{
  const base = { total: 12, finished: 3, percent: 25, elapsedMs: 192000, perJobMs: 63333, remainingMs: 570000 };
  ok(K.progressText(Object.assign({}, base, { state: "running" })) === "3/12 jobs · 25 % · elapsed 03:12 · ~09:30 left", "running: N/T jobs · P % · elapsed mm:ss · ~mm:ss left", K.progressText(Object.assign({}, base, { state: "running" })));
  ok(K.progressText(Object.assign({}, base, { perJobMs: null, remainingMs: null, state: "estimating" })) === "3/12 jobs · 25 % · elapsed 03:12 · estimating…", "estimating: \"estimating…\" (with the ellipsis character)");
  ok(K.progressText(Object.assign({}, base, { state: "paused" })) === "3/12 jobs · 25 % · elapsed 03:12 · paused", "paused: \"paused\"");
  ok(K.progressText(Object.assign({}, base, { finished: 12, percent: 100, remainingMs: 0, state: "finished" })) === "12/12 jobs · 100 % · elapsed 03:12", "finished: no tail");
  ok(K.progressText(Object.assign({}, base, { remainingMs: 0, state: "running" })) === "3/12 jobs · 25 % · elapsed 03:12", "remainingMs 0: no tail");
  ok(K.progressText(Object.assign({}, base, { remainingMs: 3600000, state: "running" })) === "3/12 jobs · 25 % · elapsed 03:12 · ~1:00:00 left", "control: an hour left reads ~1:00:00 left");
  const q = [J("dry-run", T0, T0 + 30000), J("pending"), J("pending"), J("pending")];
  ok(K.progressText(K.runProgress(q, RUN, T0 + 45000, false)) === "1/4 jobs · 25 % · elapsed 00:45 · ~01:30 left", "runProgress into progressText end to end", K.progressText(K.runProgress(q, RUN, T0 + 45000, false)));
}

console.log("--- the helpers are pure");
{
  const src = require("fs").readFileSync(path.join(E.EXT, "common/constants.js"), "utf8");
  const s = src.indexOf("MGC.runProgress = function"), e = src.indexOf("MGC.progressText = function");
  const body = src.slice(s, src.indexOf("\n  };", e));
  ok(s > 0 && e > s && !/Date\.now|document\.|window\.|chrome\.|setTimeout|setInterval/.test(body), "runProgress, formatDuration and progressText use no clock, DOM, chrome API or timer (now is a parameter)");
}

E.finish("progress");
