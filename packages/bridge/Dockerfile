# TAMS MCP Bridge — Python Docker Build
#
# Runs the TAMS MCP server in HTTP transport mode for remote agents.
#
# Usage:
#   docker build -t tams-bridge packages/bridge
#   docker run -p 3200:3200 --env-file .env tams-bridge

FROM python:3.13-slim

WORKDIR /app

# Install uv for fast dependency management
RUN pip install --no-cache-dir uv

# Copy and install dependencies
COPY pyproject.toml ./
RUN uv pip install --system -e .

# Copy source
COPY tams_mcp tams_mcp

EXPOSE 3200

CMD ["tams-mcp-http"]
