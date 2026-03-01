# TAMS

**Temporal Abstraction Memory System** — Persistent, hierarchical memory for AI agents. Open source. Any LLM provider.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Your AI forgets everything between sessions. TAMS fixes that.

TAMS compresses raw conversations through **7 abstraction layers** — from verbatim transcript down to a single-sentence theme — and organizes them across time. The result: your AI agent remembers every project, every decision, every preference, across hundreds of sessions, while adding only milliseconds and a few hundred tokens to each interaction.

## Why TAMS?

### The Problem

Every AI tool today has amnesia. Claude, GPT, Copilot — they start from scratch every session. You re-explain your project, your preferences, your architecture. Every. Single. Time.

Existing memory solutions (Letta/MemGPT, custom RAG, etc.) bolt on retrieval that burns thousands of tokens and seconds of latency per query — defeating the purpose of having memory if it slows everything down.

### The TAMS Approach

**Invest compute once at write time, so every read is free.**

When a conversation is stored, TAMS runs a one-time consolidation pipeline that compresses it through 7 abstraction layers. The result is a pre-computed context block that gets injected into every prompt — no LLM calls, no vector search, no agent loops at retrieval time. Just cached data served in milliseconds.

## Benchmarks: TAMS vs Letta (MemGPT)

Head-to-head comparison: 10 conversations stored, 15 factual recall questions, 3 independent runs. Same LLM (Claude Sonnet 4.5) for all systems.

| | Letta | TAMS |
|---|-------|------|
| **Recall accuracy** (avg 3 runs) | 95.6% | **97.8%** |
| **Retrieval latency** | ~10-14s per query | **~50ms** |
| **Store latency** | ~24,200ms (degrades over time) | **~24ms** (constant) |
| **LLM calls per read** | 1-3 | **0** |
| **Token cost per read** | ~3,000 | **0** |

**200x faster retrieval. 1,000x faster storage. Near-perfect recall.**

TAMS retrieval serves pre-computed context from PostgreSQL/Redis — no LLM reasoning loop, no vector search, no tool-call chains. Letta's agent loop gets progressively slower as context accumulates (22s → 92s per store in our [LoCoMo benchmark](BENCHMARKS.md#locomo-benchmark-acl-2024) with 272 sessions).

Full methodology, architecture comparison, and raw numbers: **[BENCHMARKS.md](BENCHMARKS.md)**

## How It Works

```
Session 1: "We're building Aurora, a Godot 4.3 multiplayer game..."
                ↓ Store (~24ms, async)
                ↓ Consolidate (background, ~30s)
                ↓
         ┌─────────────────────────────────────┐
         │  D0: Theme    "Multiplayer game..."  │  ~35 tokens
         │  D1: Gist     Key decisions + facts  │  ~117 tokens
         │  D2: Outline  Bullet-point map       │  ~282 tokens
         │  D3: Entities JSON: names, tools...  │  ~545 tokens
         │  D4: Detail   Full reasoning chains  │  ~544 tokens
         │  D5: Exchange  Compressed dialog     │  ~414 tokens
         │  D6: Raw      Verbatim transcript    │  ~635 tokens
         └─────────────────────────────────────┘

Session 2: Context block injected automatically (~50ms, ~600 tokens)
         → AI knows about Aurora, Godot 4.3, your architecture, your decisions
         → No "remind me what we're working on" ever again
```

## Quick Start

### Docker (Recommended)

```bash
git clone https://github.com/VoxylDev/TAMS.git
cd TAMS

# Set your LLM API key
echo "TAMS_LLM_API_KEY=sk-..." > .env

# Start PostgreSQL + Redis + TAMS server
docker compose up -d

# Verify
curl http://localhost:3100/health
```

### Bootstrap Your First User

```bash
# Create a user
curl -X POST http://localhost:3100/admin/users \
  -H "Content-Type: application/json" \
  -d '{"name": "admin"}'

# Generate an auth token (use the user_id from above)
curl -X POST http://localhost:3100/admin/tokens \
  -H "Content-Type: application/json" \
  -d '{"user_id": "<user-id>", "label": "primary"}'
```

Save the `plaintext` token from the response — it's shown only once.

### Connect to Claude Code, Cursor, or Any MCP Client

```bash
cd packages/bridge
uv sync
uv run tams-mcp
```

Add to your MCP client config (e.g. Claude Code `settings.json`):

```json
{
  "mcpServers": {
    "tams-memory": {
      "command": "uv",
      "args": ["--directory", "/path/to/TAMS/packages/bridge", "run", "tams-mcp"],
      "env": {
        "TAMS_BASE_URL": "http://localhost:3100",
        "TAMS_AUTH_TOKEN": "tams_..."
      }
    }
  }
}
```

That's it. Your AI now has persistent memory across every session.

**Optional:** Set `store_frequency` in `~/.config/tams/config.json` (or `TAMS_STORE_FREQUENCY` env var) to control how often the AI stores to memory. Values range from `1` (minimal — session end only) to `5` (aggressive — every few messages). Default is `3` (balanced).

## The 7 Abstraction Layers

Every conversation is compressed through 7 layers, each with a strict format contract:

| Depth | Name | What It Contains | ~Tokens | Compression |
|-------|------|------------------|---------|-------------|
| **D0** | Theme | Single sentence — the abstract essence | ~35 | **18x** |
| **D1** | Gist | 2-3 sentences — what happened and what was decided | ~117 | **5.4x** |
| **D2** | Outline | Bullet-level topic map | ~282 | 2.3x |
| **D3** | Entities | Structured JSON — names, tools, decisions, relationships | ~545 | 1.2x |
| **D4** | Detail | Paragraphs preserving reasoning chains | ~544 | 1.2x |
| **D5** | Exchanges | Compressed dialog, filler stripped | ~414 | 1.5x |
| **D6** | Raw | Full unmodified transcript | ~635 | 1x |

The always-on context uses D0 + D1: **full temporal awareness at ~150 tokens per conversation**. Across months of sessions, TAMS maintains awareness of hundreds of past conversations while injecting only ~1,000 tokens into each prompt.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  MCP Clients                     │
│  (Claude, Cursor, VS Code, Custom Agents)       │
└──────────────────┬──────────────────────────────┘
                   │ MCP Protocol (stdio or HTTP)
┌──────────────────▼──────────────────────────────┐
│              MCP Bridge (Python)                  │
│  packages/bridge/ — FastMCP server               │
└──────────────────┬──────────────────────────────┘
                   │ HTTP + Bearer Token Auth
┌──────────────────▼──────────────────────────────┐
│             TAMS HTTP Server (Node.js)            │
│  packages/server/ — Hono framework               │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │          Consolidation Pipeline              │ │
│  │  packages/core/ — 7-layer abstraction        │ │
│  │  OpenAI-compatible LLM calls                 │ │
│  └─────────────────────────────────────────────┘ │
└──────┬───────────────────────────┬──────────────┘
       │                           │
┌──────▼──────┐            ┌───────▼───────┐
│ PostgreSQL  │            │    Redis      │
│ + ltree     │            │  Hot Cache    │
│ Source of   │            │  + STM Buffer │
│ truth       │            │  <1ms reads   │
└─────────────┘            └───────────────┘
```

## Short-Term Memory (STM)

Consolidation takes seconds. Session continuity needs to be instant. STM bridges the gap.

When a conversation is stored, the last ~2,000 characters are pushed into a Redis sorted set — available in under 1ms, with zero LLM calls. A separate buffer captures raw user prompts for exact session recovery.

| Buffer | Default Size | Content | TTL |
|--------|-------------|---------|-----|
| Conversations | 5 entries | Transcript tails (~500 tokens each) | 2 hours |
| Prompts | 10 entries | Raw user messages | 2 hours |

**The gradient:** Recent sessions are recalled verbatim from STM. Older sessions are recalled from consolidated D0/D1 summaries. The transition is seamless — STM entries expire as consolidation catches up.

See [DESIGN.md §8](DESIGN.md#8-short-term-memory-stm) for the full architecture.

## Any LLM Provider

TAMS uses any OpenAI-compatible API for consolidation. Swap providers with two environment variables:

| Provider | `TAMS_LLM_API_KEY` | `TAMS_LLM_BASE_URL` |
|----------|-------------------|---------------------|
| OpenAI (default) | `sk-...` | *(not needed)* |
| Anthropic | `sk-ant-api03-...` | `https://api.anthropic.com/v1/` |
| Ollama (local, free) | `ollama` | `http://localhost:11434/v1/` |
| OpenRouter | `sk-or-...` | `https://openrouter.ai/api/v1/` |
| Together | `...` | `https://api.together.xyz/v1/` |

Using Ollama brings the LLM cost to **$0**. With gpt-4o-mini, consolidation costs ~$0.002 per conversation.

## Project Structure

```
packages/
  common/     Shared types, constants, and utilities
  core/       Database, consolidation pipeline, memory tree
  server/     Hono HTTP server with auth middleware
  mcp/        MCP stdio server (Node.js, legacy)
  bridge/     MCP server (Python/FastMCP, recommended)
```

## Documentation

- **[INSTALL.md](INSTALL.md)** — Full installation and deployment guide
- **[DESIGN.md](DESIGN.md)** — Architecture deep-dive and design rationale
- **[BENCHMARKS.md](BENCHMARKS.md)** — Performance benchmarks and comparative analysis
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Development setup and contribution guide

## Community

- [Discord](https://discord.gg/JjAmZX6XZw)
- [Twitter / X](https://x.com/VoxylDev)

## License

[MIT](LICENSE) — Use it however you want.
