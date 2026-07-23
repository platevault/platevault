-- Spec 058 T013 (FR-016): scanned file count on the source group.
--
-- A scanned-but-unclassified folder is represented in `inbox.list` by its
-- source group rather than by a placeholder inbox item. The file count the
-- list row shows was previously only ever written onto that placeholder
-- (`inbox_items.file_count`, via `persist_folder_placeholder`), so it has to
-- live on the group once the placeholder is gone.
--
-- Additive, metadata-only, no backfill (D-004 greenfield). Groups scanned by
-- an older build read 0 until their next rescan.
ALTER TABLE inbox_source_groups
    ADD COLUMN file_count INTEGER NOT NULL DEFAULT 0;
