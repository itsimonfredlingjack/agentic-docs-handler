-- Brainfileing SQLite schema
-- All metadata storage for the workspace-centric document manager.
-- LanceDB remains the vector store; this replaces the JSONL persistence layer.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- -------------------------------------------------
-- Workspaces
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS workspace (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    ai_brief TEXT NOT NULL DEFAULT '',
    ai_entities TEXT NOT NULL DEFAULT '[]',
    ai_topics TEXT NOT NULL DEFAULT '[]',
    cover_color TEXT NOT NULL DEFAULT '',
    is_inbox INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_inbox
    ON workspace(is_inbox) WHERE is_inbox = 1;

-- -------------------------------------------------
-- Documents (replaces ui_documents.jsonl)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS document (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    workspace_id TEXT REFERENCES workspace(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL,
    source_modality TEXT NOT NULL,
    kind TEXT NOT NULL,
    document_type TEXT NOT NULL,
    template TEXT NOT NULL DEFAULT '',
    source_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    -- Nested Pydantic models stored as JSON TEXT
    classification TEXT NOT NULL DEFAULT '{}',
    extraction TEXT,
    transcription TEXT,
    move_plan TEXT,
    move_result TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ready',
    undo_token TEXT,
    move_status TEXT NOT NULL DEFAULT 'not_requested',
    retryable INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    warnings TEXT NOT NULL DEFAULT '[]',
    diagnostics TEXT,
    thumbnail_data TEXT
);

CREATE INDEX IF NOT EXISTS idx_doc_workspace ON document(workspace_id);
CREATE INDEX IF NOT EXISTS idx_doc_kind ON document(kind);
CREATE INDEX IF NOT EXISTS idx_doc_status ON document(status);
CREATE INDEX IF NOT EXISTS idx_doc_move_status ON document(move_status);
CREATE INDEX IF NOT EXISTS idx_doc_updated ON document(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_doc_request ON document(request_id);

-- -------------------------------------------------
-- Move history (replaces move_history.jsonl)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS move_history (
    undo_token TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    record_id TEXT NOT NULL REFERENCES document(id),
    client_id TEXT,
    from_path TEXT NOT NULL,
    to_path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    executor TEXT NOT NULL DEFAULT 'client',
    finalized_at TEXT,
    finalize_error TEXT,
    undone_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_move_record ON move_history(record_id);
CREATE INDEX IF NOT EXISTS idx_move_created ON move_history(created_at DESC);

-- -------------------------------------------------
-- Engagement events (replaces engagement_events.jsonl)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS engagement_event (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    surface TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_engage_ts ON engagement_event(timestamp DESC);

-- -------------------------------------------------
-- File relations (future: discovery engine)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS file_relation (
    id TEXT PRIMARY KEY,
    file_a_id TEXT NOT NULL REFERENCES document(id),
    file_b_id TEXT NOT NULL REFERENCES document(id),
    relation_type TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0.0,
    explanation TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rel_a ON file_relation(file_a_id);
CREATE INDEX IF NOT EXISTS idx_rel_b ON file_relation(file_b_id);

-- -------------------------------------------------
-- Entities (future: entity graph)
-- -------------------------------------------------
CREATE TABLE IF NOT EXISTS entity (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    UNIQUE(name, entity_type)
);

CREATE TABLE IF NOT EXISTS file_entity (
    file_id TEXT NOT NULL REFERENCES document(id),
    entity_id TEXT NOT NULL REFERENCES entity(id),
    context TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (file_id, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_fe_entity ON file_entity(entity_id);

-- -------------------------------------------------
-- FTS5 full-text search on documents
-- -------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS document_fts USING fts5(
    title, summary, tags,
    content='document', content_rowid='rowid',
    tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS doc_fts_ins AFTER INSERT ON document BEGIN
    INSERT INTO document_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS doc_fts_upd AFTER UPDATE ON document BEGIN
    INSERT INTO document_fts(document_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
    INSERT INTO document_fts(rowid, title, summary, tags)
    VALUES (new.rowid, new.title, new.summary, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS doc_fts_del AFTER DELETE ON document BEGIN
    INSERT INTO document_fts(document_fts, rowid, title, summary, tags)
    VALUES ('delete', old.rowid, old.title, old.summary, old.tags);
END;
