//! LifecycleRepository — async trait for spec 002 lifecycle operations.

use domain_core::ids::{AuditId, EntityId, Timestamp};
use domain_core::lifecycle::data_asset::EntityType;
use serde_json::Value;

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
