from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


def create_ws_router(*, realtime_manager: object) -> APIRouter:
    router = APIRouter()

    @router.websocket("/ws")
    async def websocket_status_stream(websocket: WebSocket) -> None:
        client_id = websocket.query_params.get("client_id")
        if not client_id:
            await websocket.close(code=1008, reason="client_id_required")
            return

        logger.info("ws.connect client_id=%s", client_id)
        await realtime_manager.register(client_id, websocket)
        await websocket.send_json(
            {
                "type": "connection.ready",
                "client_id": client_id,
                "server_phase": 5,
            }
        )

        heartbeat_task = asyncio.create_task(_heartbeat_loop(websocket))
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            logger.info("ws.disconnect client_id=%s", client_id)
        except Exception:
            logger.exception("ws.receive.failed client_id=%s", client_id)
        finally:
            heartbeat_task.cancel()
            realtime_manager.unregister(client_id, websocket)

    return router


async def _heartbeat_loop(websocket: WebSocket) -> None:
    while True:
        await asyncio.sleep(30)
        logger.debug("ws.heartbeat.send")
        await websocket.send_json(
            {
                "type": "heartbeat",
                "ts": datetime.now(UTC).isoformat(),
            }
        )
