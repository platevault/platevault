//! LifecycleRepository — async trait for spec 002 lifecycle operations.

use audit::bus::EventBus;
use audit::event_bus::{LifecycleTransitionApplied, Source, TOPIC_LIFECYCLE_TRANSITION_APPLIED};
use domain_core::ids::{AuditId, EntityId, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;
use serde_json::Value;
use uuid::Uuid;

use crate::{DbError, DbResult};

/// Ledger row — omits provenance fields per FR-006.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerRow {
    pub entity_id: EntityId,
    pub entity_type: EntityType,
    pub current_state: String,
    pub last_action_label: Option<String>,
    pub last_action_at: Option<String>,
}

/// Filter for ledger list queries.
#[derive(Clone, Debug, Default)]
pub struct LedgerFilter {
    pub entity_type: Option<EntityType>,
    pub state: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// Full asset detail including provenance fields (for detail views).
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetDetail {
    pub entity_id: EntityId,
    pub entity_type: EntityType,
    pub current_state: String,
    pub provenance_fields: Vec<Value>,
}

/// Request to apply a lifecycle transition.
#[derive(Clone, Debug)]
pub struct TransitionRequest {
    pub entity_id: EntityId,
    pub entity_type: EntityType,
    pub from_state: String,
    pub to_state: String,
    pub trigger: String,
    pub actor: String,
    pub request_id: EntityId,
}

/// Record of a successfully applied transition.
#[derive(Clone, Debug)]
pub struct TransitionRecord {
    pub audit_id: AuditId,
    pub entity_id: EntityId,
    pub entity_type: EntityType,
    pub from_state: String,
    pub to_state: String,
    pub applied_at: Timestamp,
}

/// Noop sentinel: returned when from_state == to_state.
pub const NOOP_SENTINEL: &str = "__noop__";

/// Additional error for invalid CAS (optimistic locking failure).
impl DbError {
    #[must_use]
    pub fn invalid_state(msg: impl Into<String>) -> Self {
        Self::NotFound(msg.into())
    }
}

/// Async repository trait for lifecycle state operations.
pub trait LifecycleRepository {
    fn load_asset_detail(
        &self,
        entity_id: EntityId,
        entity_type: EntityType,
    ) -> impl std::future::Future<Output = DbResult<AssetDetail>> + Send;

    fn list_assets_ledger(
        &self,
        filter: LedgerFilter,
    ) -> impl std::future::Future<Output = DbResult<Vec<LedgerRow>>> + Send;

    fn record_transition(
        &self,
        transition: TransitionRequest,
    ) -> impl std::future::Future<Output = DbResult<TransitionRecord>> + Send;
}

// ── Table name helpers ────────────────────────────────────────────────────────

fn table_for(entity_type: EntityType) -> &'static str {
    match entity_type {
        EntityType::FileRecord => "file_record",
        // InventorySession shares the acquisition_session table
        EntityType::AcquisitionSession | EntityType::InventorySession => "acquisition_session",
        EntityType::CalibrationSession => "calibration_session",
        EntityType::Project => "project",
        // Plan is an alias for FilesystemPlan in the contract layer
        EntityType::FilesystemPlan | EntityType::Plan => "filesystem_plan",
        EntityType::PreparedSource => "prepared_source_view",
        // Projection staleness is stored in processing_artifact
        EntityType::ProcessingArtifact | EntityType::Projection => "processing_artifact",
        // DataSource and LibraryRoot both map to library_root table
        EntityType::DataSource | EntityType::LibraryRoot => "library_root",
    }
}

fn state_column_for(entity_type: EntityType) -> &'static str {
    match entity_type {
        EntityType::ProcessingArtifact | EntityType::Projection => "staleness",
        _ => "state",
    }
}

// ── SQLite-backed implementation ──────────────────────────────────────────────

/// SQLite-backed implementation of [`LifecycleRepository`].
pub struct SqliteLifecycleRepository {
    pool: sqlx::SqlitePool,
    bus: EventBus,
}

impl SqliteLifecycleRepository {
    #[must_use]
    pub fn new(pool: sqlx::SqlitePool, bus: EventBus) -> Self {
        Self { pool, bus }
    }

    #[must_use]
    pub fn pool(&self) -> &sqlx::SqlitePool {
        &self.pool
    }
}

impl LifecycleRepository for SqliteLifecycleRepository {
    async fn load_asset_detail(
        &self,
        entity_id: EntityId,
        entity_type: EntityType,
    ) -> DbResult<AssetDetail> {
        let table = table_for(entity_type);
        let state_col = state_column_for(entity_type);
        let id_str = entity_id.as_uuid().to_string();

        // Runtime-checked query: DATABASE_URL is not set at compile time for this crate.
        // AssertSqlSafe: table and state_col come from `table_for`/`state_column_for` which
        // return only static &str values — never user input.
        let row: Option<(String,)> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT {state_col} FROM {table} WHERE id = ?"
        )))
        .bind(&id_str)
        .fetch_optional(&self.pool)
        .await?;

        let current_state = row
            .map(|(s,)| s)
            .ok_or_else(|| DbError::NotFound(format!("{entity_type:?} {entity_id}")))?;

        // Provenance fields: read from provenance_history_archive for this asset.
        // Returns JSON objects; full hydration is TODO(spec 002 Phase 4).
        let prov_rows: Vec<(String,)> = sqlx::query_as(
            "SELECT json_object(\
               'fieldPath', field_path, \
               'origin', origin, \
               'capturedAt', captured_at, \
               'value', json(value)\
             ) FROM provenance_history_archive \
             WHERE asset_type = ? AND asset_id = ? \
             ORDER BY captured_at DESC LIMIT 50",
        )
        .bind(entity_type.as_str())
        .bind(&id_str)
        .fetch_all(&self.pool)
        .await?;

        let provenance_fields = prov_rows
            .into_iter()
            .filter_map(|(s,)| serde_json::from_str(&s).ok())
            .collect();

        Ok(AssetDetail { entity_id, entity_type, current_state, provenance_fields })
    }

    async fn list_assets_ledger(&self, filter: LedgerFilter) -> DbResult<Vec<LedgerRow>> {
        // Build a UNION ALL query over the tables that carry lifecycle state.
        // For the ledger we only need (id, entity_type_str, state, last_action).
        // We use runtime queries because the entity_type filter is dynamic.
        // TODO(spec 002 Phase 4): replace with a materialised ledger view.

        // Candidate tables + entity type strings for the union.
        let all_tables: &[(&str, &str, &str)] = &[
            ("file_record", "file_record", "state"),
            ("acquisition_session", "acquisition_session", "state"),
            ("calibration_session", "calibration_session", "state"),
            ("project", "project", "state"),
            ("filesystem_plan", "filesystem_plan", "state"),
            ("prepared_source_view", "prepared_source", "state"),
            ("processing_artifact", "processing_artifact", "staleness"),
            ("library_root", "data_source", "state"),
        ];

        // Filter to requested entity_type if provided.
        let tables: Vec<(&str, &str, &str)> = if let Some(et) = filter.entity_type {
            let target = et.as_str();
            all_tables
                .iter()
                .filter(|(_, et_str, _)| *et_str == target)
                .copied()
                .collect()
        } else {
            all_tables.to_vec()
        };

        if tables.is_empty() {
            return Ok(Vec::new());
        }

        let mut rows = Vec::new();

        for (table, et_str, state_col) in &tables {
            // last_action column is nullable JSON {label, at} — only project and sessions have it.
            let has_last_action =
                matches!(*table, "project" | "acquisition_session" | "calibration_session" | "filesystem_plan");

            let query_str = if has_last_action {
                format!(
                    "SELECT id, '{et_str}', {state_col}, \
                     json_extract(last_action, '$.label'), \
                     json_extract(last_action, '$.at') \
                     FROM {table}"
                )
            } else {
                format!("SELECT id, '{et_str}', {state_col}, NULL, NULL FROM {table}")
            };

            // Apply state filter.
            let query_str = if let Some(ref state) = filter.state {
                format!("{query_str} WHERE {state_col} = '{state}'")
            } else {
                query_str
            };

            // AssertSqlSafe: query_str is built from static table/column names only.
            let raw: Vec<(String, String, String, Option<String>, Option<String>)> =
                sqlx::query_as(sqlx::AssertSqlSafe(query_str))
                    .fetch_all(&self.pool)
                    .await?;

            for (id_str, et_str, state, label, at) in raw {
                let uuid = Uuid::parse_str(&id_str)
                    .map_err(|e| DbError::NotFound(format!("bad uuid {id_str}: {e}")))?;
                let entity_id = EntityId::from_uuid(uuid);
                // Map the string back to EntityType.
                let entity_type = parse_entity_type(&et_str);
                rows.push(LedgerRow {
                    entity_id,
                    entity_type,
                    current_state: state,
                    last_action_label: label,
                    last_action_at: at,
                });
            }
        }

        // Apply limit/offset.
        let offset = filter.offset.unwrap_or(0) as usize;
        let rows: Vec<LedgerRow> = rows.into_iter().skip(offset).collect();
        let rows = if let Some(limit) = filter.limit {
            rows.into_iter().take(limit as usize).collect()
        } else {
            rows
        };

        Ok(rows)
    }

    async fn record_transition(&self, transition: TransitionRequest) -> DbResult<TransitionRecord> {
        // Noop: from_state == to_state — return early without writing audit row.
        if transition.from_state == transition.to_state {
            return Ok(TransitionRecord {
                audit_id: AuditId::new(),
                entity_id: transition.entity_id,
                entity_type: transition.entity_type,
                from_state: transition.from_state.clone(),
                to_state: transition.to_state.clone(),
                applied_at: Timestamp::now_utc(),
            });
        }

        let table = table_for(transition.entity_type);
        let state_col = state_column_for(transition.entity_type);
        let id_str = transition.entity_id.as_uuid().to_string();
        let audit_id = AuditId::new();
        let applied_at = Timestamp::now_utc();

        let applied_at_str = applied_at
            .as_offset_date_time()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

        // Atomic CAS: update only if current state matches expected from_state.
        let mut tx = self.pool.begin().await?;

        // AssertSqlSafe: table and state_col are static strings from internal helper functions.
        let rows_affected = sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table} SET {state_col} = ? WHERE id = ? AND {state_col} = ?",
        )))
        .bind(&transition.to_state)
        .bind(&id_str)
        .bind(&transition.from_state)
        .execute(&mut *tx)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            tx.rollback().await?;
            return Err(DbError::invalid_state(format!(
                "{:?} {} not in state '{}' (CAS failed)",
                transition.entity_type, transition.entity_id, transition.from_state
            )));
        }

        // Insert audit log entry.
        let audit_id_str = audit_id.as_uuid().to_string();
        let request_id_str = transition.request_id.as_uuid().to_string();
        sqlx::query(
            "INSERT INTO audit_log_entry \
             (audit_id, entity_type, entity_id, from_state, to_state, trigger, actor, \
              outcome, severity, request_id, at, payload) \
             VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', 'workflow', ?, ?, NULL)",
        )
        .bind(&audit_id_str)
        .bind(transition.entity_type.as_str())
        .bind(&id_str)
        .bind(&transition.from_state)
        .bind(&transition.to_state)
        .bind(&transition.trigger)
        .bind(&transition.actor)
        .bind(&request_id_str)
        .bind(&applied_at_str)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        // Publish event after successful commit.
        let _ = self
            .bus
            .publish(
                TOPIC_LIFECYCLE_TRANSITION_APPLIED,
                Source::System,
                LifecycleTransitionApplied {
                    entity_type: transition.entity_type,
                    entity_id: transition.entity_id.to_string(),
                    from_state: transition.from_state.clone(),
                    to_state: transition.to_state.clone(),
                    actor: transition.actor.clone(),
                    at: applied_at,
                },
            )
            .await;

        Ok(TransitionRecord {
            audit_id,
            entity_id: transition.entity_id,
            entity_type: transition.entity_type,
            from_state: transition.from_state,
            to_state: transition.to_state,
            applied_at,
        })
    }
}

fn parse_entity_type(s: &str) -> EntityType {
    match s {
        "file_record" => EntityType::FileRecord,
        "acquisition_session" | "inventory_session" => EntityType::AcquisitionSession,
        "calibration_session" => EntityType::CalibrationSession,
        "filesystem_plan" | "plan" => EntityType::FilesystemPlan,
        "prepared_source" => EntityType::PreparedSource,
        "processing_artifact" => EntityType::ProcessingArtifact,
        "data_source" | "library_root" => EntityType::DataSource,
        "projection" => EntityType::Projection,
        // "project" and any unknown string → Project
        _ => EntityType::Project,
    }
}

// ── In-memory stub ────────────────────────────────────────────────────────────

/// In-memory stub — compiles without sqlx; used by unit tests.
#[derive(Default)]
pub struct InMemoryLifecycleRepository;

impl LifecycleRepository for InMemoryLifecycleRepository {
    async fn load_asset_detail(
        &self,
        entity_id: EntityId,
        entity_type: EntityType,
    ) -> DbResult<AssetDetail> {
        Ok(AssetDetail {
            entity_id,
            entity_type,
            current_state: "unknown".to_owned(),
            provenance_fields: Vec::new(),
        })
    }

    async fn list_assets_ledger(&self, _filter: LedgerFilter) -> DbResult<Vec<LedgerRow>> {
        Ok(Vec::new())
    }

    async fn record_transition(&self, transition: TransitionRequest) -> DbResult<TransitionRecord> {
        if transition.from_state == transition.to_state {
            return Err(DbError::NotFound(format!(
                "noop: {} is already in state {}",
                transition.entity_id, transition.from_state
            )));
        }
        Ok(TransitionRecord {
            audit_id: AuditId::new(),
            entity_id: transition.entity_id,
            entity_type: transition.entity_type,
            from_state: transition.from_state,
            to_state: transition.to_state,
            applied_at: Timestamp::now_utc(),
        })
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use domain_core::ids::EntityId;
    use domain_core::lifecycle::data_asset::EntityType;

    use super::{
        InMemoryLifecycleRepository, LedgerFilter, LifecycleRepository, TransitionRequest,
    };

    #[tokio::test]
    async fn stub_load_returns_unknown_state() {
        let repo = InMemoryLifecycleRepository;
        let id = EntityId::new();
        let detail = repo.load_asset_detail(id, EntityType::Project).await.unwrap();
        assert_eq!(detail.current_state, "unknown");
    }

    #[tokio::test]
    async fn stub_record_transition_succeeds() {
        let repo = InMemoryLifecycleRepository;
        let entity_id = EntityId::new();
        let record = repo
            .record_transition(TransitionRequest {
                entity_id,
                entity_type: EntityType::Project,
                from_state: "ready".to_owned(),
                to_state: "prepared".to_owned(),
                trigger: "Prepared".to_owned(),
                actor: "user".to_owned(),
                request_id: EntityId::new(),
            })
            .await
            .unwrap();
        assert_eq!(record.from_state, "ready");
        assert_eq!(record.to_state, "prepared");
    }

    #[tokio::test]
    async fn stub_list_assets_returns_empty() {
        let repo = InMemoryLifecycleRepository;
        let rows = repo.list_assets_ledger(LedgerFilter::default()).await.unwrap();
        assert!(rows.is_empty());
    }
}
