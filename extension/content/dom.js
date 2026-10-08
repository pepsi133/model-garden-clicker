/*
 * Generic DOM helpers for the content script.
 *
 * Nothing in this file knows what the console pages look like; the locators
 * live in content/selectors.js. The helpers here deal with Angular Material
 * widgets and the Cloud console's cfc-* wrappers in a generic way
 * (mat-form-field, cfc-select / mat-select, mat-radio-button, mat-checkbox)
 * and with waiting, clicking and typing.
 *
 * Safety: MGC_DOM.click() refuses to click any element whose text contains
 * "agree". The only function allowed to use MGC_DOM.unguardedClick() is
 * clickAgreeGuarded() in content/actions.js.
 */
(function () {
  if (globalThis.MGC_DOM) return;
  const D = {};

  /* ------------------------------------------------------------ errors */

  class TimeoutError extends Error {
    constructor(what, ms) {
      super(`timed out after ${ms} ms waiting for ${what}`);
      this.name = "TimeoutError";
    }
  }
  /* An error the page loop must not retry: the job fails at once. */
  class FatalError extends Error {
    constructor(message) {
      super(message);
      this.name = "FatalError";
    }
  }
  class ForbiddenClickError extends FatalError {
    constructor(reason) {
      super(`refused to click: ${reason}`);
      this.name = "ForbiddenClickError";
    }
  }
  /* The page shows something the extension cannot get past (an extra
   * consent control, a permission error): the job fails at once with the
   * message as its whole reason, never retried, nothing clicked. */
  class BlockedError extends FatalError {
    constructor(message) {
      super(message);
      this.name = "BlockedError";
    }
  }
  class StoppedError extends Error {
    constructor(reason) {
      super(reason || "stop requested");
      this.name = "StoppedError";
    }
  }
  /* selectOption: the panel opened but offers no option with the wanted
   * text. Deterministic (a retry offers the same list), so the caller
   * turns it into a FatalError. `options` holds the offered texts. */
  class NoOptionError extends Error {
    constructor(wanted, options) {
      super(`no option matching "${wanted}"; the console offers: ${options.join(" | ")}`);
      this.name = "NoOptionError";
      this.wanted = wanted;
      this.options = options;
    }
  }
  D.TimeoutError = TimeoutError;
  D.FatalError = FatalError;
  D.ForbiddenClickError = ForbiddenClickError;
  D.BlockedError = BlockedError;
  D.StoppedError = StoppedError;
  D.NoOptionError = NoOptionError;

  /* Errors that must not be retried by the page loop. */
  D.isFatal = function (err) {
    return err instanceof FatalError;
  };

  /* ------------------------------------------------------------ timing */

  D.sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * The wait in progress, { what, timeout, since } or null, and a hook the
   * page loop sets to mirror it in the badge and the popup. Every wait in
   * the extension goes through waitFor, so this is the "current step".
   */
  D.currentWait = null;
  D.onWait = null;
  /* Called on every waitFor poll before the condition; an error it throws
   * ends the wait at once (content/actions.js sets it to the blocker check). */
  D.interrupt = null;
  function setWait(w) {
    D.currentWait = w;
    if (typeof D.onWait === "function") { try { D.onWait(w); } catch (e) { /* ignore */ } }
  }

  /**
   * Poll `fn` until it returns a truthy value. Resolves with that value.
   * Rejects with TimeoutError. Errors thrown by `fn`, or by the D.interrupt
   * hook (run before `fn` on every poll unless opts.interrupt is false),
   * propagate at once.
   * The poll interval defaults to MGC.URL_POLL_MS (an advanced setting).
   */
  D.waitFor = async function (fn, opts) {
    const timeout = (opts && opts.timeout) || 20000;
    const interval = (opts && opts.interval) || (globalThis.MGC && globalThis.MGC.URL_POLL_MS) || 250;
    const what = (opts && opts.what) || "condition";
    const deadline = Date.now() + timeout;
    setWait({ what, timeout, since: Date.now() });
    try {
      for (;;) {
        if (typeof D.interrupt === "function" && !(opts && opts.interrupt === false)) D.interrupt();
        const v = await fn();
        if (v) return v;
        if (Date.now() >= deadline) throw new TimeoutError(what, timeout);
        await D.sleep(interval);
      }
    } finally {
      setWait(null);
    }
  };

  /* ------------------------------------------------------------ queries */

  D.q = (selector, root) => (root || document).querySelector(selector);
  D.qa = (selector, root) => Array.from((root || document).querySelectorAll(selector));

  D.norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
  D.text = (el) => (el ? D.norm(el.textContent) : "");

  D.isVisible = function (el) {
    if (!el || !el.isConnected) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  function textMatches(haystack, needle, exact) {
    const h = D.norm(haystack).toLowerCase();
    const n = D.norm(needle).toLowerCase();
    return exact ? h === n : h.includes(n);
  }

  /* ------------------------------------------------------------ clicking */

  D.scrollIntoView = function (el) {
    try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) { /* ignore */ }
  };

  function dispatchClickSequence(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    const Pointer = typeof PointerEvent === "function" ? PointerEvent : MouseEvent;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
      const Ctor = type.startsWith("pointer") ? Pointer : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    }
    el.click();
  }

  /**
   * Click an element. Refuses any element whose visible text contains
   * "agree" so that no code path other than clickAgreeGuarded() can reach
   * the Agree button.
   */
  D.click = function (el) {
    if (!el) throw new Error("click: element is null");
    if (/agree/i.test(el.textContent || "")) {
      throw new ForbiddenClickError('element text contains "agree"; use clickAgreeGuarded()');
    }
    D.scrollIntoView(el);
    dispatchClickSequence(el);
  };

  /**
   * Click without the text guard. Reserved for clickAgreeGuarded() in
   * content/actions.js. Do not call this from anywhere else.
   */
  D.unguardedClick = function (el) {
    if (!el) throw new Error("unguardedClick: element is null");
    D.scrollIntoView(el);
    dispatchClickSequence(el);
  };

  /**
   * Disabled state. Note that mat-mdc-button-disabled-interactive is only a
   * Material styling class (the console's Enable button carries it while
   * fully clickable), so only the real disabled markers count.
   */
  D.isDisabled = function (el) {
    return !!(el.disabled || el.getAttribute("aria-disabled") === "true" || el.classList.contains("mat-mdc-button-disabled"));
  };

  /* ------------------------------------------------------------ inputs */

  /**
   * Set an <input>/<textarea> value so that Angular reactive forms notice it:
   * native value setter, then input + change, then blur (event included) so
   * the control goes ng-dirty ng-valid and then ng-touched. Synthetic
   * keystrokes are deliberately not used: the console's global "/" shortcut
   * ate the first "/" of "https://" when typed key by key.
   */
  D.setInputValue = function (el, value) {
    if (!el) throw new Error("setInputValue: element is null");
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    D.scrollIntoView(el);
    el.focus();
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.blur();
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    if (el.value !== value) throw new Error(`setInputValue: value did not stick (got "${el.value}")`);
  };

  /* ------------------------------------------------------------ selects */

  /**
   * Visible text of a dropdown option. cfc-select options carry a hidden
   * ".cfc-select-option-collapsed" copy of the label, so textContent reads
   * "CanadaCanada"; the primary span (or innerText, which skips display:none)
   * holds the clean label.
   */
  D.optionText = function (opt) {
    const primary = D.q(".cfc-select-option-primary", opt);
    if (primary) return D.text(primary);
    return typeof opt.innerText === "string" ? D.norm(opt.innerText) : D.text(opt);
  };

  /** Options currently rendered in the body-level overlay container. */
  D.overlayOptions = function () {
    return D.qa('.cdk-overlay-container mat-option, .cdk-overlay-container [role="option"]').filter(D.isVisible);
  };

  /** Text currently shown in a closed select host (" Canada " -> "Canada"). */
  D.selectValueText = function (selectEl) {
    const v = D.q(".cfc-select-value-text, .mat-mdc-select-value-text, .mat-select-value-text", selectEl);
    return v ? D.text(v) : D.text(selectEl);
  };

  /**
   * Open a <cfc-select> (or <mat-select>) and pick the option whose visible
   * text equals `optionText` (case-insensitive, whitespace-normalised).
   * The click goes to the inner trigger because the floating label overlaps
   * the host's centre. Options render in body > div.cdk-overlay-container.
   * opts.onOptions, when given, receives the visible texts of every option
   * the panel offered (the questionnaire handler logs them).
   */
  D.selectOption = async function (selectEl, optionText, opts) {
    if (!selectEl) throw new Error("selectOption: element is null");
    const want = D.norm(optionText);
    if (D.selectValueText(selectEl).toLowerCase() === want.toLowerCase() && !D.overlayOptions().length) {
      return; // already showing the wanted value (e.g. the preselected default)
    }
    const trigger = D.q(".cfc-select-trigger, .mat-mdc-select-trigger, .mat-select-trigger", selectEl) || selectEl;
    D.click(trigger);
    const options = await D.waitFor(() => {
      const o = D.overlayOptions();
      return o.length ? o : null;
    }, { timeout: 10000, what: "select options" });
    if (opts && typeof opts.onOptions === "function") {
      try { opts.onOptions(options.map(D.optionText)); } catch (e) { /* ignore */ }
    }
    const match = options.find((o) => textMatches(D.optionText(o), want, true));
    if (!match) {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      throw new NoOptionError(optionText, options.map(D.optionText));
    }
    D.scrollIntoView(match);
    D.click(match);
    await D.waitFor(() => D.overlayOptions().length === 0, { timeout: 5000, what: "select panel to close" });
    const shown = D.selectValueText(selectEl);
    if (shown.toLowerCase() !== want.toLowerCase()) {
      throw new Error(`selected option not reflected in the select (shows "${shown}", wanted "${want}")`);
    }
  };

  /* ------------------------------------------------------------ radios, checkboxes */

  /** Inside a mat-radio-group (or any container), pick the radio labelled `labelText`. */
  D.chooseMatRadio = function (groupEl, labelText) {
    if (!groupEl) throw new Error("chooseMatRadio: element is null");
    const buttons = D.qa("mat-radio-button", groupEl).filter(D.isVisible);
    const btn = buttons.find((b) => textMatches(b.textContent, labelText, true)) ||
      buttons.find((b) => D.q(`input[type="radio"][value="${labelText}"]`, b)) ||
      buttons.find((b) => textMatches(b.textContent, labelText, false));
    if (!btn) throw new Error(`no radio labelled "${labelText}" (saw: ${buttons.map(D.text).join(" | ")})`);
    const input = D.q('input[type="radio"]', btn);
    D.click(input || btn);
    const checked = (input && input.checked) || btn.classList.contains("mat-mdc-radio-checked") || btn.classList.contains("mat-radio-checked");
    if (!checked) throw new Error(`radio "${labelText}" did not become checked`);
  };

  /* Every checkbox-like element: a native checkbox, a role="checkbox"
   * element, or an Angular Material host. */
  /* The controls that make a checkbox host ambiguous when it holds more
   * than one: native checkboxes and radios, any element whose role names a
   * checkbox, a switch or a checkable menu item (in any case, as one of
   * several role tokens), anything carrying aria-checked, and Angular
   * Material's checkbox, slide-toggle and radio hosts. Shadow roots are not
   * searched. */
  const CHECKBOX_LIKE = [
    'input[type="checkbox"]', 'input[type="radio"]', '[role~="checkbox" i]', '[role~="switch" i]',
    '[role~="menuitemcheckbox" i]', "[aria-checked]", "mat-checkbox", "mat-slide-toggle", "mat-radio-button"
  ].join(", ");

  /** The checkable controls inside a host (the host itself not counted). */
  D.checkboxControls = function (el) {
    return el ? D.qa(CHECKBOX_LIKE, el) : [];
  };

  /**
   * A checkbox host's own native input: the input itself, or, when the host
   * holds exactly ONE checkable control in total (D.checkboxControls) and
   * it is a native checkbox, that input. Any other host (none, or more than
   * one, or a single non-input control) has no own input: null.
   */
  D.ownCheckboxInput = function (el) {
    if (!el) return null;
    if (el.matches && el.matches('input[type="checkbox"]')) return el;
    const controls = D.checkboxControls(el);
    return controls.length === 1 && controls[0].matches('input[type="checkbox"]') ? controls[0] : null;
  };

  /**
   * True when a checkbox is checked: a native input by its checked state;
   * a host by its one native input; a host with no control inside (a
   * role="checkbox" element, a bare host) by aria-checked or Material's
   * checked class. A host holding more than one checkable control is
   * ambiguous and never reads as checked.
   */
  D.isCheckboxChecked = function (el) {
    if (!el) return false;
    const input = D.ownCheckboxInput(el);
    if (input) return input.checked === true;
    const controls = D.checkboxControls(el);
    if (controls.length > 1) return false;
    if (controls.length === 1) return controls[0].getAttribute("aria-checked") === "true";
    return el.getAttribute("aria-checked") === "true" ||
      el.classList.contains("mat-mdc-checkbox-checked") ||
      el.classList.contains("mat-checkbox-checked");
  };

  /** Tick (or untick) a mat-checkbox by clicking its native input, then verify. */
  D.setCheckbox = async function (el, checked) {
    if (!el) throw new Error("setCheckbox: element is null");
    if (D.checkboxControls(el).length > 1) throw new Error("setCheckbox: the checkbox host holds more than one checkbox-like element; nothing is clicked");
    if (D.isCheckboxChecked(el) === checked) return;
    const input = D.ownCheckboxInput(el);
    D.click(input || el);
    await D.waitFor(() => D.isCheckboxChecked(el) === checked, { timeout: 5000, what: "checkbox state change" });
  };

  globalThis.MGC_DOM = D;
})();
