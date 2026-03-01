# TAMS Bridge

MCP server for the TAMS memory system. Exposes TAMS as tools that AI agents
and coding assistants can use via the [Model Context Protocol](https://modelcontextprotocol.io/).

## Installation

```bash
uv sync
```

## Usage

```bash
# STDIO transport (local agents like Claude Code)
uv run tams-mcp

# HTTP transport (remote clients)
uv run tams-mcp-http
```

See the [main INSTALL guide](../../INSTALL.md) for full setup instructions.
