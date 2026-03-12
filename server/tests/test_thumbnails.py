from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image

from server.pipelines.thumbnails import generate_thumbnail


def _make_jpeg_bytes(width: int = 400, height: int = 600, color: str = "red") -> bytes:
    img = Image.new("RGB", (width, height), color)
    buf = BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return buf.read()


def _make_png_rgba_bytes(width: int = 300, height: int = 400) -> bytes:
    img = Image.new("RGBA", (width, height), (0, 128, 255, 200))
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def test_thumbnail_from_jpeg() -> None:
    jpeg_bytes = _make_jpeg_bytes(400, 600, "red")
    result = generate_thumbnail(jpeg_bytes, "image/jpeg")

    assert result is not None
    assert len(result) > 0

    # Must decode as valid base64
    decoded = base64.b64decode(result)
    # JPEG magic bytes
    assert decoded[:2] == b"\xff\xd8"

    # Verify it's a valid JPEG by opening with PIL
    img = Image.open(BytesIO(decoded))
    assert img.format == "JPEG"
    # Thumbnail should respect max dimensions 200x280
    assert img.width <= 200
    assert img.height <= 280


def test_thumbnail_from_png_with_alpha() -> None:
    png_bytes = _make_png_rgba_bytes(300, 400)
    result = generate_thumbnail(png_bytes, "image/png")

    assert result is not None
    decoded = base64.b64decode(result)

    # Output must be valid JPEG (not PNG), meaning RGBA→RGB conversion happened
    img = Image.open(BytesIO(decoded))
    assert img.format == "JPEG"
    assert img.mode == "RGB"
    assert img.width <= 200
    assert img.height <= 280


def test_thumbnail_returns_none_for_audio() -> None:
    result = generate_thumbnail(b"\x00\x01\x02\x03", "audio/mpeg")
    assert result is None


def test_thumbnail_returns_none_for_generic_binary() -> None:
    result = generate_thumbnail(b"\x00\x01\x02\x03", "application/octet-stream")
    assert result is None


def test_thumbnail_handles_corrupt_data_gracefully() -> None:
    # Garbage bytes should not raise an exception
    result = generate_thumbnail(b"this is not an image at all!!", "image/jpeg")
    assert result is None


def test_thumbnail_handles_corrupt_data_for_pdf_gracefully() -> None:
    # Garbage bytes for PDF should not raise
    result = generate_thumbnail(b"not a real pdf", "application/pdf")
    assert result is None


def test_thumbnail_png_without_alpha() -> None:
    img = Image.new("RGB", (800, 600), "blue")
    buf = BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    png_bytes = buf.read()

    result = generate_thumbnail(png_bytes, "image/png")

    assert result is not None
    decoded = base64.b64decode(result)
    out_img = Image.open(BytesIO(decoded))
    assert out_img.format == "JPEG"
    assert out_img.width <= 200
    assert out_img.height <= 280
