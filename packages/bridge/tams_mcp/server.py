"""
TAMS MCP Server

Exposes the TAMS memory system as MCP tools for AI agents and coding assistants.
Connects to the TAMS HTTP server for all memory operations.
"""

import asyncio
from typing import Annotated

from fastmcp import FastMCP
from pydantic import Field

from tams_mcp.client import TAMSClient
from tams_mcp.config import settings
from tams_mcp.formatters import (
    format_consolidate,
    format_context,
    format_prompt_store,
    format_retrieve,
    format_search,
    format_status,
    format_stm,
    format_store,
)


# ============================================================================
# Store Frequency Guidance
# ============================================================================
#
# Each level maps to a paragraph of behavioral guidance that gets injected
# into the MCP server instructions. The LLM reads these instructions and
# adjusts how often it calls tams_store during a session.


STORE_FREQUENCY_GUIDANCE: dict[int, str] = {
    1: (
        "**Store frequency: Minimal (1/5)**\n"
        "Call `tams_store` only ONCE at session end with a final summary. "
        "Do not store mid-session unless explicitly asked."
    ),
    2: (
        "**Store frequency: Conservative (2/5)**\n"
        "Call `tams_store` at session end and optionally after major milestones "
        "(completing a large feature, resolving a critical bug, finishing a research deep-dive). "
        "Aim for 1-2 stores per session."
    ),
    3: (
        "**Store frequency: Balanced (3/5)**\n"
        "Call `tams_store` after completing milestones, making important decisions, and at session end. "
        "If a session runs long, store every 15-20 exchanges. Aim for 2-4 stores per session."
    ),
    4: (
        "**Store frequency: Frequent (4/5)**\n"
        "Call `tams_store` every 5-10 exchanges and after every milestone, decision, or notable finding. "
        "Aim for 4-8 stores per session. Prefer storing more often to avoid losing context."
    ),
    5: (
        "**Store frequency: Aggressive (5/5)**\n"
        "Call `tams_store` every 2-3 exchanges. Store after virtually every meaningful interaction. "
        "Maximize memory coverage at the cost of higher write volume. Aim for 8+ stores per session."
    ),
}


def build_instructions(frequency: int) -> str:
    """
    Builds the MCP server instructions with frequency-specific storage guidance.

    The store frequency setting (1-5) controls how aggressively the LLM
    is instructed to call tams_store during a session. This is purely
    advisory — the LLM reads these instructions and adjusts its behavior.

    @param frequency - Store frequency level (1=minimal through 5=aggressive).
    @returns The complete instructions string for the FastMCP server.
    """
    guidance = STORE_FREQUENCY_GUIDANCE.get(frequency, STORE_FREQUENCY_GUIDANCE[3])

    return f"""\
You have access to a persistent memory system powered by TAMS (Temporal Abstraction Memory System).
Use these tools to maintain long-term memory across sessions:

1. **Context** - Always-on memory context:
   - `tams_context`: Load the memory context block at session start

2. **Storage** - Store conversation data:
   - `tams_store`: Store a conversation transcript (see storage frequency below)
   - `tams_prompt_store`: Store each user prompt as it arrives

3. **Short-term recall** - Recent session memory:
   - `tams_stm`: Read the short-term memory buffers (recent conversations and user prompts)
   - Call this FIRST when catching up on recent work or answering "where did we leave off"
   - Reads directly from Redis — no LLM calls, sub-100ms
   - Only fall back to `tams_retrieve` or `tams_search` if STM doesn't have the answer

4. **Retrieval** - Deep memory recall:
   - `tams_retrieve`: Retrieve memory at a specific temporal scope and depth
   - `tams_search`: Search for entities and topics across memory

5. **Maintenance** - Memory consolidation:
   - `tams_consolidate`: Trigger temporal consolidation
   - `tams_status`: Check system health and statistics

Call tams_context at session start to load persistent memory.
Call tams_prompt_store for each user message as it arrives.

## Storage Frequency

{guidance}

When storing, write concise summaries focusing on what was decided and why.
Include entities (repos, files, tools, services) and problems solved.
"""


# Initialize the MCP server
mcp = FastMCP(
    name="TAMS Memory",
    instructions=build_instructions(settings.store_frequency),
)

# Global HTTP client
client = TAMSClient()


# ============================================================================
# Memory Tools
# ============================================================================


@mcp.tool(output_schema=None)
async def tams_context() -> str:
    """
    Returns the always-on memory context block (~200-400 tokens).

    Contains D0 summaries across year/month/day and D1 for current day.
    Call at session start to load persistent memory.
    """
    try:
        result = await client.context()
        return format_context(result)
    except Exception as e:
        return f"Error loading context: {e}"


@mcp.tool(output_schema=None)
async def tams_store(
    content: Annotated[
        str, Field(description="The raw conversation transcript to store.")
    ],
    session_id: Annotated[
        str | None, Field(description="Optional session identifier for tracking.")
    ] = None,
) -> str:
    """
    Stores a conversation transcript and triggers consolidation into all 7
    abstraction layers (D6 raw -> D0 theme). Call at session end to persist memory.
    """
    try:
        result = await client.store(content, session_id)
        return format_store(result)
    except Exception as e:
        return f"Error storing conversation: {e}"


@mcp.tool(output_schema=None)
async def tams_prompt_store(
    content: Annotated[str, Field(description="The user's raw prompt/message text.")],
    session_id: Annotated[
        str | None, Field(description="Optional session identifier for tracking.")
    ] = None,
) -> str:
    """
    Stores a user's raw prompt in the short-term prompts buffer.
    Call this for each user message as it arrives so that session recovery
    and "what did we last talk about?" queries can reference the user's actual words.
    """
    try:
        result = await client.store_prompt(content, session_id)
        return format_prompt_store(result)
    except Exception as e:
        return f"Error storing prompt: {e}"


@mcp.tool(output_schema=None)
async def tams_stm(
    buffer: Annotated[
        str | None,
        Field(
            description='Which buffer to read: "conversations" (stored session summaries), '
            '"prompts" (raw user messages), or "both" (default).'
        ),
    ] = None,
) -> str:
    """
    Read short-term memory buffers: recent conversation summaries and raw user prompts.

    Returns the contents of the Redis-backed STM buffers with relative timestamps.
    Call this FIRST when catching up on recent work, before using tams_retrieve or tams_search.
    """
    try:
        target = buffer or "both"
        stm_data = None
        prompts_data = None

        if target == "both":
            stm_data, prompts_data = await asyncio.gather(
                client.get_stm(), client.get_prompts()
            )
        elif target == "conversations":
            stm_data = await client.get_stm()
        else:
            prompts_data = await client.get_prompts()

        return format_stm(stm_data, prompts_data)
    except Exception as e:
        return f"Error reading STM buffers: {e}"


@mcp.tool(output_schema=None)
async def tams_retrieve(
    temporal_scope: Annotated[
        str | None,
        Field(
            description='ltree path to retrieve from (e.g. "year.2026.month.02.day.28"). Defaults to current day.'
        ),
    ] = None,
    max_depth: Annotated[
        int | None,
        Field(
            description="Maximum abstraction depth (0=theme, 1=gist, 2=outline, 3=entities, 4=detail, 5=exchanges, 6=raw). Defaults to 1."
        ),
    ] = None,
    auto: Annotated[
        bool | None,
        Field(
            description="When true, the retrieval planner analyzes the query to determine optimal temporal scope and depth automatically."
        ),
    ] = None,
    query: Annotated[
        str | None,
        Field(
            description="The user query text. Used by the retrieval planner when auto=true."
        ),
    ] = None,
) -> str:
    """
    Retrieves memory at a specific temporal scope and depth.
    Use auto=true to let the retrieval planner decide based on the query.
    """
    try:
        result = await client.retrieve(temporal_scope, max_depth, auto, query)
        return format_retrieve(result)
    except Exception as e:
        return f"Error retrieving memory: {e}"


@mcp.tool(output_schema=None)
async def tams_search(
    query: Annotated[
        str, Field(description="The search query (matched against entity data).")
    ],
    limit: Annotated[
        int, Field(description="Maximum number of results. Defaults to 5.")
    ] = 5,
) -> str:
    """
    Searches for entities and topics across the D3 layer of the memory tree.
    Finds conversations where specific tools, people, or concepts were discussed.
    """
    try:
        result = await client.search(query, limit)
        return format_search(result)
    except Exception as e:
        return f"Error searching memory: {e}"


@mcp.tool(output_schema=None)
async def tams_consolidate(
    level: Annotated[
        str,
        Field(
            description="The temporal level to consolidate: day, week, month, or year."
        ),
    ],
    path: Annotated[
        str | None,
        Field(
            description="Specific ltree path to consolidate. Defaults to current time at the given level."
        ),
    ] = None,
) -> str:
    """
    Triggers temporal consolidation at a specific level. Merges child nodes
    into a parent (e.g. conversations->day, days->week). Run after accumulating data.
    """
    try:
        result = await client.consolidate(level, path)
        return format_consolidate(result)
    except Exception as e:
        return f"Error triggering consolidation: {e}"


@mcp.tool(output_schema=None)
async def tams_status() -> str:
    """
    Returns TAMS system health: database node counts by temporal level,
    cache hit rate, consolidation token usage, and readiness state.
    """
    try:
        result = await client.status()
        return format_status(result)
    except Exception as e:
        return f"Error getting status: {e}"


def main():
    """Entry point for stdio MCP transport (local agents)."""
    mcp.run()


def main_http():
    """Entry point for streamable HTTP MCP transport (remote agents).

    Runs the MCP server over HTTP instead of stdio, allowing remote
    connections from mobile apps, web clients, or other networked agents.
    Default port is 3200 — set behind a reverse proxy for HTTPS in production.
    """
    mcp.run(transport="streamable-http", host="0.0.0.0", port=3200)


if __name__ == "__main__":
    main()
