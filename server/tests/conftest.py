"""Shared pytest configuration for backend tests."""
from __future__ import annotations

import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "smoke: slow integration tests that require a running backend and Ollama",
    )
