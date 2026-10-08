# Privacy policy for Model Garden Clicker

Last updated: 2026-10-08

Model Garden Clicker is a Chrome extension that fills the Anthropic Claude
model enablement questionnaire and the Marketplace agreement in the Google
Cloud console Model Garden for the projects you list. This policy explains
what the extension handles and where it keeps it.

## What the extension handles

- Questionnaire values that you type into its options page: business name,
  business website, contact email, headquarters country, industry, intended
  users, use cases and the Acceptable Use Policy answer with its details.
- The project IDs and model names you paste into the popup, the job queue,
  the result of each job and a log of the last steps. On a failure the log can
  hold the name of a questionnaire field and the value the console rejected.
- Mode settings (dry run, step-by-step confirmation) and timing settings.

## Where it is stored

All of it is kept in the local extension storage of your own browser
(`chrome.storage.local`). It is not synced to a Google account or to any
other account, and it never leaves your browser through the extension.

## What is transmitted

Nothing is transmitted to the developer. There is no server, no analytics
and no telemetry. The questionnaire values go into exactly one place: the
Google Cloud console pages that you operate, where the extension types them
into Google's own form on your behalf. What Google and Anthropic do with the
submitted questionnaire is covered by their own policies, which the console
links on the questionnaire page.

The extension reads the console pages it works on in order to act on them.
It does not record your browsing, and it has access to no site other than
`https://console.cloud.google.com`.

## How to delete the data

Removing the extension deletes its storage. Open `chrome://extensions`, find
Model Garden Clicker and click Remove. The options page has no separate
"clear storage" button; the "clear" link in the popup removes the results
table only.

## Changes

Changes to this policy are published in the repository with a new
"Last updated" date.

## Contact

Questions and reports go to the issue tracker of the project repository:
https://github.com/pepsi133/model-garden-clicker/issues
