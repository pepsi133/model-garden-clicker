# Chrome Web Store listing: Model Garden Clicker

**Re-paste needed.** The Description below was rewritten on 2026-10-08 as a
step-by-step walkthrough (same facts, same summary). If the dashboard still
holds the earlier text, paste the new Description into the Store listing tab
and save the draft.

Every field of the developer dashboard, ready to paste. Replace `https://github.com/pepsi133/model-garden-clicker`
with the public GitHub URL before pasting. Package version: 0.4.0
(`extension/manifest.json`).

## Store listing tab

### Title

    Model Garden Clicker

### Summary (131 of 132 characters)

    Enables Anthropic Claude models in the Google Cloud Model Garden for many projects. Fills the questionnaire with values saved once.

### Description (plain text, 3,683 characters, under the 4,000 limit)

    Model Garden Clicker enables Anthropic Claude models in the Google Cloud console Model Garden for many projects, one project and one model at a time, inside your own signed-in browser.

    Enabling a Claude model in a project means filling the model enablement questionnaire (business name, website, contact email, headquarters country, industry, intended users, use cases, Acceptable Use Policy answer) and then accepting the Marketplace agreement. There is no API for this flow, and doing it by hand for every project and every model is slow and error-prone. This extension does the clicking for you.

    ONE RUN, STEP BY STEP

    1. Open the options page and type the questionnaire values once. Click Save. They stay in this browser's local extension storage.
    2. Click the toolbar icon. Paste project IDs, one per line, and tick the models. Every project and model pair becomes one job.
    3. Click Start. One console tab opens and the jobs run in order. A dark badge in the corner of that tab shows the job, the current step with its timeout, and what comes next.
    4. For each job the extension opens the model page, clicks Enable, fills the questionnaire with your saved values, clicks Next and ticks the terms checkbox on the Agreements page.
    5. What happens then depends on the mode (below). The popup shows one result per job: dry-run, done, unverified, skipped (the model was already enabled), failed (with the reason) or stopped. The log keeps the last 50 lines.

    MODES

    DRY RUN is the default. The job stops on the Agreements page with the checkbox ticked. Agree is never clicked, so nothing is approved, purchased or enabled. Use it to check that the form is filled the way you want.

    FULL RUN is a separate setting: untick the DRY RUN box in the options page (or switch the popup's mode banner) and confirm again when you press Start. The extension then clicks Agree once per job. Agree accepts the publisher's terms and makes a Marketplace purchase that bills the project. Agree is clicked only when the page is the Agreements page of the job's own project, product and exact model version and the terms checkbox is verified ticked. The job is done when the console reports "Successfully purchased".

    Step-by-step confirmation works in either mode. The extension fills each page and waits for you: a panel in the console tab offers Continue and Stop before Next, and before Agree in a full run. In a dry run the panel ends with Next job and Stop. If you click the console's own button instead, the extension notices and continues.

    WHAT IT STORES

    Everything the extension stores (questionnaire values, the job queue, results and the log) lives in the local extension storage of this browser only. Nothing is synced to an account and nothing is sent to the developer or to any third party. The questionnaire values are typed into Google's own form on the console page, and nowhere else.

    WHAT IT NEEDS

    A Chrome profile that is signed in to the Google Cloud console with a role that can enable models in the projects you list. The extension asks for access to the console site only (https://console.cloud.google.com). It runs no remote code.

    LIMITATIONS

    Models whose page has extra consent controls are not supported yet; such a job fails with a message that names the manual step. The console pages change now and then; a selector that no longer matches makes the job fail cleanly instead of guessing.

    OPEN SOURCE

    Model Garden Clicker is an independent open-source tool released under the Apache License 2.0. It is not affiliated with, endorsed by or supported by Google or Anthropic. Source code, issues and the privacy policy: https://github.com/pepsi133/model-garden-clicker

### Category

    Developer Tools

Why: the extension is a utility for people who administer Google Cloud
projects; it automates a developer console workflow and has no general
browsing or UI purpose. "Functionality & UI" (seen selected on another item
in the dashboard) is for extensions that change how web pages look or behave
for everyone; this one acts on one developer console only. "Productivity" is
the fallback if Developer Tools is unavailable for the account.

### Language

    English

### Store icon

    store/icon-128.png (128x128)

### Screenshots (1280x800 PNG, RGB, no alpha; upload in this order)

    store/screenshots/01-popup-dry-run.png
    store/screenshots/02-options.png
    store/screenshots/03-step-by-step-panel.png
    store/screenshots/04-dry-run-agreements.png
    store/screenshots/05-popup-in-tab.png

### Small promo tile / Marquee promo tile

    store/small-promo-tile-440x280.png
    store/marquee-1400x560.png

### Additional fields

| Field | Value |
|---|---|
| Official URL | none (leave unset; it needs a verified site) |
| Homepage URL | `https://github.com/pepsi133/model-garden-clicker` |
| Support URL | `https://github.com/pepsi133/model-garden-clicker/issues` |
| Mature content | Off |
| YouTube video URL | none |

## Privacy tab

### Single purpose description

    Fills the Anthropic Claude model enablement questionnaire and accepts the Marketplace agreement in the Google Cloud console Model Garden, for each project and model the user queues, with values the user saved once.

### Permission justifications

| Permission | Justification (one sentence each) |
|---|---|
| `storage` | Keeps the questionnaire values, the job queue, the results and the log in the browser's local extension storage so the user types them once; nothing is synced or sent anywhere. |
| `alarms` | Runs a per-phase watchdog timer so a job that produces no result in ten minutes is marked failed and the run moves on, even while the service worker is idle. |
| Host permission `https://console.cloud.google.com/*` | The content script must read the Model Garden, questionnaire and Agreements pages and click their buttons in the user's signed-in console; no other site is touched. |
| Content scripts on the same origin | Same justification as the host permission: the page handlers run only on the console pages. |

### Are you using remote code?

    No

Justification field: leave empty, or write "n/a". Every script ships inside
the package; the extension loads nothing from the network.

### Data usage

Facts the answer rests on:

- The user types a business name, a business website and a contact email into
  the options page. The extension keeps them in `chrome.storage.local` and
  types them into Google's own questionnaire form on the console page on the
  user's behalf.
- Nothing is sent to the developer or to any third party. There is no server.
- On a failure the local log can hold a form value (the field name and what
  was rejected). The log stays in local storage and is never transmitted.

Recommended answer: tick **Personally identifiable information** and nothing
else. The dashboard's own definition of "collect" covers storing user-provided
data in the extension, and a name, an email address and a website typed by the
user are the examples it gives. Ticking the box with the explanation below is
the honest reading and costs nothing at review:

    The extension stores a business name, business website and contact email that the user types into its options page, in the browser's local extension storage only (chrome.storage.local). It types these values into the Google Cloud console questionnaire on the user's behalf. It does not transmit them to the developer or to anyone else.

Do not tick Health, Financial and payment, Authentication, Personal
communications, Location, Web history, User activity or Website content. The
extension reads the console page to act on it but keeps no browsing record and
sends no page content anywhere; the local log holds step names, option texts
of the questionnaire dropdowns and console error text, nothing more.

Alternative: leave every box unticked, on the reading that data kept in the
user's own browser and typed into a form the user is already filling is not
"collected". Risk: a reviewer who opens the options page sees an email field
and a storage permission, compares that with an empty disclosure, and rejects
the item for an inaccurate privacy disclosure; a rejection costs a full
re-review cycle. The recommended answer avoids that with a single tick.

### Certifications (tick all three; each statement is true)

- I do not sell or transfer user data to third parties, outside of the
  approved use cases. True: there is no transfer at all.
- I do not use or transfer user data for purposes that are unrelated to my
  item's single purpose. True: the values go into the questionnaire only.
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes. True.

### Privacy policy URL

    https://github.com/pepsi133/model-garden-clicker/blob/main/PRIVACY.md

## Test instructions for reviewers (the "Test instructions" field)

    Model Garden Clicker acts only on pages of https://console.cloud.google.com, inside a Google Cloud project that the signed-in user owns or administers. It does nothing on any other site.

    No test account is provided: a Google Cloud project with a billing account is needed to reach the Model Garden enablement flow, and a shared account would expose that billing account. Any Google Cloud project you own shows the same pages; no special test page is needed. The default DRY RUN mode lets you watch the whole flow without any purchase: the extension stops on the Agreements page and never clicks Agree.

    Steps:
    1. Install the extension and pin its icon. Sign in to https://console.cloud.google.com in the same Chrome profile with an account that can enable models in your project.
    2. Click the icon, then click Options. Fill the questionnaire fields with any values (a business name, a website starting with https://, an email, a country, an industry, intended users, a use case, and No for the Acceptable Use Policy question). Leave DRY RUN ticked. Tick "Step-by-step confirmation" if you want the extension to wait for you before each Next. Click Save.
    3. Click the icon again. The header reads MODE: DRY RUN. Paste one project ID into the text area. Tick one model, for example Claude Haiku 4.5. Click Start.
    4. The extension opens one console tab at the model's Model Garden page. A dark badge in the bottom-right corner shows the job, the current step with its timeout and what comes next. If the console asks to enable the Agent Platform API, the extension clicks that dialog's Enable button and continues.
    5. The extension clicks Enable, fills the questionnaire with the saved values and clicks Next. With step-by-step on, the badge becomes a panel with Continue and Stop; press Continue to let it click Next.
    6. On the Agreements page it ticks the terms checkbox and stops. The Agree button is never clicked in a dry run. The popup's results table marks the job "dry-run". If the model is already enabled in the project the job is marked "skipped" instead.
    7. Click Stop in the popup at any time to end a run. Nothing is purchased, approved or enabled in DRY RUN mode.

    To see the full run (optional, bills your project): open Options, untick DRY RUN, Save; the popup banner turns red and Start asks for a confirmation. In a full run the extension clicks Agree once per job and reports "done" when the console's "Successfully purchased" dialog appears.

    Source code: https://github.com/pepsi133/model-garden-clicker
