# Contributing to TAMS

Thanks for your interest in contributing to TAMS! This guide will help you get set up.

## Development Setup

### Prerequisites

- Node.js 22+
- PostgreSQL 16+ with the `ltree` extension
- Redis 7+
- Python 3.11+ with [uv](https://github.com/astral-sh/uv) (for the bridge)
- Yarn 4.x (managed via Corepack)

### Getting Started

```bash
git clone https://github.com/VoxylDev/TAMS.git
cd TAMS

# Enable Corepack for Yarn
corepack enable

# Install dependencies
yarn install

# Build all packages
yarn build
```

### Running Locally

```bash
# Start with Docker (easiest)
docker compose up -d

# Or manually:
# 1. Start PostgreSQL and Redis
# 2. Copy .env.example to .env and configure
# 3. Run the server in dev mode
yarn dev
```

### Bridge Development

```bash
cd packages/bridge
uv sync
uv run tams-mcp  # stdio mode
# or
uv run tams-mcp-http  # HTTP mode on port 3200
```

## Code Quality

Before submitting a PR, ensure all checks pass:

```bash
# TypeScript
yarn build          # Build all packages
yarn lint           # ESLint
yarn format:check   # Prettier

# Python (bridge)
cd packages/bridge
ruff check .        # Lint
ruff format --check .  # Format
```

## Project Structure

```
packages/
  common/     Shared types, constants, utilities (no runtime deps)
  core/       Database, Redis, consolidation pipeline, memory tree
  server/     Hono HTTP server + auth middleware
  mcp/        Node.js MCP server (STDIO, legacy)
  bridge/     Python MCP server (FastMCP, recommended)
```

## Code Style

- **TypeScript:** `let` over `const`, no semicolons (Prettier handles it), well-documented with JSDoc
- **Python:** Follow PEP 8, enforced by Ruff
- **Commits:** Conventional style preferred (`feat:`, `fix:`, `docs:`, `refactor:`)

## Pull Request Process

1. Fork the repo and create a feature branch
2. Make your changes
3. Ensure all checks pass (`yarn build && yarn lint && yarn format:check`)
4. Submit a PR against `master`
5. Describe what changed and why in the PR description

## Reporting Issues

Use [GitHub Issues](https://github.com/VoxylDev/TAMS/issues). Please include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Environment details (OS, Node.js version, etc.)
