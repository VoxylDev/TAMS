"""
TAMS Bridge Configuration

Loads settings from (in priority order):
1. Environment variables (TAMS_BASE_URL, TAMS_DEVICE_NAME, TAMS_STORE_FREQUENCY)
2. Config file (~/.config/tams/config.json)
3. Built-in defaults

If no config file exists and no environment variables override
the defaults, the first-run setup wizard is triggered automatically
when running in an interactive terminal. In non-interactive mode
(e.g. when spawned as a stdio MCP server), the wizard is skipped
and defaults are used instead.
"""

import json
import os
import socket
import sys
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# --- Config file path (XDG-compliant) ---

CONFIG_DIR = Path.home() / ".config" / "tams"
CONFIG_PATH = CONFIG_DIR / "config.json"


def load_config_file() -> dict:
    """
    Loads the persistent config file if it exists.

    @returns A dictionary of settings from the config file, or empty dict.
    """
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return {}

    return {}


class Settings(BaseSettings):
    """Configuration for the TAMS MCP bridge."""

    model_config = SettingsConfigDict(env_prefix="TAMS_", env_file=".env")

    # TAMS HTTP server connection
    base_url: str = "http://localhost:3100"

    # Device identification
    device_name: str = socket.gethostname()

    # Authentication token (tams_... format)
    auth_token: str = ""

    # Store frequency: how aggressively the LLM stores conversations.
    # 1 = minimal (session end only)
    # 2 = conservative (major milestones + session end)
    # 3 = balanced (milestones + decisions, default)
    # 4 = frequent (every 5-10 exchanges + milestones)
    # 5 = aggressive (every 2-3 exchanges)
    store_frequency: int = 3

    @field_validator("store_frequency")
    @classmethod
    def clamp_store_frequency(cls, v: int) -> int:
        """Ensures store_frequency stays within the valid 1-5 range."""
        return max(1, min(5, v))


def resolve_settings() -> Settings:
    """
    Resolves the final settings by layering config file values
    under environment variables.

    Config file values are applied as defaults — environment variables
    always take precedence (Pydantic's built-in behavior).

    If no config file exists and no env vars are set, triggers
    the interactive setup wizard.

    @returns The resolved Settings instance.
    """
    file_config = load_config_file()

    # Check if this is a first-run situation:
    # No config file AND no environment overrides
    if not file_config and not _has_env_overrides():
        if sys.stdin.isatty():
            from tams_mcp.setup import run_setup

            file_config = run_setup()

        # Non-interactive (stdio MCP): skip wizard, use defaults.
        # The agent will detect the missing config and prompt the
        # user via AskUserQuestion instead.

    # Apply config file values as environment variables (low priority).
    # Pydantic will prefer actual env vars over these.
    env_defaults = {
        "TAMS_BASE_URL": file_config.get("base_url"),
        "TAMS_DEVICE_NAME": file_config.get("device_name"),
        "TAMS_AUTH_TOKEN": file_config.get("auth_token"),
        "TAMS_STORE_FREQUENCY": str(file_config["store_frequency"])
        if "store_frequency" in file_config
        else None,
    }

    for key, value in env_defaults.items():
        if value and key not in os.environ:
            os.environ[key] = value

    return Settings()


def _has_env_overrides() -> bool:
    """
    Checks whether any TAMS-related environment variables are set.

    If they are, we skip the setup wizard since the user has already
    configured the bridge externally (e.g. via the MCP server command).

    @returns True if any TAMS_ env vars are present.
    """
    return bool(os.environ.get("TAMS_BASE_URL") or os.environ.get("TAMS_DEVICE_NAME"))


settings = resolve_settings()
