from __future__ import annotations

import mimetypes
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx

from server.config import AppConfig
from server.mcp.chatgpt_app_types import UploadedFileRef

SAFE_FILE_ID_PATTERN = re.compile(r"[^a-zA-Z0-9._-]")


@dataclass(frozen=True)
class DownloadedUpload:
    file_id: str
    session_id: str
    download_url: str
    path: Path
    filename: str
    mime_type: str
    size_bytes: int


class UploadIngestError(ValueError):
    """Raised when upload ingest validation/download fails."""


def sanitize_file_id(file_id: str) -> str:
    cleaned = SAFE_FILE_ID_PATTERN.sub("_", file_id).strip("._")
    if not cleaned:
        raise UploadIngestError("invalid_file_id")
    return cleaned[:128]


def _pick_extension(url: str, mime_type: str | None) -> str:
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix:
        return suffix
    if mime_type:
        guessed = mimetypes.guess_extension(mime_type.split(";", 1)[0].strip().lower())
        if guessed:
            return guessed
    return ".bin"


def ensure_allowed_download_host(download_url: str, allowed_hosts: list[str]) -> str:
    host = (urlparse(download_url).hostname or "").lower().strip()
    if not host:
        raise UploadIngestError("download_url_missing_host")
    normalized_allowed = {entry.strip().lower() for entry in allowed_hosts if entry.strip()}
    if normalized_allowed and host not in normalized_allowed:
        raise UploadIngestError("download_host_not_allowed")
    return host


async def download_uploaded_file(
    *,
    config: AppConfig,
    file_ref: UploadedFileRef,
    session_id: str,
) -> DownloadedUpload:
    ensure_allowed_download_host(str(file_ref.download_url), config.chatgpt_allowed_download_hosts)
    safe_file_id = sanitize_file_id(file_ref.file_id)
    session_dir = (config.chatgpt_upload_staging_dir / session_id).resolve()
    session_dir.mkdir(parents=True, exist_ok=True)

    timeout = httpx.Timeout(config.request_timeout_seconds)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            async with client.stream("GET", str(file_ref.download_url)) as response:
                response.raise_for_status()
                content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
                extension = _pick_extension(str(file_ref.download_url), content_type or None)
                filename = f"{safe_file_id}{extension}"
                target_path = (session_dir / filename).resolve()
                if target_path.parent != session_dir:
                    raise UploadIngestError("invalid_staging_path")

                total = 0
                with target_path.open("wb") as handle:
                    async for chunk in response.aiter_bytes():
                        if not chunk:
                            continue
                        total += len(chunk)
                        if total > config.chatgpt_upload_max_bytes:
                            raise UploadIngestError("upload_too_large")
                        handle.write(chunk)
        except httpx.HTTPStatusError as error:
            raise UploadIngestError(f"download_failed_http_{error.response.status_code}") from error
        except httpx.HTTPError as error:
            raise UploadIngestError("download_failed_network") from error

    if total == 0:
        raise UploadIngestError("empty_upload")

    mime_type = content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
    return DownloadedUpload(
        file_id=safe_file_id,
        session_id=session_id,
        download_url=str(file_ref.download_url),
        path=target_path,
        filename=filename,
        mime_type=mime_type,
        size_bytes=total,
    )
