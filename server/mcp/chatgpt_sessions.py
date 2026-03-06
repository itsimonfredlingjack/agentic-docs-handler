from __future__ import annotations

import json
import secrets
import threading
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from server.config import AppConfig
from server.mcp.chatgpt_file_ingest import DownloadedUpload


@dataclass
class SessionDocument:
    id: str
    title: str
    text: str
    url: str
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class SessionState:
    session_id: str
    created_at: datetime
    updated_at: datetime
    documents: dict[str, SessionDocument] = field(default_factory=dict)


@dataclass
class WritePlan:
    write_plan_id: str
    session_id: str
    confirm_token: str
    created_at: datetime
    expires_at: datetime
    upload: DownloadedUpload
    preview_payload: dict[str, Any]
    used: bool = False


class SessionStoreError(ValueError):
    """Raised when session/write-plan operations fail."""


class ChatGPTSessionStore:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._lock = threading.RLock()
        self._sessions: dict[str, SessionState] = {}
        self._write_plans: dict[str, WritePlan] = {}
        self._idempotency_results: dict[str, dict[str, Any]] = {}
        self._snapshot_path = self.config.chatgpt_upload_staging_dir / "session_store.json"
        self._dirty = False
        self._load_snapshot()

    def get_or_create_session(self, requested_session_id: str | None = None) -> str:
        with self._lock:
            if requested_session_id:
                session = self._sessions.get(requested_session_id)
                if session is None:
                    now = datetime.now(UTC)
                    self._sessions[requested_session_id] = SessionState(
                        session_id=requested_session_id,
                        created_at=now,
                        updated_at=now,
                    )
                    self.mark_dirty()
                return requested_session_id

            session_id = uuid4().hex[:12]
            now = datetime.now(UTC)
            self._sessions[session_id] = SessionState(
                session_id=session_id,
                created_at=now,
                updated_at=now,
            )
            self.mark_dirty()
            return session_id

    def record_document(
        self,
        *,
        session_id: str,
        title: str,
        text: str,
        url: str,
        metadata: dict[str, Any] | None = None,
        document_id: str | None = None,
    ) -> str:
        with self._lock:
            session = self._sessions.setdefault(
                session_id,
                SessionState(
                    session_id=session_id,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                ),
            )
            document_id = document_id or uuid4().hex
            session.documents[document_id] = SessionDocument(
                id=document_id,
                title=title,
                text=text,
                url=url,
                metadata=metadata or {},
            )
            session.updated_at = datetime.now(UTC)
            self.mark_dirty()
            return document_id

    def search_documents(self, *, session_id: str, query: str, limit: int) -> list[dict[str, Any]]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise SessionStoreError("unknown_session_id")
            needle = query.casefold()
            ranked: list[tuple[int, SessionDocument]] = []
            for document in session.documents.values():
                haystack = f"{document.title}\n{document.text}\n{document.url}".casefold()
                score = haystack.count(needle)
                if score > 0:
                    ranked.append((score, document))
            ranked.sort(key=lambda item: (-item[0], item[1].id))
            return [
                {
                    "id": document.id,
                    "title": document.title,
                    "url": document.url,
                    "metadata": document.metadata,
                }
                for _, document in ranked[:limit]
            ]

    def fetch_document(self, *, session_id: str, document_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None:
                raise SessionStoreError("unknown_session_id")
            document = session.documents.get(document_id)
            if document is None:
                raise SessionStoreError("unknown_session_document_id")
            return {
                "id": document.id,
                "title": document.title,
                "text": document.text,
                "url": document.url,
                "metadata": document.metadata,
            }

    def create_write_plan(
        self,
        *,
        session_id: str,
        upload: DownloadedUpload,
        preview_payload: dict[str, Any],
    ) -> dict[str, Any]:
        with self._lock:
            now = datetime.now(UTC)
            expires_at = now + timedelta(hours=self.config.chatgpt_staging_ttl_hours)
            write_plan_id = uuid4().hex
            confirm_token = secrets.token_urlsafe(24)
            self._write_plans[write_plan_id] = WritePlan(
                write_plan_id=write_plan_id,
                session_id=session_id,
                confirm_token=confirm_token,
                created_at=now,
                expires_at=expires_at,
                upload=upload,
                preview_payload=preview_payload,
            )
            self.mark_dirty()
            return {
                "write_plan_id": write_plan_id,
                "confirm_token": confirm_token,
                "expires_at": expires_at.isoformat(),
            }

    def consume_write_plan(
        self,
        *,
        write_plan_id: str,
        confirm_token: str,
        idempotency_key: str,
    ) -> tuple[WritePlan, dict[str, Any] | None]:
        with self._lock:
            existing = self._idempotency_results.get(idempotency_key)
            if existing is not None:
                plan = self._write_plans.get(write_plan_id)
                if plan is None:
                    raise SessionStoreError("unknown_write_plan")
                return plan, existing

            plan = self._write_plans.get(write_plan_id)
            if plan is None:
                raise SessionStoreError("unknown_write_plan")
            if plan.confirm_token != confirm_token:
                raise SessionStoreError("invalid_confirm_token")
            if plan.used:
                raise SessionStoreError("write_plan_already_used")
            if datetime.now(UTC) > plan.expires_at:
                raise SessionStoreError("write_plan_expired")
            return plan, None

    def save_idempotent_result(self, *, write_plan_id: str, idempotency_key: str, payload: dict[str, Any]) -> None:
        with self._lock:
            plan = self._write_plans.get(write_plan_id)
            if plan is not None:
                plan.used = True
            self._idempotency_results[idempotency_key] = payload
            self.mark_dirty()

    def cleanup_expired(self) -> dict[str, int]:
        with self._lock:
            now = datetime.now(UTC)
            removed_plans = 0
            removed_files = 0
            removed_sessions = 0

            for plan_id, plan in list(self._write_plans.items()):
                if now <= plan.expires_at:
                    continue
                if plan.upload.path.exists():
                    try:
                        plan.upload.path.unlink()
                        removed_files += 1
                    except OSError:
                        pass
                del self._write_plans[plan_id]
                removed_plans += 1

            session_ttl = timedelta(hours=self.config.chatgpt_staging_ttl_hours)
            for session_id, session in list(self._sessions.items()):
                if now - session.updated_at <= session_ttl:
                    continue
                session_dir = (self.config.chatgpt_upload_staging_dir / session_id).resolve()
                if session_dir.exists() and session_dir.is_dir():
                    for item in session_dir.iterdir():
                        if item.is_file():
                            try:
                                item.unlink()
                                removed_files += 1
                            except OSError:
                                pass
                    try:
                        session_dir.rmdir()
                    except OSError:
                        pass
                del self._sessions[session_id]
                removed_sessions += 1

            if removed_plans or removed_sessions:
                self.mark_dirty()

            return {
                "removed_plans": removed_plans,
                "removed_sessions": removed_sessions,
                "removed_files": removed_files,
            }

    def mark_dirty(self) -> None:
        self._dirty = True

    def flush_snapshot(self) -> None:
        with self._lock:
            if not self._dirty:
                return
            self._save_snapshot()
            self._dirty = False

    def _load_snapshot(self) -> None:
        if not self._snapshot_path.exists():
            return
        try:
            payload = json.loads(self._snapshot_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return

        sessions = payload.get("sessions", [])
        for row in sessions:
            session_id = row.get("session_id")
            if not session_id:
                continue
            created_at = _parse_dt(row.get("created_at"))
            updated_at = _parse_dt(row.get("updated_at"))
            documents_payload = row.get("documents", [])
            documents: dict[str, SessionDocument] = {}
            for doc in documents_payload:
                doc_id = str(doc.get("id") or "").strip()
                if not doc_id:
                    continue
                documents[doc_id] = SessionDocument(
                    id=doc_id,
                    title=str(doc.get("title") or doc_id),
                    text=str(doc.get("text") or ""),
                    url=str(doc.get("url") or ""),
                    metadata=dict(doc.get("metadata") or {}),
                )
            self._sessions[session_id] = SessionState(
                session_id=session_id,
                created_at=created_at,
                updated_at=updated_at,
                documents=documents,
            )

        self._idempotency_results = {
            str(key): dict(value)
            for key, value in (payload.get("idempotency_results") or {}).items()
            if isinstance(value, dict)
        }

        plans = payload.get("write_plans", [])
        for row in plans:
            plan_id = str(row.get("write_plan_id") or "").strip()
            session_id = str(row.get("session_id") or "").strip()
            confirm_token = str(row.get("confirm_token") or "").strip()
            upload_payload = row.get("upload") or {}
            if not (plan_id and session_id and confirm_token and isinstance(upload_payload, dict)):
                continue
            upload_path = Path(str(upload_payload.get("path") or "")).expanduser()
            if not upload_path:
                continue
            self._write_plans[plan_id] = WritePlan(
                write_plan_id=plan_id,
                session_id=session_id,
                confirm_token=confirm_token,
                created_at=_parse_dt(row.get("created_at")),
                expires_at=_parse_dt(row.get("expires_at")),
                upload=DownloadedUpload(
                    file_id=str(upload_payload.get("file_id") or ""),
                    session_id=session_id,
                    download_url=str(upload_payload.get("download_url") or ""),
                    path=upload_path,
                    filename=str(upload_payload.get("filename") or upload_path.name),
                    mime_type=str(upload_payload.get("mime_type") or "application/octet-stream"),
                    size_bytes=int(upload_payload.get("size_bytes") or 0),
                ),
                preview_payload=dict(row.get("preview_payload") or {}),
                used=bool(row.get("used", False)),
            )
        self._dirty = False

    def _save_snapshot(self) -> None:
        self.config.chatgpt_upload_staging_dir.mkdir(parents=True, exist_ok=True)
        sessions_payload = []
        for session in self._sessions.values():
            sessions_payload.append(
                {
                    "session_id": session.session_id,
                    "created_at": session.created_at.isoformat(),
                    "updated_at": session.updated_at.isoformat(),
                    "documents": [
                        {
                            "id": doc.id,
                            "title": doc.title,
                            "text": doc.text,
                            "url": doc.url,
                            "metadata": doc.metadata,
                        }
                        for doc in session.documents.values()
                    ],
                }
            )

        payload = {
            "sessions": sessions_payload,
            "idempotency_results": self._idempotency_results,
            "write_plans": [
                {
                    "write_plan_id": plan.write_plan_id,
                    "session_id": plan.session_id,
                    "confirm_token": plan.confirm_token,
                    "created_at": plan.created_at.isoformat(),
                    "expires_at": plan.expires_at.isoformat(),
                    "used": plan.used,
                    "preview_payload": plan.preview_payload,
                    "upload": {
                        "file_id": plan.upload.file_id,
                        "download_url": plan.upload.download_url,
                        "path": str(plan.upload.path),
                        "filename": plan.upload.filename,
                        "mime_type": plan.upload.mime_type,
                        "size_bytes": plan.upload.size_bytes,
                    },
                }
                for plan in self._write_plans.values()
            ],
        }
        self._snapshot_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")


def _parse_dt(raw: object) -> datetime:
    if isinstance(raw, str):
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            pass
    return datetime.now(UTC)
