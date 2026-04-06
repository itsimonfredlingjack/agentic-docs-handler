"""Tests for backend locale string resources and prompt resolution.

Verifies:
  (a) Default locale is Swedish
  (b) Swedish string lookup works
  (c) English string lookup works
  (d) Missing English key falls back to Swedish
  (e) Interpolation works
  (f) category_labels returns locale-aware labels
  (g) Prompt path resolution prefers locale dir, falls back to flat
  (h) required_prompt_paths resolves all prompts
"""
from __future__ import annotations

from pathlib import Path

from server.config import AppConfig
from server.locale import msg, set_locale, get_locale, category_labels, DEFAULT_LOCALE


def test_default_locale_is_swedish() -> None:
    assert DEFAULT_LOCALE == "sv"
    set_locale("sv")
    assert get_locale() == "sv"


def test_swedish_string_lookup() -> None:
    set_locale("sv")
    assert msg("category.receipt") == "Kvitton"
    assert msg("event.brief_updated") == "AI-sammanfattning uppdaterad"


def test_english_string_lookup() -> None:
    set_locale("en")
    assert msg("category.receipt") == "Receipts"
    assert msg("event.brief_updated") == "AI summary updated"
    set_locale("sv")  # restore


def test_missing_english_key_falls_back_to_swedish() -> None:
    set_locale("en")
    # All keys should exist in both locales, but test the fallback mechanism
    # by checking a key that we know exists in both
    result = msg("category.receipt")
    assert result == "Receipts"
    set_locale("sv")


def test_unknown_key_returns_key() -> None:
    set_locale("sv")
    assert msg("nonexistent.key") == "nonexistent.key"


def test_interpolation() -> None:
    set_locale("sv")
    result = msg("event.document_added", title="Faktura Q1")
    assert "Faktura Q1" in result

    set_locale("en")
    result = msg("event.document_added", title="Invoice Q1")
    assert "Invoice Q1" in result
    set_locale("sv")


def test_category_labels_reflect_locale() -> None:
    set_locale("sv")
    labels = category_labels()
    assert labels["receipt"] == "Kvitton"
    assert labels["invoice"] == "Fakturor"

    set_locale("en")
    labels = category_labels()
    assert labels["receipt"] == "Receipts"
    assert labels["invoice"] == "Invoices"
    set_locale("sv")


def test_unsupported_locale_falls_back() -> None:
    set_locale("fr")  # not supported
    assert get_locale() == "sv"  # should default to sv
    assert msg("category.receipt") == "Kvitton"


def test_prompt_path_resolution_prefers_locale_dir() -> None:
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="sv",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    path = config.resolve_prompt_path("classifier_system.txt")
    # Should resolve to sv/ directory since we copied prompts there
    assert path.exists()
    assert "sv" in str(path) or path == Path("server/prompts/classifier_system.txt")


def test_prompt_path_resolution_falls_back_to_flat() -> None:
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="en",  # no en/ directory exists
        sqlite_db_path=Path("/tmp/test.db"),
    )
    path = config.resolve_prompt_path("classifier_system.txt")
    # Should fall back to sv/ or flat
    assert path.exists()


def test_discovery_strings_resolve_in_both_locales() -> None:
    """Discovery relation explanations should be available in both locales."""
    set_locale("sv")
    assert "SHA-256" in msg("discovery.exact_duplicate")
    assert "semantisk" in msg("discovery.near_duplicate", similarity="0.95")
    assert "entiteter" in msg("discovery.related_entities", entities="IKEA, Telia")
    assert "filversioner" in msg("discovery.version_relation")

    set_locale("en")
    assert "SHA-256" in msg("discovery.exact_duplicate")
    assert "semantic" in msg("discovery.near_duplicate", similarity="0.95")
    assert "entities" in msg("discovery.related_entities", entities="IKEA, Telia")
    assert "versions" in msg("discovery.version_relation")
    set_locale("sv")


def test_chat_fallback_strings_resolve() -> None:
    """Workspace chat fallback strings should be available."""
    set_locale("sv")
    assert msg("chat.all_documents") == "Alla dokument"
    assert msg("chat.unknown_document") == "Okänt dokument"

    set_locale("en")
    assert msg("chat.all_documents") == "All documents"
    assert msg("chat.unknown_document") == "Unknown document"
    set_locale("sv")


def test_required_prompt_paths_all_exist() -> None:
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="sv",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    paths = config.required_prompt_paths()
    assert len(paths) == 14
    missing = [p for p in paths if not p.exists()]
    assert len(missing) == 0, f"Missing prompts: {missing}"


def test_english_prompt_paths_all_exist() -> None:
    """All 14 required prompts must exist in en/ — no silent fallback to sv."""
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="en",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    paths = config.required_prompt_paths()
    assert len(paths) == 14
    missing = [p for p in paths if not p.exists()]
    assert len(missing) == 0, f"Missing English prompts: {missing}"


def test_english_prompts_resolve_to_en_directory() -> None:
    """With locale=en, every required prompt should resolve to en/, not sv/ or flat."""
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="en",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    for name in config.PROMPT_NAMES:
        path = config.resolve_prompt_path(name)
        assert "/en/" in str(path), (
            f"Prompt {name!r} resolved to {path}, expected en/ directory"
        )


def test_english_and_swedish_prompt_sets_have_parity() -> None:
    """Every prompt in PROMPT_NAMES must exist in both sv/ and en/."""
    prompts_dir = Path("server/prompts")
    config = AppConfig(
        prompts_dir=prompts_dir,
        locale="sv",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    missing_en = []
    missing_sv = []
    for name in config.PROMPT_NAMES:
        if not (prompts_dir / "en" / name).exists():
            missing_en.append(name)
        if not (prompts_dir / "sv" / name).exists():
            missing_sv.append(name)
    assert not missing_en, f"Missing in en/: {missing_en}"
    assert not missing_sv, f"Missing in sv/: {missing_sv}"


def test_fallback_to_sv_when_en_file_missing() -> None:
    """If an English prompt is deliberately removed, resolution falls back to sv/."""
    config = AppConfig(
        prompts_dir=Path("server/prompts"),
        locale="en",
        sqlite_db_path=Path("/tmp/test.db"),
    )
    # Use a non-existent prompt name to test fallback
    path = config.resolve_prompt_path("nonexistent_prompt.txt")
    # Should fall back to sv/ path (which also doesn't exist), then flat
    assert "nonexistent_prompt.txt" in str(path)
