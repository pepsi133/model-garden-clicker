# Backlog

Parked items for the extension. Each entry states the problem, the intended
behaviour and what is still undecided. Nothing here is scheduled.

## Per-project allow and deny lists for API auto-enablement, with a pause-and-confirm mode

**Done in 1.0.0.** What shipped: a default API-enablement policy in the
options page (`enable`, the default and the old behaviour; `ask`; `never`)
plus per-project overrides, one `project-id: policy` line each. `ask` shows
a panel in the console tab (Enable the API / Skip / Stop) with the watchdog
paused; `never`, for a project whose APIs Terraform or another tool manages,
fails the job at once with "API enablement required outside the extension",
naming the API, and clicks nothing. Every decision is logged with the
project, the policy, its source and the API. What was not built: the
wait, confirm and retry loop of the original idea (the job waiting for the
user to enable the API, then reloading and retrying). A failed job that
names the API, and a re-run of the pair once the API is enabled, cover it.

## Recover from a crashed or discarded worker tab (Chrome's Aw, Snap, error code 5)

Parked by the owner on 2026-10-29, for after 1.0.0.

**Problem.** A renderer crash ("Aw, Snap", error code 5) kills the content
script in the worker tab, so the badge and any step-by-step panel vanish
with it. The watchdog then ends the job `failed` once the phase budget is
spent, and during a step-by-step wait the run simply waits until Stop.
Chrome's Memory Saver can also discard the background worker tab, with the
same result.

**Intended behaviour.**
- Create the worker tab with `autoDiscardable: false`.
- A one-minute liveness ping (an alarm) from the worker to the tab. Two
  consecutive misses after the job's first minute mean the page died.
- With a purchase on record the job ends `unverified`. Otherwise the job
  restarts once from the model page, and the restart is logged. A second
  death ends the job `failed` with "the page died twice".
- The alarm is cleared at the end of the run.

**Open points.**
- Whether to ping during `awaiting_confirmation` (a user may wait there for
  a long time, and a dead page would otherwise go unnoticed).
- The miss threshold: two consecutive misses, or another number.

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
- Release workflow: the strict second pass in `.github/workflows/release.yml` repeats `worker-harness.mjs` and `ui-pages.cjs` but not the `models.json` lint (`extension/test/models-json.cjs`), which runs in the first pass only. Add it to the strict list at the next workflow edit.
- The run-log migration (`common/runlog.js`, v1 to v2) keeps an entry whose `msg` is not a string as an empty line; drop it instead (0.6.1 review, P5). The fake IndexedDB does not abort a versionchange whose handler throws, so an aborted-upgrade test would need the fake to roll back first (0.6.0 review, N10).
