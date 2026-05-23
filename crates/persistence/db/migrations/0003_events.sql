-- Migration 0003: durable event bus table (T010b).
--
-- Durable side of the hybrid event bus (research.md §6).
-- The live side uses tokio::sync::broadcast (in-process, non-durable).
-- This table enables replay across restarts via cursor reads on (topic, event_id).

CREATE TABLE IF NOT EXISTS events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('user', 'restore', 'system')),
    emitted_at TEXT NOT NULL,
    payload TEXT NOT NULL  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_events_topic ON events(topic, event_id);
