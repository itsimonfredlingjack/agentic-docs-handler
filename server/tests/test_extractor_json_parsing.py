from __future__ import annotations

import pytest

from server.pipelines.extractor import DocumentExtractor
from server.schemas import DocumentClassification


class FakeOllamaClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[dict[str, object]] = []

    async def chat_json(self, **kwargs: object) -> str:
        self.calls.append(kwargs)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_extractor_accepts_markdown_wrapped_json() -> None:
    client = FakeOllamaClient(
        [
            """Svar:
```json
{"fields":{"amount":"342 SEK","vendor":"ICA Maxi"},"field_confidence":{"amount":0.95},"missing_fields":[]}
```""",
        ]
    )
    extractor = DocumentExtractor(
        ollama_client=client,
        prompts={"generic": "Extrahera fält."},
    )
    classification = DocumentClassification(
        document_type="generic",
        template="generic",
        title="Kvitto",
        summary="Sammanfattning",
        tags=[],
        language="sv",
        confidence=0.8,
        ocr_text=None,
        suggested_actions=[],
    )

    result = await extractor.extract("ICA Maxi 342 kr", classification, request_id="req-extract")

    assert result.fields["amount"] == "342 SEK"
    assert len(client.calls) == 1
