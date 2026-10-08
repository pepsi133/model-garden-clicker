/*
 * Floating status badge shown bottom-right on console pages while a run is
 * active in this tab. The text block is purely informational and never
 * captures clicks (pointer-events: none), so it cannot cover a console
 * button in a way that blocks it. Its width is capped at 40 % of the
 * viewport: the console's Next (questionnaire footer) and Agree
 * (Agreements page) buttons sit bottom-left, within the leftmost ~350 px,
 * so from 880 px of window width up the badge and the panel overlap
 * neither (recorded geometry at 1390 x 847: Next x 296-350, Agree x 80-143).
 *
 * Three lines, re-rendered every second, and at once when a wait starts or
 * ends, from the last info given to B.update() plus the wait in progress
 * (MGC_DOM.currentWait):
 *   MG Clicker [DRY RUN] job 2/4 · <project> · <model> · 00:37
 *   step: waiting for Enable button ... · 12 s / 60 s
 *   then: click Enable, then the questionnaire · next job: <project> · <model>
 *
 * Step-by-step confirmation turns the badge into a panel (B.panel): the
 * same three lines plus a summary of the step and real buttons (Continue /
 * Stop) that do take clicks. The button handlers are supplied by the caller
 * (content/actions.js); the badge only renders them. While a console
 * dialog is open the caller disables a button (B.panelEnable) and shows the
 * dialog's title in a note line (B.panelNote).
 */
(function () {
  if (globalThis.MGC_BADGE) return;
  const B = {};
  const ID = "mgc-badge";
  const PANEL_ID = "mgc-panel";
  let el = null;
  let text = null;     // the three-line block
  let panelEl = null;  // the confirmation panel, when open
  let info = null;      // last B.update() argument
  let action = null;    // current action named by B.step() (shown when no wait is running)
  let timer = null;

  function ensure() {
    if (el && el.isConnected) return el;
    el = document.getElementById(ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ID;
      Object.assign(el.style, {
        position: "fixed",
        bottom: "12px",
        right: "12px",
        zIndex: "2147483647",
        maxWidth: "min(520px, 40vw)",
        padding: "6px 10px",
        borderRadius: "6px",
        font: "11px/1.45 ui-monospace, Menlo, Consolas, monospace",
        color: "#e8eaed",
        background: "rgba(18, 18, 20, 0.94)",
        boxShadow: "0 2px 8px rgba(0,0,0,0.45)",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      });
      text = document.createElement("div");
      el.appendChild(text);
    } else {
      text = el.firstElementChild || el;
    }
    (document.body || document.documentElement).appendChild(el);
    return el;
  }

  function mmss(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }

  /** The current step line: the wait in progress with its elapsed/timeout, else the named action. */
  B.stepLine = function () {
    const D = globalThis.MGC_DOM;
    const w = D && D.currentWait;
    if (w) return `waiting for ${w.what} · ${Math.floor((Date.now() - w.since) / 1000)} s / ${Math.round(w.timeout / 1000)} s`;
    if (action) return action;
    return info && info.note ? info.note : "idle";
  };

  function render() {
    if (!info) return;
    const node = ensure();
    const live = info.mode === "FULL RUN";
    const job = `job ${info.jobIndex + 1}/${info.total} · ${info.projectId} · ${info.modelSlug}`;
    const elapsed = info.jobStartedAt ? ` · ${mmss(Date.now() - info.jobStartedAt)}` : "";
    const line1 = `MG Clicker [${info.mode || "?"}] ${job}${elapsed}`;
    const line2 = `step: ${B.stepLine()}`;
    const next = info.nextJob ? `next job: ${info.nextJob.projectId} · ${info.nextJob.modelSlug}` : "next job: none (last job)";
    const line3 = `then: ${info.plan || "-"} · ${next}`;
    text.textContent = `${line1}\n${line2}\n${line3}`;
    node.style.border = live ? "2px solid #d32f2f" : "2px solid #1a7f4b";
    node.style.display = "block";
  }

  /**
   * Show the badge for a job. info: { mode ("FULL RUN" | "DRY RUN"), jobIndex,
   * total, projectId, modelSlug, jobStartedAt, plan (what happens next in
   * this phase), nextJob ({ projectId, modelSlug } | null), note }.
   */
  B.update = function (next) {
    info = next;
    render();
    if (!timer) timer = setInterval(render, 1000);
  };

  /** Name the action in progress (cleared with null); shown while no wait runs. */
  B.step = function (text) {
    action = text || null;
    render();
  };

  /**
   * Open the confirmation panel under the three lines: { title, summary,
   * buttons: [{ label, action?, onClick(event), primary? }] }. The panel
   * (and only the panel) takes pointer events. onClick receives the DOM
   * event, so the caller can require event.isTrusted. `action` (default:
   * the label in lower case) becomes data-action on the button. Replaces an
   * open panel.
   */
  B.panel = function (spec) {
    const node = ensure();
    B.closePanel();
    panelEl = document.createElement("div");
    panelEl.id = PANEL_ID;
    Object.assign(panelEl.style, {
      marginTop: "8px",
      paddingTop: "8px",
      borderTop: "1px solid rgba(255,255,255,0.25)",
      pointerEvents: "auto",
      font: "12px/1.45 system-ui, sans-serif"
    });
    const title = document.createElement("div");
    title.className = "mgc-panel-title";
    title.style.fontWeight = "700";
    title.textContent = spec.title || "";
    const summary = document.createElement("div");
    summary.className = "mgc-panel-summary";
    summary.style.margin = "4px 0 8px";
    summary.textContent = spec.summary || "";
    const note = document.createElement("div");
    note.className = "mgc-panel-note";
    Object.assign(note.style, { margin: "0 0 8px", fontWeight: "700", color: "#ffd48a", display: "none" });
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    for (const b of spec.buttons || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mgc-panel-button";
      btn.dataset.action = b.action || String(b.label || "").toLowerCase();
      btn.textContent = b.label;
      Object.assign(btn.style, {
        font: "13px system-ui, sans-serif",
        fontWeight: "700",
        padding: "6px 16px",
        borderRadius: "4px",
        cursor: "pointer",
        border: b.primary ? "1px solid #8c6424" : "1px solid #9aa0a6",
        background: b.primary ? "#d99a38" : "#e8eaed",
        color: "#1c140e"
      });
      btn.addEventListener("click", (ev) => { try { b.onClick(ev); } catch (e) { /* the caller logs */ } });
      row.appendChild(btn);
    }
    panelEl.appendChild(title);
    panelEl.appendChild(summary);
    panelEl.appendChild(note);
    panelEl.appendChild(row);
    node.appendChild(panelEl);
    node.style.display = "block";
    return panelEl;
  };

  /** Show a note line in the open panel (null or "" hides it). */
  B.panelNote = function (text) {
    const note = panelEl && panelEl.querySelector(".mgc-panel-note");
    if (!note) return;
    note.textContent = text || "";
    note.style.display = text ? "block" : "none";
  };

  /** Enable or disable the open panel's button with data-action `action`. */
  B.panelEnable = function (action, enabled) {
    const btn = panelEl && panelEl.querySelector(`button[data-action="${action}"]`);
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "" : "0.5";
    btn.style.cursor = enabled ? "pointer" : "default";
  };

  B.closePanel = function () {
    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
    panelEl = null;
  };

  B.hide = function () {
    info = null;
    action = null;
    B.closePanel();
    if (timer) { clearInterval(timer); timer = null; }
    if (el && el.isConnected) el.style.display = "none";
  };

  /** Re-render now (the page loop calls it when a wait starts or ends). */
  B.refresh = function () {
    render();
  };

  globalThis.MGC_BADGE = B;
})();
