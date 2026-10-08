"""Load python/config.local.json (gitignored) into a Config dataclass."""
from __future__ import annotations

import json
import sys
from dataclasses import dataclass, fields
from pathlib import Path

from .paths import DEFAULT_CONFIG_PATH, EXAMPLE_CONFIG_PATH

REQUIRED_KEYS = (
    "business_name",
    "business_website",
    "contact_email",
    "headquarters",
    "industry",
    "intended_users",
    "use_cases",
    "aup_additional_requirements",
)
OPTIONAL_KEYS = ("aup_details",)


@dataclass(frozen=True)
class Config:
    business_name: str
    business_website: str
    contact_email: str
    headquarters: str
    industry: str
    intended_users: str
    use_cases: str
    aup_additional_requirements: str  # "yes" or "no"
    aup_details: str = ""


class ConfigError(SystemExit):
    """Raised with a human-readable message; exits with status 2."""

    def __init__(self, message: str):
        super().__init__(f"config error: {message}")


def load_config(path: str | Path | None = None) -> Config:
    cfg_path = Path(path) if path else DEFAULT_CONFIG_PATH
    if not cfg_path.is_file():
        raise ConfigError(
            f"{cfg_path} not found. Copy {EXAMPLE_CONFIG_PATH} to {cfg_path} and fill in your values."
        )
    try:
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{cfg_path} is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{cfg_path} must contain a JSON object at the top level")

    missing = [k for k in REQUIRED_KEYS if not str(raw.get(k, "")).strip()]
    if missing:
        raise ConfigError(f"{cfg_path} is missing required keys: {', '.join(missing)}")

    known = {f.name for f in fields(Config)}
    unknown = sorted(set(raw) - known)
    if unknown:
        print(f"config warning: ignoring unknown keys in {cfg_path}: {', '.join(unknown)}", file=sys.stderr)

    values = {k: str(raw[k]) for k in REQUIRED_KEYS}
    values["aup_details"] = str(raw.get("aup_details", "") or "")
    values["aup_additional_requirements"] = values["aup_additional_requirements"].strip().lower()
    if values["aup_additional_requirements"] not in ("yes", "no"):
        raise ConfigError('aup_additional_requirements must be "yes" or "no"')
    return Config(**values)
