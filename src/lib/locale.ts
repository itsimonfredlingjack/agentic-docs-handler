/**
 * Lightweight locale string resources for frontend user-facing text.
 *
 * Usage:
 *   import { t } from "../lib/locale";
 *   t("status.completed")  // → "Klar" (sv) or "Done" (en)
 *
 * Missing keys in the active locale fall back to Swedish.
 */

type StringTable = Record<string, string>;

let activeLocale: "sv" | "en" = "sv";

export function setLocale(locale: "sv" | "en"): void {
  activeLocale = locale;
}

export function getLocale(): "sv" | "en" {
  return activeLocale;
}

export function t(key: string): string {
  const table = STRINGS[activeLocale] ?? STRINGS.sv;
  return table[key] ?? STRINGS.sv[key] ?? key;
}

// ------------------------------------------------------------------
// String tables
// ------------------------------------------------------------------

const SV: StringTable = {
  // Status labels
  "status.uploaded": "Uppladdad",
  "status.processing": "Bearbetas",
  "status.completed": "Klar",
  "status.review": "Granska",
  "status.failed": "Misslyckades",
  "status.pending": "Väntar på AI",

  // Sidebar filter labels
  "filter.all": "Alla",
  "filter.recent": "Senaste",
  "filter.processing": "Pågår",
  "filter.receipt": "Kvitton",
  "filter.contract": "Avtal",
  "filter.invoice": "Fakturor",
  "filter.meeting_notes": "Möten",
  "filter.report": "Rapporter",
  "filter.letter": "Brev",
  "filter.tax_document": "Skatt",
  "filter.audio": "Ljud",
  "filter.generic": "Övrigt",
  "filter.moved": "Flyttade",

  // Bulk action bar
  "bulk.selected": "markerade",
  "bulk.clear": "Rensa",
  "bulk.move": "Flytta",
  "bulk.delete": "Ta bort",
  "bulk.retry": "Försök igen",
  "bulk.no_workspaces": "Inga workspaces",
  "bulk.confirm_delete": "Ta bort {count} dokument permanent?",
  "bulk.deleted_success": "{count} dokument borttagna",
  "bulk.deleted_partial": "{succeeded} borttagna, {failed} misslyckades",
  "bulk.delete_error": "Kunde inte ta bort dokument",
  "bulk.retried_success": "{count} dokument ombearbetade",
  "bulk.retry_failed": "{count} misslyckades vid ombearbetning",
  "bulk.retry_error": "Kunde inte ombearbeta dokument",
  "bulk.moved_success": "{count} dokument flyttade",
  "bulk.move_error": "Kunde inte flytta dokument",

  // Document row
  "doc.pending_message": "Väntar på AI-bearbetning",
  "doc.failed_default": "Behandlingen misslyckades",
  "doc.retry": "Försök igen",
  "doc.undo_move": "Ångra flytt",
  "doc.moved_from": "Flyttad från",

  // Timeline
  "timeline.activity": "Aktivitet",
  "timeline.just_now": "just nu",
  "timeline.minutes_ago": "{n}m sedan",
  "timeline.hours_ago": "{n}h sedan",
  "timeline.yesterday": "igår",
  "timeline.days_ago": "{n}d sedan",

  // Search / empty states
  "search.failed_title": "Sökning misslyckades",
  "search.failed_message": "Kunde inte slutföra sökningen.",
  "search.no_results": "Inga träffar",
  "search.no_results_hint": "Ingen match för \"{query}\". Prova ett bredare sökord.",
  "empty.inbox": "Inkorgen är tom",
  "empty.workspace": "Inga dokument ännu",
  "empty.drop_hint": "Släpp filer var som helst för AI-bearbetning",

  // Document kind labels
  "kind.receipt": "Kvitto",
  "kind.contract": "Avtal",
  "kind.invoice": "Faktura",
  "kind.meeting_notes": "Mötesanteckning",
  "kind.report": "Rapport",
  "kind.letter": "Brev",
  "kind.tax_document": "Skattehandling",
  "kind.audio": "Ljud",
  "kind.file_moved": "Flyttad",
  "kind.generic": "Dokument",

  // Processing stage labels
  "stage.queued": "I kö",
  "stage.uploading": "Laddar upp",
  "stage.processing": "Bearbetar",
  "stage.transcribing": "Transkriberar",
  "stage.classifying": "Klassificerar",
  "stage.classified": "Extraherar",
  "stage.extracting": "Extraherar",
  "stage.organizing": "Organiserar",
  "stage.indexing": "Indexerar",
  "stage.failed": "Misslyckades",

  // Inspector pane
  "inspector.summary": "Sammanfattning",
  "inspector.extracted_fields": "Extraherade fält",
  "inspector.transcription": "Transkribering",
  "inspector.tags": "Taggar",
  "inspector.entities": "Entiteter",
  "inspector.file_location": "Filplats",
  "inspector.move_plan": "Flyttplan",
  "inspector.move_target": "Mål",
  "inspector.move_rule": "Regel",
  "inspector.move_status": "Status",
  "inspector.warnings": "Varningar",
  "inspector.meta": "Meta",
  "inspector.related_files": "Relaterade filer",
  "inspector.chat_about_doc": "Chatta om dokumentet",
  "inspector.open_in_finder": "Öppna i Finder",
  "inspector.delete_confirm": "Radera permanent?",
  "inspector.confirm_delete": "Ja, radera",
  "inspector.delete_button": "Radera",

  // Move status labels
  "move.not_requested": "Ej begärd",
  "move.planned": "Planerad",
  "move.awaiting_confirmation": "Väntar på bekräftelse",
  "move.pending_client": "Väntar på klient",
  "move.moved": "Flyttad",
  "move.failed": "Misslyckad",
  "move.undone": "Återställd",

  // Toast messages
  "toast.field_saved": "Fält sparat",
  "toast.document_deleted": "Dokument raderat",
  "toast.delete_failed": "Kunde inte radera dokumentet",

  // Common
  "common.cancel": "Avbryt",
  "common.retry": "Försök igen",

  // Connection banner
  "connection.offline": "Backend offline",
  "connection.reconnecting": "Återansluter…",
  "connection.connected": "Ansluten",
  "connection.disconnected": "Frånkopplad",
  "connection.connecting": "Ansluter…",

  // Workspace notebook
  "notebook.document_label": "Dokument",
  "notebook.doc_placeholder": "Fråga om detta dokument...",
  "notebook.doc_empty": "Fråga om detta dokument",
  "notebook.doc_mode": "Dokument-läge",
  "notebook.ws_placeholder": "Fråga {label}...",
  "notebook.ws_empty": "Fråga {label} vad som helst",
  "notebook.ws_mode": "Workspace-läge",

  // Discovery cards
  "discovery.heading": "Insikter",
  "discovery.loading": "Söker samband mellan filer...",
  "discovery.updating": "Uppdaterar insikter...",
  "discovery.error": "Kunde inte läsa insikter",
  "discovery.load_error": "Kunde inte läsa discovery",
  "discovery.result_count": "{count} fynd",
  "discovery.hide_button": "Dölj",
  "discovery.type_duplicate": "Dublett",
  "discovery.type_related": "Relaterad",
  "discovery.type_version": "Version",

  // Insights feed
  "insights.sidebar_heading": "AI Insikter",
  "insights.discoveries": "upptäckter",
  "insights.show": "Visa",
  "insights.tab_documents": "Dokument",
  "insights.tab_insights": "Insikter",
  "insights.filter_all": "Alla",
  "insights.filter_related": "Relaterade",
  "insights.filter_versions": "Versioner",
  "insights.filter_duplicates": "Duplikat",
  "insights.empty_title": "AI:n letar efter kopplingar",
  "insights.empty_description": "Insikter dyker upp här när AI:n hittar relaterade dokument, versioner eller dubbletter i din workspace.",
  "insights.new_badge": "NY",
  "insights.time_now": "Just nu",

  // Chat drawer
  "chat.drawer_placeholder": "Fråga AI om dina dokument...",
  "chat.followup_placeholder": "Följ upp...",
  "chat.new_chat": "Ny chatt",
  "chat.minimize": "Minimera",
  "chat.empty_prompt": "Fråga vad som helst om dina {count} dokument",

  // Command palette
  "cmd.search_placeholder": "Sök workspace...",
  "cmd.no_results": "Inga träffar",
  "cmd.search_results": "Sökresultat",
  "cmd.files": "Filer",
  "cmd.create_workspace": "Skapa workspace",
  "cmd.create_name_placeholder": "Namn på workspace...",
  "cmd.select_workspace": "Välj workspace",
  "cmd.searching": "Söker i index...",
  "cmd.workspace_created": "Workspace \"{name}\" skapad",
  "cmd.open_file": "Öppna fil: {title}",
  "cmd.go_to_workspace": "Gå till workspace: {name}",
  "cmd.move_file": "Flytta: {title}",
  "cmd.move_to_ws": "Flytta {title} till workspace...",

  // Chat errors
  "chat.unknown_error": "Okänt fel",
  "chat.empty_response": "Inget svar från AI-motorn",
  "chat.connection_error": "Anslutningsfel",

  // Processing rail
  "processing.active_jobs": "Aktiva jobb",

  // Column headers
  "column.name": "Namn",
  "column.details": "Detaljer",
  "column.status": "Status",

  // Actions
  "action.move": "Flytta",
  "action.confirm_route": "Bekräfta",
  "action.choose_workspace": "Välj",
  "action.import": "Importera",

  // Inbox suggestion
  "inbox.no_suggestion": "Ingen föreslagen workspace",
  "inbox.suggested_for": "Föreslagen:",

  // Workspace
  "workspace.items": "objekt",
  "workspace.inbox": "Inkorg",
  "workspace.show_more": "Visa mer",
  "workspace.show_less": "Visa mindre",

  // Inbox triage
  "inbox.progress": "{routed} av {total} dirigerade",
  "inbox.classifying": "{count} klassificeras",
  "inbox.needs_review": "{count} att granska",

  // Extraction fallback
  "extraction.no_details": "Inga detaljer",

  // Kind / status fallbacks
  "kind.generic_label": "Okategoriserad",
  "status.unknown": "Okänd",
};

const EN: StringTable = {
  // Status labels
  "status.uploaded": "Uploaded",
  "status.processing": "Processing",
  "status.completed": "Done",
  "status.review": "Review",
  "status.failed": "Failed",
  "status.pending": "Waiting for AI",

  // Sidebar filter labels
  "filter.all": "All",
  "filter.recent": "Recent",
  "filter.processing": "Processing",
  "filter.receipt": "Receipts",
  "filter.contract": "Contracts",
  "filter.invoice": "Invoices",
  "filter.meeting_notes": "Meetings",
  "filter.report": "Reports",
  "filter.letter": "Letters",
  "filter.tax_document": "Tax",
  "filter.audio": "Audio",
  "filter.generic": "Other",
  "filter.moved": "Moved",

  // Bulk action bar
  "bulk.selected": "selected",
  "bulk.clear": "Clear",
  "bulk.move": "Move",
  "bulk.delete": "Delete",
  "bulk.retry": "Retry",
  "bulk.no_workspaces": "No workspaces",
  "bulk.confirm_delete": "Delete {count} documents permanently?",
  "bulk.deleted_success": "{count} documents deleted",
  "bulk.deleted_partial": "{succeeded} deleted, {failed} failed",
  "bulk.delete_error": "Could not delete documents",
  "bulk.retried_success": "{count} documents reprocessed",
  "bulk.retry_failed": "{count} failed during reprocessing",
  "bulk.retry_error": "Could not reprocess documents",
  "bulk.moved_success": "{count} documents moved",
  "bulk.move_error": "Could not move documents",

  // Document row
  "doc.pending_message": "Waiting for AI processing",
  "doc.failed_default": "Processing failed",
  "doc.retry": "Retry",
  "doc.undo_move": "Undo move",
  "doc.moved_from": "Moved from",

  // Timeline
  "timeline.activity": "Activity",
  "timeline.just_now": "just now",
  "timeline.minutes_ago": "{n}m ago",
  "timeline.hours_ago": "{n}h ago",
  "timeline.yesterday": "yesterday",
  "timeline.days_ago": "{n}d ago",

  // Search / empty states
  "search.failed_title": "Search failed",
  "search.failed_message": "Could not complete the search.",
  "search.no_results": "No results",
  "search.no_results_hint": "No match for \"{query}\". Try a broader search term.",
  "empty.inbox": "Inbox is empty",
  "empty.workspace": "No documents yet",
  "empty.drop_hint": "Drop files anywhere to process with AI",

  // Document kind labels
  "kind.receipt": "Receipt",
  "kind.contract": "Contract",
  "kind.invoice": "Invoice",
  "kind.meeting_notes": "Meeting Note",
  "kind.report": "Report",
  "kind.letter": "Letter",
  "kind.tax_document": "Tax Document",
  "kind.audio": "Audio",
  "kind.file_moved": "Moved",
  "kind.generic": "Document",

  // Processing stage labels
  "stage.queued": "Queued",
  "stage.uploading": "Uploading",
  "stage.processing": "Processing",
  "stage.transcribing": "Transcribing",
  "stage.classifying": "Classifying",
  "stage.classified": "Extracting",
  "stage.extracting": "Extracting",
  "stage.organizing": "Organizing",
  "stage.indexing": "Indexing",
  "stage.failed": "Failed",

  // Inspector pane
  "inspector.summary": "Summary",
  "inspector.extracted_fields": "Extracted Fields",
  "inspector.transcription": "Transcription",
  "inspector.tags": "Tags",
  "inspector.entities": "Entities",
  "inspector.file_location": "File Location",
  "inspector.move_plan": "Move Plan",
  "inspector.move_target": "Target",
  "inspector.move_rule": "Rule",
  "inspector.move_status": "Status",
  "inspector.warnings": "Warnings",
  "inspector.meta": "Meta",
  "inspector.related_files": "Related Files",
  "inspector.chat_about_doc": "Chat about document",
  "inspector.open_in_finder": "Open in Finder",
  "inspector.delete_confirm": "Delete permanently?",
  "inspector.confirm_delete": "Yes, delete",
  "inspector.delete_button": "Delete",

  // Move status labels
  "move.not_requested": "Not requested",
  "move.planned": "Planned",
  "move.awaiting_confirmation": "Awaiting confirmation",
  "move.pending_client": "Pending client",
  "move.moved": "Moved",
  "move.failed": "Failed",
  "move.undone": "Undone",

  // Toast messages
  "toast.field_saved": "Field saved",
  "toast.document_deleted": "Document deleted",
  "toast.delete_failed": "Could not delete document",

  // Common
  "common.cancel": "Cancel",
  "common.retry": "Retry",

  // Connection banner
  "connection.offline": "Backend offline",
  "connection.reconnecting": "Reconnecting…",
  "connection.connected": "Connected",
  "connection.disconnected": "Disconnected",
  "connection.connecting": "Connecting…",

  // Workspace notebook
  "notebook.document_label": "Document",
  "notebook.doc_placeholder": "Ask about this document...",
  "notebook.doc_empty": "Ask about this document",
  "notebook.doc_mode": "Document mode",
  "notebook.ws_placeholder": "Ask {label}...",
  "notebook.ws_empty": "Ask {label} anything",
  "notebook.ws_mode": "Workspace mode",

  // Discovery cards
  "discovery.heading": "Insights",
  "discovery.loading": "Finding connections between files...",
  "discovery.updating": "Updating insights...",
  "discovery.error": "Could not load insights",
  "discovery.load_error": "Could not load discovery",
  "discovery.result_count": "{count} findings",
  "discovery.hide_button": "Hide",
  "discovery.type_duplicate": "Duplicate",
  "discovery.type_related": "Related",
  "discovery.type_version": "Version",

  // Insights feed
  "insights.sidebar_heading": "AI Insights",
  "insights.discoveries": "discoveries",
  "insights.show": "Show",
  "insights.tab_documents": "Documents",
  "insights.tab_insights": "Insights",
  "insights.filter_all": "All",
  "insights.filter_related": "Related",
  "insights.filter_versions": "Versions",
  "insights.filter_duplicates": "Duplicates",
  "insights.empty_title": "AI is looking for connections",
  "insights.empty_description": "Insights will appear here when the AI finds related documents, versions, or duplicates in your workspace.",
  "insights.new_badge": "NEW",
  "insights.time_now": "Just now",

  // Chat drawer
  "chat.drawer_placeholder": "Ask AI about your documents...",
  "chat.followup_placeholder": "Follow up...",
  "chat.new_chat": "New chat",
  "chat.minimize": "Minimize",
  "chat.empty_prompt": "Ask anything about your {count} documents",

  // Command palette
  "cmd.search_placeholder": "Search workspace...",
  "cmd.no_results": "No results",
  "cmd.search_results": "Search Results",
  "cmd.files": "Files",
  "cmd.create_workspace": "Create workspace",
  "cmd.create_name_placeholder": "Workspace name...",
  "cmd.select_workspace": "Select workspace",
  "cmd.searching": "Searching index...",
  "cmd.workspace_created": "Workspace \"{name}\" created",
  "cmd.open_file": "Open file: {title}",
  "cmd.go_to_workspace": "Go to workspace: {name}",
  "cmd.move_file": "Move: {title}",
  "cmd.move_to_ws": "Move {title} to workspace...",

  // Chat errors
  "chat.unknown_error": "Unknown error",
  "chat.empty_response": "No response from AI engine",
  "chat.connection_error": "Connection error",

  // Processing rail
  "processing.active_jobs": "Active jobs",

  // Column headers
  "column.name": "Name",
  "column.details": "Details",
  "column.status": "Status",

  // Actions
  "action.move": "Move",
  "action.confirm_route": "Confirm",
  "action.choose_workspace": "Choose",
  "action.import": "Import",

  // Inbox suggestion
  "inbox.no_suggestion": "No suggested workspace",
  "inbox.suggested_for": "Suggested:",

  // Workspace
  "workspace.items": "items",
  "workspace.inbox": "Inbox",
  "workspace.show_more": "Show more",
  "workspace.show_less": "Show less",

  // Inbox triage
  "inbox.progress": "{routed} of {total} routed",
  "inbox.classifying": "{count} classifying",
  "inbox.needs_review": "{count} to review",

  // Extraction fallback
  "extraction.no_details": "No details",

  // Kind / status fallbacks
  "kind.generic_label": "Uncategorized",
  "status.unknown": "Unknown",
};

const STRINGS: Record<string, StringTable> = { sv: SV, en: EN };
