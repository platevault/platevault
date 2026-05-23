-- Migration 0001: operation state table (ported from legacy rusqlite scaffolding)
CREATE TABLE IF NOT EXISTS operation_states (
    id TEXT PRIMARY KEY NOT NULL,
    operation_type TEXT NOT NULL,
    status TEXT NOT NULL,
    progress_current INTEGER,
    progress_total INTEGER,
    current_message TEXT,
    started_at TEXT,
    finished_at TEXT,
    resume_token TEXT,
    error_code TEXT,
    error_message TEXT,
    updated_at TEXT NOT NULL
);
