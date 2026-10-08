# Backlog

Parked items for the extension. Each entry states the problem, the intended
behaviour and what is still undecided. Nothing here is scheduled.

## Per-project allow and deny lists for API auto-enablement, with a pause-and-confirm mode

**Problem.** When a project lacks the Agent Platform API the console opens an
"Enable APIs" dialog and the extension clicks that dialog's Enable button so
the flow can continue. That is an unattended change to the project's service
configuration. It is harmless in a throwaway project and wrong in a project
whose API enablement is managed outside the console, typically by Terraform:
the next `terraform plan` shows drift, or the next apply disables the API
again and the model silently stops working.

**Intended behaviour.**

- The options page gets a per-project policy: an allow list and a deny list
  of API names (for example `aiplatform.googleapis.com`) that the extension
  may or may not enable, plus a default for projects not listed.
- A third mode, pause-and-confirm, applies when a project is in neither list
  or when its policy says so: the extension does not click the dialog's
  Enable button. It marks the job as waiting, shows the dialog text and the
  API name in the popup, and keeps the worker tab on that page.
- For a project flagged as managed by Terraform (or any external tool), the
  extension must never enable the API itself. It flags the job as
  "API enablement required outside the extension", names the API, and waits.
  The user enables the API with their own tooling, then confirms in the
  popup; the extension reloads the page once and retries the job from the
  model page. A second refusal after the retry fails the job.
- The deny decision, the wait, the confirmation and the retry are written to
  the extension log with the project and the API name so a run can be audited
  afterwards.

**Open points.**

- Where the Terraform flag lives: a manual per-project checkbox in the
  options page is the minimum; detecting Terraform-managed projects
  automatically is out of scope for the extension.
- Whether a waiting job blocks the queue or is skipped and revisited at the
  end of the run. Blocking is simpler and keeps one worker tab; skipping
  keeps unattended runs moving.
- Whether the confirmation should re-check the API state through the
  console (reload and look for the dialog again) or trust the user's click.
  Re-checking is safer and costs one page load.

## Models with extra consent controls on the model page

Models with extra consent controls on the model page (for example Fable 5.1)
are not supported yet; the job must fail cleanly. Today the extension never
clicks a disabled Enable button; a disabled Enable next to an unchecked
checkbox in the page's main content fails the job at once with a message
that names the manual step, and an Enable click that does not open the
questionnaire within `nav_ms` fails it with a message that points at a
manual step on the model page.

## Parked after the 0.4.0 review (low items)

One line each; none is scheduled.

- Agree guard: a refused undo of the click record (the run or tab no longer current when the guard undoes it) leaves `agreeClicked: true` with no click made; reachable only once the run is gone, and the log line says it was not cleared.
- Agree handler: after a guard refusal with the user's own activation seen, the set of dialogs open before the click is not taken again, so an unrelated dialog already open could be judged as that click's outcome; needs a click behind the console's modal backdrop.
- Hidden worker tab: a browser run that leaves the worker tab in the background for more than five minutes across two jobs (`ext_dryrun.py --hidden-worker`), asserting the results and the per-phase timings against Chrome's timer throttling; today the behaviour is documented from Chrome's rules, not measured.
- Four copies of the walkthrough (root `README.md`, `extension/README.md`, `store/LISTING.md`, `options.html`): keep one and link to it.
- `.gitignore` carries the agent tooling entries (`.agents/`, `.claude/`, `skills-lock.json`); `.claude/` is where agent worktrees live, so the entries stay as long as that tooling is used on the clone.
- `store/LISTING.md` opens with a re-paste note for the dashboard draft; drop it after the paste.
- Full run without step-by-step: the console's own Agree activated by the user in the milliseconds between the checkbox tick and the guard is not watched (the listener is attached with step-by-step only), so two activations could land for one purchase; attach the listener in both modes (0.4.0 review, T10).
- Debloat left from the 0.4.0 review: the popup's `on()`/`setIf()` wrappers (they keep a broken page rendering; a test proves the ids exist), the options page's walkthrough copy and badge sketch, `settle_ms` (a stored setting: removing it changes the options JSON), the `TIMING_KEYS` path mapping (touches every timeout read), and the four walkthrough copies.
- The run-log migration (`common/runlog.js`, v1 to v2) keeps an entry whose `msg` is not a string as an empty line; drop it instead (0.6.1 review, P5). The fake IndexedDB does not abort a versionchange whose handler throws, so an aborted-upgrade test would need the fake to roll back first (0.6.0 review, N10).
