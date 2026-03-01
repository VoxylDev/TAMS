"""
Human-readable formatters for TAMS MCP tool responses.

Converts raw JSON API responses into clean, scannable text output
so users see formatted summaries instead of nested dictionaries.
"""

from __future__ import annotations

import time

# Depth index -> human-readable layer name
DEPTH_NAMES = {
    0: "Theme",
    1: "Gist",
    2: "Outline",
    3: "Entities",
    4: "Detail",
    5: "Exchanges",
    6: "Raw",
}


def format_context(data: dict) -> str:
    """Format the always-on memory context block."""

    tokens = data.get("totalTokens", 0)
    layers = data.get("layers", [])
    recent_convos = data.get("recentConversations", [])
    recent_prompts = data.get("recentPrompts", [])

    if not layers and not recent_convos and not recent_prompts:
        return "Memory context loaded (empty — no conversations stored yet)"

    lines = [f"Memory context loaded ({tokens} tokens)"]

    # Group layers by depth
    by_depth: dict[int, list[dict]] = {}
    for layer in layers:
        depth = layer.get("depth", -1)
        if depth not in by_depth:
            by_depth[depth] = []
        by_depth[depth].append(layer)

    # Print each depth group
    for depth in sorted(by_depth.keys()):
        name = DEPTH_NAMES.get(depth, f"D{depth}")
        group = by_depth[depth]
        lines.append("")
        lines.append(f"{name}s:")
        for layer in group:
            temporal = layer.get("temporal", "")
            content = (layer.get("content", "") or "").strip()
            # Show the temporal scope (e.g. "year.2026" or "month.03.day.01")
            label = temporal or "unknown"
            # Truncate long content for themes/gists
            if depth <= 1 and len(content) > 300:
                content = content[:297] + "..."
            lines.append(f"  [{label}] {content}")

    # Recent conversations and prompts
    if recent_convos or recent_prompts:
        lines.append("")
        if recent_convos:
            lines.append(f"Recent conversations: {len(recent_convos)}")
        if recent_prompts:
            lines.append(f"Recent prompts: {len(recent_prompts)}")

    return "\n".join(lines)


def format_status(data: dict) -> str:
    """Format TAMS system health status."""

    ready = data.get("ready", False)
    db = data.get("database", {})
    cache = data.get("cache", {})
    consol = data.get("consolidation", {})
    stm = data.get("stm", {})
    prompts = data.get("prompts", {})

    lines = [f"TAMS Status: {'Ready' if ready else 'Not Ready'}"]

    # Database
    total = db.get("totalNodes", 0)
    by_temporal = db.get("byTemporal", {})
    if by_temporal:
        parts = [
            f"{v} {k}{'s' if v != 1 else ''}"
            for k, v in sorted(by_temporal.items(), key=lambda x: -x[1])
        ]
        lines.append(f"Database: {total} nodes ({', '.join(parts)})")
    else:
        lines.append(f"Database: {total} nodes")

    # Cache
    hits = cache.get("hits", 0)
    misses = cache.get("misses", 0)
    rate = cache.get("hitRate", 0)
    lines.append(f"Cache: {rate:.0%} hit rate ({hits} hits, {misses} misses)")

    # Consolidation
    tokens_used = consol.get("totalTokensUsed", 0)
    queue_len = consol.get("queueLength", 0)
    processing = consol.get("processing", False)
    queue_status = (
        "processing"
        if processing
        else f"{queue_len} queued"
        if queue_len
        else "queue empty"
    )
    lines.append(f"Consolidation: {tokens_used:,} tokens used, {queue_status}")

    # STM + Prompts
    stm_size = stm.get("bufferSize", 0)
    stm_max = stm.get("maxEntries", 0)
    prompt_size = prompts.get("bufferSize", 0)
    prompt_max = prompts.get("maxPrompts", 0)
    lines.append(
        f"STM: {stm_size}/{stm_max} entries | Prompts: {prompt_size}/{prompt_max} buffered"
    )

    return "\n".join(lines)


def format_store(data: dict) -> str:
    """Format conversation store confirmation."""

    path = data.get("path", "unknown")
    queued = data.get("queued", False)
    position = data.get("queuePosition", 0)

    line = f"Stored at {path}"
    if queued:
        line += f"\nConsolidation queued (position {position})"
    return line


def format_prompt_store(data: dict) -> str:
    """Format prompt store confirmation."""

    stored = data.get("stored", False)
    size = data.get("bufferSize", 0)

    if stored:
        return f"Prompt stored (buffer: {size} entries)"
    return f"Prompt store failed (buffer: {size} entries)"


def format_retrieve(data: dict) -> str:
    """Format memory retrieval with layer content."""

    layers = data.get("layers", [])
    resolved = data.get("resolvedPath", "")
    source = data.get("source", "unknown")

    if not layers:
        scope = resolved or "current scope"
        return f"No memory found at {scope}"

    lines = [f"Retrieved {len(layers)} layers from {resolved} (source: {source})"]

    for layer in layers:
        depth = layer.get("depth", -1)
        name = DEPTH_NAMES.get(depth, f"D{depth}")
        content = (layer.get("content", "") or "").strip()
        lines.append("")
        lines.append(f"[D{depth} {name}]")
        lines.append(content)

    return "\n".join(lines)


def format_search(data: dict) -> str:
    """Format entity/topic search results."""

    results = data.get("results", [])

    if not results:
        return "No results found."

    lines = [f"Found {len(results)} results:"]

    for i, node in enumerate(results, 1):
        path = node.get("path", "unknown")
        depth = node.get("depth", -1)
        name = DEPTH_NAMES.get(depth, f"D{depth}")
        tokens = node.get("tokenCount", 0)
        content = (node.get("content", "") or "").strip()

        lines.append("")
        lines.append(f"{i}. {path} ({name}, {tokens} tokens)")

        # Truncate content preview
        if content:
            preview = content[:200]
            if len(content) > 200:
                preview += "..."
            # Indent content preview
            for line in preview.split("\n")[:3]:
                lines.append(f"   {line}")

    return "\n".join(lines)


def format_consolidate(data: dict) -> str:
    """Format consolidation trigger result."""

    path = data.get("path", "unknown")
    queued = data.get("queued", False)
    result = data.get("result")

    if result:
        layers = result.get("layersGenerated", 0)
        tokens = result.get("tokensUsed", 0)
        return f"Consolidation complete at {path}: {layers} layers, {tokens:,} tokens"

    if queued:
        return f"Consolidation queued at {path}"

    return f"Consolidation triggered at {path}"


def _format_relative_time(stored_at_ms: int) -> str:
    """Format a Unix ms timestamp as a human-readable relative time."""

    now_ms = int(time.time() * 1000)
    diff_min = (now_ms - stored_at_ms) // 60_000

    if diff_min < 1:
        return "just now"
    if diff_min < 60:
        return f"{diff_min} min ago"

    diff_hr = diff_min // 60

    if diff_hr < 24:
        return f"{diff_hr} hr ago"

    diff_days = diff_hr // 24

    return f"{diff_days}d ago"


def format_stm(stm_data: dict | None, prompts_data: dict | None) -> str:
    """Format short-term memory buffer contents.

    Takes the raw JSON from GET /stm and/or GET /prompts and
    renders numbered entries with relative timestamps and device info.
    """

    conversations = (stm_data or {}).get("entries", [])
    prompts = (prompts_data or {}).get("entries", [])

    if not conversations and not prompts:
        return "STM buffers are empty. No recent conversations or prompts stored."

    lines: list[str] = []

    # Header with counts
    parts: list[str] = []

    if conversations:
        parts.append(f"{len(conversations)} conversations")
    if prompts:
        parts.append(f"{len(prompts)} prompts")

    lines.append(f"STM buffers ({', '.join(parts)})")

    # Conversation entries
    if conversations:
        lines.append("")
        lines.append(f"Recent Conversations ({len(conversations)} entries):")

        for i, entry in enumerate(conversations, 1):
            age = _format_relative_time(entry.get("storedAt", 0))
            device = entry.get("device", {}).get("name", "unknown")
            content = entry.get("content", "")

            lines.append(f"\n[{i}] ({age}, {device})")
            lines.append(content)

    # Prompt entries
    if prompts:
        lines.append("")
        lines.append(f"Recent User Prompts ({len(prompts)} entries):")

        for i, entry in enumerate(prompts, 1):
            age = _format_relative_time(entry.get("storedAt", 0))
            device = entry.get("device", {}).get("name", "unknown")
            content = entry.get("content", "")

            lines.append(f"[{i}] ({age}, {device}) {content}")

    return "\n".join(lines)
