# Chrome Web Store assets

Promotional images, screenshots and listing text for the Model Garden Clicker
extension. All images are stripped of EXIF/metadata, so they are ready to upload
in the Developer Dashboard.

| File | Dimensions | Web Store slot | Required? |
|---|---|---|---|
| `icon-128.png` | 128x128 | Store icon (copy of `extension/icons/icon128.png`) | Required |
| `small-promo-tile-440x280.png` | 440x280 | Small promo tile | Optional (recommended) |
| `marquee-1400x560.png` | 1400x560 | Marquee promo tile | Optional |

## Listing text and checklist

| File | Contents |
|---|---|
| `LISTING.md` | Every dashboard field ready to paste: title, summary, description, category, permission justifications, data-usage disclosure, test instructions for reviewers. |
| `CHECKLIST.md` | Tab-by-tab upload checklist and the review risks with the wording that answers them. |
| `../PRIVACY.md` | Privacy policy at the repository root; its public URL goes into the Privacy tab. |

## Screenshots

`screenshots/01-popup-dry-run.png` to `screenshots/05-popup-in-tab.png`, 1280x800
PNG, RGB, no alpha, no metadata. Upload them in numeric order. Each one is a
capture of the extension centred on the theme background with a one-line
caption. The two popup captures (01 and 05) come from the headless layout
probe's fake storage (`python/scripts/popup_layout.py`) and show no real
value. In the console captures (03 and 04) and the options capture (02) the
project IDs (the console's project picker, the badge lines and the panel),
the account avatar with its counter badge and the free-trial day ring, every
questionnaire value (business name, website, email, country, industry,
intended users, use case) and the billing currency, price and exchange-rate
lines are covered with the local background colour.

## Source

All images are cropped/resized from original photos of the author's dog (a German
Shepherd). Originals are not stored in this repository.
