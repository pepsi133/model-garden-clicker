# Chrome Web Store upload checklist

Work through the developer dashboard tabs in this order. The text for every
field is in `store/LISTING.md`; the image files are in `store/` and
`store/screenshots/`.

## Before the dashboard

- [ ] Push `main` so
      `https://github.com/pepsi133/model-garden-clicker/blob/main/PRIVACY.md`
      resolves publicly (`PRIVACY.md` is committed at the repository root).
- [ ] Bump `"version"` in `extension/manifest.json` if 0.3.0 was already
      uploaded once; the store refuses a version it has seen.
- [ ] Build the package: `sh scripts/build-extension-zip.sh` writes
      `dist/model-garden-clicker-<version>.zip`.
- [ ] Pay the one-time developer registration fee if the account is new.

## 1. Package tab

- [ ] New item (first time) or open the existing item.
- [ ] Upload new package: `dist/model-garden-clicker-<version>.zip`.
- [ ] Check that the dashboard shows version, the three permissions
      (`storage`, `alarms`, host `https://console.cloud.google.com/*`)
      and no warning about the manifest.

## 2. Store listing tab

Text fields (copy from `LISTING.md`):

- [ ] Title: Model Garden Clicker
- [ ] Summary (131 characters)
- [ ] Description (plain text)
- [ ] Category: Developer Tools
- [ ] Language: English

Assets:

- [ ] Store icon: `store/icon-128.png` (128x128)
- [ ] Screenshots, in this order (1280x800, PNG, no alpha):
      `store/screenshots/01-popup-dry-run.png`,
      `store/screenshots/02-options.png`,
      `store/screenshots/03-step-by-step-panel.png`,
      `store/screenshots/04-dry-run-agreements.png`,
      `store/screenshots/05-popup-in-tab.png`
- [ ] Small promo tile: `store/small-promo-tile-440x280.png`
- [ ] Marquee promo tile: `store/marquee-1400x560.png` (optional)

Additional fields:

- [ ] Official URL: leave unset
- [ ] Homepage URL: `https://github.com/pepsi133/model-garden-clicker`
- [ ] Support URL: `https://github.com/pepsi133/model-garden-clicker/issues`
- [ ] Mature content: off
- [ ] Save draft.

## 3. Privacy tab

- [ ] Single purpose description (from `LISTING.md`).
- [ ] Permission justifications: `storage`, `alarms`, host permission,
      content scripts (one sentence each, from `LISTING.md`).
- [ ] Remote code: No. Justification empty or "n/a".
- [ ] Data usage: tick "Personally identifiable information" only, with the
      disclosure text from `LISTING.md`.
- [ ] Certifications: tick all three.
- [ ] Privacy policy URL: `https://github.com/pepsi133/model-garden-clicker/blob/main/PRIVACY.md`
      (open it in a browser once to be sure it is public).
- [ ] Save draft.

## 4. Distribution tab

- [ ] Payments: free.
- [ ] Visibility: **Unlisted** for the first review. Unlisted goes through
      the same review as Public, installs from the direct link, and keeps the
      item out of search while the first user feedback and any reviewer
      follow-up come in. Switch to Public later without a new review of the
      package.
- [ ] Regions: all regions.
- [ ] Save draft.

## 5. Submit for review

- [ ] Account tab: contact email verified (the dashboard refuses to submit
      without it).
- [ ] "Submit for review". Leave "Publish automatically after it has passed
      review" ticked unless the switch to Public should be timed by hand.
- [ ] Expect a few days for an item with a host permission; watch the account
      email for a reviewer question about the host permission.

## Known review risks and the wording that answers them

| Risk | Why a reviewer may flag it | What answers it |
|---|---|---|
| Host permission on a Google property | A single-site host permission on `console.cloud.google.com` draws a manual review; the reviewer asks what the content script does there. | The single purpose statement and the host justification say the same thing: fill the questionnaire and Agreements pages in the user's own console. The content script runs only on those pages and refuses to act on any other page. |
| "Automation" of a web flow | Extensions that click through a site's forms can look like a bot or a circumvention of the site's intended flow. | The description says the extension runs in the user's own signed-in browser, with the user's own values, for projects the user administers, and that there is no API for this flow. The default DRY RUN mode never approves anything; a full run is a separate setting plus a confirmation; step-by-step confirmation keeps the user in control of every Next and Agree. |
| Purchases on the user's behalf | Clicking Agree bills the project; a reviewer may treat that as a financial action without consent. | The description and the test instructions state in plain words that FULL RUN clicks Agree and bills the project, that it is off by default, that it asks for a confirmation when Start is pressed, and that Agree is clicked only on the verified Agreements page of the job's own project and model. |
| Single purpose policy | A store listing that lists several things the extension does can read as more than one purpose. | Every feature in the description serves one purpose: enabling a Claude model in a project. Avoid adding unrelated features (for example a general console helper) to the listing. |
| Privacy disclosure mismatch | The options page holds an email field; an empty data-usage disclosure contradicts it. | Tick "Personally identifiable information" and keep the disclosure text consistent with `PRIVACY.md`. |
| Trademarks in the title | Names that contain "Google" or "Chrome" are rejected. | The title is "Model Garden Clicker". The description names Google Cloud and Anthropic descriptively and states that the tool is independent and not affiliated with either. |
| No test account | Reviewers ask for credentials when a feature is behind a login. | The test instructions explain why none is given (a billing account would be exposed), that any owned Google Cloud project shows the same pages, and that DRY RUN shows the complete flow with no purchase. |
| Screenshot content | Screenshots with personal data or with text that promises something the extension does not do. | The five screenshots carry no project IDs, emails, names or account initials; each caption describes what is visible. |
