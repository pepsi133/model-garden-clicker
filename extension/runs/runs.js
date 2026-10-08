/*
 * The Runs page: every run's full log from the extension's IndexedDB
 * (common/runlog.js), newest first, with "Download log" and "Delete" per
 * run, "Download all" and "Purge all" at the top. This page only reads the
 * database; a delete or a purge is a message to the service worker, the
 * one writer. Every piece of text is set through textContent: log lines
 * carry console error text and must never be parsed as markup.
 *
 * A download is a text file built in memory, saved through an anchor with
 * the download attribute and an object URL; no permission is needed.
 */
(function () {
  const K = globalThis.MGC;
  const RL = globalThis.MGC_RUNLOG;
  const { KEYS, MSG } = K;
  const $ = (id) => document.getElementById(id);

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (reply) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(reply || { ok: false, error: "no reply from the worker" });
        });
      } catch (e) {
        resolve({ ok: false, error: e && e.message ? e.message : String(e) });
      }
    });
  }

  function notice(text) {
    const el = $("notice");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
  }

  /** Save `text` as a file named `name`: a Blob, an object URL, an anchor with the download attribute. */
  function saveText(name, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return name;
  }

  const fmt = (t) => (typeof t === "number" ? new Date(t).toLocaleString() : "");

  function cell(tr, cls, build) {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    build(td);
    tr.appendChild(td);
    return td;
  }

  function span(parent, cls, text) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    parent.appendChild(s);
    return s;
  }

  function button(parent, cls, text, title, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.title = title;
    b.addEventListener("click", onClick);
    parent.appendChild(b);
    return b;
  }

  function row(rec, running) {
    const tr = document.createElement("tr");
    tr.dataset.runId = rec.runId;
    const inProgress = running && running.runId === rec.runId;
    cell(tr, "started", (td) => {
      td.appendChild(document.createTextNode(fmt(rec.startedAt)));
      if (inProgress) span(td, "progress", " (in progress)");
      else if (rec.finishedAt) span(td, "reason", `ended ${fmt(rec.finishedAt)}: ${rec.reason || "finished"}`);
      else span(td, "reason", "not ended (the worker was stopped before the run ended)");
    });
    cell(tr, "mode", (td) => {
      span(td, rec.live === true ? "live" : "dry", rec.live === true ? "FULL RUN" : "DRY RUN");
      if (rec.stepByStep === true) span(td, "sbs", " · step-by-step");
    });
    cell(tr, "jobs", (td) => { td.textContent = String((rec.jobs || []).length); });
    cell(tr, "counts", (td) => { td.textContent = K.summaryCountsText(RL.counts(rec)); });
    cell(tr, "log", (td) => { td.textContent = `${(rec.lines || []).length} lines · ${RL.sizeText(RL.sizeOf(rec))}`; });
    cell(tr, "actions", (td) => {
      button(td, "download", "Download log", `Save this run's full log as ${RL.fileName(rec)}`, async () => {
        notice("");
        try {
          const fresh = (await RL.get(rec.runId)) || rec;
          saveText(RL.fileName(fresh), RL.textOf(fresh));
        } catch (err) {
          notice(`could not read the run log: ${err && err.message ? err.message : err}`);
        }
      });
      const del = button(td, "delete", "Delete", inProgress ? "This run is in progress; stop it before deleting its log" : "Delete this run's full log (asks first)", async () => {
        notice("");
        if (!confirm(`Delete the full log of the run started ${fmt(rec.startedAt)} (${(rec.lines || []).length} lines)?`)) return;
        const r = await send({ type: MSG.RUNS_DELETE, runId: rec.runId });
        if (!r.ok) notice(r.error || "could not delete the run log");
        render();
      });
      del.disabled = inProgress;
    });
    return tr;
  }

  let rendering = null;
  let dbNotice = false; // the notice shows a database error from the last render; a later successful render clears it (and only that)
  async function render() {
    if (rendering) return rendering;
    rendering = (async () => {
      const table = $("runs");
      const tbody = table ? table.querySelector("tbody") : null;
      const empty = $("empty");
      let records = [];
      let running = null;
      try {
        const o = await chrome.storage.local.get([KEYS.RUN, KEYS.RUNNING, KEYS.RUNS_KEEP]);
        if (o[KEYS.RUNNING] === true && o[KEYS.RUN]) running = o[KEYS.RUN];
        const keep = $("keep");
        if (keep) keep.textContent = String(K.runsKeepFrom(o[KEYS.RUNS_KEEP]));
      } catch (e) { /* storage unavailable: the list still renders */ }
      try {
        records = await RL.list();
        if (dbNotice) { notice(""); dbNotice = false; }
      } catch (err) {
        notice(`could not open the run log database: ${err && err.message ? err.message : err}`);
        dbNotice = true;
      }
      if (tbody) tbody.textContent = "";
      if (tbody) for (const rec of records) tbody.appendChild(row(rec, running));
      if (table) table.hidden = records.length === 0;
      if (empty) empty.hidden = records.length > 0;
      const purge = $("purge-all");
      if (purge) purge.disabled = records.length === 0;
      const all = $("download-all");
      if (all) all.disabled = records.length === 0;
      return records;
    })();
    try { return await rendering; } finally { rendering = null; }
  }

  async function downloadAll() {
    notice("");
    try {
      const records = await RL.list();
      if (!records.length) { notice("no runs to download"); return; }
      saveText(RL.allFileName(Date.now()), RL.textOfAll(records));
    } catch (err) {
      notice(`could not read the run logs: ${err && err.message ? err.message : err}`);
    }
  }

  async function purgeAll() {
    notice("");
    let n = 0;
    try { n = await RL.count(); } catch (err) { notice(`could not count the runs: ${err && err.message ? err.message : err}`); return; }
    if (!n) { notice("no runs to delete"); return; }
    if (!confirm(`Delete the full logs of all ${n} run(s)? The popup's results and its last 50 lines are not affected. A run in progress keeps its log.`)) return;
    const r = await send({ type: MSG.RUNS_PURGE });
    if (!r.ok) notice(r.error || "could not purge the run logs");
    else if (r.kept) notice(`${r.deleted} run log(s) deleted; the run in progress keeps its log`);
    render();
  }

  function init() {
    const on = (el, fn) => { if (el) el.addEventListener("click", (e) => { e.preventDefault(); fn(); }); };
    on($("refresh"), render);
    on($("download-all"), downloadAll);
    on($("purge-all"), purgeAll);
    // A run starting or ending (KEYS.RUNNING flips) changes the list; a
    // line appended mid-run does not re-render (Refresh does).
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && (changes[KEYS.RUNNING] || changes[KEYS.RUNS_KEEP])) render();
      });
    }
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
