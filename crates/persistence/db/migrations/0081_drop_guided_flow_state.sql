-- Migration 0076: drop the legacy spec-010 guided-coach table (spec 056, T010).
--
-- Deferred from 0069 (see that migration's header and the persistence
-- lib.rs comment): the drop ships here, atomically with the spec 056
-- deletion lane that removes the code reading/writing this table
-- (`crates/app/core/src/guided_flow.rs`,
-- `crates/persistence/db/src/repositories/guided_flow.rs`). Greenfield
-- removal, no data migrated (FR-027). Migration 0030 that created the table
-- stays shipped and untouched (append-only history).
DROP TABLE IF EXISTS guided_flow_state;
