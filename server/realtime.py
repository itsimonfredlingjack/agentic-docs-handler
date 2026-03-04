from __future__ import annotations

from collections import defaultdict
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def register(self, client_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[client_id].add(websocket)
        logger.info(
            "ws.client.registered client_id=%s sockets=%s",
            client_id,
            len(self._connections[client_id]),
        )

    def unregister(self, client_id: str, websocket: WebSocket) -> None:
        sockets = self._connections.get(client_id)
        if sockets is None:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(client_id, None)
        logger.info(
            "ws.client.unregistered client_id=%s sockets=%s",
            client_id,
            len(self._connections.get(client_id, set())),
        )

    async def emit_to_client(self, client_id: str, event: dict[str, object]) -> None:
        for websocket in list(self._connections.get(client_id, set())):
            try:
                logger.info(
                    "ws.emit.start client_id=%s event_type=%s request_id=%s sockets=%s",
                    client_id,
                    event.get("type"),
                    event.get("request_id"),
                    len(self._connections.get(client_id, set())),
                )
                await websocket.send_json(event)
                logger.info(
                    "ws.emit.done client_id=%s event_type=%s request_id=%s",
                    client_id,
                    event.get("type"),
                    event.get("request_id"),
                )
            except Exception:
                logger.exception(
                    "ws.emit.failed client_id=%s event_type=%s request_id=%s",
                    client_id,
                    event.get("type"),
                    event.get("request_id"),
                )
                self.unregister(client_id, websocket)

    def connection_count(self, client_id: str) -> int:
        return len(self._connections.get(client_id, set()))
