from __future__ import annotations

import base64
import logging
from io import BytesIO

logger = logging.getLogger(__name__)


def generate_thumbnail(content: bytes, mime_type: str) -> str | None:
    """Return base64-encoded JPEG thumbnail (~200x280), or None.

    Supports PDF and image/* mime types. Returns None for unsupported types
    or if generation fails for any reason.
    """
    if mime_type == "application/pdf":
        return _thumbnail_from_pdf(content)
    if mime_type.startswith("image/"):
        return _thumbnail_from_image(content)
    return None


def _thumbnail_from_pdf(content: bytes) -> str | None:
    """Extract the first embedded image from a PDF and return as thumbnail."""
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(content))
        for page in reader.pages:
            images = getattr(page, "images", [])
            for image in images:
                image_bytes = getattr(image, "data", None)
                if not isinstance(image_bytes, (bytes, bytearray)):
                    continue
                try:
                    return _resize_and_encode(bytes(image_bytes))
                except Exception:
                    continue
    except Exception:
        logger.debug("Thumbnail generation from PDF failed", exc_info=True)
    return None


def _thumbnail_from_image(content: bytes) -> str | None:
    """Generate a thumbnail from raw image bytes."""
    try:
        return _resize_and_encode(content)
    except Exception:
        logger.debug("Thumbnail generation from image failed", exc_info=True)
        return None


def _resize_and_encode(raw: bytes) -> str:
    """Resize image to max 200x280, encode as JPEG quality 60, return base64 string."""
    from PIL import Image

    img = Image.open(BytesIO(raw))

    if img.mode == "RGBA":
        background = Image.new("RGB", img.size, (255, 255, 255))
        background.paste(img, mask=img.split()[3])
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")

    img.thumbnail((200, 280))

    output = BytesIO()
    img.save(output, format="JPEG", quality=60)
    output.seek(0)
    return base64.b64encode(output.read()).decode("ascii")
