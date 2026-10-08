#!/usr/bin/env python3
"""Drive the Model Garden "Enable" flow up to, but NOT including, "Agree".

Dumps a snapshot (page.html, screenshot.png, url.txt, forms.json) after each
step under python/recon/<timestamp>-<project>-<model>/NN-<step>/.

Steps:
  01-model-page         open the model page, find the "Enable" button
  02-after-enable       click Enable, wait for the questionnaire
  03-form-filled        fill the questionnaire from config.local.json
  04-agreements         click Next, wait for the "Purchase summary" page
  05-agreements-checked tick the terms checkbox
  99-failure            whatever the page looked like when a step failed
  NN-<step>-api-dialog  the "Enable APIs" dialog, if it was open on that page
                        (its Enable button is clicked and the dialog waited out)

With --i-approve-agree (explicit opt-in) three more steps run:
  06-after-agree        dumped right after Agree was clicked
  07-post-agree-settled after the confirmation / redirect / error settled (<=120 s)
  08-model-page-after   the model page reopened: the "already enabled" state

By default THE AGREE BUTTON IS NEVER CLICKED. mgclick.form.click_button
refuses any button whose text contains "agree", and this script only asks it
for "Enable" and "Next". Only --i-approve-agree calls form.click_agree_approved.

Timing of every step and whether a click caused a full document reload or an
in-app route change is written to <run>/timing.json (see docs/dom-map.md).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import _bootstrap  # noqa: F401

from mgclick.browser import make_driver
from mgclick.config import load_config
from mgclick.paths import DEFAULT_PROFILE_DIR, RECON_DIR
from mgclick.recon import snapshot
from mgclick.urls import DEFAULT_MODEL_SLUG, anthropic_model_url

from mgclick.flow import (
    LOOK_SECONDS,
    TIMING,
    step_agree_approved,
    step_check_terms,
    step_click_enable,
    step_fill_form,
    step_next_to_agreements,
    step_open_model_page,
)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--project", required=True, help="GCP project id")
    ap.add_argument("--model", default=DEFAULT_MODEL_SLUG, help="model slug (default: %(default)s)")
    ap.add_argument("--out", default=None, help="run directory (default: python/recon/<ts>-<project>-<model>/)")
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE_DIR), help="Chrome user-data-dir")
    ap.add_argument("--config", default=None, help="path to config.local.json")
    ap.add_argument("--i-approve-agree", action="store_true",
                    help="EXPLICIT OPT-IN: after 05, click Agree once and record steps 06-08. Default: never.")
    args = ap.parse_args()

    cfg = load_config(args.config)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    run_dir = Path(args.out) if args.out else RECON_DIR / f"{ts}-{args.project}-{args.model}"
    run_dir.mkdir(parents=True, exist_ok=True)
    url = anthropic_model_url(args.project, args.model)
    print(f"[recon] run dir: {run_dir}")
    print(f"[recon] model page: {url}")

    driver = make_driver(args.profile, headless=False)
    current_step = "01-model-page"
    try:
        try:
            state = step_open_model_page(driver, url, run_dir)
            if state == "login":
                print("not logged in, run scripts/login.py")
                return 3
            if state == "enabled":
                print("Model appears to be ALREADY ENABLED ('Open in Agent Studio' replaces 'Enable'). Nothing to do.")
                return 0

            current_step = "02-after-enable"
            step_click_enable(driver, run_dir)

            current_step = "03-form-filled"
            step_fill_form(driver, cfg, run_dir)

            current_step = "04-agreements"
            step_next_to_agreements(driver, run_dir)

            current_step = "05-agreements-checked"
            step_check_terms(driver, run_dir)

            if args.i_approve_agree:
                current_step = "06-after-agree"
                step_agree_approved(driver, run_dir, url)
        except Exception as exc:  # noqa: BLE001
            print(f"[recon] FAILED at step {current_step}: {exc!r}")
            try:
                snapshot(driver, run_dir, "99-failure")
            except Exception as dump_exc:  # noqa: BLE001
                print(f"[recon] could not dump failure page: {dump_exc!r}")
            return 1

        print()
        print("=" * 72)
        if args.i_approve_agree:
            print("AGREE WAS CLICKED BECAUSE --i-approve-agree WAS GIVEN. SEE 06/07/08 DUMPS.")
        else:
            print("THE AGREE BUTTON WAS NOT CLICKED. THE MODEL HAS NOT BEEN ENABLED.")
        print("REVIEW THE PAGE IN THE BROWSER; IT CLOSES IN %d SECONDS." % LOOK_SECONDS)
        print("=" * 72)
        time.sleep(LOOK_SECONDS)
        return 0
    finally:
        (run_dir / "timing.json").write_text(json.dumps(TIMING, indent=2) + "\n", encoding="utf-8")
        driver.quit()
        print(f"[recon] done; dumps in {run_dir}")


if __name__ == "__main__":
    sys.exit(main())
