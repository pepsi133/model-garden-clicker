"""Chrome driver factory.

Uses a dedicated user-data-dir because Chrome 136+ refuses remote debugging
on the default profile. The user logs into that profile once with
scripts/login.py; cookies then persist between runs.

Driver resolution
-----------------
A chromedriver on PATH (for example a distribution's Chromium driver) may
not match the installed Google Chrome. Selenium Manager scans PATH first
and, when it finds a chromedriver there, uses it even after warning that it
is incompatible. So we run Selenium Manager ourselves with a shim PATH that
exposes only `uname` and `sh` (which it needs internally) and no
chromedriver, pass the real Chrome binary explicitly, and forbid a browser
download. It then downloads a matching chromedriver once into
~/.cache/selenium/chromedriver/ and reuses it on later runs.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.selenium_manager import SeleniumManager

from .paths import DEFAULT_PROFILE_DIR

CHROME_BINARY = "/usr/bin/google-chrome"
WINDOW_SIZE = (1400, 1000)
_SHIM_TOOLS = ("uname", "sh")


@contextmanager
def _shim_path():
    """Temporarily replace PATH with a dir holding only the tools Selenium Manager needs."""
    shim = Path(tempfile.mkdtemp(prefix="mgclick-sm-path-"))
    try:
        for tool in _SHIM_TOOLS:
            real = shutil.which(tool)
            if real:
                (shim / tool).symlink_to(real)
        old = os.environ.get("PATH")
        os.environ["PATH"] = str(shim)
        try:
            yield
        finally:
            if old is None:
                os.environ.pop("PATH", None)
            else:
                os.environ["PATH"] = old
    finally:
        shutil.rmtree(shim, ignore_errors=True)


def resolve_chromedriver(chrome_binary: str = CHROME_BINARY) -> str:
    """Return the path of a chromedriver matching `chrome_binary`, via Selenium Manager."""
    args = [
        "--browser", "chrome",
        "--browser-path", chrome_binary,
        "--avoid-browser-download",
    ]
    with _shim_path():
        paths = SeleniumManager().binary_paths(args)
    driver_path = paths.get("driver_path")
    if not driver_path or not Path(driver_path).is_file():
        raise RuntimeError(f"Selenium Manager did not return a usable chromedriver: {paths!r}")
    return driver_path


def resolve_chrome_for_testing(browser_version: str) -> tuple[str, str]:
    """Download (once) a Chrome for Testing build via Selenium Manager.

    Returns (driver_path, browser_path). Both land under ~/.cache/selenium/.
    Used when the branded Google Chrome cannot do something, e.g. load an
    unpacked extension from the command line (ignored since Chrome 137).
    """
    # Without --force-browser-download Selenium Manager resolves a bare major
    # version to an installed branded Chrome of that version, which is exactly
    # the binary this function exists to avoid.
    args = ["--browser", "chrome", "--browser-version", str(browser_version), "--force-browser-download"]
    with _shim_path():
        paths = SeleniumManager().binary_paths(args)
    driver_path = paths.get("driver_path")
    browser_path = paths.get("browser_path")
    if not driver_path or not Path(driver_path).is_file():
        raise RuntimeError(f"Selenium Manager did not return a usable chromedriver: {paths!r}")
    if not browser_path or not Path(browser_path).is_file():
        raise RuntimeError(f"Selenium Manager did not return a Chrome for Testing binary: {paths!r}")
    return driver_path, browser_path


def make_driver(
    profile_dir: str | Path | None = None,
    headless: bool = False,
    extension_dir: str | Path | None = None,
    browser_version: str | None = None,
    extra_args: tuple[str, ...] = (),
) -> webdriver.Chrome:
    """Launch Chrome with a dedicated profile.

    extension_dir   load that unpacked extension (--load-extension plus
                    --disable-extensions-except). Branded Google Chrome 137+
                    ignores these switches; Chrome for Testing and Chromium
                    honour them. The caller must verify the extension loaded.
    browser_version use a Chrome for Testing build of that major version
                    (downloaded by Selenium Manager) instead of CHROME_BINARY.
    extra_args      additional command-line switches.
    """
    profile = Path(profile_dir) if profile_dir else DEFAULT_PROFILE_DIR
    profile = profile.resolve()
    profile.mkdir(parents=True, exist_ok=True)

    if browser_version:
        driver_path, browser_path = resolve_chrome_for_testing(browser_version)
    else:
        driver_path, browser_path = resolve_chromedriver(), CHROME_BINARY

    opts = Options()
    opts.binary_location = browser_path
    opts.add_argument(f"--user-data-dir={profile}")
    if extension_dir:
        ext = str(Path(extension_dir).resolve())
        opts.add_argument(f"--load-extension={ext}")
        opts.add_argument(f"--disable-extensions-except={ext}")
    for arg in extra_args:
        opts.add_argument(arg)
    opts.add_argument("--no-first-run")
    opts.add_argument("--no-default-browser-check")
    opts.add_argument(f"--window-size={WINDOW_SIZE[0]},{WINDOW_SIZE[1]}")
    # Google sign-in refuses browsers that advertise automation. The harness
    # runs against the user's own account in a dedicated profile, so the
    # automation hints are not sent.
    opts.add_argument("--disable-blink-features=AutomationControlled")
    opts.add_experimental_option("excludeSwitches", ["enable-automation"])
    opts.add_experimental_option("useAutomationExtension", False)
    if headless:
        opts.add_argument("--headless=new")

    driver = webdriver.Chrome(service=Service(executable_path=driver_path), options=opts)
    driver.set_window_size(*WINDOW_SIZE)
    return driver
