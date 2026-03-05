from __future__ import annotations

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from server.main import create_app
from server.mcp.apps_widget import WIDGET_RESOURCE_MIME, WIDGET_RESOURCE_URI


async def connect_session(app):
    session_context = app.state.mcp_server.session_manager.run()
    await session_context.__aenter__()

    def build_client(
        headers: dict[str, str] | None = None,
        timeout: httpx.Timeout | None = None,
        auth: httpx.Auth | None = None,
    ) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
            headers=headers,
            timeout=timeout,
            auth=auth,
        )

    return session_context, build_client


@pytest.mark.asyncio
async def test_mcp_widget_resource_and_tool_metadata_are_registered() -> None:
    app = create_app()
    session_context, build_client = await connect_session(app)

    async with streamablehttp_client("http://testserver/mcp", httpx_client_factory=build_client) as streams:
        read_stream, write_stream, _ = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            tools = await session.list_tools()
            resources = await session.list_resources()

    await session_context.__aexit__(None, None, None)

    render_tool = next(tool for tool in tools.tools if tool.name == "render_search_widget")
    assert render_tool.meta is not None
    assert render_tool.meta["ui"]["resourceUri"] == WIDGET_RESOURCE_URI
    assert render_tool.meta["openai/outputTemplate"] == WIDGET_RESOURCE_URI

    widget_resource = next(resource for resource in resources.resources if str(resource.uri) == WIDGET_RESOURCE_URI)
    assert widget_resource.mimeType == WIDGET_RESOURCE_MIME


@pytest.mark.asyncio
async def test_render_search_widget_returns_seeded_results() -> None:
    app = create_app()
    session_context, build_client = await connect_session(app)

    async with streamablehttp_client("http://testserver/mcp", httpx_client_factory=build_client) as streams:
        read_stream, write_stream, _ = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool("render_search_widget", {"query": "validation", "limit": 1})

    await session_context.__aexit__(None, None, None)

    assert result.isError is False
    assert result.structuredContent is not None
    assert result.structuredContent["query"] == "validation"
    assert result.structuredContent["limit"] == 1
    assert len(result.structuredContent["results"]) == 1
    assert result.meta is not None
    assert result.meta["widget"]["resourceUri"] == WIDGET_RESOURCE_URI


@pytest.mark.asyncio
async def test_render_search_widget_returns_empty_results_without_query() -> None:
    app = create_app()
    session_context, build_client = await connect_session(app)

    async with streamablehttp_client("http://testserver/mcp", httpx_client_factory=build_client) as streams:
        read_stream, write_stream, _ = streams
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()
            result = await session.call_tool("render_search_widget", {})

    await session_context.__aexit__(None, None, None)

    assert result.isError is False
    assert result.structuredContent is not None
    assert result.structuredContent["query"] == ""
    assert result.structuredContent["results"] == []
