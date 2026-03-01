# TAMS: Multi-Layered Temporal Abstraction Memory System

### A biologically-inspired hierarchical memory architecture for persistent AI agents, modeled after the human brain's memory consolidation mechanisms

Version 0.2 — February 2026

---

## Contents

1. The Problem with AI Memory Today
2. How Human Memory Actually Works
3. The TAMS Architecture
4. The Seven Abstraction Layers
5. Temporal Hierarchy: Memory in Time
6. Brain-Inspired Mechanisms
7. Retrieval: How Memories Are Recalled
8. Short-Term Memory (STM)
9. Storage Architecture
10. Consolidation Pipeline
11. How TAMS Compares to Existing Systems
12. Implementation Guide
13. Cost Analysis
14. From Database to Neural Network
15. Roadmap
16. Open Questions

---

## 1. The Problem with AI Memory Today

Every time you start a new conversation with an AI assistant, it forgets everything. Your name, your projects, your preferences, the decisions you made together yesterday — all gone. The AI has no memory. It lives in an eternal present, a clean slate every time.

Current solutions to this problem fall into a few categories, and all of them are fundamentally flawed.

### 1.1 Context Windows

The simplest approach: keep the entire conversation history in the prompt. This works until it doesn't. Models have finite context windows — hard ceilings on how much text they can process at once. Even with windows expanding to hundreds of thousands of tokens, you eventually hit the wall. Worse, the model's attention degrades over long contexts. Information in the middle gets lost, a well-documented phenomenon called the "lost in the middle" problem.

### 1.2 RAG (Retrieval-Augmented Generation)

The industry's current favorite: embed past conversations as vectors, store them in a database, and retrieve similar passages when they seem relevant. This is Google search for your memory. The problem is that it treats every piece of text as equally important. A casual aside about lunch gets the same treatment as a critical business decision. There's no abstraction, no hierarchy, no sense of what matters. You're searching through noise to find signal, every single time.

### 1.3 Flat Summaries

Some systems maintain a single summary block that gets rewritten after each conversation. Better than nothing, but deeply limited. The summary has no temporal structure — it can't distinguish between what happened yesterday and what happened last month. Each rewrite risks overwriting important details with new, less important ones. There's no depth: you get the gist or nothing.

### 1.4 Memory Blocks

Systems like Letta (formerly MemGPT) introduced labeled memory segments — a "human" block, a "persona" block, a "summary" block. The AI can read and edit these blocks during conversation. This is a real step forward, but the blocks are flat. There's no hierarchy within them, no temporal organization, and no mechanism for progressive abstraction. It's a filing cabinet, not a brain.

> **The core insight:** None of these approaches model how memory actually works in biological systems. Human memory isn't a search engine, a summary, or a filing cabinet. It's a layered abstraction machine with temporal structure and built-in mechanisms for what to keep, what to compress, and what to let fade. TAMS replicates this.

---

## 2. How Human Memory Actually Works

To understand TAMS, you first need to understand what it's modeled after. Human memory is not a recording device. You don't have a tape recorder in your head that plays back experiences verbatim. What you have is far more sophisticated — and far more useful.

### 2.1 Compression, Not Storage

When you experience something, your brain immediately begins compressing it. The raw sensory flood — every pixel of your visual field, every sound wave, every tactile sensation — is reduced to a manageable representation almost instantly. By the time you "remember" something from even five minutes ago, you're already working with a compressed version. The specific words someone used are gone; the meaning remains.

This compression continues over time. Tonight, while you sleep, your hippocampus will replay today's experiences and compress them further. The emotional tone survives. The key facts survive. The gist survives. The filler disappears. By next week, today will be a paragraph. By next year, a sentence. By next decade, maybe just a feeling.

### 2.2 Reconstruction, Not Replay

When you recall a memory, you don't play it back. You reconstruct it. Your brain takes the compressed representation and fills in details from context, expectations, and general knowledge. This is why eyewitness testimony is unreliable — the reconstruction process introduces errors. But it's also why human memory is incredibly efficient. You store a tiny sketch and rebuild the painting on demand.

This has a direct parallel in AI: you don't need to store and retrieve the full conversation transcript. You store the abstract representation and let the language model reconstruct the details when needed. The model is already good at reconstruction — that's what generative AI does. You just need to give it the right sketch.

### 2.3 Emotional Weighting

Not all memories are created equal. Your amygdala tags experiences with emotional significance, and this tag determines how deeply they're encoded and how resistant they are to compression. You remember where you were during a major life event with vivid clarity. You don't remember last Tuesday's commute.

In TAMS, this translates to natural salience preservation. A conversation where a critical architectural decision was made, or where a problem was finally solved after weeks of work, inherently carries more weight than a casual greeting. The abstraction process should recognize this organically — not through explicit flags, but because competent compression naturally preserves what matters and discards what doesn't.

### 2.4 Forgetting Is a Feature

We tend to think of forgetting as a failure of memory. It's not. It's a critical feature. The Ebbinghaus forgetting curve describes how memories that aren't reinforced naturally decay over time. This is your brain's garbage collector. Without it, you'd be overwhelmed by irrelevant detail from every moment of your life.

Forgetting also creates prioritization. The memories that survive are the ones that were either emotionally significant or repeatedly reinforced through recall. Everything else fades, making the important stuff easier to find. TAMS needs this same mechanism.

### 2.5 Associative Connections

Human memory isn't organized chronologically. It's organized associatively. A smell triggers a childhood memory. A word in a conversation surfaces a completely unrelated experience from months ago. Your brain builds connections between memories based on shared concepts, emotions, and context — not just when they happened.

This means a memory system that only organizes by time is incomplete. TAMS uses temporal hierarchy as its primary structure, but it also needs to capture thematic connections across time — linking conversations from different weeks that discuss the same topic or arrive at related conclusions.

---

## 3. The TAMS Architecture

TAMS — Multi-Layered Temporal Abstraction Memory System — is built on a single structural metaphor: **the double-sided funnel.**

### 3.1 The Double Funnel

When information enters the system, it flows through the funnel's wide end. A raw conversation transcript is the widest, most detailed representation. As it passes through each layer, it gets compressed. Details are stripped. Concepts are abstracted. By the time it reaches the narrow end of the funnel, all that remains is the essential theme — a single sentence capturing what mattered.

```
STORAGE (top-down compression)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D6 (widest) : Full raw transcript
D5           : Key exchanges, stripped of filler
D4           : Paragraph-level summaries per topic
D3           : Entities, facts, decisions, relationships
D2           : Topic outline
D1           : Gist — 2-3 sentences of what happened
D0 (narrowest): Theme — one sentence, the abstract essence


RETRIEVAL (bottom-up expansion)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
D0 : Always loaded. Costs almost nothing.
D1 : Almost always loaded. A few sentences.
D2 : Loaded when the query touches a known topic.
D3 : Loaded on demand for specific facts.
D4 : Rare. Only when reasoning chains matter.
D5 : Very rare. Only when exact exchanges matter.
D6 : Almost never. Only for verbatim recall.
```

The critical insight is that **retrieval almost never goes deep.** When someone asks you what you do for a living, you say "I'm a software developer." You don't replay every workday. The deeper layers exist as insurance for the rare cases where specificity is needed, but the system operates almost entirely on the compressed top layers. This makes retrieval fast, cheap, and token-efficient.

### 3.2 Why This Matters

Current AI memory systems treat storage and retrieval as the same operation: dump everything in, search through everything to get it out. TAMS separates them. Storage is write-heavy and progressive. Retrieval is read-light and shallow. The system invests compute during consolidation (the "sleep cycle") so that retrieval during conversation is nearly free.

This mirrors the brain's strategy exactly. You spend metabolic energy during sleep to consolidate memories precisely so that waking recall is fast and effortless.

---

## 4. The Seven Abstraction Layers

TAMS uses seven distinct abstraction layers, numbered D0 (most abstract) through D6 (raw). Each layer has a strict format contract. This rigidity is essential — without it, the model performing consolidation will blur the boundaries between layers, producing inconsistent results.

Seven layers (versus five in competing approaches like TiMem) provides finer granularity for tuning retrieval depth. The difference between loading 3 vs. 4 layers is meaningful when each layer has a clear, distinct purpose.

| Depth | Name | Format | What It Contains |
|-------|------|--------|------------------|
| **D0** | Theme | Single sentence | The abstract essence. Mood, intent, or category. A human would express this as: "We talked about memory systems." Nothing more. |
| **D1** | Gist | 2–3 sentences | What happened and what was decided. The minimum summary that captures the outcome. |
| **D2** | Outline | Bullet-level | Key topics covered and positions taken. Each topic gets one line. No reasoning, just the map. |
| **D3** | Entities | Structured data | Names, tools, decisions, and relationships extracted as machine-readable data. Bridges human-readable memory and database-queryable facts. |
| **D4** | Detail | Paragraphs | Per-topic summaries that preserve reasoning chains and trade-offs. Why a decision was made, not just what. |
| **D5** | Exchanges | Compressed dialog | The back-and-forth with filler stripped. Preserves who said what and the flow of decision-making. |
| **D6** | Raw | Full transcript | The unmodified conversation, word for word. Written once, read almost never. |

### 4.1 Important: Names and Key Facts Survive Naturally

In the human brain, there is no special mechanism that "pins" important facts. Names, faces, locations, and critical decisions simply survive compression because they are the load-bearing elements of the memory. Strip them out, and the memory loses its meaning.

TAMS works the same way. If the consolidation process is competent, it will naturally preserve key entities like project names, people, and tools across every layer from D0 to D6 because those entities are essential to the meaning. No flags, no special handling. If you have to explicitly tell the system "don't forget names," the abstraction is broken.

This is a key differentiator from other memory systems that rely on explicit entity extraction and tagging. In TAMS, entity preservation is an emergent property of good compression, not a bolted-on feature.

### 4.2 Layer Immutability

Depths 0 through 3 are immutable between consolidation cycles. They are only rewritten during scheduled consolidation passes (end of day, end of week). This prevents a phenomenon we call "thrashing" — where every new message triggers a rewrite of the abstract layers, causing the gist to fluctuate constantly instead of stabilizing around meaningful themes.

Depths 4 through 6 are written in real-time as conversations happen. The raw transcript (D6) is written immediately. The exchanges (D5) and detail (D4) layers are populated at conversation end.

---

## 5. Temporal Hierarchy: Memory in Time

Each memory in TAMS doesn't just have depth (how abstract it is) — it also has temporal scope (what period of time it covers). This creates a two-dimensional structure: a tree of time periods, where each node in the tree contains its own 7-layer abstraction stack.

### 5.1 The Four Temporal Levels

| Level | Scope | Contains | Think of it as... |
|-------|-------|----------|-------------------|
| Conversation | A single chat session | All 7 layers for that one exchange | A single experience |
| Day | 24-hour period | Merged view of all conversations that day | What happened today |
| Week | 7-day period | Merged view of all days | What happened this week |
| Epoch | Month or quarter | Merged view of all weeks | The "era" you're in |

### 5.2 Fractal Structure

The temporal levels nest. Each level contains its own complete 7-layer stack. This creates a fractal structure — zoom in and you see the same pattern repeated at every scale:

```
Epoch: Q1 2026
│  D0: "Focused on product polish and growth strategy"
│  D1: "Rewrote UI systems, explored AI memory architecture,
│       adjusted monetization approach"
│  D2–D6: progressively more detailed
│
├── Week: Feb 23 – Mar 1
│   │  D0: "UI rewrite, memory architecture design"
│   │  D1–D6: progressively more detailed
│   │
│   ├── Day: February 28
│   │   │  D0: "Designing TAMS memory system"
│   │   │  D1–D6: progressively more detailed
│   │   │
│   │   ├── Conversation 1 (morning)
│   │   │   D0–D6: full stack
│   │   │
│   │   ├── Conversation 2 (afternoon)
│   │       D0–D6: full stack
```

This structure means you can ask "what did I work on this quarter?" and get an answer from the epoch's D1 layer (a few sentences) without loading a single conversation transcript. Or you can ask "what exactly did we decide about the database schema on February 28th?" and drill into that day's D3–D4 layers.

### 5.3 Day Boundaries and Conversation Clustering

Day boundaries are a human construct — a convenience for temporal indexing. In reality, a conversation at 11:55 PM may continue conceptually at 12:05 AM the next day. TAMS should track conversation clusters by topic proximity as the true atomic unit, mapping them onto calendar days as a secondary index.

This is analogous to how human memory works: you don't remember experiences as "Monday things" and "Tuesday things." You remember them as episodes, which happen to span clock boundaries.

---

## 6. Brain-Inspired Mechanisms

TAMS doesn't just borrow the brain's structure — it copies its operational mechanisms. These are not bolted-on features. They are natural consequences of the architecture, just as they are natural consequences of neural biology.

### 6.1 Emotional Weighting (Salience)

**Brain:** The amygdala tags experiences with emotional significance. High-emotion events are encoded more deeply and resist compression. You remember your wedding day in detail; you don't remember last Wednesday's lunch.

**TAMS:** High-stakes conversations naturally retain more detail in the upper layers after consolidation. A conversation where a critical business decision was made will produce a richer D1 (gist) and D2 (outline) than a casual greeting. This happens organically through competent abstraction — the consolidation model recognizes that a heated architectural debate is more information-dense than small talk and preserves accordingly. No explicit "importance score" is needed.

### 6.2 Forgetting and Decay

**Brain:** The Ebbinghaus forgetting curve describes how unreinforced memories fade over time. This isn't a bug — it's your brain's garbage collector, ensuring that the important stuff (which gets reinforced through repeated recall) stays accessible while noise fades.

**TAMS:** Entities and themes that haven't been referenced in recent conversations should lose prominence in the upper abstraction layers over time. They aren't deleted — the raw transcript at D6 is still there. But they migrate out of the D0–D1 layers, making room for current priorities. If the topic comes up again, it can be resurfaced from deeper layers and re-promoted. This is decay with the possibility of reactivation, exactly like biological memory.

### 6.3 Reconsolidation

**Brain:** When you recall a memory, it becomes temporarily malleable. Your brain literally rewrites it during the recall process, updating it with new context and perspective. This is why memories change over time — they're not static recordings but living representations that evolve through use.

**TAMS:** When a deep retrieval happens — when the system pulls up old context from D4 or D5 to answer a specific question — the consolidation pass that follows should update the upper layers with the new perspective. If you discussed a topic three months ago and revisit it now with new understanding, the abstract layers should reflect the evolved understanding, not the original one.

### 6.4 Associative Recall

**Brain:** You smell cinnamon and suddenly remember your grandmother's kitchen. Memories are connected not just by time but by shared concepts, emotions, and sensory context. These lateral connections are built unconsciously and fire automatically.

**TAMS:** The temporal tree is the primary organizational axis, but the entity layer (D3) creates lateral connections across time. When the same entity or concept appears in conversations weeks apart, those connections should be captured at the week and epoch levels. This allows the system to surface relevant old context even when the current conversation doesn't explicitly reference it — because the theme overlaps, not because the user asked for it.

### 6.5 Interference

**Brain:** New information about a topic can overwrite or distort old memories of the same topic. This is called retroactive interference. If you learn a new phone number, the old one becomes harder to recall.

**TAMS:** When a topic is discussed multiple times with evolving conclusions, the most recent understanding should dominate the upper abstraction layers. If a user changed their mind about a technology choice, the D0–D2 layers should reflect the current position, not an average of all historical positions. The older stance is preserved in the deeper layers for context, but it shouldn't compete with the current one during default retrieval.

### 6.6 Context-Dependent Recall

**Brain:** You remember better in the same context where you learned something. Students who study in the same room where they take the test perform better. Divers who learn words underwater recall them better underwater.

**TAMS:** When the current conversation's theme matches a past conversation's D0 or D1, that past memory should surface more readily — even without an explicit query. The system should recognize thematic overlap and preemptively load relevant context from past sessions that share the same abstract theme, making it available for the model to draw on naturally.

---

## 7. Retrieval: How Memories Are Recalled

Retrieval in TAMS is a two-axis search: you navigate **when** (the temporal hierarchy) and **how deep** (the abstraction layers). The default behavior is to stay shallow. Deep retrieval is the exception, not the rule.

### 7.1 The Default: Always-On Context

Every message the user sends gets augmented with a tiny block of memory context. This block is assembled from the top layers across the temporal hierarchy:

```
INJECTED INTO EVERY PROMPT:

Epoch D0:  "Building Kaetram, an MMORPG. Growth phase."
Week  D0:  "UI polish, exploring AI memory architecture."
Today D0:  "Designing the TAMS memory system."
Today D1:  "Settled on 7-layer abstraction with Postgres.
            Identified parallels with neural networks."

Total: ~200–400 tokens. One cache lookup. Milliseconds.
```

No vector search. No embedding computation. No database query (it's cached). This is the 95% path — the vast majority of interactions need nothing more than this tiny context block to be coherent and personalized.

### 7.2 Depth Selection by Query Complexity

When the user's message suggests deeper context is needed, the system loads additional layers:

| What the user is doing | Layers loaded | Example |
|------------------------|---------------|---------|
| Casual greeting | D0 only | "Hey, what's up?" |
| Continuing recent work | D0–D1 | "Let's keep working on the UI." |
| Asking about a known topic | D0–D2 | "What's my current tech stack?" |
| Looking up specific facts | D0–D3 | "What database did we choose?" |
| Understanding past reasoning | D0–D4 | "Why did we reject Redis?" |
| Tracing a decision process | D0–D5 | "Walk me through how we got here." |
| Verbatim recall | D0–D6 | "What exactly did I say about that?" |

### 7.3 The Retrieval Planner

A lightweight, fast model (such as Claude Haiku) acts as a retrieval planner. It reads the user's message plus the always-on D0 context and determines: what temporal scope is relevant, and how deep should retrieval go? This costs fractions of a cent per message and eliminates unnecessary deep lookups.

In the prototype, this can be rule-based (keyword matching on temporal references and specificity signals). In production, a trained planner will handle ambiguous cases better.

---

## 8. Short-Term Memory (STM)

The consolidation pipeline is powerful but not instant. When a conversation is stored, it takes seconds for the pipeline to generate D5 through D0. If the user starts a new session within that window, the consolidated layers from the previous session may not be ready yet. Even once consolidation completes, the always-on context (D0/D1) provides a compressed summary — not the detailed recent state the user might be continuing from.

Short-term memory solves this. It is a Redis-backed buffer that provides immediate carry-over context between sessions without waiting for consolidation. STM is the "working memory" — a fast, temporary store that bridges the gap between raw conversation storage and fully consolidated long-term memory.

### 8.1 Two Buffers

STM maintains two distinct buffers per user:

**Conversation Buffer** — Stores the tail end of recent conversation transcripts. When `tams_store` is called, the last ~2,000 characters of the transcript are extracted and pushed into a Redis sorted set. This gives the agent immediate access to what was recently discussed without loading the full D6 transcript or waiting for consolidation.

**Prompts Buffer** — Stores the raw text of recent user messages. When `tams_prompt_store` is called (typically for every user message), the exact prompt is pushed into a separate sorted set. This captures the user's actual words — not summaries, not paraphrases — enabling session recovery and "what did we last talk about?" queries with perfect fidelity.

Both buffers are scoped per user for multi-user isolation.

### 8.2 Data Structures

Each conversation buffer entry contains:

```
{
  path:        ltree path where the full conversation is stored in PostgreSQL
  content:     last ~2,000 characters of the transcript
  tokenCount:  estimated token count (chars / 4)
  storedAt:    Unix timestamp (ms)
  sessionId:   optional session identifier
  device:      { name, hostname, platform }
}
```

Each prompt buffer entry contains:

```
{
  content:     the user's raw prompt text
  storedAt:    Unix timestamp (ms)
  sessionId:   optional session identifier
  device:      { name, hostname, platform }
}
```

Device metadata is captured at store time so that context includes provenance — which device and session a memory came from. This matters in multi-device scenarios where the same user has sessions open on a laptop and a phone.

### 8.3 Redis Implementation

Both buffers use Redis sorted sets, scored by Unix timestamp:

```
tams:{userId}:stm:buffer     → conversation entries (newest first)
tams:{userId}:stm:prompts    → prompt entries (newest first)
```

**Operations:**
- `ZADD key score member` — Push a new entry (score = storedAt)
- `ZREVRANGE key 0 -1` — Get all entries, newest first
- `ZRANGE key 0 0` — Get the oldest entry (for eviction)
- `ZREM key member` — Remove a specific entry
- `EXPIRE key ttl` — Refresh TTL on every push
- `ZCARD key` — Get current buffer size

The key design choice is using sorted sets rather than simple lists. Sorted sets provide natural chronological ordering through timestamp scores, efficient access to both newest (for retrieval) and oldest (for eviction) entries, and atomic operations that prevent race conditions in concurrent access scenarios.

### 8.4 Eviction and Expiry

STM buffers are bounded by two mechanisms:

**Size-based eviction:** Each buffer has a maximum entry count (default: 5 conversations, 10 prompts). When a push would exceed the limit, the oldest entry (lowest score) is removed before the new one is added.

**Time-based expiry:** Every push operation refreshes the Redis key's TTL (default: 7,200 seconds / 2 hours). If no new entries are pushed within the TTL window, the entire key expires and the buffer is cleared. This ensures stale data doesn't persist indefinitely — if a user is inactive for 2 hours, their STM starts fresh. The refreshing strategy means that active usage continuously extends the window.

These two mechanisms complement each other. Size eviction keeps the buffer small and relevant during active use. TTL expiry garbage-collects the buffer after periods of inactivity.

### 8.5 How STM Feeds Into Context

STM entries are injected into the always-on context alongside D0/D1 consolidated layers. When `tams_context` is called at session start:

1. D0/D1 layers are loaded from Redis cache (or PostgreSQL on cache miss)
2. STM conversation entries are fetched fresh from Redis (`ZREVRANGE`)
3. STM prompt entries are fetched fresh from Redis (`ZREVRANGE`)
4. Everything is assembled into a single context block

The result is a layered context that combines long-term awareness (consolidated D0/D1 themes and gists across weeks and months) with short-term continuity (the last few conversation tails and raw user prompts). This mirrors how human memory works: you have a general sense of your long-term projects and goals, plus vivid recall of what you were just doing.

### 8.6 STM vs. Consolidation: Complementary, Not Competing

STM and the consolidation pipeline serve different purposes and operate on different timescales:

| | Short-Term Memory | Consolidation Pipeline |
|---|---|---|
| **Purpose** | Immediate session carry-over | Long-term knowledge retention |
| **Latency** | Sub-millisecond (Redis) | Seconds to minutes (LLM calls) |
| **Content** | Raw transcript tails, exact prompts | Progressively abstracted layers |
| **Lifespan** | Hours (TTL-bounded) | Permanent (PostgreSQL) |
| **LLM cost** | Zero | 6 LLM calls per conversation |
| **Fidelity** | Exact words (truncated) | Lossy compression at each layer |

STM is not a replacement for consolidation. It is a bridge — providing continuity while consolidation runs in the background. Once consolidation completes and produces rich D0/D1 summaries, those summaries provide better long-term context than raw transcript tails ever could. The STM entries naturally expire and make way for the consolidated view.

The gradient of memory fidelity over time looks like this:

```
Time since conversation:
  0-2 hours  → STM: exact transcript tails + raw prompts (high fidelity)
  2+ hours   → Consolidation: D0 themes, D1 gists (compressed but permanent)
  Days/weeks → Temporal consolidation: merged day/week/month summaries
```

This creates a seamless experience: the agent has vivid, detailed recall of very recent work, progressively compressed recall of older work, and thematic awareness of long-term patterns — all without any retrieval-time LLM calls.

### 8.7 Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TAMS_STM_MAX_ENTRIES` | `5` | Maximum conversations buffered per user |
| `TAMS_STM_MAX_PROMPTS` | `10` | Maximum user prompts buffered per user |
| `TAMS_STM_MAX_TAIL_CHARS` | `2000` | Characters kept per conversation (~500 tokens) |
| `TAMS_STM_TTL` | `7200` | Buffer expiry in seconds (2 hours) |

These values balance memory footprint against recall quality. At defaults, each user consumes roughly 12 KB of Redis memory (5 × ~2,000 chars + 10 × ~200 chars), making STM trivially cheap even at scale.

---

## 9. Storage Architecture

TAMS uses two storage layers: a relational database as the source of truth and an in-memory cache for the hot retrieval path.

### 9.1 Primary Store: PostgreSQL with ltree

The TAMS data model is a tree. Each node has a temporal level (epoch, week, day, conversation), an abstraction depth (D0–D6), content, and a parent reference. This is fundamentally a tree traversal problem — not a search problem. PostgreSQL with the ltree extension was built for exactly this.

ltree provides materialized path indexing: each node's position in the tree is encoded as a dotted path (e.g., `epoch.2026Q1.week.08.day.0228.conv.01`). This allows queries like "give me everything under this week at D0" to execute in milliseconds with a single index lookup.

```sql
CREATE EXTENSION IF NOT EXISTS ltree;

CREATE TABLE memory_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path            ltree,
  temporal        TEXT CHECK (temporal IN
                    ('epoch','week','day','conversation')),
  depth           SMALLINT CHECK (depth BETWEEN 0 AND 6),
  parent_id       UUID REFERENCES memory_nodes(id),
  content         TEXT,
  entities        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now(),
  consolidated_at TIMESTAMPTZ
);

-- Hot path: instant retrieval of top layers
CREATE INDEX idx_gist_layers ON memory_nodes (temporal, depth)
  WHERE depth <= 1;

-- Tree traversal via ltree
CREATE INDEX idx_path ON memory_nodes USING GIST (path);

-- Entity search within the structured layer
CREATE INDEX idx_entities ON memory_nodes USING GIN (entities)
  WHERE depth = 3;
```

The `parent_id` column provides upward traversal (conversation → day → week → epoch). The ltree path provides downward traversal. Both directions are indexed. No separate mapping keys are needed — the tree structure handles bidirectional navigation inherently.

### 9.2 Hot Cache: Redis

Redis holds the always-on context: the D0 and D1 layers for the current epoch, week, and day. This data is loaded at session start and invalidated whenever a consolidation pass rewrites those layers.

```
memory:epoch:current:D0   → "Building Kaetram, MMORPG, growth phase"
memory:week:current:D0    → "UI polish, AI memory architecture"
memory:day:20260228:D0    → "Designing TAMS memory system"
memory:day:20260228:D1    → "Settled on 7-layer, Postgres + Redis"
```

This eliminates database queries for 95% of interactions. The always-on context is served from RAM in sub-millisecond time.

### 9.3 Why Not a Vector Database?

Vector databases (Pinecone, Weaviate, ChromaDB) are designed for semantic similarity search: "find passages that are similar to this query." TAMS doesn't need this. The whole point of building an abstraction hierarchy is that you already know where every memory lives — by its temporal position and depth. You don't need to search for it; you navigate to it.

Vector search is a crutch for systems that dump unstructured text into a bucket and need to find relevant pieces later. TAMS eliminates the bucket.

---

## 10. Consolidation Pipeline

Consolidation is the heart of TAMS. It is the process that converts raw conversations into layered abstractions — the system's equivalent of sleeping on it.

### 10.1 When Consolidation Happens

| Trigger | What Happens | Analogy |
|---------|-------------|---------|
| Conversation ends | Raw transcript (D6) is stored. D5 and D4 are generated from it. | Short-term memory encoding |
| End of day | All conversation nodes for the day are merged into a single day node. D0–D3 are generated. | Nightly sleep consolidation |
| End of week | Day nodes merge into a week node. D0–D3 regenerated. Old conversation-level D6 (raw transcripts) can be pruned. | Weekly review |
| End of epoch | Weeks merge into epoch. Deep layers archived. Abstract layers crystallize into long-term memory. | Seasonal reflection |

### 10.2 Multi-Model Consolidation

Not all consolidation passes require the same intelligence. Bulk compression (D6 → D5) is mechanical and can be handled by a fast, cheap model. Abstract synthesis (D2 → D1 → D0) requires nuance and should use a more capable model. This tiered approach optimizes cost:

| Consolidation Pass | Recommended Model Tier | Why |
|--------------------|----------------------|-----|
| D6 → D5 (strip filler) | Fast / cheap (Haiku-class) | High volume, low nuance. Mechanical compression. |
| D5 → D4 (summarize) | Mid-tier (Haiku or Sonnet) | Some nuance needed to preserve reasoning. |
| D4 → D3 (extract entities) | Mid-tier (Sonnet-class) | Structured output. Precision matters. |
| D3 → D2 → D1 → D0 | High-tier (Sonnet or Opus) | Abstract synthesis. Nuance is critical. |

### 10.3 Low-Signal Detection

Not every conversation is worth full consolidation. A casual "hey, how's it going?" exchange contains almost no information. The system should detect low-signal conversations (through simple heuristics like message count, topic diversity, or a quick classifier) and skip or minimize their consolidation pass. This saves compute without losing anything meaningful.

### 10.4 Retention Policy

Not all layers need to be kept forever at all temporal levels:

- **Conversation level:** D6 (raw transcripts) can be pruned after the week-level consolidation confirms all important information was captured upstream.
- **Day level:** D5 and D6 can be pruned after month-level consolidation.
- **Week level:** D0–D3 are retained permanently. D4+ can be archived.
- **Epoch level:** D0–D2 are retained permanently. Everything else is archived or pruned.

This mirrors the brain's natural decay: yesterday is vivid, last month is a sketch, last year is a theme.

---

## 11. How TAMS Compares to Existing Systems

| Feature | RAG | Letta | TiMem | Mem0 | TAMS |
|---------|-----|-------|-------|------|------|
| Abstraction layers | None | 1 (flat blocks) | 5 | 2 (extract + graph) | 7 |
| Temporal hierarchy | None | None | Yes (tree) | Limited | Yes (fractal) |
| Retrieval cost | High (search) | Low (blocks) | Medium | Medium | Very low (cache) |
| Decay / forgetting | No | No | No | Conflict resolution | Yes (natural) |
| Salience detection | No | No | Partial | Yes (extraction) | Emergent |
| Reconsolidation | No | No | No | No | Yes |
| Entity preservation | Embedding | Manual | Prompted | Graph-based | Emergent |
| Cross-session linking | Similarity | No | Tree-based | Graph edges | Thematic + entity |
| Vector DB required | Yes | Optional | No | Yes | No |
| Approach | Engineering | Engineering | Research | Research | Bio-inspired |

The closest existing system is TiMem, published in January 2026. TiMem independently arrived at a similar temporal-hierarchical architecture with 5 layers and demonstrated state-of-the-art benchmark results (75.30% on LoCoMo, 76.88% on LongMemEval-S, with 52% reduced context). TAMS extends this approach with finer layer granularity, brain-inspired operational mechanisms (decay, reconsolidation, interference handling), and a production-oriented engineering stack.

---

## 12. Implementation Guide

This section provides a step-by-step guide to building TAMS from scratch. Each step is self-contained and results in a testable component.

### Step 1: Set Up the Database

**Goal:** A running PostgreSQL instance with the TAMS schema.

1. Install PostgreSQL 16+ and enable the ltree extension.
2. Create the `memory_nodes` table using the schema in Section 8.1.
3. Create all three indexes (hot path, tree traversal, entity search).
4. Write a simple insertion test: create one node per depth (D0–D6) for a fake conversation and verify you can query them by path and depth.

**Validation:** You should be able to insert a conversation's worth of nodes and retrieve them by temporal level and depth in under 5ms.

### Step 2: Build the Raw Ingestion Layer

**Goal:** A service that captures conversations and stores D6 (raw transcript).

1. Create a service that wraps an LLM API (OpenAI, Anthropic, Ollama, etc.).
2. On each conversation, log the complete message exchange as a D6 node with the appropriate ltree path (e.g., `epoch.2026Q1.week.09.day.0228.conv.01`).
3. Store metadata: timestamp, session ID, token count.
4. Create the parent day/week/epoch nodes if they don't exist yet (D6 only for now — upper layers come later during consolidation).

**Validation:** After a conversation, a raw transcript node exists in the database at the correct tree position.

### Step 3: Build the Conversation-Level Consolidator

**Goal:** A process that generates D5–D0 from a conversation's D6.

1. Write a consolidation prompt for each layer transition. Each prompt takes the content of one layer and produces the next layer up. The prompts must enforce the format contracts strictly:
   - D6 → D5: "Strip filler, pleasantries, and repetition. Preserve the substantive exchanges, who said what, and the flow of decisions. Output compressed dialogue."
   - D5 → D4: "Summarize each topic discussed in a paragraph. Preserve reasoning chains and trade-offs."
   - D4 → D3: "Extract all entities (people, tools, concepts), facts, and decisions as structured JSON."
   - D3 → D2: "List each topic discussed in one line. No reasoning, just the map."
   - D2 → D1: "Summarize in 2–3 sentences: what happened and what was decided."
   - D1 → D0: "One sentence. The abstract theme or mood of this conversation."
2. Run the pipeline after each conversation ends (async — don't block the user).
3. Store each generated layer as a node in the tree under the conversation's path.

**Validation:** After consolidation, all 7 depth levels exist for the conversation. Read D0 — it should capture the essence in one sentence. Read D3 — it should contain accurate structured entities.

### Step 4: Build the Context Injection Layer

**Goal:** Every LLM call automatically includes relevant memory context.

1. Before each message to the LLM, query the database for D0 layers across epoch/week/day, and D1 for the current day.
2. Concatenate these into a memory context block (~200–400 tokens).
3. Prepend this block to the system prompt.
4. Send the augmented prompt to the LLM.

**Validation:** Start a new conversation. Ask the AI what you discussed yesterday. It should know, drawn from the memory context — even though this is a brand new session.

### Step 5: Add the Redis Hot Cache

**Goal:** Eliminate database queries for the 95% retrieval path.

1. On session start, load all D0 and D1 layers for the current epoch/week/day into Redis.
2. Modify the context injection layer to read from Redis first, falling back to Postgres only on cache miss.
3. Add cache invalidation: whenever a consolidation pass rewrites a D0 or D1 layer, delete the corresponding Redis key.

**Validation:** Context injection should now complete in under 1ms for the default path. Monitor Redis hit rate — it should be >95%.

### Step 6: Build the Temporal Consolidators

**Goal:** Automated end-of-day and end-of-week consolidation.

1. Write a daily consolidation job (cron or scheduled task) that:
   - Gathers all conversation nodes for the day
   - Merges their D4–D3 layers into a single day-level D4–D3
   - Generates day-level D2, D1, D0 from the merged content
   - Invalidates the Redis cache for updated layers
2. Write a weekly consolidation job that does the same for day nodes → week node.
3. Write an epoch consolidation job (monthly or quarterly) that merges weeks into the epoch.
4. Implement low-signal detection: if a day had only trivial interactions (e.g., single greeting, <100 tokens total), skip or minimize consolidation for that day.

**Validation:** After a week of usage, the week-level D0 should capture the overall themes across all conversations that week. The epoch D0 should reflect months of activity in a single sentence.

### Step 7: Build the Retrieval Planner

**Goal:** Intelligent depth selection based on query complexity.

1. Start with a rule-based planner that checks for temporal references ("yesterday", "last week") and specificity signals ("exactly", "why did we", "what specifically").
2. Map these signals to depth ranges using the table in Section 7.2.
3. Later, replace the rule-based planner with a lightweight LLM call (Haiku-class) that reads the user's message + the D0 context and outputs: temporal scope (which time period), max depth (how many layers to load), and specific node IDs if applicable.

**Validation:** Ask "what did we talk about last week?" — the planner should route to the week node at D1–D2, not load every raw transcript.

### Step 8: Implement Brain-Inspired Mechanisms

**Goal:** Decay, reconsolidation, and associative recall.

1. **Decay:** During epoch consolidation, check the D3 (entity) layers across all weeks. Entities that haven't appeared in recent conversations should be deprioritized in the epoch's D0–D1. Not deleted — just less prominent.
2. **Reconsolidation:** After a deep retrieval (D4+), flag the accessed temporal node for re-consolidation in the next scheduled pass. The consolidation prompt should be aware of the new context.
3. **Associative recall:** During context injection, compare the current conversation's emerging theme against historical D0 layers. If there's a strong thematic match with a past period, preemptively load that period's D1–D2 into the context.

**Validation:** Discuss a topic you haven't mentioned in weeks. The system should surface relevant old context because the theme matches, without you explicitly asking for it.

---

## 13. Cost Analysis

TAMS is designed to be cheap to operate. The primary cost is consolidation, which happens offline and can use cheaper models.

| Operation | Frequency | Model | Est. Cost |
|-----------|-----------|-------|-----------|
| Context retrieval (Redis) | Every message | None | ~$0 |
| Retrieval planner | Every message | Haiku | $0.0001–$0.001 |
| Deep retrieval (Postgres) | ~5% of messages | None | ~$0 |
| Conversation consolidation | Per session end | Haiku + Sonnet | $0.001–$0.01 |
| Daily consolidation | Once/day | Sonnet | $0.01–$0.05 |
| Weekly consolidation | Once/week | Sonnet/Opus | $0.05–$0.20 |
| Epoch consolidation | Once/month | Opus | $0.10–$0.50 |

Memory overhead per message is sub-cent. For a user having 10 conversations per day, the total memory system cost is approximately $1–$5 per month. The primary expense remains the actual LLM inference for user responses, not the memory infrastructure.

---

## 14. From Database to Neural Network

During the design of TAMS, an important realization emerged: the more brain-inspired mechanisms you add to a database, the closer you get to reimplementing a neural network with explicit state.

- Weighted connections between nodes (salience) = edge weights in a neural net
- Decay without reinforcement = weight decay / regularization
- Reconsolidation on retrieval = backpropagation, updating weights when activated
- Associative recall across themes = attention mechanisms
- Interference from new similar data = catastrophic forgetting
- Context-dependent retrieval = transformer attention heads

This isn't coincidental. TAMS is modeling the same computational patterns that neural networks model, just with explicit data structures instead of learned weights.

This reveals the long-term trajectory: TAMS as a database system is the **prototype and training scaffold**. It validates the architecture and generates training data showing what good consolidation looks like. The endgame is to distill these patterns into a model that performs consolidation in its weights instead of through SQL queries — a Mixture-of-Experts agent trained natively on temporal-abstraction memory.

The database version proves the concept. The trained model is the product.

---

## 15. Roadmap

### Phase 1: Core Prototype (Weeks 1–4)

Validate the architecture with a single-user, single-agent system.

- PostgreSQL schema with ltree
- 7-layer consolidation pipeline (single model)
- Redis hot cache for D0–D1
- LLM orchestration layer (OpenAI-compatible API)
- Manual consolidation triggers (CLI)
- Rule-based retrieval planner

### Phase 2: Automation (Weeks 5–8)

Make the system self-managing.

- Cron-based consolidation (daily, weekly, epoch)
- LLM-based retrieval planner (Haiku)
- Multi-model consolidation (Haiku for bulk, Opus for abstract)
- Low-signal detection to skip trivial conversations
- Decay mechanics in epoch consolidation
- Cache invalidation pipeline

### Phase 3: Brain Mechanisms (Weeks 9–12)

Add the cognitive mechanisms that differentiate TAMS from simpler hierarchical systems.

- Reconsolidation on deep retrieval
- Associative recall through thematic D0 matching
- Interference handling for evolving conclusions
- Cross-session entity linking at D3

### Phase 4: Benchmarking and Paper (Weeks 13–16)

Quantify the results and publish.

- Benchmark against LoCoMo and LongMemEval
- Compare 7-layer vs. 5-layer (TiMem) performance
- Measure retrieval efficiency (tokens used, latency)
- Publish results and architecture description

### Phase 5: Toward Learned Memory (Ongoing)

Use the database system as a training scaffold for a native memory agent.

- Collect consolidation input/output pairs as training data
- Fine-tune a Mixture-of-Experts agent to perform consolidation natively
- Train the agent to manage its own memory tree without external orchestration
- Replace the database system with the trained model

---

## 16. Open Questions

The following questions remain open and should be addressed during prototyping and evaluation:

- What is the optimal epoch boundary — monthly, quarterly, or adaptive based on conversation volume and topic shifts?
- How should conflicting information across temporal nodes be handled? Newer data should generally dominate upper layers, but what about cases where the older information was more carefully reasoned?
- Should the D3 entity layer use a dedicated graph database (Neo4j) for cross-session linking, or is PostgreSQL's JSONB with jsonpath sufficient at scale?
- How should conversation clustering work in practice — topic-based similarity, time proximity, or a hybrid approach?
- What benchmarks beyond LoCoMo and LongMemEval are appropriate for evaluating brain-inspired mechanisms like decay and reconsolidation?
- How should multi-user and multi-agent scenarios work — shared memory trees, separate trees with cross-references, or agent-specific branches within a shared tree?
- What is the right retention policy for D6 raw transcripts in the context of privacy regulations (GDPR, CCPA)?
- How much of the consolidation quality depends on the model used versus the prompt design? Can a well-prompted Haiku match a poorly-prompted Opus?
- At what scale does the single-Postgres architecture need to be revisited? Hundreds of users? Thousands?

---

*End of Document — TAMS v0.2 — Multi-Layered Temporal Abstraction Memory System*
