# Maintenance: when the console changes

The extension drives three Google Cloud console pages with the locators in
`extension/content/selectors.js`. Google changes those pages now and then. A
job then ends `failed` with a message such as `gave up on questionnaire page
after 3 attempts: timeout waiting for ...`, and this guide is the way back:
from that message to a tagged release.

```text
record the pages      python/scripts/recon.py            (dry run; Agree is never clicked)
  read the dumps      python/recon/<run>/NN-<step>/      page.html, forms.json, url.txt
  compare             docs/dom-map.md                    the anchors the extension relies on
update                docs/dom-map.md, then extension/content/selectors.js
test offline          sh extension/test/run.sh           the dumps are the fixtures
test in a browser     python/scripts/ext_dryrun.py       once
release               extension/manifest.json version, tag v<version>
```

Three rules hold throughout.

- **Never click Agree in a test.** `recon.py` refuses to click any button
  whose text contains "agree" unless `--i-approve-agree` is given. Do not
  give it in this loop. `ext_dryrun.py` verifies in storage that the DRY RUN
  box is ticked before Start and stops the run if the extension ever asks
  for a confirmation before Agree. The offline suite proves the one Agree
  click in jsdom only, on a saved page.
- **Keep browser runs to a minimum.** One `recon.py` run gives the dumps.
  The offline suite then runs as often as you like without a browser. One
  `ext_dryrun.py` run at the end confirms the result. Every browser run
  signs in to a real console with a real project.
- **Dumps and the profile stay gitignored.** `python/recon/` holds the
  filled forms, `python/.chrome-profile/` holds a live Google session,
  `python/config.local.json` holds your questionnaire values. All three are
  in `.gitignore`. Keep them out of backups and shared drives as well, and
  check `git status --short` before every commit.

The commands below run from the repository root. `python/README.md` is the
reference for each script; this file is the procedure.

## 1. Set up the harness

Once per machine.

```sh
bash python/setup.sh
cp python/config.example.json python/config.local.json
```

Edit `python/config.local.json`: business name, website (with `https://`),
contact email, headquarters, industry, intended users, use cases, the
Acceptable Use Policy answer. The three dropdown values must be option texts
the console offers; `docs/dom-map.md` lists them.

Sign in to the dedicated profile once. A Chrome window opens on
`python/.chrome-profile/`; log in to Google there, then press Enter in the
terminal.

```sh
python/.venv/bin/python python/scripts/login.py
```

You see one of these lines at the end:

```text
RESULT: logged in - console.cloud.google.com reached. Cookies persist in the profile.
RESULT: still on accounts.google.com - login did not complete. Run this script again.
```

Flags: `--profile DIR` picks another Chrome user-data-dir (default
`python/.chrome-profile`). The cookies persist, so this is a one-time step
until Google signs the profile out.

## 2. Record the pages (dry run)

Pick a project where the model is not yet enabled. Run the flow once; it
stops on the Agreements page with the terms checkbox ticked.

```sh
python/.venv/bin/python python/scripts/recon.py --project <project-id> --model claude-haiku-4-5
```

Flags from `recon.py --help`: `--project` (required), `--model` (default
`claude-haiku-4-5`), `--out DIR` (default `python/recon/<ts>-<project>-<model>/`),
`--profile DIR`, `--config PATH` (default `python/config.local.json`), and
`--i-approve-agree`, which you do not use here.

What you see: `[recon] run dir: ...`, then Chrome works through the pages,
then this banner, after which the browser stays open for 20 seconds so you
can look at the page:

```text
========================================================================
THE AGREE BUTTON WAS NOT CLICKED. THE MODEL HAS NOT BEEN ENABLED.
REVIEW THE PAGE IN THE BROWSER; IT CLOSES IN 20 SECONDS.
========================================================================
[recon] done; dumps in python/recon/<timestamp>-<project>-claude-haiku-4-5
```

The run directory:

```text
python/recon/<timestamp>-<project>-<model>/
├── 01-model-page/             # the model page with its Enable button
├── 02-after-enable/           # the questionnaire, empty
├── 03-form-filled/            # the questionnaire with your values typed in
├── 04-agreements/             # the Purchase summary page
├── 05-agreements-checked/     # the terms checkbox ticked; the run stops here
├── 99-failure/                # only when a step failed: the page as it was
├── NN-<step>-api-dialog/      # only when the "Enable APIs" dialog was open on that page
└── timing.json                # seconds per step; reload or in-app route change
```

Every step directory holds `page.html` (the DOM as `page_source`),
`forms.json` (the live `value` and `checked` of every input, which
`page_source` does not serialise), `screenshot.png` and `url.txt`.

When the run fails at a step, `[recon] FAILED at step NN-...` names it and
`99-failure/` holds the page that broke. That is usually the dump you need.
When the script says `Model appears to be ALREADY ENABLED`, it stopped at
`01-model-page` without touching anything: use another project, or keep
the dump as run shape C (section 5).

## 3. Read the dumps and compare with the map

Find the newest run and look at what the console served.

```sh
RUN=$(ls -d python/recon/2*/ | sort | tail -1); echo "$RUN"
cat "$RUN"99-failure/url.txt 2>/dev/null || cat "$RUN"05-agreements-checked/url.txt
python3 -I -m json.tool "$RUN"03-form-filled/forms.json | less
```

`forms.json` is `{ "elements": [ { "id", "tag", "type", "value", "checked", ... } ] }`,
one entry per form control, keyed by the generated id of that render. The
offline tests put these values back into `page.html` before they run.

Then check each anchor the extension relies on. `docs/dom-map.md` is the
full record; this is the short list.

```sh
# model page: the Enable wrapper, the enabled-state link, the "Enable APIs" dialog
grep -o '<vertex-ai-[a-z-]*\|<apis-enabler\|<vai-model-garden-call-to-action-button-stack' "$RUN"01-model-page/page.html | sort | uniq -c
# questionnaire: the raf-name hooks (nine expected) and the Next footer
grep -o 'raf-name="[^"]*"' "$RUN"02-after-enable/page.html | sort -u
grep -c 'mg-questionnaire-footer' "$RUN"02-after-enable/page.html
# agreements: the terms checkbox hook and the Agree button hook
grep -o 'p6ntest-mp-agreements-body-tos-checkbox\|data-prober="cloud-marketplace-request-product"\|<mp-agreements-tos' "$RUN"05-agreements-checked/page.html | sort | uniq -c
```

| Page | Anchors in `selectors.js` | Where the map describes them |
|---|---|---|
| model | `vertex-ai-request-access-button button` with trimmed text `Enable`, else the button reading `Enable` inside `vai-model-garden-call-to-action-button-stack` (never one elsewhere on the page); `vertex-ai-open-generation-ai-studio-button` or the text `Open in Agent Studio` (already enabled); `apis-enabler` or the h1 `Enable APIs` (the dialog); path `/agent-platform/publishers/anthropic/model-garden/`, with the stack as the page's DOM-side shell | "Page 1: model page", "Conditional: Enable APIs dialog" |
| questionnaire | `raf-runtime-form-element[raf-name=...]` for `businessName`, `businessWebsite`, `contactEmailAddress`, `businessHeadquarterSelect`, `industrySelect`, `intendedUserSelect`, `intendedUseCasesSelect`, `hasAdditionalRequirements`, `additionalRequirements`; `cfc-select` dropdowns (their `.cfc-select-trigger` and `.cfc-select-option-primary` classes live in `content/dom.js`, which handles how a control registers a value); the button `Next` inside `cfc-panel-footer.mg-questionnaire-footer` (or any `.mg-questionnaire-footer` element; never one elsewhere); URL parameters `model=` and `mp=`; `raf-form[raf-entry-name="RequestAccessFormGroup"]` or the footer as the page's DOM-side shell | "Page 2: questionnaire" |
| agreements | `mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox`, else `mp-agreements-tos` (its closest `mat-checkbox`), else the one `mat-checkbox` inside `billing-integrated-ai-agreements-body`; `button[data-prober="cloud-marketplace-request-product"]` or `aria-label^="Agree to the terms"` (no text locator for Agree); `mp-consent-complete-dialog` (success), `behavior-failure-dialog` (error); path `/marketplace/agreements/anthropic/`, with `billing-integrated-ai-agreements-body` or `mp-agreements-tos` as the page's DOM-side shell | "Page 3: Agreements", "After Agree" |
| dialogs | `mat-dialog-container`, or any element with `role="dialog"` and `aria-modal="true"`; a non-modal `role="dialog"` (a drawer, a survey panel) blocks nothing, and every refusal or panel note names the element that matched | "Conditional: Enable APIs dialog", "After Agree" |

Rules that held on every recorded page: generated ids (`_0rif_...`,
`_1rif_...`) are never used; button text is padded (`" Enable "`) and is
trimmed before comparison; overlays render into
`body > div.cdk-overlay-container`; the dialog's own Enable button is never
confused with the model page's.

A difference between the dump and the map is the thing to fix. A locator
that no longer matches ends the job with a message that names the page and
the locators it tried (for example `the Agreements page rendered
(billing-integrated-ai-agreements-body or mp-agreements-tos is present) but
the terms checkbox (...) was not found within 45 s`), and a page whose shell
renders under a URL path the extension does not know fails after two polls
naming the page and the path, so the first failed job already says which
row of the table to look at.

## 4. Update the map, then the selectors

Keep the order the header of `selectors.js` states: the map first, then the
selectors, then the tests. Add the run to the table at the top of
`docs/dom-map.md` with what it showed, and change the section that
describes the anchor. Then change the one function in `selectors.js` that
uses it. A renamed hook, as a diff:

```diff
   S.questionnaire = {
     businessName: function () {
-      return rafInput("businessName");
+      return rafInput("companyName"); // renamed by the console; dom-map.md, run <timestamp>
     },
```

Where things live when the change is not a locator:

| What changed | File |
|---|---|
| A URL path (`/agent-platform/...`, `/marketplace/agreements/anthropic/`) | `extension/common/constants.js` (`MODEL_PATH_PREFIX`, `QUESTIONNAIRE_PATH`, `AGREEMENTS_PATH_PREFIX`); `python/mgclick/urls.py` for the harness |
| The option texts of a dropdown | `extension/common/option-lists.js`; the extension log line `select "headquarters" offers N options: ...` lists what the console offered |
| How a control registers a value (events, classes) | `extension/content/dom.js`; the Python counterpart is `python/mgclick/form.py` |
| A timing (a page that renders slower) | the defaults in `extension/common/constants.js` and the table in `extension/README.md` |

`run.sh` checks that `unguardedClick()` and `agreeButton()` are consumed
only inside `clickAgreeGuarded()`. Do not add a second path to the Agree
button while repairing a selector.

## 5. Run the offline suite against the new dumps

```sh
cd extension/test && npm ci && cd ../..    # once; installs jsdom from the committed lockfile
sh extension/test/run.sh
```

`run.sh` runs `node --check` on every extension file, greps the Agree
guard, then runs nine test files. The page tests build a jsdom window from
`page.html` of a recorded run, restore the values from `forms.json`, load
the content scripts into it and call the selectors and handlers. Every
check prints one line:

```text
ok   <what held>
FAIL <what did not> -> <detail>
skip <what was not run> (no run of shape B under python/recon)
```

The last line is `ALL TEST FILES PASSED` or `SOME TESTS FAILED`. A `skip`
is never a pass: after a console change, make sure the shapes that matter
ran as `ok`.

### Run letters

The tests do not look for a run by name. `findRun()` in
`extension/test/lib/env.cjs` walks `python/recon/`, newest first, and picks
the first directory whose shape matches the letter:

| Letter | Shape (what `findRun` tests for) | How to record it |
|---|---|---|
| A | `05-agreements-checked/page.html` present, no `06-after-agree`, no `00-gallery` | `recon.py` on a project where the model is not enabled (section 2) |
| B | `01-model-page-api-dialog/page.html` present | `recon.py` on a project where the Agent Platform API is not enabled yet; the dialog is dumped and its Enable clicked |
| C | `01-model-page/page.html` present and `timing.json` holds `"state": "enabled"` | `recon.py` on a project where the model is already enabled; the script stops at once |
| D | `07-post-agree-settled/page.html` holds `behavior-failure-dialog` | `recon.py --i-approve-agree` on a project whose billing account cannot buy. This is the one shape that needs an Agree click. It is not part of this loop; keep the existing dump, and re-record it only by a deliberate decision when the post-Agree dialogs themselves changed |
| E | `01-model-page/page.html` present, no `02-after-enable`, and the page holds `<mat-checkbox` | `recon.py --model <slug>` on a model whose page renders a consent checkbox next to a disabled Enable; the run fails before step 02, which is the dump the test needs |
| F | `00-gallery` present with `03-model-page/page.html` | `python/scripts/gallery_recon.py --project <project-id>` (defaults: `--model claude-sonnet-5`, `--title "Claude Sonnet 5"`, `--query "claude sonnet 5"`), which reaches a model page through the gallery's own search box |

To pin a run instead of taking the newest, name its directory (not its
path) in `MGC_RUN_<letter>`:

```sh
MGC_RUN_A=<timestamp>-<project>-claude-haiku-4-5 sh extension/test/run.sh
```

Shape A is the one a selector repair needs first; the others matter when
the dialog, the enabled state, the error dialog, the consent page or the
gallery changed. Old dumps of a shape that did not change are still valid
fixtures.

## 6. Run the extension once in a browser

The offline suite cannot click through the live console. One end-to-end
dry run does, with the extension loaded unpacked into the dedicated profile.

```sh
python/.venv/bin/python python/scripts/ext_dryrun.py --projects <project-id> --models claude-haiku-4-5 --expect <project-id>=dry-run
```

Flags from `ext_dryrun.py --help`: `--projects` (required, comma-separated),
`--models` (default `claude-haiku-4-5`), `--expect PROJECT=STATUS` (pins
`dry-run` or `skipped` for a project; repeatable), `--step-by-step` (ticks
the step-by-step box; the script presses Continue before Next and Next job
on the dry-run end panel with trusted clicks and checks the log for the
panel lines), `--timeout-min` (default 8), `--chrome-major` (the Chrome for
Testing version for attempt b), `--attempts` (default `ab`), `--profile`,
`--config`, `--out`, `--download-dir` (where the Runs page's downloaded
log lands; default `<out>/downloads/`).

What the script does, in order: deletes the profile's cached service worker
so the worker on disk runs; starts a browser that loads the extension
(attempt a is branded Chrome, which 137+ ignores, so attempt b is Chrome
for Testing of the same major version on the same profile); checks the
running worker reports the manifest version on disk; checks the profile is
signed in; fills the options page from `config.local.json` with DRY RUN
ticked and verifies `live_mode=false` in storage; starts the run from the
popup page and refuses unless the banner reads `MODE: DRY RUN`; polls the
results with a screenshot per phase; evaluates; opens the Runs page at
900 x 700 (`runs-900x700.png`), checks the run is listed first with its
log size and clicks its Download log, checking the saved text file; drains
the browser console.

What you see at the end:

```text
job  project                          model              status      message
1    <project-id>                     claude-haiku-4-5   dry-run     dry run: stopped on the Agreements page with the checkbox ticked; Agree was not clicked

PASS <project-id>/claude-haiku-4-5: expected status 'dry-run' with 'checkbox ticked' in the message; got 'dry-run' - '...'

evidence: python/recon/ext-<timestamp>
```

Exit codes: 0 every expectation held; 1 a job ended differently; 2 a config
or extension problem; 3 the profile is signed out or no browser could load
the extension (run `login.py` again). The evidence directory holds
`extension-log.txt`, `results.json`, `console-log.txt`, a screenshot per
phase and the popup and options pages at a few window sizes. At the end
the script drains the browser console of the worker tab, the popup page
and the options page and fails (exit 1) on any SEVERE entry from the
extension's own scripts or pages (`chrome-extension://` source), printing
them; SEVERE noise from the console page itself is printed as a note only.
The service worker's console is not in that log (the offline harness
covers the worker), so the script also fails on any error-level line in
the run's log (the storage log and the downloaded run log): the extension
logs every error it catches at that level (a tick that threw, a handler
that threw something other than a timeout, a worker message handler that
threw, a failed delete), and the content script's tick errors go to the
browser console with `console.error` as well.

Run it a second time with `--step-by-step` only when the panel code or the
questionnaire handler changed. If anything under `popup/` or `options/`
changed, run the headless layout probe too; it measures the popup at
800 x 600, loads the options page, and fails on any SEVERE browser console
entry from either page, printing them:

```sh
python/.venv/bin/python python/scripts/popup_layout.py all
```

## 7. Bump the version and tag

The Chrome Web Store refuses a version it has already seen, and the release
workflow refuses a tag that does not match the manifest.

1. Set `"version"` in `extension/manifest.json` to the next number.
2. Update "Package version" at the top of `store/LISTING.md`.
3. Run `sh extension/test/run.sh` once more.
4. Check `git status --short`: nothing under `python/recon/`,
   `python/.chrome-profile/` or `python/config.local.json` may appear.
5. Commit, tag and push:

```sh
git add extension docs store python/README.md
git commit -m "Repair the console selectors after the change of <date>"
git tag v<version>
git push origin main v<version>
```

`.github/workflows/release.yml` runs on the tag: it checks that the tag
equals the manifest version, installs the test dependencies from the
committed lockfile (`npm ci`) and runs the offline suite with
`MGC_ALLOW_SKIP=1` (the recon dumps are not in the repository, so the
dump-based checks skip there; a failed check fails the release), then runs
the two dump-independent suites (`worker-harness.mjs`, `ui-pages.cjs`) a
second time under a strict wrapper that fails on a non-zero exit, on a
missing summary line and on any skipped check, then runs
`scripts/build-extension-zip.sh` and
attaches `dist/model-garden-clicker-<version>.zip` to a GitHub release.
Then upload that zip to the Chrome Web Store by hand; `store/CHECKLIST.md`
walks the dashboard tabs.
