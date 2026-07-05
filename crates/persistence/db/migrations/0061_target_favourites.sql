-- Migration 0061: target favourites (spec 051 US2).
--
-- Replaces the localStorage-only favourites stub
-- (apps/desktop/src/features/targets/useFavourites.ts) with a durable,
-- canonical record so favourited status survives restarts/reinstalls and is
-- inspectable in the database (Constitution Principle V).
--
-- One row per favourited target; absence of a row means "not favourited" --
-- no boolean column needed. ON DELETE CASCADE means a deleted/merged
-- canonical_target automatically drops its favourite row with no app-level
-- cleanup required.
--
-- Constitution §I : metadata only; no filesystem mutation.
-- Constitution §V : SQLite is the durable record for this previously
-- browser-storage-only piece of state.
--
-- NOTE: data-model.md §E1 documents this as migration `0055` (the next free
-- number when that doc was written); by implementation time concurrent
-- branches had already landed migrations through `0060`
-- (0060_project_path_anchor.sql), so this file is numbered `0061` to avoid a
-- collision (see the duplicate-migration-version-collision project lesson).

CREATE TABLE IF NOT EXISTS target_favourite (
    target_id     TEXT NOT NULL PRIMARY KEY REFERENCES canonical_target(id) ON DELETE CASCADE,
    favourited_at TEXT NOT NULL
);
