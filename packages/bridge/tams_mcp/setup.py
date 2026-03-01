"""
TAMS First-Run Setup

Interactive configuration wizard that runs when the TAMS bridge is
launched for the first time on a new device (or when the config file
is missing). Prompts for all necessary settings and writes them to
a persistent config file.

Config file location: ~/.config/tams/config.json
"""

import json
import platform
import socket
import sys

import httpx

from tams_mcp.config import CONFIG_PATH, CONFIG_DIR


def run_setup() -> dict:
    """
    Runs the interactive setup wizard.

    Prompts the user for all required TAMS bridge settings, validates
    the connection to the TAMS server, and writes the config file.

    Returns the resolved configuration dictionary.
    """
    print()
    print("=" * 60)
    print("  TAMS Memory System — First-Time Setup")
    print("=" * 60)
    print()
    print("This wizard will configure the TAMS MCP bridge for this device.")
    print("Settings are stored at:", CONFIG_PATH)
    print()

    # --- Server URL ---

    server_url = prompt(
        "TAMS server URL",
        default="http://localhost:3100",
        help_text="The HTTP address of your TAMS server (e.g. http://your-server:3100).",
    )

    # --- Device Name ---

    default_device = socket.gethostname()

    device_name = prompt(
        "Device name",
        default=default_device,
        help_text="A friendly name for this device (e.g. MacBook, Desktop, Laptop).",
    )

    # --- Store Frequency ---

    print()
    print("  How aggressively should the AI store conversations to memory?")
    print()
    print("    1 = Minimal      — Only at session end")
    print("    2 = Conservative — Major milestones + session end")
    print("    3 = Balanced     — Milestones + decisions (recommended)")
    print("    4 = Frequent     — Every few exchanges + all milestones")
    print("    5 = Aggressive   — Almost every message")
    print()

    store_frequency_raw = prompt(
        "Store frequency (1-5)",
        default="3",
        help_text="Controls how often the AI calls tams_store during a session.",
    )

    try:
        store_frequency = max(1, min(5, int(store_frequency_raw)))
    except ValueError:
        store_frequency = 3

    # --- Connection Test ---

    print()
    print(f"Testing connection to {server_url}...", end=" ", flush=True)

    try:
        resp = httpx.get(f"{server_url}/health", timeout=5.0)
        data = resp.json()

        if data.get("status") == "ok":
            print("OK")
            print(
                f"  Server: {data.get('service', 'tams')} v{data.get('version', '?')}"
            )
        else:
            print("WARNING — unexpected response:", data)
    except httpx.ConnectError:
        print("FAILED")
        print(f"  Could not connect to {server_url}.")
        print("  Make sure the TAMS server is running and accessible from this device.")

        if not confirm("Continue anyway?"):
            print("Setup cancelled.")
            sys.exit(1)
    except Exception as e:
        print(f"FAILED — {e}")

        if not confirm("Continue anyway?"):
            print("Setup cancelled.")
            sys.exit(1)

    # --- Build config ---

    frequency_labels = ["minimal", "conservative", "balanced", "frequent", "aggressive"]

    config = {
        "base_url": server_url,
        "device_name": device_name,
        "store_frequency": store_frequency,
        "platform": platform.system().lower(),
        "hostname": socket.gethostname(),
    }

    # --- Write config file ---

    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(json.dumps(config, indent=2) + "\n")

    print()
    print("Configuration saved to:", CONFIG_PATH)
    print()
    print("  Server URL:  ", config["base_url"])
    print("  Device name: ", config["device_name"])
    print(
        "  Store freq:  ",
        f"{config['store_frequency']} ({frequency_labels[config['store_frequency'] - 1]})",
    )
    print("  Platform:    ", config["platform"])
    print("  Hostname:    ", config["hostname"])
    print()
    print("Setup complete. The TAMS bridge is ready to use.")
    print("=" * 60)
    print()

    return config


def prompt(label: str, default: str = "", help_text: str = "") -> str:
    """
    Prompts the user for a value with an optional default.

    @param label - The field label to display.
    @param default - The default value shown in brackets.
    @param help_text - Optional description printed before the prompt.
    @returns The user's input, or the default if they pressed Enter.
    """
    if help_text:
        print(f"  {help_text}")

    suffix = f" [{default}]" if default else ""
    value = input(f"  {label}{suffix}: ").strip()

    return value or default


def confirm(question: str) -> bool:
    """
    Prompts the user for a yes/no confirmation.

    @param question - The question to display.
    @returns True if the user answered yes, False otherwise.
    """
    answer = input(f"  {question} (y/n): ").strip().lower()

    return answer in ("y", "yes")
