#!/usr/bin/env python3
"""One-time interactive Google login into the dedicated Chrome profile.

Run:  python/.venv/bin/python python/scripts/login.py [--profile DIR]
"""
from __future__ import annotations

import argparse
import sys

import _bootstrap  # noqa: F401

from mgclick.browser import make_driver
from mgclick.paths import DEFAULT_PROFILE_DIR
from mgclick.urls import console_home, is_console, is_login_page


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--profile", default=str(DEFAULT_PROFILE_DIR), help="Chrome user-data-dir")
    args = ap.parse_args()

    driver = make_driver(args.profile, headless=False)
    try:
        driver.get(console_home())
        print(f"Profile: {args.profile}")
        print("Log in to Google in the opened window, then come back here and press Enter")
        try:
            input()
        except EOFError:
            print("stdin closed; assuming you are done")
        url = driver.current_url
        print(f"Current URL: {url}")
        if is_login_page(url):
            print("RESULT: still on accounts.google.com - login did not complete. Run this script again.")
            return 1
        if is_console(url):
            print("RESULT: logged in - console.cloud.google.com reached. Cookies persist in the profile.")
            return 0
        print("RESULT: unexpected URL; not on console.cloud.google.com. Check the window and retry.")
        return 2
    finally:
        driver.quit()


if __name__ == "__main__":
    sys.exit(main())
