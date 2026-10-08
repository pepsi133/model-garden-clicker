"""URL builders for the Google Cloud console Model Garden."""
from __future__ import annotations

from urllib.parse import urlencode

CONSOLE_BASE = "https://console.cloud.google.com"
DEFAULT_MODEL_SLUG = "claude-haiku-4-5"


def console_home() -> str:
    return CONSOLE_BASE + "/"


def model_garden_gallery_url(project_id: str) -> str:
    """The Model Garden gallery (all publishers)."""
    return f"{CONSOLE_BASE}/vertex-ai/model-garden?{urlencode({'project': project_id})}"


def anthropic_model_url(project_id: str, model_slug: str = DEFAULT_MODEL_SLUG) -> str:
    """The Anthropic model page where the "Enable" button lives."""
    return (
        f"{CONSOLE_BASE}/agent-platform/publishers/anthropic/model-garden/{model_slug}"
        f"?{urlencode({'project': project_id})}"
    )


def is_login_page(url: str) -> bool:
    return "accounts.google.com" in url


def is_console(url: str) -> bool:
    return url.startswith(CONSOLE_BASE) and not is_login_page(url)
