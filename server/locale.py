"""Lightweight locale string resources for backend user-facing messages.

Usage:
    from server.locale import msg
    msg("event.document_added", title="Faktura")
    # → "Dokument tillagt av AI: Faktura"

Strings are plain Python dicts keyed by locale code.
Missing keys in the active locale fall back to Swedish (sv).
"""
from __future__ import annotations

_active_locale: str = "sv"

SUPPORTED_LOCALES = ("sv", "en")
DEFAULT_LOCALE = "sv"


def set_locale(locale: str) -> None:
    global _active_locale
    _active_locale = locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE


def get_locale() -> str:
    return _active_locale


def msg(key: str, **kwargs: object) -> str:
    """Look up a user-facing string by key, interpolate with kwargs."""
    table = _STRINGS.get(_active_locale, _STRINGS[DEFAULT_LOCALE])
    template = table.get(key)
    if template is None:
        template = _STRINGS[DEFAULT_LOCALE].get(key, key)
    try:
        return template.format(**kwargs) if kwargs else template
    except (KeyError, IndexError):
        return template


# ------------------------------------------------------------------
# String tables
# ------------------------------------------------------------------

_SV: dict[str, str] = {
    # Workspace category labels
    "category.receipt": "Kvitton",
    "category.contract": "Avtal",
    "category.invoice": "Fakturor",
    "category.meeting_notes": "Mötesanteckningar",
    "category.report": "Rapporter",
    "category.letter": "Brev",
    "category.tax_document": "Skattehandlingar",
    "category.audio": "Ljud",
    "category.generic": "Övrigt",

    # Timeline event titles
    "event.workspace_created": "Workspace skapad: {name}",
    "event.document_added": "Dokument tillagt av AI: {title}",
    "event.document_added_detail": "Typ: {doc_type}, confidence: {confidence}",
    "event.documents_moved_in": "{count} dokument flyttade hit",
    "event.documents_moved_in_detail": "Manuellt flyttade av användaren",
    "event.documents_moved_out": "{count} dokument flyttade härifrån",
    "event.brief_updated": "AI-sammanfattning uppdaterad",
    "event.document_removed": "Dokument borttaget: {title}",

    # Pipeline progress messages
    "progress.processing": "Bearbetar dokument",
    "progress.waiting_queue": "Väntar på modellkön",
    "progress.extracting": "Extraherar fält",
    "progress.fields_extracted": "Fält extraherade",
    "progress.awaiting_move": "Väntar på bekräftelse för filflytt",
    "progress.file_moved": "Filen flyttades",

    # Warnings and errors
    "warning.classification_fallback": "Kunde inte tolka dokumentet fullt ut, visning sker i generiskt läge.",
    "warning.ollama_unavailable": "AI-motorn är inte tillgänglig. Dokumentet sparas och bearbetas senare.",

    # Search fallbacks
    "search.no_documents": "Inga indexerade dokument finns tillgängliga ännu.",
    "search.no_results": "Jag hittade inga dokument som matchar frågan.",

    # Discovery relation explanations
    "discovery.exact_duplicate": "Exakt kopia: filerna har samma SHA-256-hash.",
    "discovery.near_duplicate": "Nästan identiskt innehåll med semantisk likhet {similarity}.",
    "discovery.related_entities": "Delar entiteter: {entities}",
    "discovery.version_relation": "Liknande titel och innehåll, men olika filversioner.",

    # Workspace chat fallbacks
    "chat.all_documents": "Alla dokument",
    "chat.unknown_document": "Okänt dokument",
    "chat.documents_fallback": "dokument",

    # Workspace memory
    "memory.header": "WORKSPACE-HISTORIK (tidigare samtal):",
}

_EN: dict[str, str] = {
    # Workspace category labels
    "category.receipt": "Receipts",
    "category.contract": "Contracts",
    "category.invoice": "Invoices",
    "category.meeting_notes": "Meeting Notes",
    "category.report": "Reports",
    "category.letter": "Letters",
    "category.tax_document": "Tax Documents",
    "category.audio": "Audio",
    "category.generic": "Other",

    # Timeline event titles
    "event.workspace_created": "Workspace created: {name}",
    "event.document_added": "Document added by AI: {title}",
    "event.document_added_detail": "Type: {doc_type}, confidence: {confidence}",
    "event.documents_moved_in": "{count} documents moved here",
    "event.documents_moved_in_detail": "Manually moved by user",
    "event.documents_moved_out": "{count} documents moved away",
    "event.brief_updated": "AI summary updated",
    "event.document_removed": "Document removed: {title}",

    # Pipeline progress messages
    "progress.processing": "Processing document",
    "progress.waiting_queue": "Waiting for model queue",
    "progress.extracting": "Extracting fields",
    "progress.fields_extracted": "Fields extracted",
    "progress.awaiting_move": "Awaiting file move confirmation",
    "progress.file_moved": "File moved",

    # Warnings and errors
    "warning.classification_fallback": "Could not fully interpret the document. Displaying in generic mode.",
    "warning.ollama_unavailable": "AI engine is unavailable. Document saved for later processing.",

    # Search fallbacks
    "search.no_documents": "No indexed documents available yet.",
    "search.no_results": "No documents found matching your query.",

    # Discovery relation explanations
    "discovery.exact_duplicate": "Exact copy: files have the same SHA-256 hash.",
    "discovery.near_duplicate": "Nearly identical content with semantic similarity {similarity}.",
    "discovery.related_entities": "Shares entities: {entities}",
    "discovery.version_relation": "Similar title and content, but different file versions.",

    # Workspace chat fallbacks
    "chat.all_documents": "All documents",
    "chat.unknown_document": "Unknown document",
    "chat.documents_fallback": "documents",

    # Workspace memory
    "memory.header": "WORKSPACE HISTORY (past conversations):",
}

_STRINGS: dict[str, dict[str, str]] = {
    "sv": _SV,
    "en": _EN,
}


def category_labels() -> dict[str, str]:
    """Return workspace category labels for the active locale."""
    return {
        "receipt": msg("category.receipt"),
        "contract": msg("category.contract"),
        "invoice": msg("category.invoice"),
        "meeting_notes": msg("category.meeting_notes"),
        "report": msg("category.report"),
        "letter": msg("category.letter"),
        "tax_document": msg("category.tax_document"),
        "audio": msg("category.audio"),
        "generic": msg("category.generic"),
    }
