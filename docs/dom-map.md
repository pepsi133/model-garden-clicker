# DOM map: Model Garden "Enable" flow for Anthropic Claude models

Recorded 2026-10-07 from live Selenium runs against console.cloud.google.com
(Chrome 155, Google Cloud console, Angular Material MDC, Cloud console
`cfc-*` wrappers). Evidence lives in `python/recon/<run>/NN-<step>/`
(`page.html`, `forms.json`, `screenshot.png`, `url.txt`) and `<run>/timing.json`;
those dumps are not committed (regenerate them with `python/scripts/recon.py`).
The Selenium reference implementation is `python/mgclick/form.py` and
`python/mgclick/flow.py`; the extension's `content/dom.js` and
`content/selectors.js` implement the same logic.

Runs used for this document. Two projects were used: project-a, whose
billing account could not purchase, and project-b, where purchases went
through. Run directories are named `<timestamp>-<project>-<model>`.

| run | project | model | what it shows |
|---|---|---|---|
| 185228 | project-a | claude-haiku-4-5 | clean dry run, stops at 05 with the box ticked, Agree not clicked |
| 185514 | project-a | claude-haiku-4-5 | Agree clicked, refused by billing (a billing account that does not permit Marketplace purchases) -> error dialog |
| 185747 | project-b | claude-sonnet-4-6 | Agree clicked with the "Enable APIs" dialog still open; purchase succeeded |
| 190153 | project-b | claude-haiku-4-5 | "Enable APIs" dialog handled on the model page, then Agree, purchase succeeded |
| 190410 | project-b | claude-sonnet-4-6 | model already enabled: "Open in Agent Studio" detector |
| 190511 | project-b | claude-haiku-4-5 | dry run 3.5 min after the Haiku purchase: already enabled, no dialog |
| 190535 | project-a | claude-haiku-4-5 | final dry run with the final code, stops at 05, Agree not clicked |
| 194426 | project-b | claude-sonnet-5 | gallery -> search -> results table -> model page, then Agree; purchase succeeded (section "Gallery path") |

## Conventions that hold on all three pages

- No shadow DOM is involved. The recon walker descends into open shadow
  roots; the only shadow host found was one `DIV` unrelated to the form
  (the embedded code editor). Every control below is in the light DOM of
  the top document. There are no iframes around the form either.
- The console is a shell hosting micro-frontends. Each micro-frontend gets a
  `sandboxuid` attribute and an id prefix: the Agent Platform pages use
  `sandboxuid="0"` and ids `_0rif_...`; the Marketplace Agreements page uses
  `sandboxuid="1"` and ids `_1rif_...`.
- **Generated ids, never rely on them**: `_0rif_mat-input-0..4`,
  `_0rif_cfc-select-0..2`, `_0rif_mat-radio-0/1` (+`-input`),
  `_0rif_mat-mdc-form-field-label-N`, `_0rif_label-goog_743788562` (the
  numeric part changes per render), `_0rif_mat-option-N`,
  `_0rif_cdk-overlay-N`, `_1rif_mat-mdc-checkbox-0`, `_1rif_mat-mdc-dialog-0`.
  The `_0rif_`/`_1rif_` prefix is the micro-frontend instance and the counter
  depends on render order. Also unstable: `_ngcontent-ng-c<digits>` /
  `_nghost-ng-c<digits>` attributes (Angular component hashes), `jslog`
  numbers, and `ng-tns-*` classes.
- **Stable anchors**: visible label text inside `<mat-label>`, the
  `raf-name="..."` attribute on `<raf-runtime-form-element>` (questionnaire
  only), the wrapper component tag names (`vertex-ai-request-access-button`,
  `vai-model-garden-call-to-action-button-stack`, `raf-form`,
  `cfc-panel-footer.mg-questionnaire-footer`, `mp-agreements-tos`,
  `billing-integrated-ai-agreements-body`), the Marketplace test hooks
  (`p6ntest-mp-agreements-body-tos-checkbox`, `p6ntest-mp-agreements-tos`),
  and `data-prober="cloud-marketplace-request-product"` on the Agree button.
- Button text is padded with spaces inside `<span class="mdc-button__label">`
  (`" Enable "`, `" Next "`, `" Agree "`): always trim before comparing.
- All Material overlays (select panels, dialogs, snackbars) render into
  `body > div.cdk-overlay-container` (class list observed:
  `cdk-overlay-container cfc-ng2-region cm-gm2`), outside the page's
  component tree. Select panels sit in `div.cdk-overlay-pane` with a
  transparent `div.cdk-overlay-backdrop`.
- Angular reactive forms: state is mirrored as classes on the control, the
  `mat-form-field` and the `<form>`: `ng-untouched/ng-touched`,
  `ng-pristine/ng-dirty`, `ng-invalid/ng-valid`. The `<form>` elements are
  `form#_0rif_RequestAccessFormGroup[raf-name=RequestAccessFormGroup]` and
  `form[raf-name=AdditionalQuestionFormDataFormGroup]`; both must be
  `ng-valid` before Next is useful. Observed after a full fill:
  `RequestAccessFormGroup: ng-dirty ng-touched ng-valid`,
  `AdditionalQuestionFormDataFormGroup: ng-untouched ng-dirty ng-valid`.

### Angular-specific: how a text field registers a value

A bare `input.value = "x"` does not reach the FormControl. The sequence that
works (used by `form.fill_text`, verified by the classes flipping and by Next
accepting the form):

```js
const el = input;                                  // the <input matinput>
el.focus();
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
el.dispatchEvent(new Event('input',  {bubbles: true}));   // -> ng-dirty ng-valid
el.dispatchEvent(new Event('change', {bubbles: true}));
el.blur();
el.dispatchEvent(new Event('blur',   {bubbles: true}));   // -> ng-touched
```

Observed class transitions on the `mat-form-field`:
`ng-untouched ng-pristine ng-invalid` -> after `input`: `ng-untouched ng-dirty
ng-valid` -> after `blur`: `ng-dirty ng-valid ng-touched`. The floating label
also loses `mat-form-field-hide-placeholder` once the field has a value.

Do not type with synthetic keystrokes: the console binds `/` as a global
"focus search" shortcut and fast key-by-key typing lost the first `/` of
`https://` (observed value `https:/example.com`, which then showed the
validation error "Please provide your full website with protocol included.
For example, https://www.google.com"). Slow typing (150 ms per key) did not
lose it, but the native-setter sequence above is deterministic.

Selects, radios and the checkbox react to real `click` events (an
`element.click()` from script is enough; Angular listens on `click`).

---

## Page 1: model page

**URL pattern**

```
https://console.cloud.google.com/agent-platform/publishers/anthropic/model-garden/<model-slug>?project=<project-id>
```

e.g. `.../model-garden/claude-haiku-4-5?project=my-project`.

**Texts**

- `document.title`: `Claude Haiku 4.5 – Agent Platform – <project-id-ellipsi…> – Google Cloud console`
  (project id is ellipsised by the console).
- Breadcrumb (`nav[aria-label="Breadcrumb"]`, `pcc-breadcrumb-bar`):
  `Agent Platform / Models / Model Garden / Model: claude-haiku-4-5`
  (the last item is the span texts `Model:` + `claude-haiku-4-5`).
- Action bar title (`h1.cfc-heading-tag > span > span.cfc-action-bar-title-text-span`):
  ` Claude Haiku 4.5 `.
- Hero headline: `<p class="headline"> Claude Haiku 4.5 </p>` inside
  `span.mg-heading-container`, followed by the description span.

**Ready detector**: the call-to-action stack exists and holds the Enable
button:

```css
vai-model-garden-call-to-action-button-stack vertex-ai-request-access-button button
```

Only the Angular app renders this; before that the shell shows a spinner.
`vai-model-garden-call-to-action-button-stack` holds, in order,
`vertex-ai-request-access-button` (Enable), `vertex-ai-open-notebook-button`
(Open Notebook, `aria-disabled="true"`), `vertex-ai-view-api-code-button`
(View Code).

**Enable button** (minimal HTML):

```html
<vai-model-garden-call-to-action-button-stack>
  <div fxlayout="col" style="display:flex; flex-direction:row;">
    <vertex-ai-request-access-button jslog="281005;track:generic_click">
      <button mat-button="" color="primary"
              class="mdc-button mat-mdc-button-base gmat-mdc-button cfc-cursor-pointer mdc-button--unelevated mat-mdc-unelevated-button mat-primary mat-mdc-button-disabled-interactive cm-button"
              rel="noopener" jslog="52839;track:generic_click" tabindex="0">
        <span class="mdc-button__label"> Enable </span>
      </button>
    </vertex-ai-request-access-button>
    ...
```

- no id, no name, no aria-label, no data attribute: find it by wrapper tag
  `vertex-ai-request-access-button` or by trimmed text `Enable`.
- When searching by text, **exclude dialogs**: the conditional "Enable APIs"
  dialog (below) has its own `Enable` button at the end of `body`, inside
  `mat-dialog-container`. Use `:not(mat-dialog-container *)` or
  `!button.closest('mat-dialog-container')`.
- `mat-mdc-button-disabled-interactive` is a Material styling class, not a
  disabled state; the button has no `disabled` attribute.

**Already-enabled state** (seen on project-b for Sonnet 4.6 after a
successful purchase): `vertex-ai-request-access-button` is gone and the first
child of the stack is

```html
<vertex-ai-open-generation-ai-studio-button jslog="281000;track:generic_click">
  <a mat-button="" color="primary" class="mdc-button ... mat-mdc-unelevated-button mat-primary cm-button cfc-tooltip ..."
     href="/vertex-ai/generative/multimodal/create/text?model=claude-sonnet-4-6&project=<project-id>" rel="noopener">
    <span class="mdc-button__label"> Open in Agent Studio </span>
  </a>
</vertex-ai-open-generation-ai-studio-button>
```

Detector: `vertex-ai-open-generation-ai-studio-button` present (or an
`<a>`/`<button>` with trimmed text `Open in Agent Studio`) and no
`vertex-ai-request-access-button`. It is an `<a>`, not a `<button>`. No
"Enabled" button text exists anywhere in this flow.

**Clicking Enable** is an in-app route change (no document reload: a marker
set on `window` before the click survived). URL becomes the questionnaire
URL within 1.2-4.3 s.

---

## Page 2: questionnaire

**URL pattern**

```
https://console.cloud.google.com/agent-platform/model-garden/questionnaire?model=publishers%2Fanthropic%2Fmodels%2F<model-slug>&mp=anthropic%2Fanthropic-<NNN>.cloudpartnerservices.goog&project=<project-id>
```

`mp` is the Marketplace listing id: `anthropic-867` for claude-haiku-4-5,
`anthropic-884` for claude-sonnet-4-6. The same URL opened directly (not via
Enable) renders the same form (10.6 s cold).

**Texts**

- `document.title`: `Claude Haiku 4.5 enablement – Agent Platform – <project-id-ellipsi…> – Google Cloud console`
- Breadcrumb: `Agent Platform / Models / Model Garden / Questionnaire`
- Action bar title: ` Claude Haiku 4.5 enablement ` (same `h1` structure as page 1),
  with a back-arrow button `aria-label="Back to previous page"` before it.
- Two info boxes above the form: "Anthropic recommends enabling Agent
  Platform's request-response logging ..." with a `Set up logging` link
  button, and "This model support features like Web Search ...". Then a bold
  paragraph "This third party model is licensed from Anthropic and is
  provided under Anthropic's terms of service." and the privacy paragraph.

**Ready detector**: the first labelled input exists:

```css
raf-runtime-form-element[raf-name="businessName"] input
```

(`form[raf-name="RequestAccessFormGroup"]` also only exists once rendered.)
Rendered 2.3-5.1 s after clicking Enable.

**Form skeleton** (two `<raf-form>` blocks, each with one `<form>`):

```html
<raf-form raf-entry-name="RequestAccessFormGroup">
  <raf-runtime-form>
    <form novalidate id="_0rif_RequestAccessFormGroup" raf-name="RequestAccessFormGroup" class="ng-untouched ng-pristine ng-invalid">
      <raf-runtime-form-section class="raf-first-section-no-margin">
        <div class="raf-section-inner-container ..." raf-name="">
          <cfc-form-section tabindex="-1">
            <div role="group" tabindex="-1" class="cfc-outline-focus-indicator" aria-describedby="_0rif_errorgoog_743788558">
              <raf-runtime-form-element raf-name="businessName" style="display:block;">
                <raf-runtime-form-input> <mat-form-field ...> ... </mat-form-field> </raf-runtime-form-input>
              </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="businessWebsite"> ... </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="contactEmailAddress"> ... </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="businessHeadquarterSelect"> <raf-runtime-form-select> ... </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="industrySelect"> ... </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="intendedUserSelect"> ... </raf-runtime-form-element>
              <raf-runtime-form-element raf-name="intendedUseCasesSelect"> <raf-runtime-form-input> (a text input despite the name) </raf-runtime-form-element>
...
<raf-form raf-entry-name="AdditionalQuestionFormDataFormGroup">
  <form id="_0rif_AdditionalQuestionFormDataFormGroup" raf-name="AdditionalQuestionFormDataFormGroup">
    ... <raf-runtime-form-element raf-name="hasAdditionalRequirements"> <raf-runtime-form-select-radio> <mat-radio-group> ...
        <raf-runtime-form-element raf-name="additionalRequirements"> <raf-runtime-form-input> <mat-form-field> ... (optional text)
```

The `raf-name` values are the most stable hooks on this page:
`businessName`, `businessWebsite`, `contactEmailAddress`,
`businessHeadquarterSelect`, `industrySelect`, `intendedUserSelect`,
`intendedUseCasesSelect`, `hasAdditionalRequirements`, `additionalRequirements`.
Label text is the fallback.

### Text inputs (4 required + 1 conditional)

| label text (`mat-label`) | raf-name | tag | id (generated) |
|---|---|---|---|
| `Business name` | `businessName` | `input[type=text]` | `_0rif_mat-input-0` |
| `Business website` | `businessWebsite` | `input[type=text]` | `_0rif_mat-input-1` |
| `Contact email address` | `contactEmailAddress` | `input[type=text]` | `_0rif_mat-input-2` |
| `What are your intended use cases for Claude models` | `intendedUseCasesSelect` | `input[type=text]` | `_0rif_mat-input-3` |
| `If yes, please describe how you plan to meet the additional requirements` (optional) | `additionalRequirements` | `input[type=text]` | `_0rif_mat-input-4` |

mat-form-field structure around every text input (Business name shown):

```html
<mat-form-field class="mat-mdc-form-field cm-form-field cm-buttons-size-small gmat-mdc-form-field mat-mdc-form-field-type-mat-input mat-form-field-appearance-outline mat-form-field-hide-placeholder mat-primary ng-untouched ng-pristine ng-invalid">
  <div class="mat-mdc-text-field-wrapper mdc-text-field mdc-text-field--outlined">
    <div class="mat-mdc-form-field-flex">
      <div matformfieldnotchedoutline class="mdc-notched-outline ...">
        <div class="mat-mdc-notch-piece mdc-notched-outline__notch">
          <label matformfieldfloatinglabel class="mdc-floating-label mat-mdc-floating-label" id="_0rif_mat-mdc-form-field-label-0" for="_0rif_mat-input-0">
            <mat-label>
              <raf-runtime-text-view id="_0rif_label-goog_743788562"><span><span>Business name</span></span></raf-runtime-text-view>
            </mat-label>
            <span aria-hidden="true" class="mat-mdc-form-field-required-marker mdc-floating-label--required"></span>
          </label>
        </div>
      </div>
      <div class="mat-mdc-form-field-infix">
        <input matinput type="text" id="_0rif_mat-input-0"
               class="mat-mdc-autocomplete-trigger cm-input gmat-mdc-input mat-mdc-input-element cm-autocomplete mat-mdc-form-field-input-control mdc-text-field__input ng-untouched ng-pristine ng-invalid cdk-text-field-autofill-monitored"
               aria-labelledby="_0rif_label-goog_743788562" aria-label="" autocomplete="off" required aria-required="true"
               jslog="54039;track:generic_click,input_text">
      </div>
    </div>
  </div>
  <div aria-live="polite" class="mat-mdc-form-field-subscript-wrapper ..."> (hint / error text appears here) </div>
</mat-form-field>
```

- `aria-label=""` (empty), no `name`, no `placeholder`, no data attributes.
  `aria-labelledby` points at the generated `raf-runtime-text-view` id.
- Find by: `raf-runtime-form-element[raf-name=X] input`, or the
  `mat-form-field` whose `mat-label` text contains the label, then its
  `input`. XPath used in Python:
  `//mat-form-field[.//mat-label[contains(lower(normalize-space(.)), 'business name')]]//input[not(@type='hidden')]`.
- Validation: the website field requires a scheme; its error renders inside
  the subscript wrapper with a `cfc-form-error`-style red message.
- Conditional field: `raf-runtime-form-element[raf-name=additionalRequirements]`
  is visible on first render; after choosing `No` in the radio group it gets
  `raf-hidden="true" style="display:none"` and its inner content is removed.
  With `Yes` it stays. Fill it only when `Yes` was chosen.

### Dropdowns: `cfc-select` (not `mat-select`)

The three dropdowns are Cloud console `<cfc-select>` elements wrapped by
`<raf-runtime-form-select>` inside a `mat-form-field` of type
`mat-mdc-form-field-type-cfc-select`.

| label text | raf-name | host id (generated) | example option |
|---|---|---|---|
| `Where is your Business headquartered` | `businessHeadquarterSelect` | `_0rif_cfc-select-0` | `Germany` |
| `Industry` | `industrySelect` | `_0rif_cfc-select-1` | `Education` |
| `Who are your intended users of Claude models` | `intendedUserSelect` | `_0rif_cfc-select-2` | `Internal employees` |

Closed host (headquarters):

```html
<cfc-select class="cfc-select ng-untouched ng-pristine ng-invalid" role="combobox" id="_0rif_cfc-select-0"
            aria-expanded="false" aria-haspopup="listbox" aria-labelledby="_0rif_mat-mdc-form-field-label-3"
            aria-invalid="false" aria-required="true" tabindex="0" required jslog="54820;track:generic_click">
  <template id="_0rif_cfc-select-has-dialog-description-1"> Has popup dialog. </template>
  <div cdk-overlay-origin class="cfc-select-trigger">
    <div class="cfc-select-value">
      <span class="cfc-select-placeholder"> &nbsp; </span>          <!-- unset -->
      <!-- once set: -->
      <span class="cfc-select-value-text"><span id="_0rif_cfc-select-0-select-value"> Canada </span></span>
    </div>
    <cm-icon class="cfc-icon-small-medium-arrow"><svg data-icon-name="arrowDropDownIcon" .../></cm-icon>
  </div>
  <cfc-overlay></cfc-overlay>
</cfc-select>
```

- `aria-labelledby` points at the `<label>` of the mat-form-field (the
  floating label), which contains the `mat-label` text.
- Industry renders with `Agriculture` pre-shown in `.cfc-select-value-text`
  and the host already `ng-valid` (it is a real default value, the first
  option). The other two start empty (`cfc-select-placeholder`, `ng-invalid`).
- **Open it by clicking `.cfc-select-trigger`**, not the host: the floating
  `<label>` overlaps the host's centre and Selenium's click was intercepted by
  `span.mat-mdc-form-field-required-marker`. A JS `click()` on the host also
  works. After opening, the host gets `aria-expanded="true"`.
- The panel renders in the overlay container:

```html
body > div.cdk-overlay-container
  div.cdk-overlay-popover.cdk-overlay-connected-position-bounding-box[popover=manual]
    div.cdk-overlay-backdrop.cdk-overlay-transparent-backdrop.cdk-overlay-backdrop-showing
    div#_0rif_cdk-overlay-0.cdk-overlay-pane (style min-width 488px; top/left positioned)
      div#_0rif_cfc-select-0-overlay.cfc-overlay-content[role=presentation]
        div#_0rif_cfc-select-0-panel.cfc-select-panel[role=presentation]
          div#_0rif_cfc-select-0-listbox.cfc-select-body[role=listbox][aria-label="Options"]
            <mat-option role="option" id="_0rif_mat-option-0" aria-selected="false" aria-disabled="false" tabindex="0"
                        class="mat-mdc-option mdc-list-item cfc-max-width-base cfc-tooltip ...">
              <span class="mdc-list-item__primary-text">
                <cfc-select-rich-option class="cfc-select-rich-option">
                  <div class="cfc-select-option-col">
                    <div class="cfc-select-option-row">
                      <span class="cfc-select-option-primary">Canada</span>
                      <span class="cfc-select-option-collapsed" style="display: none;">Canada</span>
                    </div>
                    <div class="cfc-select-option-row"><span class="cfc-select-option-subtext"></span></div>
                  </div>
                </cfc-select-rich-option>
              </span>
              <div aria-hidden="true" mat-ripple class="mat-ripple mat-mdc-option-ripple ..."></div>
            </mat-option>
            ...
```

- **Option text is doubled in `textContent`** (`"CanadaCanada"`) because of
  the hidden `.cfc-select-option-collapsed` copy. Match on
  `option.querySelector('.cfc-select-option-primary').textContent.trim()`
  or on `innerText` (which skips `display:none`). The visible text has no
  surrounding whitespace, but the selected value span does (`" Canada "`).
- Listbox id pattern `<host-id>-listbox` and panel id `<host-id>-panel` are
  derived from the generated host id: do not hardcode, but you can derive
  them at runtime from `cfc-select.id` if needed.
- The exact option texts of the three lists (182 headquarters countries,
  16 industries, 3 intended-users entries) live in
  `extension/common/option-lists.js`, with their order and the console's
  own duplicate. Headquarters is flat (no groups): `United States of
  America`, `Canada`, then alphabetical from `Afghanistan` (`Germany`, for
  example, is `_0rif_mat-option-N` with N its alphabetical position plus 2);
  the panel is scrollable, `scrollIntoView` on the option before clicking.
  One intended-users entry is lower case (sic).
- Clicking the option closes the panel (overlay pane removed, `aria-expanded`
  back to `false`), the host becomes `ng-dirty ng-valid` (still `ng-untouched`
  until focus leaves) and `.cfc-select-value-text` shows the choice.

### Radio group: Acceptable Use Policy question

Question text (a paragraph right above the group, referenced by the group's
`aria-labelledby`): "Do any of your use cases have additional requirements
per Anthropic's Acceptable Use Policy? These include use cases that involve
providing legal, medical, or financial advice to consumers, or chatbots that
interact directly with consumers."

```html
<raf-runtime-form-element raf-name="hasAdditionalRequirements">
  <raf-runtime-form-select-radio><div>
    <mat-radio-group role="radiogroup" aria-required="true" required aria-labelledby="_0rif_label-goog_743788575"
                     class="mat-mdc-radio-group cfc-invalid-container cm-radio-group ng-untouched ng-pristine ng-invalid">
      <cfc-form-error> ... hidden error slot ... </cfc-form-error>
      <mat-radio-button id="_0rif_mat-radio-0" class="mat-mdc-radio-button gmat-mdc-radio mat-accent cm-radio-button" jslog="54041;track:generic_click">
        <label mat-internal-form-field class="mdc-form-field mat-internal-form-field" for="_0rif_mat-radio-0-input">
          <span class="mdc-radio">
            <span class="mat-mdc-radio-touch-target"></span>
            <input type="radio" class="mdc-radio__native-control" id="_0rif_mat-radio-0-input" required name="mat-radio-group-0" value="Yes" tabindex="0">
            <span aria-hidden="true" class="mdc-radio__background">...</span>
          </span>
          <span class="mat-internal-form-field-label mdc-label">
            <raf-runtime-text-view><span><span>Yes</span></span></raf-runtime-text-view>
          </span>
        </label>
      </mat-radio-button>
      <mat-radio-button id="_0rif_mat-radio-1" ...>
        <label ... for="_0rif_mat-radio-1-input">
          ... <input type="radio" class="mdc-radio__native-control" id="_0rif_mat-radio-1-input" required name="mat-radio-group-0" value="No" tabindex="0"> ...
          <span class="mat-internal-form-field-label mdc-label">...<span>No</span>...</span>
        </label>
      </mat-radio-button>
    </mat-radio-group>
```

- Stable: `input[type=radio][value="Yes"]` / `[value="No"]` inside
  `raf-runtime-form-element[raf-name=hasAdditionalRequirements]`, or
  `mat-radio-button` whose trimmed text is `Yes`/`No`. `name="mat-radio-group-0"`
  is generated (counter). The radio inputs have no aria-label.
- Click the `<label>` (or the native input); Angular's `change` handler
  runs. The chosen `mat-radio-button` gets class `mat-mdc-radio-checked` and
  the input `checked`. `AdditionalQuestionFormDataFormGroup` becomes
  `ng-dirty ng-valid`. Choosing `No` hides the optional text field (above).

### Next / Cancel buttons

```html
<cfc-panel-footer class="mg-questionnaire-footer">
  <div class="cfc-panel-footer mg-questionnaire-footer cfc-panel-footer-notstick">
    <button mat-flat-button color="primary" type="button"
            class="mdc-button mat-mdc-button-base gmat-mdc-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary cm-button">
      <span class="mdc-button__label"><span>Next</span></span>
    </button>
    <button mat-button type="button" class="... cm-button"><span class="mdc-button__label"><span>Cancel</span></span></button>
```

- No id/name/aria-label/data attributes. Find: `cfc-panel-footer.mg-questionnaire-footer button`
  with trimmed text `Next`. It is `type="button"` and always enabled;
  clicking it with an invalid form shows field errors instead of navigating.
- Clicking Next (with a valid form) is an in-app route change (no reload) to
  the Agreements page; the Agree button became visible 8.0-17.9 s later.
  The questionnaire is submitted at this point (it is the "request access"
  form sent to Anthropic/Google).

---

## Page 3: Agreements (Marketplace "Purchase summary")

**URL pattern**

```
https://console.cloud.google.com/marketplace/agreements/anthropic/anthropic-<NNN>.cloudpartnerservices.goog?project=<project-id>
```

(`anthropic-867` for claude-haiku-4-5, `anthropic-884` for claude-sonnet-4-6;
same id as the questionnaire's `mp` parameter.) This is the Marketplace
micro-frontend (`sandboxuid="1"`, ids `_1rif_*`): the left navigation is gone
and there is no breadcrumb bar.

**Texts**

- `document.title`: `Agreements – Marketplace – <project-id-ellipsi…> – Google Cloud console`
- Action bar title `h1 ... span.cfc-action-bar-title-text-span`: ` Agreements `,
  with a back button `aria-label="Back to previous page"`.
- Body heading: `<h2 class="cfc-font-weight-base"> Purchase summary </h2>`
  inside `billing-integrated-ai-agreements-body > div.p6ntest-mp-agreements-body-prompt-section`,
  caption "Agree to the following details and terms to enable this product".
- Sections: `Project` (shows the project id, "Update a project from the
  project selector on top navigation bar"), `Pricing` / `Usage fee` ("Usage fee
  is billed every month") with a `Select Location` `cfc-select`
  (`_1rif_cfc-select-0`, value `global`, leave it alone) and a tiered SKU
  table (`button.cfc-tiered-table-entry` rows like "Claude Haiku 4 5 — Batch
  Cache Read Tokens — global — ..."; price shown in the billing account's
  currency as `<currency> <amount> /1M tokens`), the currency disclaimer, `Terms`,
  `Promotional credits`, `Terms and agreements`.
- Nothing on this page asks for payment details; it only displays the
  billing currency of the project's billing account.

**Ready detector**: `mp-agreements-tos` (the terms checkbox label component)
or `button[data-prober="cloud-marketplace-request-product"]` exists.

### Terms checkbox

```html
<p class="cfc-text-title-4 cfc-space-above-minus-4"> Terms and agreements </p>
<mat-checkbox id="_1rif_mat-mdc-checkbox-0" jslog="54037;track:generic_click"
              class="mat-mdc-checkbox gmat-mdc-checkbox p6ntest-mp-agreements-body-tos-checkbox mat-primary cm-checkbox ng-untouched ng-pristine ng-valid">
  <label mat-internal-form-field class="mdc-form-field mat-internal-form-field" for="_1rif_mat-mdc-checkbox-0-input">
    <span class="mdc-checkbox">
      <span aria-hidden="true" class="mat-mdc-checkbox-touch-target"></span>
      <input type="checkbox" class="mdc-checkbox__native-control" id="_1rif_mat-mdc-checkbox-0-input" tabindex="0">
      <span aria-hidden="true" class="mdc-checkbox__background"><svg class="mdc-checkbox__checkmark">...</svg></span>
    </span>
    <span class="mat-internal-form-field-label mdc-label">
      <mp-agreements-tos><div class="p6ntest-mp-agreements-tos">
        <p> By purchasing, deploying, accessing, or using this product,
            <span class="p6ntest-mp-agreements-tos-agency-clause"> you acknowledge that Google or an affiliate is the Vendor’s agent with respect to this transaction and </span>
            you agree to comply with the <a class="cfc-external-link p6ntest-mp-agreements-tos-marketplace-term" href="https://cloud.google.com/terms/marketplace/launcher?hl=en_US">Google Cloud Marketplace Terms of Service</a>
            (including the GPC terms set forth in Appendix A of the Marketplace ToS), <a ...>Anthropic Terms of Service</a>
            and the terms of applicable open source software licenses bundled with the product. </p>
      </div></mp-agreements-tos>
    </span>
  </label>
</mat-checkbox>
```

- Stable: `mat-checkbox.p6ntest-mp-agreements-body-tos-checkbox` (Google's
  own test hook) or `mp-agreements-tos` then `closest('mat-checkbox')`.
  It is the only `mat-checkbox` on the page. The native input has no
  aria-label and no name.
- Click the native `input[type=checkbox]` (what `ensure_checkbox_checked`
  does). Checked state: `input.checked === true`, input gains class
  `mdc-checkbox--selected`, `mat-checkbox` gains `mat-mdc-checkbox-checked`
  and becomes `ng-valid` (it is not `ng-dirty`-tracked). Unchecked, the box
  is `ng-untouched ng-pristine ng-valid` so `ng-valid` alone proves nothing.
- The Agree button is enabled regardless of the checkbox; clicking Agree
  unchecked was not tried.

### Agree button (never clicked by default; the extension must show a confirmation)

```html
<button mat-button data-prober="cloud-marketplace-request-product" color="primary" cfctargetedcallout
        class="mdc-button mat-mdc-button-base gmat-mdc-button mdc-button--unelevated mat-mdc-unelevated-button mat-primary cm-button cfc-tooltip cfc-tooltip-disable-user-select-on-touch-device"
        aria-label="Agree to the terms and agreements before continuing" role="button">
  <span class="mdc-button__label"> Agree </span>
</button>
```

- Stable locator: `button[data-prober="cloud-marketplace-request-product"]`;
  fallbacks: `button[aria-label^="Agree to the terms"]`, trimmed text `Agree`.
  No id, no `disabled` attribute even before the box is ticked.
- The Python guard refuses any button whose text contains `agree` (case
  insensitive). Only `form.click_agree_approved`, reachable only via
  `recon.py --i-approve-agree`, clicks it. The extension's guard
  (`clickAgreeGuarded` in `content/actions.js`) additionally requires the
  URL to carry this Anthropic prefix, the job's `?project=`, and the product
  id recorded from the questionnaire's `mp` parameter, and the page text to
  name the model (the SKU rows read `Claude Haiku 4 5 — ...`; the match is
  token-bounded with an exact version, so `Claude Sonnet 5 5` does not
  satisfy a Claude Sonnet 5 job or the reverse). The same page checks run in
  a dry run before the checkbox is ticked, and again after the click is
  recorded, immediately before the click.

---

## Conditional: "Enable APIs" dialog (can sit on any of the three pages)

Seen on project-b, a project where the Agent Platform
(`aiplatform.googleapis.com`) API was not yet enabled. It opened on top of the
model page as soon as it rendered, stayed open across the route change to
the questionnaire, and was still open on the Agreements page and after
Agree (the pages behind it kept working: the Enable button, the form, Next
and Agree all accepted clicks through its transparent backdrop because
`aria-modal="false"` and `safe_click` falls back to a JS click). It is an
Agent Platform dialog (`_0rif_` ids), so it also overlays the Marketplace
page.

```html
body > div.cdk-overlay-container > ... >
<mat-dialog-container id="_0rif_mat-mdc-dialog-0" role="dialog" aria-modal="false" aria-labelledby="_0rif_mat-mdc-dialog-title-1"
                      class="mat-mdc-dialog-container mdc-dialog cdk-dialog-container mdc-dialog--open mat-mdc-dialog-container-with-actions">
  <div class="mat-mdc-dialog-inner-container mdc-dialog__container"><div class="mat-mdc-dialog-surface mdc-dialog__surface">
    <xap-deferred-loader-outlet class="mat-mdc-dialog-component-host ...">
      <apis-enabler>
        <h1 matdialogtitle class="mat-mdc-dialog-title mdc-dialog__title" id="_0rif_mat-mdc-dialog-title-1"> Enable APIs </h1>
        <div matdialogcontent class="mat-mdc-dialog-content mdc-dialog__content cfc-width-base">
          <cfc-message id="_0rif_contentText"> ... <div class="cfc-message-text-wrapper"> The Agent Platform API must be enabled to use this page. </div> ... </cfc-message>
          <dl cfc-kv-list class="cfc-kv-list cfc-width-full main-api-list ...">
            <div>
              <dt class="api-enabler-dt-width"><a class="cfc-external-link" href="https://cloud.google.com/vertex-ai/...">Agent Platform API</a> <cfc-help-button>...</cfc-help-button></dt>
              <dd class="api-enabler-dd-width"><cfc-icon icon="disabled-yellow" ...></cfc-icon> Not enabled </dd>
            </div>
          </dl>
        </div>
        <div matdialogactions class="mat-mdc-dialog-actions mdc-dialog__actions">
          <button mat-button type="button" class="... cm-button" jslog="262712;..."><span class="mdc-button__label"> Send feedback </span></button>
          <button mat-button color="primary" type="button" class="... mat-primary cm-button" jslog="262711;..."><span class="mdc-button__label"> Cancel </span></button>
          <button mat-button type="button" color="primary" cfciamnopermissiontooltip="You don't have permission to enable APIs"
                  class="... mat-primary mat-mdc-button-disabled-interactive cm-button" jslog="208874;..."><span class="mdc-button__label"> Enable </span></button>
        </div>
      </apis-enabler>
```

- Detect: a displayed `mat-dialog-container` whose `h1` trimmed text is
  `Enable APIs` (the `apis-enabler` tag is also unique). Check it before
  acting on any page, and again after each navigation.
- Act: click the dialog's own `Enable` button, scoped to the dialog
  (`mat-dialog-container button` with trimmed text `Enable`). This is allowed;
  the guard only blocks `agree`. `cfciamnopermissiontooltip` is a tooltip
  shown when the account lacks `serviceusage.services.enable`; the button
  had no `disabled` attribute for this account.
- How it closes: the `<dd>` status text goes `Not enabled` -> `Loading In
  progress` (spinner) -> `Enabled`, then the whole `mat-dialog-container` is
  removed. Observed 7.7 s from click to removal. The page behind does not
  reload or change URL. The extension waits up to 120 s for it to close and
  fails the job if the dialog shows up again for the same job.
- It did not reappear in the runs after the API was enabled; on the next
  run against the same project no dialog was shown at all.
- Do not confuse its `Enable` with the model page's `Enable`: scope the
  model-page search outside `mat-dialog-container`.

---

## After Agree (recorded with `--i-approve-agree` only)

Clicking Agree does not change the URL and does not reload the document. The
Agree button is immediately replaced by a small spinner (06 screenshots show
the spinner where the button was; the button element is still in the DOM but
hidden), then one of these appears in `div.cdk-overlay-container`, 5-7 s
after the click:

**Success** (project-b, both models):

```html
<mat-dialog-container id="_1rif_mat-mdc-dialog-0" role="dialog" aria-modal="false" aria-labelledby="_1rif_mat-mdc-dialog-title-0"
                      class="mat-mdc-dialog-container mdc-dialog cdk-dialog-container mat-mdc-dialog-container-with-actions mdc-dialog--open">
  ... <mp-consent-complete-dialog class="mat-mdc-dialog-component-host">
    <h1 matdialogtitle class="mat-mdc-dialog-title mdc-dialog__title" id="_1rif_mat-mdc-dialog-title-0">Successfully purchased Claude Sonnet 4.6</h1>
    <div matdialogcontent class="mat-mdc-dialog-content mdc-dialog__content"><mp-dialog-body>
      <div class="cfc-align-center"><img class="cmImgSrc mp-dialog-body-view-item" alt="Successfully purchased {productName}" src="https://www.gstatic.com/pantheon/images/marketplace/purchase_request_sent_small.png"></div>
      <p class="mp-dialog-body-view-item"> Now that you've agreed to the terms, you can enable Claude Sonnet 4.6 in Agent Platform </p>
    </mp-dialog-body></div>
    <div matdialogactions class="mat-mdc-dialog-actions mdc-dialog__actions">
      <button mat-flat-button color="primary" type="button" class="mdc-button ... mat-mdc-unelevated-button mat-primary cm-button"><span class="mdc-button__label"> Manage on Agent Platform </span></button>
    </div>
  </mp-consent-complete-dialog>
```

Confirmation detector: `mp-consent-complete-dialog` present, or a
`mat-dialog-container h1` whose text starts with `Successfully purchased`.
Its only action is `Manage on Agent Platform` (navigates to the Agent
Platform; not clicked in the runs). The underlying page is unchanged (box
still ticked, Agree button hidden behind the spinner).

**Error** (a project whose billing account does not permit Marketplace purchases):

```html
<mat-dialog-container id="_1rif_mat-mdc-dialog-0" role="dialog" aria-modal="false" aria-label="Error dialog" class="... mdc-dialog--open mat-mdc-dialog-container-with-actions">
  ... <behavior-failure-dialog>
    <h1 matdialogtitle class="mat-mdc-dialog-title mdc-dialog__title" id="_1rif_mat-mdc-dialog-title-0">Action Required: Choose Different Billing Account</h1>
    <div matdialogcontent class="mat-mdc-dialog-content mdc-dialog__content cfc-width-base">
      <p> This product cannot be purchased using a billing account currently associated with a free trial. Please select a different billing account to proceed or upgrade to a paid account.
         <a class="cfc-doc-link" href="https://cloud.google.com/free/docs/free-cloud-features#how-to-upgrade"> Learn more</a></p>
    </div>
    <div matdialogactions class="mat-mdc-dialog-actions mdc-dialog__actions">
      <button mat-button color="primary" aria-label="Got it" class="mdc-button ... mat-primary cm-button"><span class="mdc-button__label"> Got it </span></button>
    </div>
  </behavior-failure-dialog>
```

Error detector: `behavior-failure-dialog` present, or
`mat-dialog-container[aria-label="Error dialog"]`. Exact texts: title
`Action Required: Choose Different Billing Account`, body "This product
cannot be purchased using a billing account currently associated with a free
trial. Please select a different billing account to proceed or upgrade to a
paid account.", single button `Got it`. After `Got it` the Agreements page
is back with the Agree button visible again; the model page afterwards still
shows `Enable` (nothing was purchased). This is the "asks for a billing
account change" case: stop there and show the user.

**Enabled-state detector on the model page** (what the extension must
recognise so it does not start the flow again): the call-to-action stack
has `vertex-ai-open-generation-ai-studio-button` with the `Open in Agent
Studio` link and no `vertex-ai-request-access-button` (full HTML under
Page 1). Observed for claude-sonnet-4-6 on project-b 30 s after
the purchase and again on a fresh visit 6 minutes later (run 190410:
`state=enabled`, script exits without touching anything).

**Propagation delay, and the difference between the two project-b Agree
runs**: both purchases produced the identical
`mp-consent-complete-dialog`. The difference was only in step 08:

- claude-sonnet-4-6 (run 185747): the model page revisited ~35 s after Agree
  already showed `Open in Agent Studio`.
- claude-haiku-4-5 (run 190153): the model page revisited ~30 s after Agree
  still showed `Enable` inside `vertex-ai-request-access-button` (08
  screenshot), i.e. the purchase had not propagated to the Agent Platform
  page yet. A fresh dry run 3.5 minutes later (run 190511) found
  `Open in Agent Studio` (`state=enabled`, script stopped without acting).

So the enabled state can lag the success dialog by more than 30 s. The
extension should treat the `Successfully purchased ...` dialog as the
authoritative success signal and poll (or tell the user to refresh) the
model page rather than assuming `Enable` means "not yet agreed". The other
difference between the runs: the Sonnet run had the "Enable APIs" dialog
open the whole time (its Enable was never clicked; the purchase succeeded
anyway); the Haiku run handled the dialog on the model page first, so the
API was already on before the questionnaire, and no dialog appeared on any
later page. The run after that (190511) saw no dialog at all.

---

## Flow timing (seconds, measured by `recon.py`, see each run's `timing.json`)

| step | measurement | observed |
|---|---|---|
| model page | `driver.get` -> Enable button visible (cold console shell load) | 16.2, 16.3, 18.6, 23.3, 24.4 |
| model page -> questionnaire | click Enable -> URL changed | 1.2, 1.7, 2.4, 4.3 |
| | click Enable -> Business name input present | 2.3, 4.2, 4.2, 5.1 |
| | document reloaded? | no (in-app route change; `window` marker survived) |
| questionnaire opened directly by URL | `driver.get` -> form present | 10.6 |
| questionnaire -> agreements | click Next -> Agree button visible | 8.0, 10.8, 12.1, 17.9 |
| | URL changed? / document reloaded? | yes (`/marketplace/agreements/...`) / no |
| agreements | click Agree -> result dialog (success or error) stable | 5.5-7 (spinner replaces the button after ~2 s) |
| "Enable APIs" dialog | click its Enable -> dialog removed | 7.7 (status went Not enabled -> In progress -> Enabled) |
| model page revisit after Agree | `driver.get` -> CTA stack visible | 18.9, 20.9, 21.9 |

Navigation model: the whole flow is one single-page app session. Enable and
Next are Angular router transitions (URL changes, `window` state kept);
Agree stays on the same URL and only opens a dialog. Only `driver.get` /
reload produce a real document load, which costs 16-25 s for the console
shell plus micro-frontend.

---

## Gallery path (recorded by `scripts/gallery_recon.py`, run 194426, project-b, claude-sonnet-5)

One session: gallery -> own search box -> results table -> model page ->
the Enable flow above with `--i-approve-agree`. Dumps under
`python/recon/<timestamp>-gallery-<project>-claude-sonnet-5/`
(`00-gallery/ready.json`, `01-search/search-candidates.json`,
`01-search/search.json`, `02-results/cards.json`, `03-model-page/click.json`).

**URL pattern**

```
https://console.cloud.google.com/agent-platform/model-garden?project=<project-id>
```

On load the console appends its own state and the URL becomes
`...?project=<id>&pageState=("galleryStateKey":("f":("g":[],"o":[]),"s":""))`
(URL-encoded: `pageState=(%22galleryStateKey%22:(%22f%22:(%22g%22:%5B%5D,%22o%22:%5B%5D),%22s%22:%22%22))`).
`f` holds the facet filters, `s` the search text. `document.title` is
`Agent Platform – Google Cloud console` (no page name). Breadcrumb:
`Agent Platform / Models / Model Garden`.

**Ready detector**: the Angular app has rendered when `vai-search-input`
exists and holds the search `<input>` (below), or when `mg-gallery-tile`
elements exist. Observed 18.3 s after `driver.get` (cold shell load, same
order as the model page); the tile set did not change afterwards. Headings:
`h1` `Model Garden` and `What's new in Model Garden`; section `h2`s `Made by
Google`, `Made by partners`, `Open models`, `All partners`, `Open models on
Hugging Face`. Component tags on the page: `model-garden-gallery-banner`,
`model-garden-promotion-tile` (6, the "What's new" tiles), `mg-gallery-tile`
(24), `vai-search-input`, `ai-facet-filter` (the left-hand "Model
Collections / Tasks / Providers" facets), and the error handlers
`vertex-ai-api-not-enabled-error-handler`,
`vertex-ai-quota-exceeded-error-handler`,
`vertex-ai-default-metadata-store-not-found-handler`.

A yellow banner `Enable APIs to access full platform capabilities.` with a
`vertex-ai-enable-api-button > cfc-progress-button > button` (`Enable
APIs`, `jslog="120685;track:generic_click"`) sat at the top of the gallery
although the Agent Platform API is already enabled on this project. It is a
banner, not the `Enable APIs` dialog; it was not clicked, no dialog appeared
on any page of this run, and the banner is absent from the model page.

**Gallery tiles (before a search)** have no links. Minimal HTML:

```html
<mg-gallery-tile class="ng-star-inserted">
  <div tabindex="0" class="mg-gallery-tile">
    <div class="mg-gallery-tile-icon-section cfc-flex-container cfc-flex-center-aligned"></div>
    <div class="mg-gallery-tile-content">
      <div class="mg-gallery-tile-title">Claude Sonnet 5.5</div>
      <div class="mg-gallery-tile-subtitle">Anthropic</div>
      <div class="mg-gallery-tile-badges"><div class="mg-gallery-tile-badge mg-gallery-tile-badge-serverless"> Serverless </div></div>
    </div>
  </div>
</mg-gallery-tile>
```

Title in `.mg-gallery-tile-title`, publisher in `.mg-gallery-tile-subtitle`,
a `NEW` badge before the title on some tiles. Navigation is a click handler
on `div.mg-gallery-tile[tabindex=0]` (no `href` to read; not exercised in
this run). The gallery showed Gemini, Claude 5.x, GLM, Kimi and Hugging Face
tiles; `claude-sonnet-5` itself was not among the 24 tiles, so the search
is needed to reach it from the gallery.

**Search box** (the gallery's own, not the console's global bar):

```html
<vai-search-input>
  <form novalidate class="full-length-search-bar ng-untouched ng-pristine ng-valid" jslog="127656;track:generic_click,impression">
    <div class="autocomplete-container">
      <mat-form-field class="mat-mdc-form-field cm-form-field cm-buttons-size-small ... mat-form-field-appearance-outline">
        ... <label class="mdc-floating-label mat-mdc-floating-label" id="_0rif_mat-mdc-form-field-label-0" for="_0rif_mat-input-0">
              <mat-label>Search models</mat-label></label>
        ... <cm-icon matprefix><svg data-icon-name="searchIcon" ...></svg></cm-icon>
        ... <div class="mat-mdc-form-field-infix">
              <input matinput class="mat-mdc-autocomplete-trigger cm-input gmat-mdc-input mat-mdc-input-element cm-autocomplete mat-mdc-form-field-input-control mdc-text-field__input ..."
                     jslog="281006;track:input_text" autocomplete="off" role="combobox" aria-autocomplete="list"
                     aria-expanded="false" aria-haspopup="listbox" id="_0rif_mat-input-0" aria-invalid="false" aria-required="false">
              <mat-autocomplete class=""></mat-autocomplete>
            </div>
```

- tag `input`, no `type`, no `name`, no `aria-label`, no `placeholder`; the
  only text anchor is `<mat-label>Search models</mat-label>` (floating label
  `for=_0rif_mat-input-0`; the id is generated). `role="combobox"` with a
  `mat-autocomplete` sibling. Position: inside `main`, y = 269 px at
  1400x1000, width 682 px.
- Selector: `vai-search-input input[matinput]`, or by label
  `//mat-form-field[.//mat-label[normalize-space()='Search models']]//input`.
- The console's global bar is a different element and must be excluded:
  `input#mat-input-OneCloudBarMicroUi__<uuid>` with `type="search"`,
  `aria-label="Enter query to search for resources, docs, products, and
  more"`, `placeholder="Search (/) for resources, docs, products, and more"`,
  inside `div#pcc-search-container > pcc-platform-bar-search` (`header`).
  Filter rule that picked the right one: visible text input, not inside
  `header`/`pcc-platform-bar*`, label or aria text containing "search".
- The gallery's form is `ng-untouched ng-pristine` until a human-like
  keystroke lands; `send_keys` into the focused input worked (readback
  `claude sonnet 5`, no character lost: the query has no `/`).

**How results update**: typing alone does not search. After the last
keystroke the page showed no model links for 12 s (the model-page anchor
set did not change; whether the `mat-autocomplete` listbox opened was not
recorded). `Enter` in the focused box submits the form: the results table
appeared 0.23 s after Enter and was stable 2.6 s after it. The URL's
`pageState` changed in place to `"s":"claude sonnet 5"`
(`...&pageState=(%22galleryStateKey%22:(%22f%22:(%22g%22:%5B%5D,%22o%22:%5B%5D),%22s%22:%22claude%20sonnet%205%22))`)
without a document reload (the attribute the recon script had set on the
input element was still there afterwards). The left facets collapse to the
matching counts (`Partner models 5`, `Providers: Anthropic 5, Ai2 1`) with a
`Clear all filters` link; the tiles and "What's new" section are replaced by
the results table. The box keeps the query and gains a clear (x) suffix.

**Result "cards" are table rows**, not cards. Heading
`h2#_0rif_search-text-header.search-text-header` = `Search results for
"claude sonnet 5"`. Structure:

```
cfc-panel-body > cfc-virtual-viewport > cfc-table > cfc-table-columns-presenter-v2
  > table.cfc-table-element[role=grid][aria-busy=false][aria-labelledby="_0rif_search-text-header ..."]
    thead > tr.cfc-table-header-row > th[data-column-id=icon|displayName|matchingLine|versionExternalName]
      (aria-labels "Model icon", "Name", "Matching line", "Resource ID"; only Name and Resource ID show text)
    tbody > tr.cfc-table-body-row#_0rif_cfc-table-caption-0-row-<N>[role=row][data-row-index=<N>]
      td[role=gridcell]  > img.search-results-icon[alt="Model icon"][src=".../model_garden/icons/icon-anthropic-v2.png"]
      td[role=rowheader] > a[queryparamshandling=merge][rel=noopener][jslog="283888;track:generic_click"]
                            [href="/agent-platform/publishers/anthropic/model-garden/claude-sonnet-5?project=<project-id>&pageState=(...)"]
                           > highlight-select-text-in-text-block > span.highlight-dark "Claude Sonnet 5"
      td[role=gridcell]  > highlight-select-text-in-text-block (description with the match highlighted)
      td[role=gridcell]  > div.cfc-table-extend-cell > cfc-expand-button + div.cfc-table-cell-content "claude-sonnet-5@default"
```

- Title element: the `<a>` in the second cell (`td[role=rowheader]`), text
  wrapped in `highlight-select-text-in-text-block > span.highlight-dark`;
  the match is highlighted, so read `innerText` of the `<a>`, not a child.
- Publisher element: none. The table has no publisher column; the publisher
  is only in the href path (`/publishers/<publisher>/model-garden/<slug>`),
  in the icon file name, and in the left `Providers` facet. The pre-search
  tiles do have `.mg-gallery-tile-subtitle`.
- Link: the same `<a>`; href pattern
  `/agent-platform/publishers/<publisher>/model-garden/<slug>?project=<id>&pageState=<gallery state>`.
  `queryparamshandling="merge"` is why the model page URL keeps the
  gallery's `pageState`.
- Resource ID cell: `<slug>@<version>` (`claude-sonnet-5@default`,
  `claude-opus-4-5@20251101`) or the Hugging Face id for open models.
- The action bar's `View my endpoints & models` link
  (`a[mat-button][href="/agent-platform/model-garden/locations/us-central1/deployments?project=..."]`)
  also contains `/model-garden/`; a link regex must exclude
  `/model-garden/locations/` and `/model-garden/questionnaire`.

Rows for the query `claude sonnet 5` (row id suffix | Name | slug | Resource ID):

| N | Name | href slug | Resource ID |
|---|---|---|---|
| 0 | Claude Sonnet 5.5 | publishers/anthropic/model-garden/claude-sonnet-5-5 | claude-sonnet-5-5@default |
| 1 | Claude Sonnet 5 | publishers/anthropic/model-garden/claude-sonnet-5 | claude-sonnet-5@default |
| 2 | Qwen3.6 | publishers/qwen/model-garden/qwen3-6 | Qwen/Qwen3.6-35B-A3B |
| 3 | GLM 4.7 | publishers/zai-org/model-garden/glm-4.7 | GLM-4.7-FP8 |
| 4 | Claude Sonnet 4.6 | publishers/anthropic/model-garden/claude-sonnet-4-6 | claude-sonnet-4-6@default |
| 5 | GLM 4.7 API Service | publishers/zai-org/model-garden/glm-4.7-maas | zai-org/glm-4.7-maas |
| 6 | Claude Opus 4.5 | publishers/anthropic/model-garden/claude-opus-4-5 | claude-opus-4-5@20251101 |
| 7 | Kimi K2 Thinking API Service | publishers/moonshotai/model-garden/kimi-k2-thinking-maas | moonshotai/kimi-k2-thinking-maas |
| 8 | MiniMax-M2, MiniMax-M2.1, MiniMax-M2.5 | publishers/minimaxai/model-garden/minimax-m2 | minimaxai/minimax-m2.5 |
| 9 | MiniMax-M2 API Service | publishers/minimaxai/model-garden/minimax-m2-maas | minimaxai/minimax-m2-maas |
| 10 | Claude Haiku 4.5 | publishers/anthropic/model-garden/claude-haiku-4-5 | claude-haiku-4-5@20251001 |

The exact title `Claude Sonnet 5` is row 1, not row 0: an exact-title (or
href-ends-with-slug) match is required, a "first result" or
"contains" rule would open Claude Sonnet 5.5.

**Click path to the model page**:
`tr#_0rif_cfc-table-caption-0-row-1 > td:nth-of-type(2) > a` (the Name
link), i.e. `//table[contains(@class,'cfc-table-element')]//td[@role='rowheader']//a[normalize-space()='Claude Sonnet 5']`,
or `a[href*="/model-garden/claude-sonnet-5?"]`. A plain `click()` on the
`<a>` is an **in-app route change**: the URL became
`/agent-platform/publishers/anthropic/model-garden/claude-sonnet-5?project=<project-id>&pageState=(...)`
1.6 s after the click, the `window` marker survived (no document reload),
no new tab. The model page's `Enable` button was visible 11.9 s after the
click (vs 16-24 s for a cold `driver.get` of the model page). The
`pageState` tail is carried over and harmless; `driver.get` of the plain
model URL in step 08 drops it.

**Enablement flow for Sonnet 5 vs the Haiku 4.5 / Sonnet 4.6 runs**

- New on the model page, before and after enabling: a "Cyber Verification"
  card above the hero,
  `div.cyber-verification-card-container > div.cyber-verification-card >
  div.cyber-verification-body` ("The Cyber Verification program lets
  verified users work on high-risk, dual-use tasks on Claude with fewer
  automatic blocks and less hassle." + `a.cyber-verification-learn-more`
  to support.claude.com) followed by
  `mat-radio-group.enrollment-mode-group[role=radiogroup]` with
  `mat-radio-button.enrollment-mode-option[value=standard]` (checked by
  default, "Standard use cases / This model is ready to use for your
  project.") and `[value=cvp]` ("Cyber Verification Program / High risk or
  dual use cases require additional steps."). It is rendered by the same
  component as the CTA stack. The Haiku 4.5 and Sonnet 4.6 pages (runs
  185747, 190153, 190410) have no such card. The flow left the radio at its
  default and did not need to touch it. A radio-helper that searches the
  whole page for `mat-radio-button` would now find these two on the model
  page; `form.choose_radio` is only called on the questionnaire.
- Marketplace product id differs per model: `anthropic-896` for Sonnet 5
  (`mp=anthropic%2Fanthropic-896.cloudpartnerservices.goog` on the
  questionnaire URL, `/marketplace/agreements/anthropic/anthropic-896.cloudpartnerservices.goog`
  for the agreements page) vs `anthropic-867` (Haiku 4.5) and
  `anthropic-884` (Sonnet 4.6). Do not hard-code it; it comes from the
  Enable click.
- Questionnaire: identical fields (same eleven `raf-name`s), same fill
  sequence worked unchanged. Agreements page: same structure (`Select
  Location` = global, one `mat-checkbox`, `Agree`), more SKU rows (41
  controls vs 31 for Haiku), prices in the billing currency.
- No `Enable APIs` dialog on any page (the API was enabled by the Haiku run
  earlier), only the gallery banner described above.
- Agree result: the same `mp-consent-complete-dialog`, `h1` `Successfully
  purchased Claude Sonnet 5`, body "Now that you've agreed to the terms,
  you can enable Claude Sonnet 5 in Agent Platform", single button
  `Manage on Agent Platform`. The settle detector in `flow.step_agree_approved`
  reported `agree-button-gone` (the spinner state, held for 3 s) at 5.3 s
  and the dialog opened after that; the `07-post-agree-settled` dump 5 s
  later contains the dialog. The detector should keep polling for a dialog
  for a few seconds after the button disappears.
- Enabled state: step 08 (`driver.get` of the model page about 10 s after
  the dialog, 28.3 s render) already showed
  `vertex-ai-open-generation-ai-studio-button > a` `Open in Agent Studio`
  (`href="/vertex-ai/generative/multimodal/create/text?model=claude-sonnet-5&project=<project-id>"`)
  and no `vertex-ai-request-access-button`: no propagation lag this time
  (the Haiku run still showed `Enable` at that point).
- Timings: Enable -> questionnaire URL 1.6 s, form ready 3.5 s; Next ->
  Agree button 12.5 s; all in-app route changes, no document reload.
