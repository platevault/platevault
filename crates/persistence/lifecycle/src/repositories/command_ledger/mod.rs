// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Durable command identity, lease fencing, terminal reconciliation, audit,
//! and the single trusted in-process outbox for Spec 062.
//!
//! The repository deliberately keeps command ownership in SQLite.  A caller
//! must acquire a [`CommandLease`] before doing domain work and pass that lease
//! to [`CommandLedger::finish`].  The same transaction writes the terminal
//! command result, one audit row, and its bounded outbox sequence.

#![allow(clippy::missing_errors_doc)]

use std::time::Duration;

use domain_core::ids::Timestamp;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use time::{format_description::well_known::Rfc3339, Duration as TimeDuration, OffsetDateTime};
use uuid::Uuid;

const DEFAULT_LEASE_TTL: Duration = Duration::from_secs(30);
/// Prevents an accidentally unbounded command response from becoming a row.
pub const MAX_RESPONSE_BYTES: usize = 64 * 1024;
/// Event DTOs are intentionally small and bounded at this trusted boundary.
pub const MAX_OUTBOX_PAYLOAD_BYTES: usize = 16 * 1024;
/// A command may emit at most one bounded event sequence.
pub const MAX_OUTBOX_EVENTS: usize = 100;
const MAX_SAFE_STRING_BYTES: usize = 1024;

/// Errors returned by command-ledger operations.  Semantic errors are kept
/// separate from [`crate::DbError`] so callers can project safe contract codes
/// without parsing SQLite's diagnostic text.
#[derive(Debug, Error)]
pub enum CommandLedgerError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("idempotency.payload_mismatch")]
    PayloadMismatch,
    #[error("operation.in_progress")]
    InProgress,
    #[error("command lease fence is stale")]
    StaleFence,
    #[error("command lease has expired")]
    LeaseExpired,
    #[error("command terminal result is already recorded")]
    AlreadyTerminal,
    #[error("ambiguous command recovery; refusing to execute again")]
    AmbiguousRecovery,
    #[error("command not found")]
    NotFound,
    #[error("invalid command ledger input: {0}")]
    InvalidInput(String),
}

pub type Result<T> = std::result::Result<T, CommandLedgerError>;

/// Input identity for a command claim.  `payload` is canonicalized before it
/// is digested, so object key order cannot change command identity.
#[derive(Clone, Debug)]
pub struct CommandRequest {
    pub command_id: String,
    pub actor_id: String,
    pub operation: String,
    pub payload: Value,
    pub worker_id: String,
}

impl CommandRequest {
    #[must_use]
    pub fn new(
        command_id: impl Into<String>,
        actor_id: impl Into<String>,
        operation: impl Into<String>,
        payload: Value,
        worker_id: impl Into<String>,
    ) -> Self {
        Self {
            command_id: command_id.into(),
            actor_id: actor_id.into(),
            operation: operation.into(),
            payload,
            worker_id: worker_id.into(),
        }
    }

    fn digest(&self) -> Result<String> {
        canonical_payload_digest(&self.actor_id, &self.operation, &self.payload)
    }
}

/// The database-owned fencing token.  The owner is intentionally part of this
/// type even though the portable contract only exposes command ID and
/// generation; it prevents a worker from presenting another worker's token.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandFence {
    pub command_id: String,
    pub lease_owner: String,
    pub lease_generation: i64,
}

/// An acquired command lease.  `state_version` is an optimistic CAS token for
/// heartbeat updates; generation + owner remain the irreversible-effect fence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandLease {
    pub fence: CommandFence,
    pub state_version: i64,
    pub lease_expires_at: String,
    pub heartbeat_at: String,
}

impl CommandLease {
    #[must_use]
    pub fn command_id(&self) -> &str {
        &self.fence.command_id
    }

    #[must_use]
    pub fn lease_generation(&self) -> i64 {
        self.fence.lease_generation
    }
}

/// Claim result.  Replays and live executions are values, not failures, so a
/// transport can project the stable idempotency error codes without inspecting
/// an exception string.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ClaimOutcome {
    Claimed(CommandLease),
    Replayed(CommandTerminal),
    PayloadMismatch,
    InProgress { command_id: String, operation: String },
}

/// The terminal command result stored in `command_execution`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandTerminal {
    pub command_id: String,
    pub state: TerminalState,
    pub response_json: Option<String>,
    pub error_code: Option<String>,
    pub finished_at: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TerminalState {
    Applied,
    Refused,
    Failed,
}

impl TerminalState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Refused => "refused",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "applied" => Some(Self::Applied),
            "refused" => Some(Self::Refused),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}

/// The audit vocabulary is intentionally wider than the command state
/// vocabulary.  A rejected review decision is a refused command at the
/// transport boundary, but must remain `rejected` in the immutable audit log.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AuditOutcome {
    Applied,
    Rejected,
    Refused,
    Failed,
}

impl AuditOutcome {
    fn as_str(self) -> &'static str {
        match self {
            Self::Applied => "applied",
            Self::Rejected => "rejected",
            Self::Refused => "refused",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "applied" => Some(Self::Applied),
            "rejected" => Some(Self::Rejected),
            "refused" => Some(Self::Refused),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }

    fn command_state(self) -> TerminalState {
        match self {
            Self::Applied => TerminalState::Applied,
            Self::Rejected | Self::Refused => TerminalState::Refused,
            Self::Failed => TerminalState::Failed,
        }
    }
}

/// One of the typed physical aggregate references required by the normalized
/// audit and outbox tables.  Exactly one reference is written per row.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AggregateRef {
    Operation(i64),
    Proposal(i64),
    Session(i64),
    PanelGroup(i64),
    Mosaic(i64),
    Project(i64),
    Handoff(i64),
}

impl AggregateRef {
    fn validate(self) -> Result<()> {
        let values = self.values();
        if values.into_iter().flatten().any(|id| id <= 0) {
            return Err(CommandLedgerError::InvalidInput(
                "aggregate row ID must be positive".to_owned(),
            ));
        }
        Ok(())
    }

    fn values(self) -> [Option<i64>; 7] {
        let mut values = [None; 7];
        match self {
            Self::Operation(id) => values[0] = Some(id),
            Self::Proposal(id) => values[1] = Some(id),
            Self::Session(id) => values[2] = Some(id),
            Self::PanelGroup(id) => values[3] = Some(id),
            Self::Mosaic(id) => values[4] = Some(id),
            Self::Project(id) => values[5] = Some(id),
            Self::Handoff(id) => values[6] = Some(id),
        }
        values
    }
}

/// Audit fields supplied by the trusted domain operation.  Actor and command
/// identity are always taken from the claimed command, never from this input.
#[derive(Clone, Debug)]
pub struct AuditInput {
    pub action: String,
    pub aggregate: AggregateRef,
    pub reason_code: String,
    pub payload: Option<Value>,
    /// Optional audit-only outcome.  When absent it follows the terminal
    /// command state (`refused` remains the default for rejected transport
    /// decisions); callers may set `Rejected` for review decisions.
    pub outcome: Option<AuditOutcome>,
}

impl AuditInput {
    #[must_use]
    pub fn new(
        action: impl Into<String>,
        aggregate: AggregateRef,
        reason_code: impl Into<String>,
    ) -> Self {
        Self {
            action: action.into(),
            aggregate,
            reason_code: reason_code.into(),
            payload: None,
            outcome: None,
        }
    }

    #[must_use]
    pub fn with_outcome(mut self, outcome: AuditOutcome) -> Self {
        self.outcome = Some(outcome);
        self
    }
}

/// One event in the transactional outbox sequence.  Ordinals are assigned by
/// [`CommandLedger::finish`], making retries naturally idempotent.
#[derive(Clone, Debug)]
pub struct OutboxInput {
    pub aggregate: AggregateRef,
    pub event_type: String,
    pub payload: Value,
}

impl OutboxInput {
    #[must_use]
    pub fn new(aggregate: AggregateRef, event_type: impl Into<String>, payload: Value) -> Self {
        Self { aggregate, event_type: event_type.into(), payload }
    }
}

/// Terminal data committed with the command result, audit row, and outbox.
#[derive(Clone, Debug)]
pub struct TerminalInput {
    pub state: TerminalState,
    pub response: Option<Value>,
    pub error_code: Option<String>,
    pub audit: AuditInput,
    pub outbox: Vec<OutboxInput>,
}

/// A safely projected, unpublished event returned by the bounded outbox poll.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OutboxRow {
    pub row_id: i64,
    pub public_id: String,
    pub command_id: String,
    pub event_ordinal: i64,
    pub event_type: String,
    pub payload_json: String,
    pub occurred_at: String,
    pub attempt_count: i64,
    pub last_error: Option<String>,
}

/// SQLite command-ledger repository.
#[derive(Clone)]
pub struct CommandLedger {
    pool: SqlitePool,
    lease_ttl: Duration,
}

impl CommandLedger {
    #[must_use]
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool, lease_ttl: DEFAULT_LEASE_TTL }
    }

    #[must_use]
    pub fn with_lease_ttl(pool: SqlitePool, lease_ttl: Duration) -> Self {
        Self { pool, lease_ttl }
    }

    #[must_use]
    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Claim a command or return its recorded/replayed state.
    pub async fn claim(&self, request: &CommandRequest) -> Result<ClaimOutcome> {
        self.claim_at(request, &Timestamp::now_iso()).await
    }

    /// Deterministic variant used by recovery tests and callers with a trusted
    /// clock.  `now` must be an RFC3339 timestamp in the same format as the DB.
    pub async fn claim_at(&self, request: &CommandRequest, now: &str) -> Result<ClaimOutcome> {
        let digest = request.digest()?;
        let lease_expires_at = add_ttl(now, self.lease_ttl)?;
        let mut connection = self.pool.acquire().await?;
        begin_immediate(&mut connection).await?;

        let actor_row_id = match ensure_actor(&mut connection, &request.actor_id, now).await {
            Ok(id) => id,
            Err(error) => return rollback_error(&mut connection, error).await,
        };
        let existing = match load_command(&mut connection, &request.command_id).await {
            Ok(row) => row,
            Err(error) => return rollback_error(&mut connection, error).await,
        };

        let outcome = if let Some(row) = existing {
            if row.actor_row_id != actor_row_id
                || row.operation != request.operation
                || row.canonical_payload_digest != digest
            {
                ClaimOutcome::PayloadMismatch
            } else if let Some(terminal) = row.terminal() {
                ClaimOutcome::Replayed(terminal)
            } else if row.lease_expires_at.as_deref().is_some_and(|expiry| expiry > now) {
                ClaimOutcome::InProgress {
                    command_id: request.command_id.clone(),
                    operation: request.operation.clone(),
                }
            } else {
                match recover_expired_row(
                    &mut connection,
                    &row,
                    &request.worker_id,
                    &lease_expires_at,
                    now,
                )
                .await
                {
                    Ok(value) => value,
                    Err(error) => return rollback_error(&mut connection, error).await,
                }
            }
        } else {
            let result = sqlx::query(
                "INSERT INTO command_execution
                 (public_id, actor_row_id, operation, canonical_payload_digest, state,
                  state_version, lease_generation, lease_owner, lease_expires_at,
                  heartbeat_at, created_at, started_at)
                 VALUES (?, ?, ?, ?, 'executing', 1, 1, ?, ?, ?, ?, ?)",
            )
            .bind(&request.command_id)
            .bind(actor_row_id)
            .bind(&request.operation)
            .bind(&digest)
            .bind(&request.worker_id)
            .bind(&lease_expires_at)
            .bind(now)
            .bind(now)
            .execute(&mut *connection)
            .await;
            match result {
                Ok(result) => {
                    let row_id = result.last_insert_rowid();
                    if let Err(error) = append_repository_change(&mut connection, row_id, now).await
                    {
                        return rollback_error(&mut connection, error).await;
                    }
                    ClaimOutcome::Claimed(CommandLease {
                        fence: CommandFence {
                            command_id: request.command_id.clone(),
                            lease_owner: request.worker_id.clone(),
                            lease_generation: 1,
                        },
                        state_version: 1,
                        lease_expires_at,
                        heartbeat_at: now.to_owned(),
                    })
                }
                Err(error) => return rollback_error(&mut connection, error.into()).await,
            }
        };

        if let Err(error) = sqlx::query("COMMIT").execute(&mut *connection).await {
            return Err(error.into());
        }
        Ok(outcome)
    }

    /// Reclaim an expired command or reconcile an already committed outcome.
    /// This is an explicit alias for [`Self::claim`], retained to make recovery
    /// call sites read as a recovery operation.
    pub async fn recover(&self, request: &CommandRequest) -> Result<ClaimOutcome> {
        self.claim(request).await
    }

    /// Extend a lease using a state-version CAS.  A stale worker receives a
    /// stable fence error and cannot refresh a reclaimed execution.
    pub async fn heartbeat(&self, lease: &CommandLease) -> Result<CommandLease> {
        self.heartbeat_at(lease, &Timestamp::now_iso()).await
    }

    pub async fn heartbeat_at(&self, lease: &CommandLease, now: &str) -> Result<CommandLease> {
        let expiry = add_ttl(now, self.lease_ttl)?;
        let mut connection = self.pool.acquire().await?;
        begin_immediate(&mut connection).await?;
        let result = sqlx::query(
            "UPDATE command_execution
             SET state_version = state_version + 1, heartbeat_at = ?, lease_expires_at = ?
             WHERE public_id = ? AND state = 'executing' AND lease_owner = ?
               AND lease_generation = ? AND state_version = ? AND lease_expires_at > ?",
        )
        .bind(now)
        .bind(&expiry)
        .bind(&lease.fence.command_id)
        .bind(&lease.fence.lease_owner)
        .bind(lease.fence.lease_generation)
        .bind(lease.state_version)
        .bind(now)
        .execute(&mut *connection)
        .await;
        let result = match result {
            Ok(value) => value,
            Err(error) => return rollback_error(&mut connection, error.into()).await,
        };
        if result.rows_affected() != 1 {
            return rollback_error(&mut connection, CommandLedgerError::StaleFence).await;
        }
        let next = CommandLease {
            fence: lease.fence.clone(),
            state_version: lease.state_version + 1,
            lease_expires_at: expiry,
            heartbeat_at: now.to_owned(),
        };
        sqlx::query("COMMIT").execute(&mut *connection).await?;
        Ok(next)
    }

    /// Atomically publish one terminal result, exactly one audit row, and a
    /// bounded redacted outbox sequence.
    pub async fn finish(
        &self,
        lease: &CommandLease,
        input: &TerminalInput,
    ) -> Result<CommandTerminal> {
        self.finish_at(lease, input, &Timestamp::now_iso()).await
    }

    #[allow(clippy::too_many_lines)]
    pub async fn finish_at(
        &self,
        lease: &CommandLease,
        input: &TerminalInput,
        now: &str,
    ) -> Result<CommandTerminal> {
        validate_terminal(input)?;
        let response_json = input.response.as_ref().map(canonical_json).transpose()?;
        let audit_payload = input.audit.payload.as_ref().map(safe_payload_json).transpose()?;
        let outbox_payloads: Vec<String> = input
            .outbox
            .iter()
            .map(|event| safe_payload_json(&event.payload))
            .collect::<Result<_>>()?;
        let outbox_digest = canonical_outbox_digest(&input.outbox, &outbox_payloads)?;
        let audit_outcome =
            input.audit.outcome.unwrap_or_else(|| default_audit_outcome(input.state));
        let mut connection = self.pool.acquire().await?;
        begin_immediate(&mut connection).await?;
        let Some(row) = load_command(&mut connection, &lease.fence.command_id).await? else {
            return rollback_error(&mut connection, CommandLedgerError::NotFound).await;
        };
        if let Some(terminal) = row.terminal() {
            sqlx::query("COMMIT").execute(&mut *connection).await?;
            return Ok(terminal);
        }
        if row.lease_owner.as_deref() != Some(&lease.fence.lease_owner)
            || row.lease_generation != lease.fence.lease_generation
            || row.state != "executing"
        {
            return rollback_error(&mut connection, CommandLedgerError::StaleFence).await;
        }
        if row.lease_expires_at.as_deref().is_none_or(|expiry| expiry <= now) {
            return rollback_error(&mut connection, CommandLedgerError::LeaseExpired).await;
        }

        // A live execution may only create its terminal evidence once.  Any
        // pre-existing audit/outbox row indicates a discovered partial commit;
        // recovery, not a worker retry, must reconcile it fail-closed.
        let audit_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM audit_event WHERE command_row_id = ?")
                .bind(row.row_id)
                .fetch_one(&mut *connection)
                .await?;
        let outbox_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM outbox_event WHERE command_row_id = ?")
                .bind(row.row_id)
                .fetch_one(&mut *connection)
                .await?;
        if audit_count.0 != 0 || outbox_count.0 != 0 {
            return rollback_error(&mut connection, CommandLedgerError::AmbiguousRecovery).await;
        }

        let evidence = sqlx::query(
            "UPDATE command_execution
             SET recovery_terminal_outcome = ?, recovery_response_json = ?,
                 recovery_error_code = ?, recovery_expected_outbox_count = ?,
                 recovery_expected_outbox_digest = ?
             WHERE row_id = ? AND state = 'executing' AND lease_owner = ?
               AND lease_generation = ? AND lease_expires_at > ?",
        )
        .bind(audit_outcome.as_str())
        .bind(&response_json)
        .bind(&input.error_code)
        .bind(i64::try_from(input.outbox.len()).map_err(|_| {
            CommandLedgerError::InvalidInput("outbox sequence exceeds SQLite bounds".to_owned())
        })?)
        .bind(&outbox_digest)
        .bind(row.row_id)
        .bind(&lease.fence.lease_owner)
        .bind(lease.fence.lease_generation)
        .bind(now)
        .execute(&mut *connection)
        .await?;
        if evidence.rows_affected() != 1 {
            return rollback_error(&mut connection, CommandLedgerError::StaleFence).await;
        }

        let change_sequence = append_repository_change(&mut connection, row.row_id, now).await?;
        let audit_public_id = Uuid::new_v4().to_string();
        let values = input.audit.aggregate.values();
        sqlx::query(
            "INSERT INTO audit_event
             (public_id, command_row_id, operation_row_id, proposal_row_id, session_row_id,
              panel_group_row_id, mosaic_row_id, project_row_id, handoff_row_id, actor_row_id,
              action, outcome, reason_code, payload_json, created_sequence, occurred_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&audit_public_id)
        .bind(row.row_id)
        .bind(values[0])
        .bind(values[1])
        .bind(values[2])
        .bind(values[3])
        .bind(values[4])
        .bind(values[5])
        .bind(values[6])
        .bind(row.actor_row_id)
        .bind(&input.audit.action)
        .bind(audit_outcome.as_str())
        .bind(&input.audit.reason_code)
        .bind(audit_payload)
        .bind(change_sequence)
        .bind(now)
        .execute(&mut *connection)
        .await?;

        for (ordinal, (event, payload)) in input.outbox.iter().zip(outbox_payloads).enumerate() {
            let values = event.aggregate.values();
            sqlx::query(
                "INSERT INTO outbox_event
                 (public_id, command_row_id, event_ordinal, operation_row_id, proposal_row_id,
                  session_row_id, panel_group_row_id, mosaic_row_id, project_row_id, handoff_row_id,
                  event_type, payload_json, created_sequence, occurred_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(row.row_id)
            .bind(i64::try_from(ordinal).map_err(|_| {
                CommandLedgerError::InvalidInput("event ordinal overflow".to_owned())
            })?)
            .bind(values[0])
            .bind(values[1])
            .bind(values[2])
            .bind(values[3])
            .bind(values[4])
            .bind(values[5])
            .bind(values[6])
            .bind(&event.event_type)
            .bind(payload)
            .bind(change_sequence)
            .bind(now)
            .execute(&mut *connection)
            .await?;
        }

        let written_audit_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM audit_event WHERE command_row_id = ?")
                .bind(row.row_id)
                .fetch_one(&mut *connection)
                .await?;
        let written_outbox_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM outbox_event WHERE command_row_id = ?")
                .bind(row.row_id)
                .fetch_one(&mut *connection)
                .await?;
        if written_audit_count.0 != 1
            || written_outbox_count.0 != i64::try_from(input.outbox.len()).unwrap_or(i64::MAX)
        {
            return rollback_error(&mut connection, CommandLedgerError::AmbiguousRecovery).await;
        }

        let finished = TerminalState::as_str(input.state);
        let update = sqlx::query(
            "UPDATE command_execution
             SET state = ?, state_version = state_version + 1, lease_owner = NULL,
                 lease_expires_at = NULL, heartbeat_at = NULL, response_json = ?,
                 error_code = ?, finished_at = ?, recovery_terminal_outcome = NULL,
                 recovery_response_json = NULL, recovery_error_code = NULL,
                 recovery_expected_outbox_count = NULL, recovery_expected_outbox_digest = NULL
             WHERE row_id = ? AND state = 'executing' AND lease_owner = ?
               AND lease_generation = ? AND lease_expires_at > ?",
        )
        .bind(finished)
        .bind(&response_json)
        .bind(&input.error_code)
        .bind(now)
        .bind(row.row_id)
        .bind(&lease.fence.lease_owner)
        .bind(lease.fence.lease_generation)
        .bind(now)
        .execute(&mut *connection)
        .await?;
        if update.rows_affected() != 1 {
            return rollback_error(&mut connection, CommandLedgerError::StaleFence).await;
        }
        sqlx::query("COMMIT").execute(&mut *connection).await?;
        Ok(CommandTerminal {
            command_id: lease.fence.command_id.clone(),
            state: input.state,
            response_json,
            error_code: input.error_code.clone(),
            finished_at: now.to_owned(),
        })
    }

    /// Poll unpublished events in deterministic `(occurred_at, row_id)` order.
    pub async fn poll_outbox(&self, limit: u32) -> Result<Vec<OutboxRow>> {
        let max_events = u32::try_from(MAX_OUTBOX_EVENTS).unwrap_or(u32::MAX);
        let limit = i64::from(limit.min(max_events));
        let rows = sqlx::query_as::<_, RawOutboxRow>(
            "SELECT o.row_id, o.public_id, c.public_id AS command_id, o.event_ordinal,
                    o.event_type, o.payload_json, o.occurred_at, o.attempt_count, o.last_error
             FROM outbox_event o JOIN command_execution c ON c.row_id = o.command_row_id
             WHERE o.published_at IS NULL ORDER BY o.occurred_at, o.row_id LIMIT ?",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(OutboxRow::from).collect())
    }

    /// Mark an event delivered.  Delivery fields are the only mutable outbox
    /// fields permitted by migration triggers.
    pub async fn mark_published(&self, row_id: i64, now: &str) -> Result<bool> {
        let result = sqlx::query(
            "UPDATE outbox_event SET published_at = ?, attempt_count = attempt_count + 1,
                    last_error = NULL WHERE row_id = ? AND published_at IS NULL",
        )
        .bind(now)
        .bind(row_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    /// Record a bounded safe delivery failure without leaking raw diagnostics.
    pub async fn mark_delivery_failure(&self, row_id: i64, safe_code: &str) -> Result<bool> {
        let safe_code = bounded_safe_string(safe_code)?;
        let result = sqlx::query(
            "UPDATE outbox_event SET attempt_count = attempt_count + 1,
                    last_error = ? WHERE row_id = ? AND published_at IS NULL",
        )
        .bind(safe_code)
        .bind(row_id)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }
}

#[derive(Debug, FromRow)]
struct CommandRow {
    row_id: i64,
    public_id: String,
    actor_row_id: i64,
    operation: String,
    canonical_payload_digest: String,
    state: String,
    state_version: i64,
    lease_generation: i64,
    lease_owner: Option<String>,
    lease_expires_at: Option<String>,
    response_json: Option<String>,
    error_code: Option<String>,
    finished_at: Option<String>,
    recovery_terminal_outcome: Option<String>,
    recovery_response_json: Option<String>,
    recovery_error_code: Option<String>,
    recovery_expected_outbox_count: Option<i64>,
    recovery_expected_outbox_digest: Option<String>,
}

impl CommandRow {
    fn terminal(&self) -> Option<CommandTerminal> {
        Some(CommandTerminal {
            command_id: self.public_id.clone(),
            state: TerminalState::parse(&self.state)?,
            response_json: self.response_json.clone(),
            error_code: self.error_code.clone(),
            finished_at: self.finished_at.clone()?,
        })
    }
}

#[derive(Debug, FromRow)]
struct RawOutboxRow {
    row_id: i64,
    public_id: String,
    command_id: String,
    event_ordinal: i64,
    event_type: String,
    payload_json: String,
    occurred_at: String,
    attempt_count: i64,
    last_error: Option<String>,
}

impl From<RawOutboxRow> for OutboxRow {
    fn from(row: RawOutboxRow) -> Self {
        Self {
            row_id: row.row_id,
            public_id: row.public_id,
            command_id: row.command_id,
            event_ordinal: row.event_ordinal,
            event_type: row.event_type,
            payload_json: row.payload_json,
            occurred_at: row.occurred_at,
            attempt_count: row.attempt_count,
            last_error: row.last_error,
        }
    }
}

async fn begin_immediate(connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>) -> Result<()> {
    sqlx::query("BEGIN IMMEDIATE").execute(&mut **connection).await?;
    Ok(())
}

async fn rollback_error<T>(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    error: CommandLedgerError,
) -> Result<T> {
    let _ = sqlx::query("ROLLBACK").execute(&mut **connection).await;
    Err(error)
}

async fn ensure_actor(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    actor_id: &str,
    now: &str,
) -> Result<i64> {
    if actor_id.is_empty() {
        return Err(CommandLedgerError::InvalidInput("actor ID is empty".to_owned()));
    }
    sqlx::query(
        "INSERT INTO spec062_actor(public_id, created_at) VALUES (?, ?)
         ON CONFLICT(public_id) DO NOTHING",
    )
    .bind(actor_id)
    .bind(now)
    .execute(&mut **connection)
    .await?;
    let row: (i64,) = sqlx::query_as("SELECT row_id FROM spec062_actor WHERE public_id = ?")
        .bind(actor_id)
        .fetch_one(&mut **connection)
        .await?;
    Ok(row.0)
}

async fn append_repository_change(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    command_row_id: i64,
    now: &str,
) -> Result<i64> {
    let result =
        sqlx::query("INSERT INTO repository_change(command_row_id, created_at) VALUES (?, ?)")
            .bind(command_row_id)
            .bind(now)
            .execute(&mut **connection)
            .await?;
    Ok(result.last_insert_rowid())
}

async fn load_command(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    command_id: &str,
) -> Result<Option<CommandRow>> {
    Ok(sqlx::query_as::<_, CommandRow>(
        "SELECT row_id, public_id, actor_row_id, operation, canonical_payload_digest, state,
                state_version, lease_generation, lease_owner, lease_expires_at,
                response_json, error_code, finished_at, recovery_terminal_outcome,
                recovery_response_json, recovery_error_code, recovery_expected_outbox_count,
                recovery_expected_outbox_digest
         FROM command_execution WHERE public_id = ?",
    )
    .bind(command_id)
    .fetch_optional(&mut **connection)
    .await?)
}

#[allow(clippy::too_many_lines)]
async fn recover_expired_row(
    connection: &mut sqlx::pool::PoolConnection<sqlx::Sqlite>,
    row: &CommandRow,
    worker_id: &str,
    expiry: &str,
    now: &str,
) -> Result<ClaimOutcome> {
    let audit_rows: Vec<(String,)> =
        sqlx::query_as("SELECT outcome FROM audit_event WHERE command_row_id = ? ORDER BY row_id")
            .bind(row.row_id)
            .fetch_all(&mut **connection)
            .await?;
    let outbox_rows: Vec<RecoveryOutboxRow> = sqlx::query_as(
        "SELECT event_ordinal, event_type, payload_json, operation_row_id, proposal_row_id,
                session_row_id, panel_group_row_id, mosaic_row_id, project_row_id, handoff_row_id
         FROM outbox_event WHERE command_row_id = ? ORDER BY event_ordinal",
    )
    .bind(row.row_id)
    .fetch_all(&mut **connection)
    .await?;

    // The only recoverable shapes are an untouched execution (no evidence) or
    // one complete audit row plus the exact event sequence recorded before the
    // terminal write. Any other shape is a discovered partial commit and must
    // not be guessed at.
    if audit_rows.is_empty() && outbox_rows.is_empty() {
        if row.response_json.is_some()
            || row.error_code.is_some()
            || row.recovery_terminal_outcome.is_some()
            || row.recovery_response_json.is_some()
            || row.recovery_error_code.is_some()
            || row.recovery_expected_outbox_count.is_some()
            || row.recovery_expected_outbox_digest.is_some()
        {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
    } else if audit_rows.len() != 1
        || outbox_rows.len() > MAX_OUTBOX_EVENTS
        || outbox_rows.iter().enumerate().any(|(ordinal, event)| {
            event.event_ordinal != i64::try_from(ordinal).unwrap_or(i64::MAX)
        })
    {
        return Err(CommandLedgerError::AmbiguousRecovery);
    }

    if !audit_rows.is_empty() {
        let expected_count = row
            .recovery_expected_outbox_count
            .filter(|count| *count >= 0)
            .and_then(|count| usize::try_from(count).ok())
            .ok_or(CommandLedgerError::AmbiguousRecovery)?;
        if expected_count != outbox_rows.len() {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
        let expected_digest = row
            .recovery_expected_outbox_digest
            .as_deref()
            .ok_or(CommandLedgerError::AmbiguousRecovery)?;
        if recovery_outbox_digest(&outbox_rows)? != expected_digest {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
        let recorded_outcome = &audit_rows[0].0;
        let audit_outcome =
            AuditOutcome::parse(recorded_outcome).ok_or(CommandLedgerError::AmbiguousRecovery)?;
        let pending_outcome = row
            .recovery_terminal_outcome
            .as_deref()
            .and_then(AuditOutcome::parse)
            .ok_or(CommandLedgerError::AmbiguousRecovery)?;
        if pending_outcome != audit_outcome {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
        let state = audit_outcome.command_state();
        let response_json = row.recovery_response_json.clone();
        let error_code = row.recovery_error_code.clone();
        if let Some(response) = response_json.as_deref() {
            let parsed = serde_json::from_str::<Value>(response)
                .map_err(|_| CommandLedgerError::AmbiguousRecovery)?;
            if canonical_json(&parsed).map_err(|_| CommandLedgerError::AmbiguousRecovery)?
                != response
            {
                return Err(CommandLedgerError::AmbiguousRecovery);
            }
            if response.len() > MAX_RESPONSE_BYTES {
                return Err(CommandLedgerError::AmbiguousRecovery);
            }
        }
        if let Some(error) = error_code.as_deref() {
            bounded_safe_string(error).map_err(|_| CommandLedgerError::AmbiguousRecovery)?;
        }
        if (matches!(state, TerminalState::Applied) && error_code.is_some())
            || (!matches!(state, TerminalState::Applied) && error_code.is_none())
        {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
        let update = sqlx::query(
            "UPDATE command_execution
             SET state = ?, state_version = state_version + 1, lease_owner = NULL,
                 lease_expires_at = NULL, heartbeat_at = NULL, response_json = ?,
                 error_code = ?, finished_at = ?, recovery_terminal_outcome = NULL,
                 recovery_response_json = NULL, recovery_error_code = NULL,
                 recovery_expected_outbox_count = NULL, recovery_expected_outbox_digest = NULL
             WHERE row_id = ? AND state_version = ? AND lease_generation = ?",
        )
        .bind(state.as_str())
        .bind(&response_json)
        .bind(&error_code)
        .bind(now)
        .bind(row.row_id)
        .bind(row.state_version)
        .bind(row.lease_generation)
        .execute(&mut **connection)
        .await?;
        if update.rows_affected() != 1 {
            return Err(CommandLedgerError::AmbiguousRecovery);
        }
        return Ok(ClaimOutcome::Replayed(CommandTerminal {
            command_id: row.public_id.clone(),
            state,
            response_json,
            error_code,
            finished_at: now.to_owned(),
        }));
    }

    let update = sqlx::query(
        "UPDATE command_execution
         SET state = 'executing', state_version = state_version + 1,
             lease_generation = lease_generation + 1, lease_owner = ?,
             lease_expires_at = ?, heartbeat_at = ?, started_at = COALESCE(started_at, ?)
         WHERE row_id = ? AND state IN ('received','executing')
           AND state_version = ? AND lease_generation = ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
    )
    .bind(worker_id)
    .bind(expiry)
    .bind(now)
    .bind(now)
    .bind(row.row_id)
    .bind(row.state_version)
    .bind(row.lease_generation)
    .bind(now)
    .execute(&mut **connection)
    .await?;
    if update.rows_affected() != 1 {
        return Err(CommandLedgerError::InProgress);
    }
    Ok(ClaimOutcome::Claimed(CommandLease {
        fence: CommandFence {
            command_id: row.public_id.clone(),
            lease_owner: worker_id.to_owned(),
            lease_generation: row.lease_generation + 1,
        },
        state_version: row.state_version + 1,
        lease_expires_at: expiry.to_owned(),
        heartbeat_at: now.to_owned(),
    }))
}

fn validate_terminal(input: &TerminalInput) -> Result<()> {
    if input.outbox.len() > MAX_OUTBOX_EVENTS {
        return Err(CommandLedgerError::InvalidInput(format!(
            "outbox sequence exceeds {MAX_OUTBOX_EVENTS} events"
        )));
    }
    if matches!(input.state, TerminalState::Applied) && input.error_code.is_some() {
        return Err(CommandLedgerError::InvalidInput(
            "applied command cannot carry an error code".to_owned(),
        ));
    }
    if !matches!(input.state, TerminalState::Applied) && input.error_code.is_none() {
        return Err(CommandLedgerError::InvalidInput(
            "refused and failed commands require an error code".to_owned(),
        ));
    }
    if input.audit.action.is_empty() || input.audit.reason_code.is_empty() {
        return Err(CommandLedgerError::InvalidInput(
            "audit action and reason are required".to_owned(),
        ));
    }
    let audit_outcome = input.audit.outcome.unwrap_or_else(|| default_audit_outcome(input.state));
    let expected_outcome = default_audit_outcome(input.state);
    if !audit_outcome_matches_state(audit_outcome, input.state)
        || (matches!(input.state, TerminalState::Applied | TerminalState::Failed)
            && audit_outcome != expected_outcome)
    {
        return Err(CommandLedgerError::InvalidInput(
            "audit outcome does not match terminal command state".to_owned(),
        ));
    }
    input.audit.aggregate.validate()?;
    for event in &input.outbox {
        if event.event_type.is_empty() {
            return Err(CommandLedgerError::InvalidInput(
                "outbox event type is required".to_owned(),
            ));
        }
        bounded_safe_string(&event.event_type)?;
        event.aggregate.validate()?;
    }
    if let Some(response) = &input.response {
        let serialized = canonical_json(response)?;
        if serialized.len() > MAX_RESPONSE_BYTES {
            return Err(CommandLedgerError::InvalidInput(
                "command response is too large".to_owned(),
            ));
        }
    }
    if let Some(payload) = &input.audit.payload {
        let _ = safe_payload_json(payload)?;
    }
    Ok(())
}

fn default_audit_outcome(state: TerminalState) -> AuditOutcome {
    match state {
        TerminalState::Applied => AuditOutcome::Applied,
        TerminalState::Refused => AuditOutcome::Refused,
        TerminalState::Failed => AuditOutcome::Failed,
    }
}

fn audit_outcome_matches_state(outcome: AuditOutcome, state: TerminalState) -> bool {
    match state {
        TerminalState::Applied => matches!(outcome, AuditOutcome::Applied),
        TerminalState::Refused => matches!(outcome, AuditOutcome::Rejected | AuditOutcome::Refused),
        TerminalState::Failed => matches!(outcome, AuditOutcome::Failed),
    }
}

/// Compute the actor-bound SHA-256 identity used by `command_execution`.
pub fn canonical_payload_digest(
    actor_id: &str,
    operation: &str,
    payload: &Value,
) -> Result<String> {
    if actor_id.is_empty() || operation.is_empty() {
        return Err(CommandLedgerError::InvalidInput(
            "actor and operation are required".to_owned(),
        ));
    }
    let canonical = canonical_json(payload)?;
    let mut hasher = Sha256::new();
    hasher.update(operation.as_bytes());
    hasher.update([0]);
    hasher.update(actor_id.as_bytes());
    hasher.update([0]);
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn canonical_json(value: &Value) -> Result<String> {
    Ok(serde_json::to_string(&canonicalize(value))?)
}

fn canonicalize(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut sorted = Map::new();
            let mut keys: Vec<_> = map.keys().collect();
            keys.sort_unstable();
            for key in keys {
                sorted.insert(key.clone(), canonicalize(&map[key]));
            }
            Value::Object(sorted)
        }
        Value::Array(values) => Value::Array(values.iter().map(canonicalize).collect()),
        other => other.clone(),
    }
}

fn canonical_outbox_digest(events: &[OutboxInput], payloads: &[String]) -> Result<String> {
    if events.len() != payloads.len() {
        return Err(CommandLedgerError::InvalidInput(
            "outbox payload/dto cardinality mismatch".to_owned(),
        ));
    }
    let mut manifest = Vec::with_capacity(events.len());
    for (ordinal, (event, payload)) in events.iter().zip(payloads).enumerate() {
        manifest.push(json!({
            "ordinal": ordinal,
            "aggregate": aggregate_json(event.aggregate),
            "eventType": event.event_type,
            "payload": serde_json::from_str::<Value>(payload)?,
        }));
    }
    digest_manifest(&Value::Array(manifest))
}

fn digest_manifest(value: &Value) -> Result<String> {
    let canonical = canonical_json(value)?;
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    Ok(format!("sha256:{:x}", hasher.finalize()))
}

fn aggregate_json(aggregate: AggregateRef) -> Value {
    Value::Array(
        aggregate
            .values()
            .into_iter()
            .map(|value| value.map_or(Value::Null, Value::from))
            .collect(),
    )
}

#[derive(Debug, FromRow)]
struct RecoveryOutboxRow {
    event_ordinal: i64,
    event_type: String,
    payload_json: String,
    operation_row_id: Option<i64>,
    proposal_row_id: Option<i64>,
    session_row_id: Option<i64>,
    panel_group_row_id: Option<i64>,
    mosaic_row_id: Option<i64>,
    project_row_id: Option<i64>,
    handoff_row_id: Option<i64>,
}

fn recovery_outbox_digest(rows: &[RecoveryOutboxRow]) -> Result<String> {
    let mut manifest = Vec::with_capacity(rows.len());
    for row in rows {
        let payload = serde_json::from_str::<Value>(&row.payload_json)
            .map_err(|_| CommandLedgerError::AmbiguousRecovery)?;
        let aggregate = Value::Array(
            [
                row.operation_row_id,
                row.proposal_row_id,
                row.session_row_id,
                row.panel_group_row_id,
                row.mosaic_row_id,
                row.project_row_id,
                row.handoff_row_id,
            ]
            .into_iter()
            .map(|value| value.map_or(Value::Null, Value::from))
            .collect(),
        );
        manifest.push(json!({
            "ordinal": row.event_ordinal,
            "aggregate": aggregate,
            "eventType": row.event_type,
            "payload": payload,
        }));
    }
    digest_manifest(&Value::Array(manifest))
}

fn safe_payload_json(value: &Value) -> Result<String> {
    if !value.is_object() {
        return Err(CommandLedgerError::InvalidInput("event payload must be an object".to_owned()));
    }
    let bounded = validate_payload_value(value, None)?;
    let serialized = canonical_json(&bounded)?;
    if serialized.len() > MAX_OUTBOX_PAYLOAD_BYTES {
        return Err(CommandLedgerError::InvalidInput("event payload is too large".to_owned()));
    }
    Ok(serialized)
}

/// Serialize only the fields that are part of the reviewed event DTO union.
/// Unknown fields are rejected rather than copied and redacted heuristically;
/// this makes adding a new event payload an explicit code review boundary.
fn validate_payload_value(value: &Value, key: Option<&str>) -> Result<Value> {
    if let Some(key) = key {
        if is_sensitive_key(key) {
            return Err(CommandLedgerError::InvalidInput(
                "event payload contains a sensitive field".to_owned(),
            ));
        }
        if !is_allowed_payload_key(key) {
            return Err(CommandLedgerError::InvalidInput(format!(
                "event payload field is not allowlisted: {key}"
            )));
        }
    }
    match value {
        Value::Object(map) => {
            if map.len() > 64 {
                return Err(CommandLedgerError::InvalidInput(
                    "event payload has too many fields".to_owned(),
                ));
            }
            let mut output = Map::new();
            for (field, value) in map {
                output.insert(field.clone(), validate_payload_value(value, Some(field))?);
            }
            Ok(Value::Object(output))
        }
        Value::Array(values) => {
            if values.len() > 500 {
                return Err(CommandLedgerError::InvalidInput(
                    "event payload array is too large".to_owned(),
                ));
            }
            values
                .iter()
                .map(|value| validate_payload_value(value, None))
                .collect::<Result<Vec<_>>>()
                .map(Value::Array)
        }
        Value::String(value) => {
            if value.len() > MAX_SAFE_STRING_BYTES || value.chars().any(char::is_control) {
                return Err(CommandLedgerError::InvalidInput(
                    "event payload string is not bounded".to_owned(),
                ));
            }
            Ok(Value::String(value.clone()))
        }
        other => Ok(other.clone()),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    [
        "api_key",
        "apikey",
        "authorization",
        "cookie",
        "path",
        "secret",
        "token",
        "password",
        "credential",
        "stack",
        "exception",
        "rawpayload",
        "sourcepayload",
        "absolute",
    ]
    .iter()
    .any(|needle| key.contains(needle))
}

fn is_allowed_payload_key(key: &str) -> bool {
    [
        "eventId",
        "occurredAt",
        "actorId",
        "commandId",
        "entityRefs",
        "entityType",
        "entityId",
        "operationId",
        "proposalId",
        "sessionId",
        "panelGroupId",
        "mosaicId",
        "projectId",
        "handoffId",
        "planId",
        "resolutionId",
        "revision",
        "selectedSiteId",
        "selectedTimezone",
        "decision",
        "derivedObservingNight",
        "planRevision",
        "approvedPlanDigest",
        "processedSessionCount",
        "totalSessionCount",
        "processedFrameCount",
        "totalFrameCount",
        "sourcePlanId",
        "kind",
        "resultSnapshotId",
        "sessionCount",
        "frameMembershipCount",
        "singletonPanelGroupCount",
        "blockedFrameCount",
        "failureCode",
        "state",
        "status",
        "count",
        "total",
        "ok",
        "reason",
        "errorCode",
        "evidenceRef",
        "beforeRevisionCount",
        "afterRevisionCount",
        "expectedRevision",
        "actualRevision",
        "value",
    ]
    .contains(&key)
}

fn bounded_safe_string(value: &str) -> Result<String> {
    if value.is_empty() || value.len() > MAX_SAFE_STRING_BYTES {
        return Err(CommandLedgerError::InvalidInput(
            "delivery error code is not bounded".to_owned(),
        ));
    }
    if value.chars().any(char::is_control)
        || value
            .chars()
            .any(|character| !(character.is_ascii_alphanumeric() || ".-_".contains(character)))
    {
        return Err(CommandLedgerError::InvalidInput(
            "delivery error code contains control text".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

fn add_ttl(now: &str, ttl: Duration) -> Result<String> {
    let parsed = OffsetDateTime::parse(now, &Rfc3339)
        .map_err(|_| CommandLedgerError::InvalidInput("timestamp is not RFC3339".to_owned()))?;
    let seconds = i64::try_from(ttl.as_secs())
        .map_err(|_| CommandLedgerError::InvalidInput("lease TTL is too large".to_owned()))?;
    let nanos = i32::try_from(ttl.subsec_nanos())
        .map_err(|_| CommandLedgerError::InvalidInput("lease TTL is too large".to_owned()))?;
    parsed
        .checked_add(TimeDuration::new(seconds, nanos))
        .ok_or_else(|| CommandLedgerError::InvalidInput("lease expiry overflow".to_owned()))?
        .format(&Rfc3339)
        .map_err(|_| CommandLedgerError::InvalidInput("timestamp formatting failed".to_owned()))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;
    use persistence_core::Database;
    use serde_json::json;
    use tokio::sync::Barrier;

    async fn database() -> Database {
        let db = Database::in_memory().await.unwrap();
        db.migrate().await.unwrap();
        db
    }

    fn request(worker: &str) -> CommandRequest {
        CommandRequest::new(
            "00000000-0000-7000-8000-000000000101",
            "00000000-0000-7000-8000-000000000102",
            "session.test.apply",
            json!({ "b": 2, "a": 1 }),
            worker,
        )
    }

    async fn seed_session(db: &Database) {
        sqlx::query("INSERT INTO spec062_project (row_id, public_id, created_at) VALUES (1, 'project-1', '2026-01-01T00:00:00Z')")
            .execute(db.pool()).await.unwrap();
        sqlx::query("INSERT INTO repository_change(sequence, command_row_id, created_at) VALUES (1, NULL, '2026-01-01T00:00:00Z')")
            .execute(db.pool()).await.unwrap();
    }

    #[tokio::test]
    async fn actor_bound_digest_is_order_independent() {
        let left = canonical_payload_digest("actor", "op", &json!({ "a": 1, "b": 2 })).unwrap();
        let right = canonical_payload_digest("actor", "op", &json!({ "b": 2, "a": 1 })).unwrap();
        assert_eq!(left, right);
        assert_ne!(
            left,
            canonical_payload_digest("other", "op", &json!({ "a": 1, "b": 2 })).unwrap()
        );
    }

    #[tokio::test]
    async fn claim_replay_mismatch_and_in_progress_are_global() {
        let db = database().await;
        let ledger = CommandLedger::with_lease_ttl(db.pool().clone(), Duration::from_secs(30));
        let first = ledger.claim_at(&request("worker-a"), "2026-01-01T00:00:00Z").await.unwrap();
        assert!(matches!(first, ClaimOutcome::Claimed(_)));
        let replay = ledger.claim_at(&request("worker-b"), "2026-01-01T00:00:01Z").await.unwrap();
        assert!(matches!(replay, ClaimOutcome::InProgress { .. }));
        let mut mismatch = request("worker-b");
        mismatch.payload = json!({ "a": 9 });
        let mismatch = ledger.claim_at(&mismatch, "2026-01-01T00:00:01Z").await.unwrap();
        assert!(matches!(mismatch, ClaimOutcome::PayloadMismatch));
    }

    #[tokio::test]
    async fn independent_connections_share_global_command_identity() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("command-ledger.db");
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let first_db = Database::connect(&url).await.unwrap();
        first_db.migrate_uncached().await.unwrap();
        let second_db = Database::connect(&url).await.unwrap();
        second_db.migrate().await.unwrap();
        let first_ledger = CommandLedger::new(first_db.pool().clone());
        let second_ledger = CommandLedger::new(second_db.pool().clone());
        assert!(matches!(
            first_ledger.claim_at(&request("worker-a"), "2026-01-01T00:00:00Z").await.unwrap(),
            ClaimOutcome::Claimed(_)
        ));
        assert!(matches!(
            second_ledger.claim_at(&request("worker-b"), "2026-01-01T00:00:01Z").await.unwrap(),
            ClaimOutcome::InProgress { .. }
        ));
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn independent_connections_race_has_one_winner_and_one_effect_sequence() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("command-ledger-race.db");
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let first_db = Database::connect(&url).await.unwrap();
        first_db.migrate_uncached().await.unwrap();
        seed_session(&first_db).await;
        let second_db = Database::connect(&url).await.unwrap();
        second_db.migrate().await.unwrap();
        let first = CommandLedger::with_lease_ttl(first_db.pool().clone(), Duration::from_secs(30));
        let second =
            CommandLedger::with_lease_ttl(second_db.pool().clone(), Duration::from_secs(30));
        let barrier = Arc::new(Barrier::new(2));
        let first_barrier = Arc::clone(&barrier);
        let second_barrier = Arc::clone(&barrier);
        let first_task = {
            let ledger = first.clone();
            let command = request("worker-a");
            tokio::spawn(async move {
                first_barrier.wait().await;
                ledger.claim_at(&command, "2026-01-01T00:00:00Z").await
            })
        };
        let second_task = {
            let ledger = second.clone();
            let command = request("worker-b");
            tokio::spawn(async move {
                second_barrier.wait().await;
                ledger.claim_at(&command, "2026-01-01T00:00:00Z").await
            })
        };
        let first_result = first_task.await.unwrap().unwrap();
        let second_result = second_task.await.unwrap().unwrap();
        let (winning_ledger, winning_lease) = match (first_result, second_result) {
            (ClaimOutcome::Claimed(lease), ClaimOutcome::InProgress { .. }) => (first, lease),
            (ClaimOutcome::InProgress { .. }, ClaimOutcome::Claimed(lease)) => (second, lease),
            outcomes => panic!("expected exactly one winner, got {outcomes:?}"),
        };
        let terminal = TerminalInput {
            state: TerminalState::Applied,
            response: Some(json!({ "status": "applied" })),
            error_code: None,
            audit: AuditInput::new("session.race", AggregateRef::Project(1), "applied"),
            outbox: vec![OutboxInput::new(
                AggregateRef::Project(1),
                "session.race.applied",
                json!({ "status": "applied" }),
            )],
        };
        winning_ledger.finish_at(&winning_lease, &terminal, "2026-01-01T00:00:01Z").await.unwrap();
        assert!(matches!(
            winning_ledger.claim_at(&request("worker-c"), "2026-01-01T00:00:02Z").await.unwrap(),
            ClaimOutcome::Replayed(_)
        ));
        let counts: (i64, i64) = sqlx::query_as(
            "SELECT
                 (SELECT COUNT(*) FROM audit_event WHERE command_row_id = c.row_id),
                 (SELECT COUNT(*) FROM outbox_event WHERE command_row_id = c.row_id)
             FROM command_execution c WHERE c.public_id = ?",
        )
        .bind(request("worker-a").command_id)
        .fetch_one(winning_ledger.pool())
        .await
        .unwrap();
        assert_eq!(counts, (1, 1));
    }

    #[tokio::test]
    #[allow(clippy::too_many_lines)]
    async fn independent_connections_cover_reclaim_reconciliation_and_cardinality() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("command-ledger-concurrency.db");
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let first_db = Database::connect(&url).await.unwrap();
        first_db.migrate_uncached().await.unwrap();
        seed_session(&first_db).await;
        let second_db = Database::connect(&url).await.unwrap();
        second_db.migrate().await.unwrap();
        let first = CommandLedger::with_lease_ttl(first_db.pool().clone(), Duration::from_secs(1));
        let second =
            CommandLedger::with_lease_ttl(second_db.pool().clone(), Duration::from_secs(1));

        let command = request("worker-a");
        let lease_a = match first.claim_at(&command, "2026-01-01T00:00:00Z").await.unwrap() {
            ClaimOutcome::Claimed(lease) => lease,
            outcome => panic!("expected first claim, got {outcome:?}"),
        };
        let mut mismatch = command.clone();
        mismatch.payload = json!({ "a": 9 });
        assert!(matches!(
            second.claim_at(&mismatch, "2026-01-01T00:00:00Z").await.unwrap(),
            ClaimOutcome::PayloadMismatch
        ));
        assert!(matches!(
            second.claim_at(&command, "2026-01-01T00:00:00.500Z").await.unwrap(),
            ClaimOutcome::InProgress { .. }
        ));
        let lease_b = match second.claim_at(&command, "2026-01-01T00:00:02Z").await.unwrap() {
            ClaimOutcome::Claimed(lease) => lease,
            outcome => panic!("expected reclaim, got {outcome:?}"),
        };
        assert_eq!(lease_b.lease_generation(), lease_a.lease_generation() + 1);

        let applied = TerminalInput {
            state: TerminalState::Applied,
            response: Some(json!({ "status": "applied" })),
            error_code: None,
            audit: AuditInput::new("session.apply", AggregateRef::Project(1), "applied"),
            outbox: vec![
                OutboxInput::new(
                    AggregateRef::Project(1),
                    "session.applied",
                    json!({ "status": "applied", "count": 1 }),
                ),
                OutboxInput::new(
                    AggregateRef::Project(1),
                    "session.applied.summary",
                    json!({ "status": "applied", "count": 2 }),
                ),
            ],
        };
        assert!(matches!(
            first.finish_at(&lease_a, &applied, "2026-01-01T00:00:02Z").await,
            Err(CommandLedgerError::StaleFence)
        ));
        let finished = second.finish_at(&lease_b, &applied, "2026-01-01T00:00:02Z").await.unwrap();
        assert_eq!(finished.response_json.as_deref(), Some(r#"{"status":"applied"}"#));
        assert!(matches!(
            first.claim_at(&command, "2026-01-01T00:00:03Z").await.unwrap(),
            ClaimOutcome::Replayed(_)
        ));
        // A worker retry returns the terminal row and cannot append a second
        // audit or event sequence.
        let retry = second.finish_at(&lease_b, &applied, "2026-01-01T00:00:03Z").await.unwrap();
        assert_eq!(retry, finished);
        let (audit_count, outbox_count): (i64, i64) = sqlx::query_as(
            "SELECT
                 (SELECT COUNT(*) FROM audit_event WHERE command_row_id = c.row_id),
                 (SELECT COUNT(*) FROM outbox_event WHERE command_row_id = c.row_id)
             FROM command_execution c WHERE c.public_id = ?",
        )
        .bind(&command.command_id)
        .fetch_one(first.pool())
        .await
        .unwrap();
        assert_eq!((audit_count, outbox_count), (1, 2));
        let ordinals: Vec<(i64,)> = sqlx::query_as(
            "SELECT event_ordinal FROM outbox_event
             WHERE command_row_id = (SELECT row_id FROM command_execution WHERE public_id = ?)
             ORDER BY event_ordinal",
        )
        .bind(&command.command_id)
        .fetch_all(first.pool())
        .await
        .unwrap();
        assert_eq!(ordinals, vec![(0,), (1,)]);

        let too_many_request = CommandRequest::new(
            "00000000-0000-7000-8000-000000000103",
            command.actor_id.clone(),
            command.operation.clone(),
            command.payload.clone(),
            "worker-a",
        );
        let too_many_lease =
            match first.claim_at(&too_many_request, "2026-01-01T00:00:04Z").await.unwrap() {
                ClaimOutcome::Claimed(lease) => lease,
                outcome => panic!("expected bounded-sequence claim, got {outcome:?}"),
            };
        let too_many = TerminalInput {
            state: TerminalState::Applied,
            response: None,
            error_code: None,
            audit: AuditInput::new("session.apply", AggregateRef::Project(1), "applied"),
            outbox: (0..=MAX_OUTBOX_EVENTS)
                .map(|ordinal| {
                    OutboxInput::new(
                        AggregateRef::Project(1),
                        format!("session.event.{ordinal}"),
                        json!({ "count": ordinal }),
                    )
                })
                .collect(),
        };
        assert!(matches!(
            second.finish_at(&too_many_lease, &too_many, "2026-01-01T00:00:04Z").await,
            Err(CommandLedgerError::InvalidInput(_))
        ));
        let evidence_counts: (i64, i64) = sqlx::query_as(
            "SELECT
                 (SELECT COUNT(*) FROM audit_event WHERE command_row_id = c.row_id),
                 (SELECT COUNT(*) FROM outbox_event WHERE command_row_id = c.row_id)
             FROM command_execution c WHERE c.public_id = ?",
        )
        .bind(&too_many_request.command_id)
        .fetch_one(first.pool())
        .await
        .unwrap();
        assert_eq!(evidence_counts, (0, 0));

        let rejected_request = CommandRequest::new(
            "00000000-0000-7000-8000-000000000104",
            command.actor_id.clone(),
            command.operation.clone(),
            command.payload.clone(),
            "worker-a",
        );
        let rejected_lease =
            match first.claim_at(&rejected_request, "2026-01-01T00:00:05Z").await.unwrap() {
                ClaimOutcome::Claimed(lease) => lease,
                outcome => panic!("expected rejected claim, got {outcome:?}"),
            };
        let rejected = TerminalInput {
            state: TerminalState::Refused,
            response: Some(json!({ "status": "rejected" })),
            error_code: Some("review.rejected".to_owned()),
            audit: AuditInput::new("session.review", AggregateRef::Project(1), "not_approved")
                .with_outcome(AuditOutcome::Rejected),
            outbox: Vec::new(),
        };
        second.finish_at(&rejected_lease, &rejected, "2026-01-01T00:00:05Z").await.unwrap();
        let rejected_replay =
            first.claim_at(&rejected_request, "2026-01-01T00:00:06Z").await.unwrap();
        assert!(matches!(
            rejected_replay,
            ClaimOutcome::Replayed(CommandTerminal {
                state: TerminalState::Refused,
                error_code: Some(ref code),
                ..
            }) if code == "review.rejected"
        ));
        let outcome: (String,) = sqlx::query_as(
            "SELECT outcome FROM audit_event
             WHERE command_row_id = (SELECT row_id FROM command_execution WHERE public_id = ?)",
        )
        .bind(&rejected_request.command_id)
        .fetch_one(first.pool())
        .await
        .unwrap();
        assert_eq!(outcome.0, "rejected");

        let recovery_request = CommandRequest::new(
            "00000000-0000-7000-8000-000000000105",
            command.actor_id,
            command.operation,
            command.payload,
            "worker-a",
        );
        let _ = first.claim_at(&recovery_request, "2026-01-01T00:00:00Z").await.unwrap();
        let recovery_row: (i64, i64) = sqlx::query_as(
            "SELECT row_id, actor_row_id FROM command_execution WHERE public_id = ?",
        )
        .bind(&recovery_request.command_id)
        .fetch_one(first.pool())
        .await
        .unwrap();
        sqlx::query(
            "UPDATE command_execution
             SET recovery_terminal_outcome = 'applied', recovery_response_json = ?,
                 recovery_expected_outbox_count = 0, recovery_expected_outbox_digest = ?
             WHERE row_id = ?",
        )
        .bind(r#"{"status":"authoritative"}"#)
        .bind(canonical_outbox_digest(&[], &[]).unwrap())
        .bind(recovery_row.0)
        .execute(first.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO audit_event
             (public_id, command_row_id, project_row_id, actor_row_id, action, outcome,
              reason_code, payload_json, created_sequence, occurred_at)
             VALUES (?, ?, 1, ?, 'session.recover', 'applied', 'reconciled',
                     '{\"status\":\"audit-only\"}', 1, '2026-01-01T00:00:02Z')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(recovery_row.0)
        .bind(recovery_row.1)
        .execute(first.pool())
        .await
        .unwrap();
        let recovered = second.claim_at(&recovery_request, "2026-01-01T00:00:02Z").await.unwrap();
        assert!(matches!(
            recovered,
            ClaimOutcome::Replayed(CommandTerminal {
                response_json: Some(ref response),
                ..
            }) if response == r#"{"status":"authoritative"}"#
        ));
    }

    #[tokio::test]
    async fn finish_is_atomic_and_stale_fence_cannot_duplicate_effects() {
        let db = database().await;
        seed_session(&db).await;
        let ledger = CommandLedger::with_lease_ttl(db.pool().clone(), Duration::from_secs(30));
        let request = request("worker-a");
        let ClaimOutcome::Claimed(lease) =
            ledger.claim_at(&request, "2026-01-01T00:00:00Z").await.unwrap()
        else {
            unreachable!()
        };
        let input = TerminalInput {
            state: TerminalState::Applied,
            response: Some(json!({ "ok": true })),
            error_code: None,
            audit: AuditInput::new("session.apply", AggregateRef::Project(1), "applied"),
            outbox: vec![OutboxInput::new(
                AggregateRef::Project(1),
                "session.applied",
                json!({ "status": "applied", "ok": true }),
            )],
        };
        let terminal = ledger.finish_at(&lease, &input, "2026-01-01T00:00:01Z").await.unwrap();
        assert_eq!(terminal.state, TerminalState::Applied);
        let replay = ledger.claim_at(&request, "2026-01-01T00:00:02Z").await.unwrap();
        assert!(matches!(replay, ClaimOutcome::Replayed(_)));
        let rows = ledger.poll_outbox(100).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].payload_json, r#"{"ok":true,"status":"applied"}"#);
        let audit_count: (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM audit_event WHERE command_row_id = 1")
                .fetch_one(db.pool())
                .await
                .unwrap();
        assert_eq!(audit_count.0, 1);
    }

    #[tokio::test]
    async fn outbox_payload_boundary_rejects_sensitive_and_unknown_fields() {
        let db = database().await;
        seed_session(&db).await;
        let ledger = CommandLedger::new(db.pool().clone());
        for (command_id, payload) in [
            ("00000000-0000-7000-8000-000000000106", json!({ "apiKey": "do-not-persist" })),
            (
                "00000000-0000-7000-8000-000000000107",
                json!({ "unreviewedField": "do-not-persist" }),
            ),
        ] {
            let command = CommandRequest::new(
                command_id,
                "00000000-0000-7000-8000-000000000102",
                "session.test.apply",
                json!({ "id": command_id }),
                "worker-a",
            );
            let lease = match ledger.claim_at(&command, "2026-01-01T00:00:00Z").await.unwrap() {
                ClaimOutcome::Claimed(lease) => lease,
                outcome => panic!("expected claim, got {outcome:?}"),
            };
            let input = TerminalInput {
                state: TerminalState::Applied,
                response: None,
                error_code: None,
                audit: AuditInput::new("session.apply", AggregateRef::Project(1), "applied"),
                outbox: vec![OutboxInput::new(
                    AggregateRef::Project(1),
                    "session.applied",
                    payload,
                )],
            };
            assert!(matches!(
                ledger.finish_at(&lease, &input, "2026-01-01T00:00:01Z").await,
                Err(CommandLedgerError::InvalidInput(_))
            ));
            let counts: (i64, i64) = sqlx::query_as(
                "SELECT
                     (SELECT COUNT(*) FROM audit_event WHERE command_row_id = c.row_id),
                     (SELECT COUNT(*) FROM outbox_event WHERE command_row_id = c.row_id)
                 FROM command_execution c WHERE c.public_id = ?",
            )
            .bind(command_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
            assert_eq!(counts, (0, 0));
        }
    }

    #[tokio::test]
    async fn recovery_reconciles_authoritative_rejected_and_failed_results() {
        let db = database().await;
        seed_session(&db).await;
        let ledger = CommandLedger::with_lease_ttl(db.pool().clone(), Duration::from_secs(1));
        for (command_id, audit_outcome, expected_state, error_code) in [
            (
                "00000000-0000-7000-8000-000000000108",
                "rejected",
                TerminalState::Refused,
                "review.rejected",
            ),
            (
                "00000000-0000-7000-8000-000000000109",
                "failed",
                TerminalState::Failed,
                "operation.failed",
            ),
        ] {
            let command = CommandRequest::new(
                command_id,
                "00000000-0000-7000-8000-000000000102",
                "session.test.recover",
                json!({ "commandId": command_id }),
                "worker-a",
            );
            let _ = ledger.claim_at(&command, "2026-01-01T00:00:00Z").await.unwrap();
            let command_row: (i64, i64) = sqlx::query_as(
                "SELECT row_id, actor_row_id FROM command_execution WHERE public_id = ?",
            )
            .bind(command_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
            sqlx::query(
                "UPDATE command_execution
                 SET recovery_terminal_outcome = ?, recovery_response_json = ?,
                     recovery_error_code = ?, recovery_expected_outbox_count = 0,
                     recovery_expected_outbox_digest = ? WHERE row_id = ?",
            )
            .bind(audit_outcome)
            .bind(format!(r#"{{"status":"{audit_outcome}"}}"#))
            .bind(error_code)
            .bind(canonical_outbox_digest(&[], &[]).unwrap())
            .bind(command_row.0)
            .execute(db.pool())
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO audit_event
                 (public_id, command_row_id, project_row_id, actor_row_id, action, outcome,
                  reason_code, payload_json, created_sequence, occurred_at)
                 VALUES (?, ?, 1, ?, 'session.test.recover', ?, 'recorded', '{}', 1,
                         '2026-01-01T00:00:02Z')",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(command_row.0)
            .bind(command_row.1)
            .bind(audit_outcome)
            .execute(db.pool())
            .await
            .unwrap();
            let recovered = ledger.claim_at(&command, "2026-01-01T00:00:02Z").await.unwrap();
            assert!(matches!(
                recovered,
                ClaimOutcome::Replayed(CommandTerminal {
                    state,
                    error_code: Some(ref actual),
                    ..
                }) if state == expected_state && actual == error_code
            ));
        }
    }

    #[tokio::test]
    async fn expired_lease_reclaims_and_old_worker_is_fenced() {
        let db = database().await;
        seed_session(&db).await;
        let ledger = CommandLedger::with_lease_ttl(db.pool().clone(), Duration::from_secs(1));
        let request_a = request("worker-a");
        let ClaimOutcome::Claimed(first) =
            ledger.claim_at(&request_a, "2026-01-01T00:00:00Z").await.unwrap()
        else {
            unreachable!()
        };
        let request_b = request("worker-b");
        let second = match ledger.claim_at(&request_b, "2026-01-01T00:00:02Z").await.unwrap() {
            ClaimOutcome::Claimed(lease) => lease,
            other => panic!("expected reclaim, got {other:?}"),
        };
        assert_eq!(second.lease_generation(), first.lease_generation() + 1);
        let input = TerminalInput {
            state: TerminalState::Applied,
            response: Some(json!({ "ok": true })),
            error_code: None,
            audit: AuditInput::new("session.apply", AggregateRef::Project(1), "applied"),
            outbox: Vec::new(),
        };
        assert!(matches!(
            ledger.finish_at(&first, &input, "2026-01-01T00:00:02Z").await,
            Err(CommandLedgerError::StaleFence)
        ));
        ledger.finish_at(&second, &input, "2026-01-01T00:00:02Z").await.unwrap();
    }

    #[tokio::test]
    async fn discovered_audit_reconciles_and_partial_evidence_fails_closed() {
        let db = database().await;
        seed_session(&db).await;
        let ledger = CommandLedger::with_lease_ttl(db.pool().clone(), Duration::from_secs(1));
        let request_a = request("worker-a");
        let _lease = ledger.claim_at(&request_a, "2026-01-01T00:00:00Z").await.unwrap();
        let command_row: (i64, i64) = sqlx::query_as(
            "SELECT row_id, actor_row_id FROM command_execution WHERE public_id = ?",
        )
        .bind(&request_a.command_id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "UPDATE command_execution
             SET recovery_terminal_outcome = 'applied', recovery_expected_outbox_count = 0,
                 recovery_expected_outbox_digest = ? WHERE row_id = ?",
        )
        .bind(canonical_outbox_digest(&[], &[]).unwrap())
        .bind(command_row.0)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO audit_event
             (public_id, command_row_id, project_row_id, actor_row_id, action, outcome,
              reason_code, payload_json, created_sequence, occurred_at)
             VALUES (?, ?, 1, ?, 'session.apply', 'applied', 'reconciled', '{\"ok\":true}', 1,
                     '2026-01-01T00:00:02Z')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(command_row.0)
        .bind(command_row.1)
        .execute(db.pool())
        .await
        .unwrap();
        let reconciled =
            ledger.claim_at(&request("worker-b"), "2026-01-01T00:00:02Z").await.unwrap();
        assert!(matches!(
            reconciled,
            ClaimOutcome::Replayed(CommandTerminal { state: TerminalState::Applied, .. })
        ));

        let second_request = CommandRequest::new(
            "00000000-0000-7000-8000-000000000103",
            request_a.actor_id.clone(),
            request_a.operation.clone(),
            request_a.payload.clone(),
            "worker-a",
        );
        let _ = ledger.claim_at(&second_request, "2026-01-01T00:00:00Z").await.unwrap();
        let second_row: (i64,) =
            sqlx::query_as("SELECT row_id FROM command_execution WHERE public_id = ?")
                .bind(&second_request.command_id)
                .fetch_one(db.pool())
                .await
                .unwrap();
        sqlx::query(
            "INSERT INTO outbox_event
             (public_id, command_row_id, event_ordinal, project_row_id, event_type, payload_json,
              created_sequence, occurred_at)
             VALUES (?, ?, 0, 1, 'session.applied', '{}', 1, '2026-01-01T00:00:02Z')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(second_row.0)
        .execute(db.pool())
        .await
        .unwrap();
        sqlx::query(
            "UPDATE command_execution
             SET recovery_terminal_outcome = 'applied', recovery_expected_outbox_count = 0,
                 recovery_expected_outbox_digest = ? WHERE row_id = ?",
        )
        .bind(canonical_outbox_digest(&[], &[]).unwrap())
        .bind(second_row.0)
        .execute(db.pool())
        .await
        .unwrap();
        assert!(matches!(
            ledger.claim_at(&second_request, "2026-01-01T00:00:02Z").await,
            Err(CommandLedgerError::AmbiguousRecovery)
        ));
    }
}
