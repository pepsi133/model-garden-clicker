/*
 * Per-run logs in the extension's IndexedDB (schema v2).
 *
 * One database ("mgc-runs"), two object stores:
 *   "runs"  keyed by runId, one record per run:
 *     { runId, startedAt, finishedAt, live, stepByStep, reason,
 *       jobs:      [{ projectId, modelSlug, modelName }],   the job list at Start
 *       results:   [{ projectId, modelSlug, modelName, status, message, startedAt, finishedAt, productId, agreeClicked, agreeClickedByUser }],
 *       lineCount, byteCount }                               log counters only, no lines
 *   "lines" keyed [runId, seq], one record per log line, with an index
 *     "runId" on the run id:
 *     { runId, seq, t, level, src, msg }
 *
 * The record holds metadata, the job list, the results and the two counters
 * (lineCount is how many lines the run has, byteCount is the UTF-8 size of
 * the rendered log body). A line is never stored on the record: append()
 * writes one line record and bumps the counters in the same transaction, so
 * its cost does not grow with the lines already written. list() reads the
 * records only; the download and the Runs page read a run's lines by the
 * index cursor (readLines). sizeOf() comes from the counters, never from
 * rebuilding the text.
 *
 * Schema v1 kept every line in an array on the record. The upgrade handler
 * moves each v1 record's embedded lines into the line store and fills the
 * counters, losing nothing.
 *
 * The service worker is the only writer (create, append, update, delete,
 * purge, prune); the runs page and the options page only read (list, get,
 * readLines, count). Every call opens the database, runs one transaction and
 * closes it again: no handle outlives a call, so a worker that Chrome
 * terminates and restarts mid-run keeps appending to the same record. Every
 * function rejects on a database error; the caller decides what that means
 * (the worker logs one line and goes on with the run).
 *
 * Loaded like constants.js: via a <script> tag in the runs and options
 * pages and via `import "../common/runlog.js"` from the worker; attaches
 * MGC_RUNLOG to globalThis and uses no module syntax. Needs MGC
 * (constants.js) loaded first.
 */
(function () {
  if (globalThis.MGC_RUNLOG) return;
  const K = globalThis.MGC;

  const L = {};
  L.DB_NAME = "mgc-runs";
  L.STORE = "runs";
  L.LINES = "lines";
  L.RUN_INDEX = "runId";
  L.DB_VERSION = 2;

  /* Result fields copied from a queue entry into the record (nothing else of the job). */
  L.RESULT_FIELDS = ["projectId", "modelSlug", "modelName", "status", "message", "startedAt", "finishedAt", "productId", "agreeClicked", "agreeClickedByUser", "purchaseObserved", "leftOut", "leftOutStatus"];

  function idb() {
    const db = globalThis.indexedDB;
    if (!db) throw new Error("IndexedDB is not available here");
    return db;
  }
  function keyRange() {
    const r = globalThis.IDBKeyRange;
    if (!r) throw new Error("IDBKeyRange is not available here");
    return r;
  }

  function utf8Len(s) {
    return new TextEncoder().encode(s).length;
  }

  /* ---------------------------------------------------------------- text helpers */

  const pad = (v, n) => String(v).padStart(n, "0");
  function iso(t) {
    return typeof t === "number" && Number.isFinite(t) ? new Date(t).toISOString() : "";
  }
  /** Fold a message's own newlines into spaces. */
  function fold(s) { return String(s === undefined || s === null ? "" : s).replace(/\r?\n/g, " "); }
  /**
   * Replace every control character except tab and newline, and the Unicode
   * bidi controls, with U+FFFD, so a downloaded log cannot smuggle an ANSI
   * escape, a NUL or a right-to-left override into a terminal or an editor.
   * Applied to a message that has already had its newlines folded, so the
   * only structural whitespace left to keep is the tab.
   *
   * Beyond C0, DEL and the bidi controls this also covers the C1 range
   * (U+0080-U+009F, e.g. NEL and the 8-bit CSI), the soft hyphen (U+00AD),
   * the zero-width characters (U+200B-U+200D, word joiner U+2060, BOM/ZWNBSP
   * U+FEFF), the Mongolian vowel separator (U+180E), the invisible operators
   * (U+2061-U+2064), the interlinear annotation characters (U+FFF9-U+FFFB),
   * the Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), the variation
   * selectors (U+FE00-U+FE0F, U+E0100-U+E01EF; an emoji that carries one
   * renders without it) and the tag characters (U+E0000-U+E007F), which hide
   * or reshape text in an editor or terminal. The "u" flag is needed for the
   * astral ranges.
   */
  var CONTROL_AND_BIDI = new RegExp("[\\u0000-\\u0008\\u000b-\\u001f\\u007f\\u0080-\\u009f\\u00ad\\u061c\\u115f\\u1160\\u180e\\u200b-\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb\\u{e0000}-\\u{e007f}\\u{e0100}-\\u{e01ef}]", "gu");
  function clean(s) {
    return fold(s).replace(CONTROL_AND_BIDI, "\ufffd");
  }
  /** One rendered log line: "<ISO> <source> [<level>] <message>" (message folded and cleaned). */
  function renderLine(l) {
    return `${iso(l.t)} ${l.src || "worker"} [${l.level || "info"}] ${clean(l.msg)}`;
  }
  /** The UTF-8 byte cost a line adds to the log body (the line plus its newline). */
  function lineBytes(l) { return utf8Len(renderLine(l) + "\n"); }

  /* ---------------------------------------------------------------- database */

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = idb().open(L.DB_NAME, L.DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = (ev) => {
        const db = req.result;
        const tx = req.transaction; // the versionchange transaction
        if (!db.objectStoreNames.contains(L.STORE)) db.createObjectStore(L.STORE, { keyPath: "runId" });
        if (!db.objectStoreNames.contains(L.LINES)) {
          const lines = db.createObjectStore(L.LINES, { keyPath: ["runId", "seq"] });
          lines.createIndex(L.RUN_INDEX, "runId", { unique: false });
        }
        // v1 -> v2: move each record's embedded lines into the line store and
        // fill the counters. Done with cursors inside the versionchange
        // transaction so onsuccess only fires once the migration completed.
        const oldVersion = ev && typeof ev.oldVersion === "number" ? ev.oldVersion : 0;
        if (oldVersion >= 1 && oldVersion < 2 && tx) {
          const runs = tx.objectStore(L.STORE);
          const lines = tx.objectStore(L.LINES);
          let dropped = 0; // malformed v1 lines skipped across the whole migration
          const cur = runs.openCursor();
          cur.onsuccess = () => {
            const c = cur.result;
            if (!c) {
              // One warning for the whole migration; a bad line must never
              // abort the versionchange and brick every later open.
              if (dropped > 0) { try { console.warn(`[MG Clicker] run log migration: dropped ${dropped} malformed log line(s)`); } catch (e) { /* ignore */ } }
              return;
            }
            const rec = c.value;
            const embedded = Array.isArray(rec.lines) ? rec.lines : [];
            let bytes = 0;
            let seq = 0; // the surviving lines stay contiguous from 0
            embedded.forEach((l) => {
              // A non-object or otherwise malformed line is skipped, not
              // migrated: it would throw inside this event handler and, in
              // Chrome, abort the versionchange transaction.
              if (!l || typeof l !== "object") { dropped += 1; return; }
              try {
                lines.put({ runId: rec.runId, seq, t: l.t, level: l.level, src: l.src, msg: l.msg });
                bytes += lineBytes(l);
                seq += 1;
              } catch (e) { dropped += 1; }
            });
            rec.lineCount = seq;
            rec.byteCount = bytes;
            delete rec.lines;
            c.update(rec);
            c.continue();
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("could not open the run log database"));
      req.onblocked = () => reject(new Error("the run log database is blocked by another open connection"));
    });
  }

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("run log request failed"));
    });
  }

  /**
   * Open the database, run `fn(tx)` inside one transaction over `storeNames`
   * of `mode`, wait for the transaction to complete and close the database.
   * Returns what fn returned. A failed or aborted transaction (a quota error
   * among others) rejects with its error.
   */
  L.withTx = async function (storeNames, mode, fn) {
    const db = await openDb();
    try {
      const tx = db.transaction(storeNames, mode);
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("run log transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("run log transaction aborted"));
      });
      let result;
      try {
        result = await fn(tx);
      } catch (e) {
        try { tx.abort(); } catch (e2) { /* already finished */ }
        await done.catch(() => {});
        throw e;
      }
      await done;
      return result;
    } finally {
      try { db.close(); } catch (e) { /* ignore */ }
    }
  };

  /** Convenience: one transaction over the runs store, fn(store). */
  L.withStore = function (mode, fn) {
    return L.withTx(L.STORE, mode, (tx) => fn(tx.objectStore(L.STORE)));
  };

  /**
   * Delete every line record of a run with one request over the store's key
   * range: the store is keyed [runId, seq], -Infinity is the lowest key and
   * an empty array sorts above every number, so the bound covers every seq
   * of this run and nothing of another run. One request, however many lines
   * the run has (a cursor would cost one round trip per line).
   */
  function deleteLines(linesStore, runId) {
    return request(linesStore.delete(keyRange().bound([runId, -Infinity], [runId, []])));
  }

  /** A result entry from a queue entry: the whitelisted fields only. */
  L.resultOf = function (job) {
    const out = {};
    for (const f of L.RESULT_FIELDS) if (job && job[f] !== undefined) out[f] = job[f];
    return out;
  };

  /** Create the record of a run at Start (replaces a record, and its lines, with the same id). */
  L.create = function (run, queue, stepByStep) {
    const jobs = (Array.isArray(queue) ? queue : []).map((j) => ({ projectId: j.projectId, modelSlug: j.modelSlug, modelName: j.modelName || null }));
    const record = {
      runId: run.runId, startedAt: run.startedAt, finishedAt: null, live: run.live === true, stepByStep: stepByStep === true, reason: null,
      jobs, results: (Array.isArray(queue) ? queue : []).map(L.resultOf), lineCount: 0, byteCount: 0
    };
    return L.withTx([L.STORE, L.LINES], "readwrite", async (tx) => {
      await deleteLines(tx.objectStore(L.LINES), run.runId);
      await request(tx.objectStore(L.STORE).put(record));
      return record;
    });
  };

  /**
   * Append one log line { t, level, src, msg } to the run: one line record
   * and the two counters, written in the same transaction. False when there
   * is no record for that id (the caller may warn once).
   */
  L.append = function (runId, line) {
    return L.withTx([L.STORE, L.LINES], "readwrite", async (tx) => {
      const runs = tx.objectStore(L.STORE);
      const rec = await request(runs.get(runId));
      if (!rec) return false;
      const seq = typeof rec.lineCount === "number" ? rec.lineCount : 0;
      await request(tx.objectStore(L.LINES).put({ runId, seq, t: line.t, level: line.level, src: line.src, msg: line.msg }));
      rec.lineCount = seq + 1;
      rec.byteCount = (typeof rec.byteCount === "number" ? rec.byteCount : 0) + lineBytes(line);
      await request(runs.put(rec));
      return true;
    });
  };

  /** Merge `patch` into the record (finishedAt, reason, results). False when there is no record. */
  L.update = function (runId, patch) {
    return L.withStore("readwrite", async (store) => {
      const rec = await request(store.get(runId));
      if (!rec) return false;
      const p = Object.assign({}, patch);
      if (Array.isArray(p.results)) p.results = p.results.map(L.resultOf);
      await request(store.put(Object.assign(rec, p)));
      return true;
    });
  };

  L.get = function (runId) {
    return L.withStore("readonly", (store) => request(store.get(runId)));
  };

  /**
   * Newest first. The tie rule for equal start times: the later finishedAt
   * first (an unfinished run, finishedAt null, counts as the newest), then
   * the runId in descending string order, so the order (and with it which
   * outcome the cross-run guard calls the newest) never depends on how the
   * database returned the records.
   */
  L.newestFirst = function (a, b) {
    const s = (b.startedAt || 0) - (a.startedAt || 0);
    if (s) return s;
    const fa = typeof a.finishedAt === "number" ? a.finishedAt : Infinity;
    const fb = typeof b.finishedAt === "number" ? b.finishedAt : Infinity;
    if (fa !== fb) return fb > fa ? 1 : -1;
    const ra = String(a.runId || ""), rb = String(b.runId || "");
    return ra === rb ? 0 : (rb > ra ? 1 : -1);
  };

  /** Every record, newest first (L.newestFirst); metadata and counters only, no lines. */
  L.list = async function () {
    const all = await L.withStore("readonly", (store) => request(store.getAll()));
    return (Array.isArray(all) ? all : []).sort((a, b) => L.newestFirst(a || {}, b || {}));
  };

  /** A run's log lines in order, read by the index cursor. */
  L.readLines = function (runId) {
    return L.withTx(L.LINES, "readonly", (tx) => new Promise((resolve, reject) => {
      const out = [];
      const req = tx.objectStore(L.LINES).index(L.RUN_INDEX).openCursor(keyRange().only(runId));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) { resolve(out); return; }
        const v = c.value;
        out.push({ t: v.t, level: v.level, src: v.src, msg: v.msg });
        c.continue();
      };
      req.onerror = () => reject(req.error || new Error("could not read run log lines"));
    }));
  };

  L.count = function () {
    return L.withStore("readonly", (store) => request(store.count()));
  };

  /** Delete one record and its lines. True when it existed. */
  L.delete = function (runId) {
    return L.withTx([L.STORE, L.LINES], "readwrite", async (tx) => {
      const store = tx.objectStore(L.STORE);
      const rec = await request(store.get(runId));
      if (!rec) return false;
      await request(store.delete(runId));
      await deleteLines(tx.objectStore(L.LINES), runId);
      return true;
    });
  };

  /** Delete every record and its lines except `keepRunId` (the run in progress, if any). Returns the number deleted. */
  L.purge = function (keepRunId) {
    return L.withTx([L.STORE, L.LINES], "readwrite", async (tx) => {
      const store = tx.objectStore(L.STORE);
      const linesStore = tx.objectStore(L.LINES);
      const keys = await request(store.getAllKeys());
      let n = 0;
      for (const k of keys) {
        if (keepRunId && k === keepRunId) continue;
        await request(store.delete(k));
        await deleteLines(linesStore, k);
        n += 1;
      }
      return n;
    });
  };

  /**
   * Keep the newest records (by startedAt), delete the rest and their lines.
   * `keep` is the stored "Runs to keep" value (K.runsKeepFrom turns anything
   * invalid into the default). `exceptRunId` (the run in progress) is never
   * deleted, whatever a backwards clock did to the start times.
   */
  L.prune = function (keep, exceptRunId) {
    const n = K.runsKeepFrom(keep);
    return L.withTx([L.STORE, L.LINES], "readwrite", async (tx) => {
      const store = tx.objectStore(L.STORE);
      const linesStore = tx.objectStore(L.LINES);
      const all = await request(store.getAll());
      const sorted = (Array.isArray(all) ? all : []).sort((a, b) => L.newestFirst(a || {}, b || {}));
      let deleted = 0;
      for (const rec of sorted.slice(n)) {
        if (exceptRunId && rec.runId === exceptRunId) continue;
        await request(store.delete(rec.runId));
        await deleteLines(linesStore, rec.runId);
        deleted += 1;
      }
      return deleted;
    });
  };

  /* ---------------------------------------------------------------- text */

  /** "20261008-143005" in local time, for file names. */
  L.stamp = function (t) {
    const d = new Date(typeof t === "number" ? t : Date.now());
    return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}-${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}`;
  };

  L.fileName = function (record) {
    return `model-garden-clicker-run-${L.stamp(record.startedAt)}.txt`;
  };

  L.allFileName = function (now) {
    return `model-garden-clicker-runs-${L.stamp(now)}.txt`;
  };

  /** The counts of a record's results, as the popup's summary counts them. */
  L.counts = function (record) {
    return K.runSummary((record && record.results) || []).counts;
  };

  function table(rows) {
    const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c]).length)));
    return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? String(cell) : String(cell).padEnd(widths[c]))).join("  ").replace(/\s+$/, "")).join("\n");
  }

  /** The header block and the job-results table of a run (everything but the log body). */
  function headAndTable(record) {
    const r = record || {};
    const counts = L.counts(r);
    const jobs = Array.isArray(r.results) && r.results.length ? r.results : (Array.isArray(r.jobs) ? r.jobs : []);
    const lineCount = typeof r.lineCount === "number" ? r.lineCount : 0;
    const head = [
      "Model Garden Clicker run log",
      `run id:        ${r.runId || ""}`,
      `started:       ${iso(r.startedAt)}`,
      `ended:         ${r.finishedAt ? iso(r.finishedAt) : "(not ended)"}`,
      `mode:          ${r.live === true ? "FULL RUN" : "DRY RUN"}`,
      `step-by-step:  ${r.stepByStep === true ? "on" : "off"}`,
      `reason:        ${r.reason || "(none recorded)"}`,
      `jobs:          ${jobs.length} (${K.summaryCountsText(counts)})`,
      `log lines:     ${lineCount}`,
      ""
    ];
    const rows = [["job", "project", "model", "status", "started", "ended", "message"]];
    jobs.forEach((j, i) => rows.push([i + 1, j.projectId || "", j.modelSlug || "", j.status || "pending", iso(j.startedAt), iso(j.finishedAt), clean(j.message)]));
    return head.concat([table(rows), "", "log:"]).join("\n");
  }

  /**
   * The plain-text log of one run: the header block with the run's metadata,
   * the job results as a table, then one line per log entry. `lines` is the
   * run's lines (from readLines). The questionnaire values never appear here
   * unless a log line already carried one. Control characters and bidi
   * overrides in a message are replaced with U+FFFD.
   */
  L.textOf = function (record, lines) {
    const r = record || {};
    const body = (Array.isArray(lines) ? lines : []).map(renderLine);
    return headAndTable(r) + "\n" + body.join("\n") + "\n";
  };

  /**
   * Every run in one text, newest first, each under its own header line.
   * `entries` is an array of { record, lines } (lines from readLines).
   */
  L.textOfAll = function (entries) {
    const arr = Array.isArray(entries) ? entries : [];
    const parts = [`Model Garden Clicker: ${arr.length} run(s), newest first`, ""];
    for (const e of arr) {
      const record = (e && e.record) || {};
      const lines = e && Array.isArray(e.lines) ? e.lines : [];
      parts.push("=".repeat(72), `run ${record.runId || ""} started ${iso(record.startedAt)}`, "=".repeat(72), L.textOf(record, lines));
    }
    return parts.join("\n");
  };

  /** UTF-8 size of the run's full text, in bytes, from the counters (no rebuild). */
  L.sizeOf = function (record) {
    const r = record || {};
    const body = typeof r.byteCount === "number" ? r.byteCount : 0;
    return utf8Len(headAndTable(r) + "\n") + body;
  };

  L.sizeText = function (bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  globalThis.MGC_RUNLOG = L;
})();
