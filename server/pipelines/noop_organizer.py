"""Stub organizer that replaces FileOrganizer in the workspace-centric model.

Returns a no-op MovePlan for every file. Workspace assignment is handled
separately by the workspace_suggester pipeline (future) instead of
YAML rule-based file moves.
"""
from __future__ import annotations

from server.schemas import DocumentClassification, MovePlan, MoveResult


class NoOpOrganizer:
    def plan_move(
        self,
        filename: str,
        classification: DocumentClassification,
    ) -> MovePlan:
        return MovePlan(
            rule_name=None,
            destination=None,
            auto_move_allowed=False,
            reason="workspace_pending",
        )

    def execute_move(
        self,
        move_plan: MovePlan,
        source_path: object,
    ) -> MoveResult:
        return MoveResult(
            attempted=False,
            success=False,
            from_path=str(source_path) if source_path else None,
            to_path=None,
            error=None,
        )
