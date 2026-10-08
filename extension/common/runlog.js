/*
 * Per-run logs in the extension's IndexedDB.
 *
 * One database ("mgc-runs"), one object store ("runs") keyed by run id, one
 * record per run:
 *   { runId, startedAt, finishedAt, live, stepByStep, reason,
 *     jobs:    [{ projectId, modelSlug, modelName }],          the job list at Start
 *     results: [{ projectId, modelSlug, modelName, status, message, startedAt, finishedAt, productId, agreeClicked, agreeClickedByUser }],
 *     lines:   [{ t, level, src, msg }] }                        every log line, uncapped
 *
 * The service worker is the only writer (create, append, update, delete,
 * purge, prune); the runs page and the options page only read (list, get,
 * count). Every call opens the database, runs one transaction and closes
 * it again: no handle outlives a call, so a worker that Chrome terminates
 * and restarts mid-run keeps appending to the same record. Every function
 * rejects on a database error; the caller decides what that means (the
 * worker logs one line and goes on with the run).
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
  L.DB_VERSION = 1;

  /* Result fields copied from a queue entry into the record (nothing else of the job). */
  L.RESULT_FIELDS = ["projectId", "modelSlug", "modelName", "status", "message", "startedAt", "finishedAt", "productId", "agreeClicked", "agreeClickedByUser"];

  function idb() {
    const db = globalThis.indexedDB;
    if (!db) throw new Error("IndexedDB is not available here");
    return db;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = idb().open(L.DB_NAME, L.DB_VERSION); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(L.STORE)) db.createObjectStore(L.STORE, { keyPath: "runId" });
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
   * Open the database, run `fn(store)` inside one transaction of `mode`
   * ("readonly" or "readwrite"), wait for the transaction to complete and
   * close the database. Returns what fn returned. A failed or aborted
   * transaction (a quota error among others) rejects with its error.
   */
  L.withStore = async function (mode, fn) {
    const db = await openDb();
    try {
      const tx = db.transaction(L.STORE, mode);
      const done = new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("run log transaction failed"));
        tx.onabort = () => reject(tx.error || new Error("run log transaction aborted"));
      });
      let result;
      try {
        result = await fn(tx.objectStore(L.STORE));
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

  /** A result entry from a queue entry: the whitelisted fields only. */
  L.resultOf = function (job) {
    const out = {};
    for (const f of L.RESULT_FIELDS) if (job && job[f] !== undefined) out[f] = job[f];
    return out;
  };

  /** Create the record of a run at Start (replaces a record with the same id). */
  L.create = function (run, queue, stepByStep) {
    const jobs = (Array.isArray(queue) ? queue : []).map((j) => ({ projectId: j.projectId, modelSlug: j.modelSlug, modelName: j.modelName || null }));
    const record = {
      runId: run.runId, startedAt: run.startedAt, finishedAt: null, live: run.live === true, stepByStep: stepByStep === true, reason: null,
      jobs, results: (Array.isArray(queue) ? queue : []).map(L.resultOf), lines: []
    };
    return L.withStore("readwrite", async (store) => { await request(store.put(record)); return record; });
  };

  /** Append one log line { t, level, src, msg } to the run's record. False when there is no record for that id. */
  L.append = function (runId, line) {
    return L.withStore("readwrite", async (store) => {
      const rec = await request(store.get(runId));
      if (!rec) return false;
      rec.lines.push({ t: line.t, level: line.level, src: line.src, msg: line.msg });
      await request(store.put(rec));
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

  /** Every record, newest first. */
  L.list = async function () {
    const all = await L.withStore("readonly", (store) => request(store.getAll()));
    return (Array.isArray(all) ? all : []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  };

  L.count = function () {
    return L.withStore("readonly", (store) => request(store.count()));
  };

  /** Delete one record. True when it existed. */
  L.delete = function (runId) {
    return L.withStore("readwrite", async (store) => {
      const rec = await request(store.get(runId));
      if (!rec) return false;
      await request(store.delete(runId));
      return true;
    });
  };

  /** Delete every record except `keepRunId` (the run in progress, if any). Returns the number deleted. */
  L.purge = function (keepRunId) {
    return L.withStore("readwrite", async (store) => {
      const keys = await request(store.getAllKeys());
      let n = 0;
      for (const k of keys) {
        if (keepRunId && k === keepRunId) continue;
        await request(store.delete(k));
        n += 1;
      }
      return n;
    });
  };

  /** Keep the `keep` newest records (by startedAt), delete the rest. Returns the number deleted. */
  L.prune = function (keep) {
    const n = K.runsKeepFrom(keep);
    return L.withStore("readwrite", async (store) => {
      const all = await request(store.getAll());
      const sorted = (Array.isArray(all) ? all : []).sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
      let deleted = 0;
      for (const rec of sorted.slice(n)) {
        await request(store.delete(rec.runId));
        deleted += 1;
      }
      return deleted;
    });
  };

  /* ---------------------------------------------------------------- text */

  const pad = (v, n) => String(v).padStart(n, "0");

  function iso(t) {
    return typeof t === "number" && Number.isFinite(t) ? new Date(t).toISOString() : "";
  }

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

  /**
   * The plain-text log of one run: a header block with the run's metadata,
   * the job results as a table, then one line per log entry,
   * "<ISO timestamp> <source> [<level>] <message>". The questionnaire values
   * never appear here unless a log line already carried one (the worker and
   * the content script log a rejected field's value on failure, nothing else).
   */
  L.textOf = function (record) {
    const r = record || {};
    const counts = L.counts(r);
    const jobs = Array.isArray(r.results) && r.results.length ? r.results : (Array.isArray(r.jobs) ? r.jobs : []);
    const lines = Array.isArray(r.lines) ? r.lines : [];
    const head = [
      "Model Garden Clicker run log",
      `run id:        ${r.runId || ""}`,
      `started:       ${iso(r.startedAt)}`,
      `ended:         ${r.finishedAt ? iso(r.finishedAt) : "(not ended)"}`,
      `mode:          ${r.live === true ? "FULL RUN" : "DRY RUN"}`,
      `step-by-step:  ${r.stepByStep === true ? "on" : "off"}`,
      `reason:        ${r.reason || "(none recorded)"}`,
      `jobs:          ${jobs.length} (${K.summaryCountsText(counts)})`,
      `log lines:     ${lines.length}`,
      ""
    ];
    const rows = [["job", "project", "model", "status", "started", "ended", "message"]];
    jobs.forEach((j, i) => rows.push([i + 1, j.projectId || "", j.modelSlug || "", j.status || "pending", iso(j.startedAt), iso(j.finishedAt), String(j.message || "").replace(/\s+/g, " ")]));
    const body = lines.map((l) => `${iso(l.t)} ${l.src || "worker"} [${l.level || "info"}] ${String(l.msg || "").replace(/\r?\n/g, " ")}`);
    return head.concat([table(rows), "", "log:"], body).join("\n") + "\n";
  };

  /** Every run in one text, newest first, each under its own header line. */
  L.textOfAll = function (records) {
    const recs = Array.isArray(records) ? records : [];
    const parts = [`Model Garden Clicker: ${recs.length} run(s), newest first`, ""];
    for (const r of recs) {
      parts.push("=".repeat(72), `run ${r.runId || ""} started ${iso(r.startedAt)}`, "=".repeat(72), L.textOf(r));
    }
    return parts.join("\n");
  };

  /** UTF-8 size of the run's text, in bytes. */
  L.sizeOf = function (record) {
    const text = L.textOf(record);
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
    return text.length;
  };

  L.sizeText = function (bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  globalThis.MGC_RUNLOG = L;
})();
