# TAMS Benchmarks

Comprehensive benchmarks comparing three memory approaches:
- **TAMS** — 7-layer hierarchical abstraction with pre-computed retrieval
- **Letta** (MemGPT) — Agent-loop architecture with tiered memory blocks
- **No Memory** (Control) — Raw conversation context with no memory wrapper

All benchmarks run on a single Ubuntu 24 server with PostgreSQL 16 + Redis 7 + Node.js 22.
LLM: Claude Sonnet 4.5 for all systems.

---

## Head-to-Head Recall Benchmark

A custom recall test designed to stress-test factual recall across diverse conversation topics.

### Setup

- **10 conversations** stored (game dev architecture, audio systems, procedural generation, combat mechanics, economy design, multiplayer networking, marketing strategy, performance optimization, quest systems, environment art)
- **15 recall questions** targeting specific facts, numbers, and decisions across all conversations
- **3 independent runs** for statistical reliability
- Each conversation contains specific values (numbers, names, configs) that must be recalled exactly

### Recall Accuracy (3 runs)

| | Run 1 | Run 2 | Run 3 | Average |
|---|---|---|---|---|
| **TAMS** | 15/15 | 14/15 | 15/15 | **97.8%** |
| **Letta** | 14/15 | 15/15 | 14/15 | **95.6%** |

*15 questions = ~6.7% granularity per question. "15/15" means every fact was recalled correctly for that run, not that the system is infallible — a larger question set would show more variation. Both systems are strong at recall; TAMS's advantage is speed, not accuracy margin.*

### Speed

| Metric | TAMS | Letta | Ratio |
|--------|------|-------|-------|
| **Retrieval latency** (10 conversations) | 97-230ms | N/A (per-query) | — |
| **Avg retrieval per conversation** | 9-23ms | — | — |
| **Avg answer time** | ~5,100ms | ~13,850ms | **2.7x faster** |
| **LLM calls per query** | 1 (answer only) | 1-3 (agent loop + answer) | — |

TAMS retrieval is **zero LLM calls** — all 7 abstraction layers are pre-computed during consolidation and served from PostgreSQL/Redis cache. The ~5s answer time is purely the LLM generating the answer from injected context.

Letta's higher answer time includes the agent loop: reasoning about which memory tools to call, executing archival/recall searches, then synthesizing the response. Letta also experienced timeouts (69s, 72s) on 2 of its 3 failures.

### Context Window

| Metric | TAMS | No Memory (estimated) |
|--------|------|----------------------|
| Context per query | ~28K tokens (10 convos, D0-D6) | ~full transcript |
| Retrieval method | Pre-computed layers, 0 LLM calls | N/A |

### Storage Speed

Measured during ingestion of the same 10 conversations:

| System | Avg Store Time | Method |
|--------|---------------|--------|
| **TAMS** | ~55ms | Async queue (returns instantly, consolidates in background) |
| **Letta** | ~28,678ms | Synchronous agent loop (LLM processes each message) |

TAMS is **~522x faster** at accepting new data.

---

## LoCoMo Benchmark (ACL 2024)

Standardized academic benchmark from [Snap Research](https://github.com/snap-research/locomo). Tests long-conversation memory with 10 conversations, 272 sessions, and 1,986 QA pairs across 5 categories.

### Categories

| # | Category | Questions | Description |
|---|----------|-----------|-------------|
| 1 | Multi-hop | 282 | Connecting facts across multiple sessions |
| 2 | Temporal | 321 | Time-based questions using session dates |
| 3 | Commonsense | 96 | Inference requiring world knowledge + conversation context |
| 4 | Single-hop | 841 | Direct factual recall from one session |
| 5 | Adversarial | 446 | Questions about things NOT discussed (correct answer: decline) |

### Scoring

Token-level F1 (LoCoMo standard): normalize text, tokenize, compute precision/recall/F1 on shared tokens. Adversarial questions scored 1.0 if the model correctly declines to answer, 0.0 otherwise.

### Ingestion Performance

Storage speed during setup (272 sessions across 10 conversations):

| System | Avg Store (ms) | Median (ms) | Trend Over Time | Notes |
|--------|---------------|-------------|-----------------|-------|
| **TAMS** | **24.1ms** | **23.2ms** | Constant | Async queue, no degradation |
| **Letta** | **24,222ms** | **23,508ms** | Degrades (22s → 92s) | Agent loop grows with accumulated context |

TAMS is **~1,005x faster** at storage. TAMS speed is constant regardless of how many sessions have been stored. Letta's agent loop gets progressively slower as its context accumulates — from ~22s for the first session to ~92s by session 8, a **4x degradation** within a single conversation. One Letta store exceeded the original 120s timeout (increased to 300s for reliability).

### Results

> **Status: In progress.** All 272 sessions have been ingested into both TAMS and Letta. QA evaluation (1,986 questions across 3 runs per system) is underway. F1 scores will be published here once complete.

The ingestion performance above is the primary result so far — it demonstrates the fundamental architectural difference between pre-computed consolidation (TAMS) and synchronous agent loops (Letta) at scale.

---

## Architecture Comparison

| | No Memory | Letta | TAMS |
|---|-----------|-------|------|
| **Storage model** | None | Tiered (core blocks + archival + recall) | 7-layer abstraction hierarchy |
| **Retrieval** | Full context window | LLM agent loop (tool calls) | Pre-computed context injection |
| **LLM calls per query** | 0 | 1-3 (agent reasoning + tool use) | 0 (cached) |
| **Token cost per query** | Full transcript | ~2,000-4,000 (agent context) | 0 (context is pre-built) |
| **Token cost per store** | 0 | ~2,000-4,000 (agent processing) | ~6,000 (one-time consolidation) |
| **Store latency** | N/A | ~22-90s (degrades) | ~35-55ms (constant) |
| **Retrieval latency** | N/A | ~10-14s per query | ~50ms (cached) |
| **Temporal awareness** | None | Limited (compaction) | Full (conversation/day/week/epoch) |
| **Scales with history** | Context window fills up | Agent loop degrades | Pre-computed, constant speed |

### Key Takeaways

1. **TAMS invests compute at write time** (consolidation) so reads are nearly free.
   Letta invests compute at read time (agent loop) so writes queue up but reads are slow.

2. **TAMS context is deterministic** — the same pre-computed layers are injected every time.
   Letta's recall depends on the agent's reasoning, which can miss facts or timeout.

3. **TAMS doesn't degrade with history.** Retrieval speed stays constant whether you have 10 or 1,000 conversations stored. Letta's agent loop grows with accumulated context, causing measurable slowdown and occasional timeouts.

4. **No Memory is fast but finite.** Injecting full transcripts works for small histories but hits context window limits quickly. For the LoCoMo benchmark (272 sessions per conversation), this approach is impractical for production use.

---

## TAMS Internal Benchmarks

Benchmarked against a production TAMS instance with 14+ real conversations stored across multiple days.

### Context Retrieval (the 95% path)

The always-on context block is served on every interaction. It contains D0 summaries across all temporal levels and D1 for the current period.

| Metric | Value |
|--------|-------|
| Average | 22.4ms |
| P50 | 20.1ms |
| Min | 18.2ms |
| Max | 66.3ms |

*20 iterations over LAN. First request includes cache warm-up.*

After Redis cache warm-up, context retrieval is sub-millisecond on localhost.

### Retrieval by Depth

| Depth | Time | Response Size | ~Tokens |
|-------|------|---------------|---------|
| D0 only | 19.5ms | 421 chars | ~105 |
| D0-D1 | 17.7ms | 3.9 KB | ~977 |
| D0-D2 | 24.9ms | 18.5 KB | ~4,637 |
| D0-D3 | 24.7ms | 32.3 KB | ~8,083 |
| D0-D4 | 37.1ms | 49.6 KB | ~12,397 |

The default context injection (D0+D1) costs ~977 tokens — well within any model's context window while providing full temporal awareness.

### Entity Search

Searching the D3 (entities) layer across all stored conversations:

| Query | Time |
|-------|------|
| "PostgreSQL" | 71.9ms |
| "consolidation" | 21.9ms |
| "memory" | 20.7ms |
| "authentication" | 28.2ms |
| "Redis" | 37.3ms |

### Memory Compression

A single conversation compressed through all 7 layers:

| Layer | Tokens | Compression vs Raw |
|-------|--------|--------------------|
| **D6** (Raw) | ~635 | 1x (baseline) |
| **D5** (Exchanges) | ~414 | 1.5x |
| **D4** (Detail) | ~544 | 1.2x |
| **D3** (Entities) | ~545 | 1.2x |
| **D2** (Outline) | ~282 | 2.3x |
| **D1** (Gist) | ~117 | **5.4x** |
| **D0** (Theme) | ~35 | **18x** |

The always-on context (D0 + D1) provides full temporal awareness at **~150 tokens per conversation**. Across weeks of conversations, this compounds dramatically.

### Consolidation Performance

| Metric | Value |
|--------|-------|
| Store (async queue) | 61ms |
| Full consolidation | ~30s |
| LLM calls | 6 sequential (D6→D5, D6→D4→D3→D2→D1→D0) |
| Tokens consumed | ~6,074 |
| Layers generated | 7 |

Consolidation runs asynchronously — the store call returns immediately and the 7-layer pipeline executes in the background.

### Cost Estimate

Based on consolidation token usage with gpt-4o-mini pricing ($0.15/1M input, $0.60/1M output):

| Operation | Est. Cost |
|-----------|-----------|
| Single conversation consolidation | ~$0.002 |
| Daily consolidation (5 conversations) | ~$0.01 |
| Weekly consolidation | ~$0.02 |
| Context retrieval | $0 (cached) |

**Monthly cost for active use (~10 conversations/day): ~$3-5**

Using local models (Ollama) brings the LLM cost to **$0**.

## Environment

- **Server:** Ubuntu 24, single machine
- **PostgreSQL:** 16 with ltree extension
- **Redis:** 7
- **Node.js:** 22
- **LLM:** Claude Sonnet 4.5 for all benchmark systems
- **Letta:** v0.16.5 with `anthropic` provider, `byok` mode
