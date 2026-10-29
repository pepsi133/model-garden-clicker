# Scoping 03: open the popup from a link, with the project and the models filled in

> **Decision note.** Form B dropped in 0.9.0 (owner decision 2026-10-13): did not work in the owner's test; not pursued. Only form A ships: `chrome-extension://fmfhgpbcpacoddjpfemghhpinhodcglp/popup/popup.html?tab=1&v=1&projects=p-a,p-b&models=latest` (the Chrome Web Store id; an unpacked copy has another id). The content-script fragment reader and its watcher, the worker's `MSG.DEEP_LINK` handler, `KEYS.PENDING_LINK`, the 2-second window, the 10-minute expiry, the refusal-log window and the parser's `mgc` key and `;` separator are removed. A console page with `#mgc=` in its URL is now left alone (`main-loop.cjs` M6; `worker-harness.mjs` section 31). The form B analysis below is kept as history and marked **[dropped]**.
>
> **Decision note (2026-10-29).** The project cap was raised from 23 to 200 and the raw-length cap from 4,096 to 16,384 characters; the settings import gained a separate 8,192-character cap for the joined project and model lists (`MGC.CONFIG_LIST_MAX`), so the count cap still fires before the length caps. The model cap stays 13. The numbers below are the 0.9.0 history.

Date: 2026-10-13. Repository state: branch `claude/trusting-feynman-a7kvdo`, after the "latest" link (scoping 01, Phase 0).
Status: reviewed on 2026-10-13 (the section below). The feature is built on branch `claude/deep-links`, smaller than the scoping proposed. The sections after the review are the historical scoping and keep the proposals the review removed.

## Summary

A deep link is a URL that opens the extension with inputs already filled in. The idea: a person clicks a link in a browser that has the extension installed. The popup opens in a tab with the project IDs entered and the models ticked. The link names the models, or it leaves them out and the extension ticks a default set. The link never starts a run. The person reads the filled form, sees that it came from a link, and presses Start.

**[dropped: form B]** Proposed path: a normal `https://console.cloud.google.com/...` link that carries the inputs in its fragment. The content script that already runs on the console reads the fragment. The service worker validates the inputs and stores them. The popup opens in a tab with the form filled. A second, cheaper form of the same feature is a `chrome-extension://fmfhgpbcpacoddjpfemghhpinhodcglp/popup/popup.html?...` URL for bookmarks and the address bar.

## Feasibility review (2026-10-13)

Reviewed against `extension/manifest.json`, `extension/common/constants.js`, `extension/popup/popup.js`, `extension/background/service-worker.js`, `extension/content/main.js`, `extension/test/worker-harness.mjs` and `extension/test/ui-pages.cjs` as of commit f77ac93.

### Verdict: build smaller

The feature is feasible without a manifest change. The parser, the worker handler, the content script hook and the popup fill map onto code that exists. The scoping proposed five things that the review removes, each for a reason in the code or the platform:

| Proposal in the scoping | Decision | Reason |
|---|---|---|
| A `note` key shown in the banner | Out (D2) | Free text in a link is a social-engineering vector. The banner would show attacker text next to the extension's own words. |
| A "Default models for links" setting | Out (D2) | One more stored value that changes what a link means per machine. `latest` and an absent `models` cover the need. |
| Unknown keys are ignored and named in the banner | Refused (D2) | An ignored key is a key the person did not see validated. The whole link is refused with one reason. |
| A link during a run is stored and shown after the run | Dropped (D4) | A stored link outlives the run and the person's memory of it. One log line, nothing stored, no tab. |
| **[dropped: form B]** "Survives the sign-in redirect, because the console carries the full URL in `continue=`" | Not claimed | A fragment never reaches the server, so the server-built `continue=` URL cannot carry it. Form B is for a signed-in console. This machine cannot sign in, so the claim stays untested. |

Four more facts from the code bound the build:

1. `chrome.action.openPopup()` is out. It needs Chrome 127, the manifest sets `minimum_chrome_version` 116, and it takes no parameters. A link opens `popup/popup.html?tab=1` in a tab with `chrome.tabs.create`, the path `openInTab` already uses (`extension/popup/popup.js:44-48`).
2. **[dropped: form B]** The content script runs at `document_end` (`extension/manifest.json`), not at document start as the scoping's file table said. It reads `location.hash` once when it loads. The console is a single-page application and may rewrite the URL before `document_end`. The offline suite cannot prove the console keeps the fragment that long. One manual check in a signed-in browser is required before the feature is announced in the store listing. The Model Garden gallery writes the fragment back about 6-8 s after load: its router calls `history.replaceState` with a URL it read while the fragment was still there (measured 2026-10-13, 6.6 s). A watcher in the content script (`keepLinkFragmentOut`, `extension/content/main.js`) checks the URL every `URL_POLL_MS` (250 ms) in a document that carried a link and strips a fragment that comes back, keeping the console's history state; it never sends the link again. The remaining narrow case: a reload within 250 ms of the write-back can open a second tab, and that tab still goes through the confirm.
3. The deep-link path in the popup runs only under the tab layout. The action popup has no query string, so a link never reaches it (`detectLayout`, `extension/popup/popup.js:40-42`). The `window.confirm()` of D3 therefore always runs in a tab page. The action popup already uses `confirm()` for the mode switch (`toggleMode`, `:65-76`), so no new dialog kind is introduced.
4. **[dropped: form B]** `fromExtensionPage` and the job-message checks already rely on `sender.url` and `sender.tab` (`extension/background/service-worker.js:773-788`). The D5 checks reuse that shape. The harness's fake sender carries no `id` (`extension/test/worker-harness.mjs:48-51`), so the harness gains `chrome.runtime.id` and the new checks pass a sender with `id`, with a control case that a sender without `id` is refused.

### Answers to the open questions

| Question | Answer |
|---|---|
| 1. Form B without the extension id in it | **[dropped: form B]** Yes. Form B is the shareable link. Form A is the bookmark form (D1). |
| 2. Form A from web pages | No. `popup/popup.html` stays out of `web_accessible_resources`. The manifest keeps its permissions exactly as they are (D1). |
| 3. Default when `models` is absent | Nothing is ticked. The banner says so (D2). |
| 4. "Default models for links" setting | No (D2). |
| 5. `chrome.action.openPopup()` first | No. A tab, always (fact 1 above). |
| 6. Banner until Start or until the first edit | Until Clear, Start or the page closes. The banner says where the values came from. It does not claim they are unchanged. |
| 7. A `note` key | No (D2). |
| 8. Links in the GitLab inventory artifact | Not in this build. Scoping 02 can emit form A links later (form B was dropped). The format here is the contract. Implemented 2026-10-29: `mg_inventory.py` writes `deep-links.md` (one link per pending project and chunked links for all pending projects, at most 200 per link). |

### Decisions D1 to D6

- D1. Forms A and B only (**[dropped: form B]**; form A only since 0.9.0). `chrome-extension://fmfhgpbcpacoddjpfemghhpinhodcglp/popup/popup.html?tab=1&v=1&projects=p-a,p-b&models=latest` and `https://console.cloud.google.com/...#mgc=v1;projects=p-a,p-b;models=latest`. No `web_accessible_resources`, no `externally_connectable`, no `omnibox`, no custom scheme.
- D2. Keys are exactly `v`, `projects`, `models`. Any unknown key, a repeated key, a missing or wrong `v`, an invalid project id (`MGC.isValidProjectId`), an invalid slug (`MGC.isValidModelSlug`), more than 23 projects, more than 13 models or a raw link longer than 4096 characters refuses the whole link with one reason. Nothing is filled. `models` may be absent (nothing ticked, the banner says so), `latest` (`MGC.latestModelSlugs` over the rendered list) or a comma list of slugs. A slug not in `models.json` goes to the extra-slugs field, as the settings import does.
- D3. Before the form is filled the popup page shows a `window.confirm()` built from validated values only: the number and the list of project ids, the model slugs (or `latest` resolved to its slugs, or "no models"), and that nothing starts until Start is pressed. Cancel leaves the form as it was and discards the link. OK fills the textarea and the checklist and shows a banner "Filled from a link" built with `textContent`, with a Clear button.
- D4. While a run is active an incoming link is dropped with one log line (form A: one error line in the popup). **[dropped: form B]** The pending link for form B lives in `chrome.storage.local` under one new key `KEYS.PENDING_LINK` as `{ token, raw, receivedAt }`. `token` is `crypto.randomUUID()`. The popup reads the record under that fixed key, compares `record.token` with its own `?link=` value by string equality, deletes the record at once and refuses a record older than 10 minutes. The worker drops a pending record older than 10 minutes when a new link arrives and at worker start. The worker opens exactly one tab per accepted link and drops a second link within 2 seconds.
- D5. **[dropped: form B]** The content script reads `location.hash` once per document, only when `location.origin` is `https://console.cloud.google.com`, and only when the hash starts with `#mgc=`. It sends `{ type: MSG.DEEP_LINK, raw, length }` once, with `raw` the first 4096 characters and `length` the full length, then removes the fragment with `history.replaceState(history.state, ...)`. The Model Garden gallery writes the fragment back about 6-8 s after load: its router calls `history.replaceState` with a URL it read while the fragment was still there (measured 2026-10-13, 6.6 s). A watcher in the content script (`keepLinkFragmentOut`, `extension/content/main.js`) checks the URL every `URL_POLL_MS` (250 ms) in a document that carried a link and strips a fragment that comes back, keeping the console's history state; it never sends the link again. The remaining narrow case: a reload within 250 ms of the write-back can open a second tab, and that tab still goes through the confirm. The worker verifies `sender.id === chrome.runtime.id`, that `sender.tab` exists, and that `sender.url` parses with `origin === "https://console.cloud.google.com"`, before it parses anything. The content script does no parsing and no DOM work for this. The manifest injects the content script into the top frame only (no `all_frames`), so a frame on another origin never sends.
- D6. `MGC.parseDeepLink(raw)` in `extension/common/constants.js` returns `{ ok, error, projects, models, latest, dropped }`. It is pure. It splits on `&` or `;` (`&` only since 0.9.0; `;` and the `mgc` key were form B's) before it decodes, percent-decodes every key and value with `decodeURIComponent` inside a try/catch, refuses on a decode failure, and compares keys against a fixed list, never by object lookup. The `projects` and `models` values go through `MGC.parseConfig({ popup: { projects, models } })`, so the validators and the length cap are shared. Only `textContent` puts text into the page. Nothing from a link is used as a URL, an HTML attribute, a storage key, a selector, a RegExp source or an argument to `eval`, `Function` or a string `setTimeout`.

Two refinements inside the decisions:

- **[dropped: form B]** The content script sends the original `length` with the capped `raw` (D5). Without it, a link cut at 4096 characters could end on a comma and read as a shorter valid link. The worker refuses when `length` is above 4096 before it parses.
- **[dropped: form B]** The worker stores the raw link, not the parsed values, after its own parse succeeded (D4). The popup parses the stored raw string again with the same function. Form A and form B then share one code path in the popup: `parseDeepLink` → confirm → fill. Storage is the extension's own, so this is defence in depth, not a trust boundary.

### Threat model

Entry points, the attacker goal at each, the control under D1 to D6, and the test that proves the control. Test ids: P = parser checks in node (`extension/test/deep-link.cjs`), W = `worker-harness.mjs`, U = popup in jsdom (`ui-pages.cjs`), M = content script (`main-loop.cjs`), S = static check on the source (`ui-pages.cjs`).

| Entry point | Attacker goal | Control | Test |
|---|---|---|---|
| Crafted popup query string (form A), from the address bar or a bookmark | Start a run | The popup only fills the form. Start keeps its guards (`projectIds()`, `selectedModels()`, the full-run confirm, the worker's checks). No link key maps to a click. | U1, U2, S1 |
| Same | Change the mode, step-by-step, include-done, the questionnaire or the timing | The parser knows three keys (D2). The fill touches `#projects`, `#models` and `#extra-models` only. `settings`, `timing` and `include-done` are not read or written on the link path. | P1, U3 |
| Same | Inject text or HTML into the page | Values that reach the page passed `isValidProjectId` or `isValidModelSlug` (ASCII only). The banner and the confirm use `textContent` and string concatenation into a dialog. `popup.js` stays free of `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write`. | P2, U4, S2 |
| Same | Fill the action popup, where a dialog is awkward | The link path runs only under the tab layout. The action popup has no query string. | U5 |
| **[dropped: form B]** Same, with `?link=<token>` and link keys together | Confuse the two paths | Both present refuses the whole thing with one reason. | U6 |
| **[dropped: form B]** Crafted console fragment (form B) | Start a run, change a setting | The content script sends the raw string only. The worker parses with the same function as form A. The popup path is the same as form A. | M1, W1 |
| **[dropped: form B]** Same | Open many tabs | One tab per accepted link. A second link within 2 seconds is dropped. The fragment is read once per document and removed, so a reload does not fire it again. The gallery writes it back about 6-8 s after load; the content script's watcher strips it again within 250 ms without sending the link. Residual: a reload within 250 ms of that write-back can open a second tab, which still goes through the confirm. A looping page must sit on the console origin, which is Google's. Residual: a console redirect loop that keeps a fragment would open one tab per 2 seconds while the person stays on it. | W2, M2, M5 |
| **[dropped: form B]** Same, on a page that is not the console | Send a link from another site | The content script runs only on `https://console.cloud.google.com/*` (manifest) and checks `location.origin` again. The worker checks `sender.url`'s origin. | M3, W3 |
| **[dropped: form B]** A message to the worker from a web page or another extension | Fake a link, open tabs | No `externally_connectable`, so `chrome.runtime.onMessage` never receives a message from outside the extension. `sender.id === chrome.runtime.id`, `sender.tab` present and the exact origin `https://console.cloud.google.com` are checked before any parse. `console.cloud.google.com.evil.example` and `http://console.cloud.google.com` fail the origin comparison. An extension page (the popup in a tab) is refused as a sender of this message. | W3, W4, S3 |
| **[dropped: form B]** A stale pending-link record in storage | Fill the form later, persist across reloads | The record holds a random token. The popup accepts it only with a matching `?link=` token, deletes it at once and refuses a record older than 10 minutes. The worker drops an old record when a new link arrives and at start. A second accepted link replaces the record, so an earlier tab finds no match and shows one refusal line. | W5, U7 |
| A link while a run is active | Change the queue, start a second run, be shown later | Dropped inside the serialized chain with one log line. No tab, nothing stored. `KEYS.RUNNING` is read in the same turn as the decision. | W6 |
| Repeated links, or a repeated key in one link | Open tabs, override an earlier value | A repeated key refuses the whole link (D2). The 2-second limit lives in the worker's memory inside the serialized chain. | P3, W2 |
| A link with 23 projects or 13 models | Fill a queue the person does not read | 23 and 13 are accepted. 24 and 14 are refused. The confirm names the count, the first 16 ids and how many more; every id is in the textarea and the banner after OK. The pair line and the full-run confirm count the pairs as they do today. | P4, U8 |
| A link longer than 4096 characters, or cut at 4096 | Read a cut link as a shorter valid one | The popup refuses on `location.search.length`. The content script sends `length`. The worker refuses on `length` before it parses. | P5, W7, M4 |
| Unicode and percent-encoding tricks | Pass the validators, crash the parser, inject | `decodeURIComponent` in a try/catch: a bad sequence refuses. Decoding happens once, after the split, so `%3B`, `%26`, `%2C` and `%3D` in a value cannot add a key or an id. Double encoding (`%2541`) decodes to `%41`, which fails the regexes. Non-ASCII, a NUL, a newline, a space and `+` fail the regexes. `__proto__` and `constructor` are unknown keys. | P2, P6 |
| A project id that looks like another id | Enable a model in the wrong project | Confusable letters are not in `[a-z0-9-]`, so they are refused. The confirm and the banner list every id verbatim, and the person compares them with the ticket. A valid id that is simply wrong is the same risk as a typed id, and the run's own project check (`assertMayAct`) still applies. | P7, U9 |
| `models=latest` on a machine with a different `models.json` | Tick a model the sender did not mean | `latest` resolves over this machine's rendered list. The confirm and the banner name the resolved slugs, never the word `latest` alone. The stored selection holds concrete slugs. A list with no latest set ticks nothing, and the banner says so. | U10 |
| A slug not in `models.json` | Hide a model in the extra field | The slug goes to the extra-slugs field, which Start reads, and the confirm and the banner name it as "extra". | P8, U11 |
| Any link | Exfiltrate the questionnaire values | The content script reads the hash only. The worker's reply to `MSG.DEEP_LINK` is `{ ok }` or `{ ok: false, error }` with no stored data. The popup builds no URL and no request from link values. Form A is unreachable from a web page. | W8, S4 |
| Any link | Change the manifest's reach | The manifest is unchanged: the same `permissions`, `host_permissions`, no `web_accessible_resources`, no `externally_connectable`, no `omnibox`. | S5 |

### Test list

Every check has a control case in the "ok/FAIL" style of the suite. The offline suite must pass with `MGC_ALLOW_SKIP=1 sh extension/test/run.sh`, with `node extension/test/worker-harness.mjs` and `node extension/test/ui-pages.cjs` each printing "CHECKS PASSED (" with 0 skipped, and with the guard md5 line unchanged.

Parser (P), `MGC.parseDeepLink` in node:

- P1. `v=1&projects=p-one-1` is ok with one project, no models, `latest` false. `projects=p-one-1` without `v`, `v=2&...`, `v=1&projects=p-one-1&x=1`, `v=1&projects=p-one-1&note=hi`, `v=1&projects=p-one-1&models=latest&models=latest` and `v=1&projects=p-one-1&v=1` are each refused with one reason that names the key. Control: the ok case fills every field of the result.
- P2. Each of these refuses: a project id with an upper-case letter, with a Unicode confusable (`р` U+0440), with `%00`, with a newline, with a space, with `+`, with `%2541`, with a bad sequence (`%E0%A4%A`), and a slug with `<`. Control: `p-one-1` and `claude-haiku-4-5` pass.
- P3. A repeated key refuses. `;` and `&` both separate pairs (since 0.9.0 only `&` does; `;` and `mgc=v1` are refused). `%3B` and `%26` inside a value stay in the value and the value is refused by the id regex. `%2C` in a value does not split an id.
- P4. 23 projects pass, 24 refuse. 13 models pass, 14 refuse. The counts in the result match.
- P5. A raw string of 4096 characters that is otherwise valid passes. 4097 refuses before any other check.
- P6. The keys `__proto__`, `constructor` and `hasOwnProperty` refuse as unknown. The result object has no prototype pollution (`({}).polluted` is undefined after the parse).
- P7. `projects=p-one-1,p-one-1` is refused (a repeated id), and `projects=p-one-1,P-ONE-1` is refused (the case rule), so one link cannot name a project twice under two spellings. Control: two distinct ids pass.
- P8. `models=claude-haiku-4-5,my-own-slug` with the packaged `models.json` returns `models` `[claude-haiku-4-5]` and `dropped` (the extra slugs) `[my-own-slug]`. `models=latest` returns `latest` true and an empty `models` list (the popup resolves it).

Worker (W), `worker-harness.mjs` (**[dropped: form B]**; since 0.9.0 section 31 checks that the old `mgc:deep-link` message is an unknown type that opens no tab and stores nothing):

- W1. `MSG.DEEP_LINK` with a valid raw string from a content-script sender (`id` the runtime id, `tab`, console URL) stores `{ token, raw, receivedAt }` under `KEYS.PENDING_LINK`, creates exactly one tab at `popup/popup.html?tab=1&link=<token>`, and replies `{ ok: true }`. The token is the record's token. Control: `tabs.create` count went up by one.
- W2. A second valid link 1 second later is dropped: no new tab, the record is unchanged, one log line. A third link after 2 seconds is accepted and replaces the record (new token). A link with a repeated key is refused with the reason in the reply and no tab.
- W3. Each of these is refused before any parse, with no tab and nothing stored: a sender without `id`, a sender with another `id`, a sender without `tab`, a sender whose URL is `https://console.cloud.google.com.evil.example/`, `http://console.cloud.google.com/`, `https://evil.example/#mgc=...` and the extension's own `popup.html?tab=1`. Control: the valid sender from W1 is accepted again after the 2-second window.
- W4. A message with `raw` that is not a string, or with no `raw`, is refused.
- W5. A stored record with `receivedAt` 11 minutes ago is deleted when a new link arrives, and at worker start (the `recoverUnsafe` path). A record 9 minutes old at start stays.
- W6. With `KEYS.RUNNING` true, a valid link is dropped: no tab, no record, one log line that says a run is active.
- W7. `length` 4097 with a 4096-character `raw` is refused before any parse. `length` 4096 passes.
- W8. The reply to every refused and every accepted `MSG.DEEP_LINK` carries only `ok`, and `error` on a refusal. No settings, no queue, no log.

Popup in jsdom (U), `ui-pages.cjs`, with `win.confirm` replaced by a recorder:

- U1. `popup.html?tab=1&v=1&projects=p-one-1,p-two-2&models=claude-haiku-4-5`: the confirm text names 2 projects, both ids and the slug and says nothing starts until Start. On OK the textarea holds the two ids, the one box is ticked, the banner reads "Filled from a link" with the ids and the slug, `popup_state` holds them, and `store.__messages` carries no `MSG.START`. Control: Start is still a button the person must press (`#start` not disabled, no message sent).
- U2. The same link with the confirm returning false: the textarea, the checklist, the extra field, `popup_state` and the banner are as they were before the load. No message was sent.
- U3. After U1, `store.settings` deep-equals the value before the load, `#include-done` is unchecked, and `KEYS.TIMING` is absent.
- U4. A link with `projects=p-one-1&models=%3Cb%3Ex` is refused: the error line names the reason with `textContent`, no element with tag `b` exists in the page, and the confirm was not called.
- U5. `popup.html?v=1&projects=p-one-1` (no `tab`): the layout is `popup`, the confirm is not called, the textarea is empty.
- U6. `popup.html?tab=1&link=abc&v=1&projects=p-one-1`: refused with one reason, confirm not called. (Since 0.9.0 `link` is an unknown key like any other.)
- U7. **[dropped: form B]** `popup.html?tab=1&link=<token>` with a matching record: the record is deleted before the confirm, the confirm names the stored values, OK fills. With a token that does not match, or a record 11 minutes old: one refusal line, the record is deleted, nothing filled.
- U8. A link with 23 projects: the confirm names "23 project(s)", the first 16 ids and "and 7 more"; the textarea and the banner hold every id after OK. The pair line reads `23 project(s) × 1 model(s) = 23 pair(s)`.
- U9. The confirm and the banner show each id verbatim, in the link's order.
- U10. `models=latest` with the packaged list: the confirm names the slugs `MGC.latestModelSlugs(currentModels).ticked` returns, the boxes are ticked, and the models note reads as the latest link's note. With a synthetic list where no entry carries a release date: nothing is ticked and the banner says "no models ticked".
- U11. `models=claude-haiku-4-5,my-own-slug`: the box is ticked, `#extra-models` holds `my-own-slug`, the banner names it as extra.
- U12. Clear: the textarea, the checklist and the extra field are empty, the banner is hidden, `popup_state` is saved empty. The settings are unchanged.

Content script (M), `main-loop.cjs` (**[dropped: form B]**; since 0.9.0 M6 checks that a console page with `#mgc=` sends nothing and keeps its URL):

- M1. A document at `https://console.cloud.google.com/x#mgc=v1;projects=p-one-1` sends exactly one `MSG.DEEP_LINK` with `raw` the hash and `length` its length, then `location.hash` is empty. A second tick sends nothing. Control: the sent message carries no other field.
- M2. A document whose hash is `#other` sends nothing.
- M3. A document at `https://evil.example/#mgc=v1;projects=p-one-1` sends nothing (the origin check in the script, with the manifest match as the first control).
- M4. A hash of 5000 characters sends `raw` of 4096 characters and `length` 5000.

Static (S), `ui-pages.cjs`:

- S1. `popup.js` has no call to the Start handler and no `MSG.START` on the link path (the deep-link function body does not contain `MSG.START`, `click()` on `#start`, or `send(`).
- S2. `popup.js` matches none of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` (the existing `runs.js` check, extended to `popup.js`).
- S3. **[dropped: form B]** `service-worker.js` reads `sender.id`, `sender.tab` and `sender.url` in the `MSG.DEEP_LINK` handler before `parseDeepLink` (a source-order check on the handler body).
- S4. `popup.js` (and, before 0.9.0, `service-worker.js` and `main.js`) do not pass any field of a `parseDeepLink` result into `chrome.tabs.create`, `URL(`, `fetch(`, `setAttribute(`, `querySelector(`, `RegExp(`, `eval(`, `Function(` or `setTimeout(` (a source scan over the link-path functions).
- S5. The manifest deep-equals the committed baseline on `permissions`, `host_permissions`, `content_scripts` and has no `web_accessible_resources`, `externally_connectable`, `omnibox` or `protocol_handlers`.

Manual, not in the offline suite:

- **[dropped: form B]** One signed-in browser check that the console keeps a `#mgc=` fragment until `document_end` and that the popup tab opens with the form filled. This machine cannot sign in. The owner ran it on 2026-10-13: form B did not work, and it was dropped.
- Optional Playwright check of form A with `launchPersistentContext` and the unpacked extension: open `popup/popup.html?tab=1&v=1&projects=p-one-1` under the unpacked copy's id, accept the dialog through `page.on("dialog")`, and read the textarea. The extension id comes from `context.serviceWorkers()[0].url()`. Done on 2026-10-13 in headless Chromium (Playwright 1.63.0, a throwaway profile, no sign-in): one `confirm` dialog with the counts, ids, slug and extra slug; OK filled the textarea, the checklist and the extra field and showed the banner with no run started; `models=latest` named the three resolved slugs; Cancel left the stored form as it was; a link with an encoded `<img>` and a `note` key was refused with no dialog and no element added; without `?tab=1` the popup layout ignored the link; and `mgc:deep-link` sent from the extension's own page was refused by the worker ("the sender is not on the console origin") with nothing stored and no tab. 12 of 12 checks passed. (The `mgc:deep-link` check no longer applies: the message type was removed with form B.)

## Problem

Today a run starts with three manual steps in the popup: paste the project IDs, tick the models, press Start. An operator who hands a request to a colleague has to write those values down in a message, and the colleague retypes them. A link that carries the values removes the retyping and the typos. Typical sources of such a link:

- a ticket or a runbook ("enable the latest Claude models in project X"),
- a chat message,
- the inventory artifact of the GitLab pipeline (scoping 02 writes `projects.txt` and a settings file; a link per project is one more output),
- a bookmark for a project that gets new models often.

## How the popup takes its inputs today

| Input | Where it lives | Code |
|---|---|---|
| Project IDs | `popup_state.projects`, one id per line in the textarea | `extension/popup/popup.js:252` (save), `:420-421` (restore), `extension/common/constants.js:24` |
| Ticked models | `popup_state.models`, concrete slugs | same |
| Extra slugs | `popup_state.extra` | same |
| Popup in a tab | `popup/popup.html?tab=1`, opened with `chrome.tabs.create` | `extension/popup/popup.js:41-46` |
| Import of a settings file | `MGC.parseConfig(obj)` validates `popup.projects` and `popup.models` | `extension/common/constants.js:466-542`, `extension/options/options.js:326-334` |
| Validation | `MGC.isValidProjectId`, `MGC.isValidModelSlug` | `extension/common/constants.js:582-589` |
| The latest set | `MGC.latestModelSlugs(list)` | `extension/common/constants.js` (scoping 01) |

Three facts shape the design:

1. The popup already runs as a normal tab page (`?tab=1`). A deep link opens that page, not the small popup window. Chrome offers `chrome.action.openPopup()` to extensions since Chrome 127, but it needs a focused window and gives no way to pass parameters. A tab is simpler and testable.
2. `parseConfig` already validates exactly the fields a link carries (`popup.projects`, `popup.models`). The link format can map onto that object, so the validation code is shared.
3. The content script already runs on every `https://console.cloud.google.com/*` page (`extension/manifest.json`). It can read a fragment on a console URL without a new permission.

## Link forms

| Form | Example | Works from | Needs | Notes |
|---|---|---|---|---|
| A. Extension page URL | `chrome-extension://fmfhgpbcpacoddjpfemghhpinhodcglp/popup/popup.html?tab=1&projects=p-a,p-b&models=latest` | the address bar, bookmarks, the omnibox | no manifest change | A web page cannot link to it unless `popup/popup.html` is listed in `web_accessible_resources`. The id is the store install's; an unpacked copy has another. |
| **[dropped]** B. Console URL with a fragment | `https://console.cloud.google.com/agent-platform/model-garden?project=p-a#mgc=v1;projects=p-a,p-b;models=latest` | any web page, chat, ticket, document | a fragment reader in the content script, one new message type, one worker handler | A plain https link. It survives the sign-in redirect, because the console carries the full URL in `continue=`. The fragment never reaches the server. |
| C. Extension messaging from a site | an internal portal page calls `chrome.runtime.sendMessage(<id>, {...})` | one allow-listed site | `externally_connectable` in the manifest | Useful for an organization portal only. Not a link a person can paste. |
| D. Custom scheme | `web+mgc://p-a/latest` | anywhere | not available | Chrome extensions cannot register a protocol handler through the manifest. Rejected. |
| E. Omnibox keyword | type `mgc p-a latest` in the address bar | the address bar | the `omnibox` manifest key | A complement to A, not a link. Optional. |

**[dropped: form B]** Proposed: build B as the feature and A as its free by-product (both resolve to the same popup URL). C and E are options for later. D is out.

## Link format

One format for A and B. Keys and values are URL-encoded. Unknown keys are ignored and named in the banner.

| Key | Value | Required | Meaning |
|---|---|---|---|
| `v` | `1` | yes | Format version. A link with another version is refused with a message. |
| `projects` | comma list of project IDs | yes | Each id must pass `isValidProjectId`. One bad id refuses the whole link. |
| `models` | comma list of slugs, or `latest`, or absent | no | Slugs must pass `isValidModelSlug`. A slug in `models.json` is ticked, any other goes to the extra-slugs field (the import does the same). `latest` ticks the latest set. Absent means the default set (below). |
| `note` | short text, at most 200 characters | no | Shown in the banner only ("ticket INC-1234"). Never used for anything else. |

In form A the keys are query parameters. **[dropped: form B]** In form B they sit in the fragment after `#mgc=` with `;` as the separator, so the console's own query string stays untouched. The `project=` query parameter of the console URL is not read: the link's own `projects` key is the input.

Default models when `models` is absent, in this order:

1. the "Default models for links" setting in the options page, when set (a saved list of slugs),
2. else the latest set (`MGC.latestModelSlugs` over the rendered list),
3. else nothing ticked, with a banner line that says so.

The stored last selection (`popup_state.models`) is never the default for a link, because a link must mean the same thing on every machine.

## Flow **[dropped: form B]**

```text
 link (form B)                      content script (console page)          service worker                     popup tab
 ------------                       -----------------------------          --------------                     ---------
 https://console.../#mgc=v1;...  -> reads location.hash once            -> MSG.DEEP_LINK {raw}              -> popup.html?tab=1&link=<token>
                                    sends the raw string, nothing else     parses and validates (parseConfig)   reads the pending link from storage
                                                                           stores { token, projects, models,    fills the textarea and the checklist
                                                                             extra, note, receivedAt }          shows the banner "Filled from a link"
                                                                           opens popup.html?tab=1&link=<token>  deletes the pending link
                                                                                                                 waits for Start
```

Form A skips the first two columns. The popup page reads its own query string, validates it with the same function and shows the same banner.

Rules that hold in both forms:

- A link fills the form. It never presses Start, never changes the DRY RUN setting, never ticks "Include pairs already done", never changes the step-by-step setting.
- The banner names what came from the link: the projects, the models, the extra slugs, the dropped keys, the note. It has a "Clear" button that empties the form.
- A link received while a run is active is stored and shown after the run, with a line in the status.
- The pending link lives in `chrome.storage.local` under one new key and is deleted when the popup reads it or after ten minutes.
- The content script reads the fragment once per document. It then removes `#mgc=` from the URL with `history.replaceState`, so a reload does not fire it again.
- The service worker counts links: a second link within two seconds is dropped (a page that loops on redirects must not open ten tabs).

## Security and safety

| Concern | Answer |
|---|---|
| A link makes a purchase | Never. The link ends at a filled form. Start, the DRY RUN banner, the full-run confirmation and the Agree guard are unchanged. |
| A link carries a questionnaire value or a setting | Refused by the format: only `projects`, `models`, `note` exist. `parseConfig` ignores `settings` and `timing` for a link. |
| A link injects text into the page | The banner is built with `textContent`, like the rest of the popup (the test suite forbids `innerHTML`). |
| A malicious page sends many links | The content script only reads the fragment of the console origin. The worker rate-limits. A link opens one tab. |
| A link hides a model the person did not want | The checklist shows every tick, the pair count line shows the total, the banner lists the models. The full-run confirmation lists extra and manual-step models (scoping 01). |
| Form A on a web page | Listing `popup/popup.html` in `web_accessible_resources` lets any matching site open it. Keep it out of the manifest for the MVP. Form A then works from the address bar and bookmarks only. |
| Form C | A site allow-listed in `externally_connectable` can message the extension at any time. Only for an organization portal, only after a review of that portal. Not in the MVP. |

## Changes per file (estimate)

| File | Change |
|---|---|
| `extension/common/constants.js` | `MGC.parseDeepLink(text)`: splits the keys, builds a `popup` object, calls `parseConfig`, returns `{ ok, errors, notices, values, dropped }`. A new `KEYS.PENDING_LINK` and `MSG.DEEP_LINK`. |
| `extension/content/main.js` | At document start on a console page: read `location.hash`, send `MSG.DEEP_LINK` once, clean the hash. About 20 lines. |
| `extension/background/service-worker.js` | Handler for `MSG.DEEP_LINK`: validate, store, open the tab, rate-limit. About 40 lines. |
| `extension/popup/popup.js`, `popup.html`, `popup.css` | Read `link=` or the query keys at init, fill the form, the banner with Clear. About 60 lines. |
| `extension/options/options.js`, `options.html` | "Default models for links" (a checklist like the popup's, or empty for the latest set). |
| `extension/manifest.json` | No change for the MVP. Form A from web pages and form C need keys, both deferred. |
| `extension/test/ui-pages.cjs` | Parse tests, popup fill tests, banner tests, "never starts" tests. |
| `extension/test/worker-harness.mjs` | Handler tests: valid link opens one tab, bad link is refused with a reason, rate limit, link during a run. |
| `extension/test/main-loop.cjs` | The content script sends once and cleans the hash. |
| `docs/`, `README.md`, `extension/README.md`, `CHANGELOG.md`, `store/LISTING.md` | The link format, the banner, the defaults setting. |

## Fit with the other scopings

- Scoping 01: `models=latest` reuses `MGC.latestModelSlugs`. The flags (manual step, deprecated) show in the checklist as usual.
- Scoping 02: the GitLab inventory job can write one link per pending project into its artifact. A reviewer clicks the link and lands on the filled form.

## Out of scope

- Starting a run from a link.
- Setting the mode, the timing, the questionnaire or the include-done box from a link.
- A custom URL scheme (not possible in Chrome).
- Links that open the options page or the Runs page.
- Links for the Python harness.

## Open questions for the owner

1. **[dropped: form B]** Is form B (a console URL with a fragment) acceptable as the shareable link, given that the extension id does not appear in it?
2. Must form A also work from web pages (needs `web_accessible_resources`), or from the address bar and bookmarks only?
3. Default when `models` is absent: the latest set, or an empty selection so the person always ticks by hand?
4. Is a "Default models for links" setting wanted at all, or is `latest` enough?
5. Must a link open the popup in a tab (proposed) or try `chrome.action.openPopup()` first and fall back to a tab?
6. Must the banner stay until Start, or disappear on the first edit of the form?
7. Is a `note` key useful, or is it one more thing to validate?
8. Must the GitLab inventory job (scoping 02) emit links in its artifact?

## Effort estimate

| Part | Estimate |
|---|---|
| Parser and shared validation, with tests | 0.5 day |
| Content script hook and worker handler, with tests | 0.5 to 1 day |
| Popup fill, banner, Clear, tests | 1 day |
| Options setting for default models | 0.5 day |
| Docs, changelog, store listing text | 0.5 day |
| Total | 3 to 3.5 days |
