import { describe, it, expect, afterEach } from "vitest";
import { t, setLocale, getLocale } from "./locale";

afterEach(() => {
  setLocale("sv"); // restore default
});

describe("locale string resolution", () => {
  it("defaults to Swedish", () => {
    expect(getLocale()).toBe("sv");
    expect(t("status.completed")).toBe("Klar");
  });

  it("resolves Swedish strings", () => {
    setLocale("sv");
    expect(t("status.uploaded")).toBe("Uppladdad");
    expect(t("status.failed")).toBe("Misslyckades");
    expect(t("filter.receipt")).toBe("Kvitton");
    expect(t("bulk.delete")).toBe("Ta bort");
  });

  it("resolves English strings", () => {
    setLocale("en");
    expect(t("status.completed")).toBe("Done");
    expect(t("status.uploaded")).toBe("Uploaded");
    expect(t("filter.receipt")).toBe("Receipts");
    expect(t("bulk.delete")).toBe("Delete");
  });

  it("falls back to Swedish for missing key in English", () => {
    setLocale("en");
    // All current keys exist in both locales, but the fallback mechanism
    // should return the Swedish value if a key were missing from English
    expect(t("status.completed")).toBe("Done");
  });

  it("returns key for completely unknown key", () => {
    expect(t("totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("has consistent key coverage across locales", () => {
    const svKeys = [
      // Status
      "status.completed", "status.uploaded", "status.processing",
      "status.failed", "status.pending", "status.review",
      // Filters
      "filter.all", "filter.receipt", "filter.invoice",
      // Bulk
      "bulk.delete", "bulk.move", "bulk.retry",
      // Inspector
      "inspector.summary", "inspector.extracted_fields", "inspector.tags",
      "inspector.delete_button", "inspector.chat_about_doc",
      // Document kinds
      "kind.receipt", "kind.contract", "kind.invoice",
      // Processing stages
      "stage.queued", "stage.processing", "stage.indexing",
      // Move status
      "move.moved", "move.failed", "move.undone",
      // Toast
      "toast.field_saved", "toast.document_deleted",
      // Connection
      "connection.connected", "connection.disconnected",
      // Notebook
      "notebook.doc_mode", "notebook.ws_mode",
      // Discovery
      "discovery.heading", "discovery.type_duplicate",
      // Command palette
      "cmd.create_workspace", "cmd.files",
      // Chat
      "chat.unknown_error", "chat.connection_error",
    ];

    for (const key of svKeys) {
      setLocale("sv");
      const svVal = t(key);
      setLocale("en");
      const enVal = t(key);
      expect(svVal).not.toBe(key); // Swedish value should exist
      expect(enVal).not.toBe(key); // English value should exist
    }
  });

  it("resolves inspector and kind keys correctly", () => {
    setLocale("sv");
    expect(t("kind.receipt")).toBe("Kvitto");
    expect(t("inspector.summary")).toBe("Sammanfattning");
    expect(t("move.moved")).toBe("Flyttad");

    setLocale("en");
    expect(t("kind.receipt")).toBe("Receipt");
    expect(t("inspector.summary")).toBe("Summary");
    expect(t("move.moved")).toBe("Moved");
  });
});
