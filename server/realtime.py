from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def register(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[client_id].add(websocket)

    def unregister(self, client_id: str, websocket: WebSocket) -> None:
        sockets = self._connections.get(client_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(client_id, None)

    async def emit_to_client(self, client_id: str, event: dict[str, object]) -> None:
        for websocket in list(self._connections.get(client_id, set())):
            try:
                await websocket.send_json(event)
            except RuntimeError:
                self.unregister(client_id, websocket)

    def connection_count(self, client_id: str) -> int:
        return len(self._connections.get(client_id, set()))
