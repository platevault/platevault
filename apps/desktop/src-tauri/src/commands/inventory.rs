//! Inventory Tauri commands (spec 006).
//!
//! Exposes `inventory.list` to the webview.
//!
//! Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
//! inventory. The `inventory.session.review` command that wrapped the
//! spec-002 lifecycle transition use case was removed along with the
//! review-state machine it mutated.

use app_core::inventory::list;
use contracts_core::inventory::{InventoryListRequest, InventoryListResponse};
use contracts_core::ContractError;
use sqlx::SqlitePool;
use tauri::State;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

// ── inventory.list ────────────────────────────────────────────────────────────

/// `inventory.list` — return the grouped inventory ledger with optional filters.
///
/// # Errors
/// Returns `Err(String)` on database error.
#[tauri::command]
#[specta::specta]
pub async fn inventory_list(
    req: InventoryListRequest,
    pool: State<'_, SqlitePool>,
) -> Result<InventoryListResponse, ContractError> {
    tracing::debug!("inventory.list request_id={}", req.request_id);

    let sources = list(&pool, req.filters).await.map_err(ContractError::internal)?;

    let generated_at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned());

    Ok(InventoryListResponse {
        status: "success".to_owned(),
        contract_version: "2.0.0".to_owned(),
        request_id: req.request_id,
        generated_at,
        sources,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::inventory::{
        InventoryFrameType, InventoryListFilters, InventoryListRequest,
    };

    #[test]
    fn inventory_list_request_serializes() {
        let req = InventoryListRequest {
            contract_version: "2.0.0".to_owned(),
            request_id: "00000000-0000-0000-0000-000000000001".to_owned(),
            filters: Some(InventoryListFilters {
                source_filter: None,
                frame_filter: Some(InventoryFrameType::Light),
            }),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["contractVersion"], "2.0.0");
        assert_eq!(json["filters"]["frameFilter"], "light");
    }
}
