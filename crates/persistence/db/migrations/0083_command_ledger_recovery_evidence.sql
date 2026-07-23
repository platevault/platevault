-- Spec 062 command-ledger recovery evidence.
--
-- Migration 0082 intentionally constrains command_execution.error_code to
-- terminal states.  A crashed terminal write still needs an authoritative
-- nonterminal evidence record, so recovery fields live beside (rather than
-- weakening) the terminal-state checks in 0082.

ALTER TABLE command_execution ADD COLUMN recovery_terminal_outcome TEXT;
ALTER TABLE command_execution ADD COLUMN recovery_response_json TEXT;
ALTER TABLE command_execution ADD COLUMN recovery_error_code TEXT;
ALTER TABLE command_execution ADD COLUMN recovery_expected_outbox_count INTEGER;
ALTER TABLE command_execution ADD COLUMN recovery_expected_outbox_digest TEXT;
