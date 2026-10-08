# Model Garden Clicker

Model Garden Clicker is a Chrome extension that enables Anthropic Claude models in the Google Cloud console Model Garden for many projects. It fills the enablement questionnaire and the Marketplace agreement with values that you save once.

Google Cloud offers no API for this flow as of October 2026. For this reason the extension drives the console pages in your own signed-in browser.

## What is in this repository

| Path | Content |
|---|---|
| `extension/` | The Chrome extension (Manifest V3). There is no build step. `extension/README.md` is the user manual. |
| `python/` | A Selenium harness that records the console pages and runs the extension end to end in a dedicated Chrome profile. `python/README.md` is the developer manual, including the offline tests. |
| `docs/` | The DOM map of the console pages, the model list with its source, and the backlog. |
| `scripts/` | `build-extension-zip.sh` packages the extension for the Chrome Web Store. |

## Safety

- Dry-run mode is the default. In dry-run mode the extension never clicks Agree.
- A full run (the DRY RUN box unticked, or the popup banner switched to MODE: FULL RUN) clicks Agree and makes Marketplace purchases that bill the project.
- The extension stores values only in local browser storage. It does not sync values to an account.
- The extension asks for host access to the console origin only (`https://console.cloud.google.com/*`) plus `storage` and `alarms`; the install prompt mentions no browsing history.

## Status

The console DOM was recorded on 2026-10-07. Selectors can break when Google changes the console pages. Read `docs/dom-map.md` to repair the selectors.

## License

This repository uses the Apache License, Version 2.0. Read `LICENSE` for the full text.
