"""Filesystem anchors for the python/ tree."""
from pathlib import Path

PYTHON_DIR = Path(__file__).resolve().parent.parent
DEFAULT_PROFILE_DIR = PYTHON_DIR / ".chrome-profile"
DEFAULT_CONFIG_PATH = PYTHON_DIR / "config.local.json"
EXAMPLE_CONFIG_PATH = PYTHON_DIR / "config.example.json"
RECON_DIR = PYTHON_DIR / "recon"
