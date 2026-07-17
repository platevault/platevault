PRAGMA foreign_keys = ON;

-- Migration 0067: Inbox-confirm attribution apply-path (spec 008 Q27,
-- F-Framing-10, FR-022). Renumbered from 0066 (claim-next-free collision
-- with main's 0066_session_notes.sql, PR #891 — precedent PR #317).
--
-- `plans.chosen_framing_id` carries the user's attribution pick from an
-- `inbox.confirm` request through to plan-apply time: the target framing (or
-- project's framing, once created) does not yet have a real light session to
-- add as a member at confirm time — light sessions are only durably created
-- when the plan's applied light frames are folded into `acquisition_session`
-- rows (`app_core_targets::ingest_sessions`, spec 035 US4). NULL means no
-- attribution was chosen (or the item was not a light frame) — the plan's
-- ingested session(s) stay unassigned, attributable later via
-- `framing.reassign`.
--
-- Also indexes `framing.optic_train_key`, read by the F-Framing-5 attribution
-- prefilter (`list_framings_by_optic_train_key`) — migration 0064 indexed the
-- session-level column but not the framing-level one.
ALTER TABLE plans ADD COLUMN chosen_framing_id TEXT REFERENCES framing(id);

CREATE INDEX IF NOT EXISTS idx_framing_optic_train_key ON framing(optic_train_key);
