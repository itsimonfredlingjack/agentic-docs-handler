from __future__ import annotations

import base64
from io import BytesIO

import pytest
from PIL import Image

from server.pipelines.classifier import ClassificationValidationError, DocumentClassifier


class FakeOllamaClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[dict[str, object]] = []

    async def chat_json(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_classifier_returns_valid_classification_on_first_attempt() -> None:
    client = FakeOllamaClient(
        [
            (
                '{"document_type":"receipt","template":"receipt","title":"ICA Maxi",'
                '"summary":"Matvarukvitto","tags":["receipt"],"language":"sv",'
                '"confidence":0.97,"ocr_text":"ICA Maxi 342 kr",'
                '"suggested_actions":["archive"]}'
            ),
        ]
    )

    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    result = await classifier.classify_text("ICA Maxi 342 kr")

    assert result.document_type == "receipt"
    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_classifier_raises_on_invalid_json() -> None:
    client = FakeOllamaClient(['{"broken":'])
    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    with pytest.raises(ClassificationValidationError):
        await classifier.classify_text("text")

    assert len(client.calls) == 1


@pytest.mark.asyncio
async def test_classifier_raises_on_empty_input() -> None:
    client = FakeOllamaClient([])
    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    with pytest.raises(ClassificationValidationError):
        await classifier.classify_text("   ")

    assert len(client.calls) == 0


@pytest.mark.asyncio
async def test_classifier_downsizes_large_images_before_model_call() -> None:
    client = FakeOllamaClient(
        [
            (
                '{"document_type":"receipt","template":"receipt","title":"ICA Maxi",'
                '"summary":"Matvarukvitto","tags":["receipt"],"language":"sv",'
                '"confidence":0.97,"ocr_text":"ICA Maxi 342 kr",'
                '"suggested_actions":["archive"]}'
            ),
        ]
    )
    image = Image.new("RGB", (4000, 3000), "white")
    buffer = BytesIO()
    image.save(buffer, format="PNG")

    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    await classifier.classify_image(buffer.getvalue(), "image/png")

    image_url = client.calls[0]["messages"][1]["content"][0]["image_url"]["url"]
    encoded = image_url.split(",", 1)[1]
    resized = Image.open(BytesIO(base64.b64decode(encoded)))
    assert max(resized.size) <= 1280


@pytest.mark.asyncio
async def test_classifier_accepts_markdown_wrapped_json() -> None:
    client = FakeOllamaClient(
        [
            """Här är resultatet:
```json
{"document_type":"receipt","template":"receipt","title":"ICA Maxi","summary":"Matvarukvitto","tags":["receipt"],"language":"sv","confidence":0.97,"ocr_text":"ICA Maxi 342 kr","suggested_actions":["archive"]}
```""",
        ]
    )
    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    result = await classifier.classify_text("ICA Maxi 342 kr")

    assert result.document_type == "receipt"
    assert len(client.calls) == 1
