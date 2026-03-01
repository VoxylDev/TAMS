# Installing TAMS

TAMS (Temporal Abstraction Memory System) is a hierarchical memory backend for persistent AI agents. It replaces flat memory blocks with 7 abstraction layers across temporal levels, providing seamless context carry-over between sessions and devices.

## Architecture

```
Local Device (AI Agent)              Remote Server
┌─────────────────────┐              ┌─────────────────────────┐
│  Claude / Cursor /   │              │  TAMS HTTP Server :3100 │
│  VS Code / Custom   │              │  ├─ PostgreSQL (ltree)  │
│  ├─ tams-bridge     │── HTTP ─────>│  ├─ Redis (cache + STM) │
│  │  (MCP over STDIO)│              │  └─ LLM API (any)       │
│  │                  │              │                         │
│  └─ config.json     │              │  tams-bridge :3200      │
│     ~/.config/tams/  │              │  (MCP over HTTP)        │
└─────────────────────┘              │                         │
                                     │  nginx (:80/:443)       │
Mobile / Remote Clients              │  └─ tams.example.com    │
┌─────────────────────┐              │                         │
│  Claude iOS         │              │  .env (credentials)     │
│  Any MCP client     │── HTTPS ────>└─────────────────────────┘
└─────────────────────┘
```

TAMS supports two access modes:

- **Local (STDIO):** The tams-bridge runs on the same machine as your agent, communicating over STDIO. Best for desktop/laptop use.
- **Remote (HTTP):** The tams-bridge runs on the server alongside TAMS, exposed over HTTPS via a reverse proxy. Mobile apps, web clients, and other remote MCP-capable clients connect to this endpoint.

Both modes share the same TAMS server, the same memory, and the same auth tokens.

---

## Quick Start: Docker

The fastest way to get TAMS running:

```bash
git clone https://github.com/VoxylDev/TAMS.git
cd TAMS

# Set your LLM API key
echo "TAMS_LLM_API_KEY=sk-..." > .env

# Start everything (PostgreSQL + Redis + TAMS server)
docker compose up -d

# Verify
curl http://localhost:3100/health
# {"status":"ok","service":"tams","version":"0.2.0"}
```

Then skip to [Part 2: Client Setup](#part-2-client-setup-per-device).

---

## Part 1: Manual Server Setup

If you prefer not to use Docker, follow these steps on the machine that will host TAMS.

### 1.1 Install System Dependencies

```bash
# PostgreSQL (Ubuntu/Debian)
sudo apt install -y postgresql postgresql-contrib

# Redis
sudo apt install -y redis-server

# Node.js 22+ (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Enable Corepack (ships with Node.js, manages Yarn)
corepack enable
```

Verify:

```bash
node --version    # v22.x.x
psql --version    # psql 16+
redis-cli ping    # PONG
```

### 1.2 Create the Database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER tams WITH PASSWORD 'your_password_here';
CREATE DATABASE tams OWNER tams;
\c tams
CREATE EXTENSION IF NOT EXISTS ltree;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO tams;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO tams;
SQL
```

The TAMS server runs migrations automatically on first start.

### 1.3 Clone and Build

```bash
git clone https://github.com/VoxylDev/TAMS.git
cd TAMS
corepack yarn install
corepack yarn build
```

### 1.4 Configure Environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
# PostgreSQL
TAMS_DB_HOST=localhost
TAMS_DB_PORT=5432
TAMS_DB_NAME=tams
TAMS_DB_USER=tams
TAMS_DB_PASSWORD=your_password_here

# Redis
TAMS_REDIS_HOST=localhost
TAMS_REDIS_PORT=6379

# LLM Provider (any OpenAI-compatible API)
TAMS_LLM_API_KEY=sk-...
# TAMS_LLM_BASE_URL=        # Set for non-OpenAI providers
# TAMS_LLM_FAST_MODEL=gpt-4o-mini
# TAMS_LLM_ABSTRACT_MODEL=gpt-4o-mini

# Logging
TAMS_LOG_LEVEL=info
```

### 1.5 Start the Server

#### Option A: Systemd (Recommended for Production)

Create `/etc/systemd/system/tams.service`:

```ini
[Unit]
Description=TAMS Memory Server
After=network.target postgresql.service redis-server.service

[Service]
Type=simple
WorkingDirectory=/opt/tams
ExecStart=/opt/tams/start-tams.sh
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Create `/opt/tams/start-tams.sh`:

```bash
#!/bin/bash
set -a
source /opt/tams/.env
set +a
exec node packages/server/dist/main.js
```

```bash
chmod +x /opt/tams/start-tams.sh
sudo systemctl daemon-reload
sudo systemctl enable tams.service
sudo systemctl start tams.service
```

#### Option B: PM2

```bash
cd /opt/tams
pm2 start "node --env-file=.env packages/server/dist/main.js" --name tams
pm2 save
```

### 1.6 Verify the Server

```bash
curl http://localhost:3100/health
# {"status":"ok","service":"tams","version":"0.2.0"}
```

All endpoints except `/health` require authentication.

### 1.7 Create Your User and Auth Token

TAMS uses token-based authentication. Every request (except `/health`) must include a
`Bearer` token in the `Authorization` header.

#### Bootstrap Token (First Time Only)

Generate a token and its SHA-256 hash, then insert it directly into the database:

```bash
# Generate a token
node -e "
const crypto = require('node:crypto');
const raw = crypto.randomBytes(48);
const token = 'tams_' + raw.toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');
console.log('Token:', token);
console.log('Hash:', hash);
"
```

Save the token output — it is only shown once. Then seed your user and insert the token:

```bash
psql -h localhost -U tams -d tams <<SQL
INSERT INTO tams_users (name, email)
VALUES ('admin', 'admin@example.com')
RETURNING id;

-- Insert the bootstrap token (replace values from above)
INSERT INTO auth_tokens (user_id, token_hash, label)
VALUES ('<your-user-id>', '<HASH>', 'bootstrap');
SQL
```

Verify the token works:

```bash
curl -H "Authorization: Bearer tams_..." http://localhost:3100/status
```

#### Generate Tokens via Admin API

Once you have a working token, use the admin API to generate more (one per device):

```bash
# Create a user
curl -X POST -H "Authorization: Bearer tams_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "admin"}' \
  http://localhost:3100/admin/users

# Generate a new token
curl -X POST -H "Authorization: Bearer tams_..." \
  -H "Content-Type: application/json" \
  -d '{"user_id": "<user-id>", "label": "macbook"}' \
  http://localhost:3100/admin/tokens

# Revoke a token
curl -X DELETE -H "Authorization: Bearer tams_..." \
  http://localhost:3100/admin/tokens/<token-id>
```

Generate a separate token for each device so you can revoke individually.

---

## Part 2: Client Setup (Per Device)

Run these steps on **each device** where you use an MCP-capable agent.

### 2.1 Install the Bridge

```bash
cd packages/bridge  # or clone separately

# Install with uv (recommended)
uv sync
# or: pip install .
```

### 2.2 First-Run Setup

The bridge includes an interactive setup wizard:

```bash
uv run tams-mcp
```

On first launch (when `~/.config/tams/config.json` doesn't exist), it will prompt for
your server URL, device name, and store frequency. After setup, add your auth token to the config file:

```json
{
  "base_url": "http://your-server:3100",
  "device_name": "MacBook",
  "auth_token": "tams_...",
  "store_frequency": 3,
  "platform": "darwin",
  "hostname": "your-hostname"
}
```

### 2.3 Register with Your MCP Client

#### Claude Code

```bash
claude mcp add --transport stdio --scope user \
  --env TAMS_BASE_URL=http://your-server:3100 \
  --env TAMS_AUTH_TOKEN=tams_... \
  tams-memory -- \
  uv run --directory /path/to/TAMS/packages/bridge tams-mcp
```

Or edit `~/.claude/settings.json`:

```json
{
    "mcpServers": {
        "tams-memory": {
            "type": "stdio",
            "command": "uv",
            "args": [
                "run", "--directory", "/path/to/TAMS/packages/bridge", "tams-mcp"
            ],
            "env": {
                "TAMS_BASE_URL": "http://your-server:3100",
                "TAMS_AUTH_TOKEN": "tams_..."
            }
        }
    }
}
```

#### Other MCP Clients (Cursor, VS Code, etc.)

Use the same command and env vars in whatever MCP configuration format your client supports.

### 2.4 Auto-Allow Memory Tools

For Claude Code, add these to `~/.claude/settings.json` under `permissions.allow`:

```json
"mcp__tams-memory__tams_context",
"mcp__tams-memory__tams_store",
"mcp__tams-memory__tams_prompt_store",
"mcp__tams-memory__tams_stm",
"mcp__tams-memory__tams_retrieve",
"mcp__tams-memory__tams_search",
"mcp__tams-memory__tams_consolidate",
"mcp__tams-memory__tams_status"
```

### 2.5 Agent Behavior Instructions

Add memory usage instructions to your agent's system prompt (e.g. `CLAUDE.md` for Claude Code).
These instructions tell the agent **when** to call each tool and **what** to store.

```markdown
# TAMS Memory

You have persistent memory via TAMS (Temporal Abstraction Memory System).

## Session Lifecycle

1. **Session start**: Call `tams_context` to load your always-on memory context.
   This returns a compact summary (~200-400 tokens) of all past conversations
   organized by time — themes at the year/month level, gists at the day level.

2. **Each user message**: Call `tams_prompt_store` with the user's raw prompt text.
   This captures the user's actual words for session recovery and cross-session recall.

3. **During the session**: Call `tams_store` based on the configured store frequency
   (the bridge injects guidance automatically via `store_frequency` in config.json).
   By default (level 3 / balanced), store after milestones and important decisions,
   aiming for 2-4 stores per session. Write concise summaries focusing on what was
   decided and why, not raw transcripts. Include entities (repos, files, tools,
   services) and problems solved.

4. **Session end**: Call `tams_store` with a final summary of anything not yet stored.

## Retrieval

- **Short-term recall**: Call `tams_stm` FIRST when the user asks about recent work
  or "where did we leave off". It reads the Redis STM buffers directly — no LLM calls,
  sub-100ms. Only fall back to `tams_retrieve` or `tams_search` if STM doesn't have
  the answer.
- **Deep recall**: Use `tams_retrieve` with `auto=true` and a `query` string to
  remember past work. The retrieval planner automatically selects the right temporal
  scope and abstraction depth.
- **Manual retrieval**: Use `tams_retrieve` with a `temporal_scope` (e.g.
  `year.2026.month.03.day.01`) and `max_depth` (0=theme through 6=raw) for
  precise control over what layer you read.
- **Entity search**: Use `tams_search` to find conversations where specific tools,
  people, projects, or concepts were discussed.

## Consolidation

After storing multiple conversations in one day, call `tams_consolidate` with
`level: "day"` to merge them into a unified daily summary. This improves the
quality of the always-on context block for future sessions.
```

---

## Part 3: Remote / Mobile Access

For mobile apps and remote MCP clients that cannot run a local bridge, TAMS provides
a server-side bridge over streamable HTTP.

### 3.1 Install the Bridge on the Server

```bash
# On the same machine as TAMS
cd /opt/tams/packages/bridge

# Install uv if not already available
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install dependencies
uv sync
```

### 3.2 Configure the Server Bridge

Create `~/.config/tams/config.json` on the server:

```json
{
  "base_url": "http://localhost:3100",
  "device_name": "server-bridge",
  "auth_token": "tams_..."
}
```

### 3.3 Run the Bridge in HTTP Mode

```bash
uv run tams-mcp-http
# Starts on 0.0.0.0:3200
```

### 3.4 Create the Systemd Service

Create `/etc/systemd/system/tams-bridge.service`:

```ini
[Unit]
Description=TAMS MCP Bridge (HTTP)
After=network.target tams.service
Requires=tams.service

[Service]
Type=simple
WorkingDirectory=/opt/tams/packages/bridge
ExecStart=/root/.local/bin/uv run tams-mcp-http
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable tams-bridge.service
sudo systemctl start tams-bridge.service
```

### 3.5 Expose via Reverse Proxy (nginx)

```nginx
server {
    listen 80;
    server_name tams.example.com;

    location / {
        proxy_pass http://127.0.0.1:3200;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600;
    }
}
```

For HTTPS, use Let's Encrypt or Cloudflare in front of this.

### 3.6 Connect from Mobile / Remote Clients

**MCP Endpoint:** `https://tams.example.com/mcp`
**Transport:** Streamable HTTP

---

## Configuration Reference

### Server Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TAMS_DB_HOST` | `localhost` | PostgreSQL host |
| `TAMS_DB_PORT` | `5432` | PostgreSQL port |
| `TAMS_DB_NAME` | `tams` | Database name |
| `TAMS_DB_USER` | `tams` | Database user |
| `TAMS_DB_PASSWORD` | *(empty)* | Database password |
| `TAMS_DB_MAX_CONNECTIONS` | `10` | Connection pool size |
| `TAMS_REDIS_HOST` | `localhost` | Redis host |
| `TAMS_REDIS_PORT` | `6379` | Redis port |
| `TAMS_REDIS_PASSWORD` | *(none)* | Redis password |
| `TAMS_REDIS_PREFIX` | `tams` | Cache key namespace |
| `TAMS_LLM_API_KEY` | *(required)* | API key for LLM consolidation |
| `TAMS_LLM_BASE_URL` | OpenAI default | Override for other providers |
| `TAMS_LLM_FAST_MODEL` | `gpt-4o-mini` | Model for D6->D5->D4 |
| `TAMS_LLM_ABSTRACT_MODEL` | `gpt-4o-mini` | Model for D3->D2->D1->D0 |
| `TAMS_LLM_LOW_SIGNAL_THRESHOLD` | `50` | Min tokens for full consolidation |
| `TAMS_STM_MAX_ENTRIES` | `5` | Short-term memory buffer size |
| `TAMS_STM_MAX_PROMPTS` | `10` | User prompts buffer size |
| `TAMS_STM_MAX_TAIL_CHARS` | `2000` | Chars per STM entry (~500 tokens) |
| `TAMS_STM_TTL` | `7200` | STM buffer TTL in seconds |
| `TAMS_SERVER_PORT` | `3100` | HTTP server port |
| `TAMS_LOG_LEVEL` | `info` | Log verbosity |

### Bridge Config File (`~/.config/tams/config.json`)

| Field | Description |
|-------|-------------|
| `base_url` | TAMS server URL (e.g. `http://localhost:3100`) |
| `device_name` | Friendly name for this device |
| `auth_token` | TAMS auth token (`tams_...` format) |
| `store_frequency` | How often the AI stores to memory: 1=minimal, 2=conservative, **3=balanced** (default), 4=frequent, 5=aggressive |
| `platform` | Auto-detected OS platform |
| `hostname` | Auto-detected hostname |

Environment variables (`TAMS_BASE_URL`, `TAMS_DEVICE_NAME`, `TAMS_AUTH_TOKEN`, `TAMS_STORE_FREQUENCY`)
override the config file.

---

## MCP Tools

All tools return human-readable formatted text (not raw JSON).

| Tool | Description |
|------|-------------|
| `tams_context` | Always-on memory context. Call at session start. |
| `tams_store` | Store a conversation transcript. Triggers 7-layer consolidation. |
| `tams_prompt_store` | Store a user's raw prompt in the short-term buffer. |
| `tams_stm` | Read STM buffers: recent session summaries and user prompts. Call before `tams_retrieve` when catching up. |
| `tams_retrieve` | Deep memory retrieval at a specific temporal scope and depth. |
| `tams_search` | Search entities, tools, and topics across the D3 layer. |
| `tams_consolidate` | Trigger temporal consolidation (day/week/month/year). |
| `tams_status` | System health: database stats, cache performance. |

### Example Tool Output

**`tams_context`** — loaded at session start:
```
Memory context loaded (245 tokens)

Themes:
  [year.2026] Building platform with TAMS memory system, benchmarking against Letta...
  [month.03] Open-source release prep, formatting improvements...

Gists:
  [year.2026.month.03.day.01] Ran LoCoMo benchmark — TAMS 24ms vs Letta 24s ingestion...

Recent conversations: 3
Recent prompts: 5
```

**`tams_store`** — after storing a conversation:
```
Stored at year.2026.month.03.week.01.day.01.conv.abc123
Consolidation queued (position 2)
```

**`tams_stm`** — catch up on recent work:
```
STM buffers (3 conversations, 5 prompts)

Recent Conversations (3 entries):

[1] (5 min ago, MacBook)
Added tams_stm tool to read short-term memory buffers. Updated both
the TS MCP package and Python bridge with client methods, formatters,
and tool registration.

[2] (1 hr ago, MacBook)
Fixed output_schema wrapping in FastMCP — added output_schema=None
to all tool decorators to prevent JSON wrapping of string returns.

[3] (3 hr ago, MacBook)
Pushed initial TAMS OSS commit to GitHub. 76 files, 14,242 lines.

Recent User Prompts (5 entries):
[1] (3 min ago, MacBook) Do we not have MCP calls for short term memory?
[2] (8 min ago, MacBook) Check your short term memory....
[3] (15 min ago, MacBook) Hey, where did we leave off
```

**`tams_retrieve`** — deep memory recall:
```
Retrieved 3 layers from year.2026.month.03 (source: cache)

[D0 Theme]
Building and benchmarking the TAMS memory system for AI agents.

[D1 Gist]
Implemented 7-layer consolidation pipeline, ran head-to-head benchmarks
against Letta showing 200x faster retrieval and near-perfect recall.

[D2 Outline]
- Consolidation pipeline: D6 raw → D0 theme
- Benchmark results: 97.7% TAMS vs 95.3% Letta
- Storage latency: 24ms constant vs 24s degrading
```

**`tams_search`** — find conversations about a topic:
```
Found 2 results:

1. year.2026.month.02.day.28.conv.xyz (Entities, 545 tokens)
   Discussed database schema migration and ltree extension setup...

2. year.2026.month.03.day.01.conv.abc (Entities, 412 tokens)
   Benchmarked TAMS vs Letta with 10 synthetic conversations...
```

**`tams_status`** — system health check:
```
TAMS Status: Ready
Database: 206 nodes (198 conversations, 5 days, 1 week, 1 month, 1 year)
Cache: 50% hit rate (1 hit, 1 miss)
Consolidation: 12,450 tokens used, queue empty
STM: 3/5 entries | Prompts: 5/10 buffered
```

---

## Troubleshooting

### Bridge: "Could not connect" during setup

- Ensure the TAMS server is running: `curl http://your-server:3100/health`
- Ensure the server port is accessible from your device (check firewall rules)
- If the server is on LAN, use the LAN IP, not `localhost`

### Auth: 401 Unauthorized

- Verify the token is in `~/.config/tams/config.json` under `auth_token`
- Test the token: `curl -H "Authorization: Bearer tams_..." http://your-server:3100/status`
- If the bridge was already running when you added the token, restart it

### Bridge (HTTP): 502 Bad Gateway

- Verify the bridge is running: `systemctl status tams-bridge.service`
- Verify it's listening: `ss -tlnp | grep 3200`
- Check nginx config and reload: `nginx -t && systemctl reload nginx`
- Check bridge logs: `journalctl -u tams-bridge.service -f`

### Consolidation: No layers generated

- Ensure `TAMS_LLM_API_KEY` is set and valid
- Check server logs: `journalctl -u tams.service -f`
- Low-signal conversations (<50 tokens) skip full consolidation by design

### Database: Connection refused

- Ensure PostgreSQL is running: `sudo systemctl status postgresql`
- Check `pg_hba.conf` allows the TAMS user
- Test manually: `psql -h localhost -U tams -d tams -c 'SELECT 1;'`
