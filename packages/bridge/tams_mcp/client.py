"""
TAMS HTTP Client

Handles communication with the remote TAMS HTTP server.
Sends device metadata with store requests so the STM buffer
captures the calling device, not the server's hostname.
"""

import platform
import socket

import httpx

from tams_mcp.config import settings


class TAMSClient:
    """HTTP client for the TAMS memory server."""

    def __init__(self):
        self._client: httpx.AsyncClient | None = None

    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            headers = {}
            if settings.auth_token:
                headers["Authorization"] = f"Bearer {settings.auth_token}"
            self._client = httpx.AsyncClient(
                base_url=settings.base_url,
                timeout=60.0,
                headers=headers,
            )
        return self._client

    async def health(self) -> dict:
        """Check server health."""
        resp = await self.client.get("/health")
        resp.raise_for_status()
        return resp.json()

    async def status(self) -> dict:
        """Get system status and statistics."""
        resp = await self.client.get("/status")
        resp.raise_for_status()
        return resp.json()

    async def context(self) -> dict:
        """Get the always-on memory context block."""
        resp = await self.client.get("/context")
        resp.raise_for_status()
        return resp.json()

    async def store(self, content: str, session_id: str | None = None) -> dict:
        """Store a conversation transcript.

        Sends device metadata alongside the transcript so the STM buffer
        captures which device originated the conversation.

        Uses an extended timeout because background consolidation queuing
        includes the initial D6 write to PostgreSQL.
        """
        body: dict = {
            "content": content,
            "device": {
                "name": settings.device_name,
                "hostname": socket.gethostname(),
                "platform": platform.system().lower(),
            },
        }
        if session_id:
            body["session_id"] = session_id
        resp = await self.client.post("/store", json=body, timeout=300.0)
        resp.raise_for_status()
        return resp.json()

    async def store_prompt(self, content: str, session_id: str | None = None) -> dict:
        """Store a user prompt in the prompts buffer.

        Sends device metadata alongside the prompt so the buffer
        captures which device originated the prompt.
        """
        body: dict = {
            "content": content,
            "device": {
                "name": settings.device_name,
                "hostname": socket.gethostname(),
                "platform": platform.system().lower(),
            },
        }
        if session_id:
            body["session_id"] = session_id
        resp = await self.client.post("/prompt/store", json=body)
        resp.raise_for_status()
        return resp.json()

    async def get_stm(self) -> dict:
        """Get the short-term memory conversation buffer."""
        resp = await self.client.get("/stm")
        resp.raise_for_status()
        return resp.json()

    async def get_prompts(self) -> dict:
        """Get the short-term memory prompts buffer."""
        resp = await self.client.get("/prompts")
        resp.raise_for_status()
        return resp.json()

    async def retrieve(
        self,
        temporal_scope: str | None = None,
        max_depth: int | None = None,
        auto: bool | None = None,
        query: str | None = None,
    ) -> dict:
        """Retrieve memory at a specific temporal scope and depth."""
        body: dict = {}
        if temporal_scope is not None:
            body["temporal_scope"] = temporal_scope
        if max_depth is not None:
            body["max_depth"] = max_depth
        if auto is not None:
            body["auto"] = auto
        if query is not None:
            body["query"] = query
        resp = await self.client.post("/retrieve", json=body)
        resp.raise_for_status()
        return resp.json()

    async def search(self, query: str, limit: int = 5) -> dict:
        """Search entities across memory."""
        resp = await self.client.post("/search", json={"query": query, "limit": limit})
        resp.raise_for_status()
        return resp.json()

    async def consolidate(self, level: str, path: str | None = None) -> dict:
        """Trigger temporal consolidation.

        Uses an extended timeout because merging multiple child nodes
        requires sequential LLM calls that can take several minutes.
        """
        body: dict = {"level": level}
        if path is not None:
            body["path"] = path
        resp = await self.client.post("/consolidate", json=body, timeout=600.0)
        resp.raise_for_status()
        return resp.json()
