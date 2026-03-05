from __future__ import annotations

from contextlib import AbstractAsyncContextManager

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP
from starlette.routing import Route

from server.mcp.apps_widget import register_widget_resource
from server.mcp.read_tools import register_read_tools
from server.mcp.services import AppServices
from server.mcp.write_tools import register_write_tools


class RootAliasApp:
    def __init__(self, app: object) -> None:
        self.app = app

    async def __call__(self, scope: dict[str, object], receive: object, send: object) -> None:
        forwarded_scope = dict(scope)
        forwarded_scope["path"] = "/"
        await self.app(forwarded_scope, receive, send)


def create_mcp_server(services: AppServices) -> FastMCP:
    server = FastMCP(
        name="Agentic Docs Handler",
        instructions="Phase 2 MCP tools for knowledge lookup, document processing, and semantic search.",
        host="0.0.0.0",
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
    )
    register_read_tools(server, services)
    register_write_tools(server, services)
    register_widget_resource(server)
    return server


def mount_mcp_server(app: FastAPI, services: AppServices, mount_path: str) -> FastMCP:
    server = create_mcp_server(services)
    mounted_app = server.streamable_http_app()
    alias_app = RootAliasApp(mounted_app)
    app.router.routes.append(Route(mount_path, endpoint=alias_app, methods=["GET", "POST", "DELETE"]))
    app.mount(mount_path, mounted_app)
    app.state.mcp_server = server
    app.state.mcp_session_context = None

    async def start_mcp() -> None:
        session_context: AbstractAsyncContextManager[object] = server.session_manager.run()
        await session_context.__aenter__()
        app.state.mcp_session_context = session_context

    async def stop_mcp() -> None:
        session_context = app.state.mcp_session_context
        if session_context is not None:
            await session_context.__aexit__(None, None, None)
            app.state.mcp_session_context = None

    app.add_event_handler("startup", start_mcp)
    app.add_event_handler("shutdown", stop_mcp)
    return server
