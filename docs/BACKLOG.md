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
