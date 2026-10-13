# scripts/deep-link: make a link that opens the popup filled in

Two small generators for the deep links described in
[`extension/README.md`](../../extension/README.md), "Open the popup from a
link". They are meant for a trusted place (a runbook, a pipeline, a
shell): they join the values and check only the two counts. The extension
validates every value when the link is opened, asks for a confirmation
and never starts a run.

```sh
python3 -I scripts/deep-link/mgc_link.py my-proj-a my-proj-b --models latest
sh scripts/deep-link/mgc-link.sh my-proj-a,my-proj-b latest
```

Both print the console form:

```text
https://console.cloud.google.com/agent-platform/model-garden?project=my-proj-a#mgc=v1;projects=my-proj-a,my-proj-b;models=latest
```

With `--extension-id <id>` (Python) or `MGC_EXTENSION_ID=<id>` (shell) a
second line holds the popup-page form for the address bar and bookmarks:

```text
chrome-extension://<id>/popup/popup.html?tab=1&v=1&projects=my-proj-a,my-proj-b&models=latest
```

`--models` (or the second argument) takes a comma list of slugs or
`latest`. Leave it out to open the popup with no model ticked. At most 23
projects and 13 models, the extension's own limits.
