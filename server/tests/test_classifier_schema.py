from __future__ import annotations

import pytest

from server.pipelines.classifier import ClassificationValidationError, DocumentClassifier


class FakeOllamaClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[dict[str, object]] = []

    async def chat_json(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_classifier_repairs_invalid_json_once_before_succeeding() -> None:
    client = FakeOllamaClient(
        [
            '{"document_type":"receipt"',
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
    assert len(client.calls) == 2
    assert client.calls[1]["prompt_name"] == "classifier_repair"


@pytest.mark.asyncio
async def test_classifier_fails_after_second_invalid_response() -> None:
    client = FakeOllamaClient(['{"broken":', '{"still":"broken"'])
    classifier = DocumentClassifier(
        ollama_client=client,
        classifier_prompt="Du klassificerar dokument.",
        image_classifier_prompt="Du analyserar dokumentbilder.",
    )

    with pytest.raises(ClassificationValidationError):
        await classifier.classify_text("text")
