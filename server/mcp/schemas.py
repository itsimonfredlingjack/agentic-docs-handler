from __future__ import annotations

from pydantic import BaseModel, Field

from server.schemas import DocumentClassification


class SearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class SearchDocumentsInput(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=20)


class FetchInput(BaseModel):
    id: str = Field(min_length=1, max_length=200)


class ClassifyTextInput(BaseModel):
    text: str = Field(min_length=1)


class ClassifyImageInput(BaseModel):
    image_path: str = Field(min_length=1)


class ExtractFieldsInput(BaseModel):
    text: str = Field(min_length=1)
    classification: DocumentClassification


class PreviewDocumentProcessingInput(BaseModel):
    source_path: str = Field(min_length=1)


class OrganizeFileInput(BaseModel):
    source_path: str = Field(min_length=1)


class ActivityLogInput(BaseModel):
    limit: int = Field(default=10, ge=1, le=100)
