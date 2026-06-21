//! Inventory Tauri commands (spec 006).
//!
//! Exposes `inventory.list` and `inventory.session.review` to the webview.
//! Both commands are wired through `app_core::inventory` which in turn
//! delegates state mutations to the spec-002 lifecycle transition use case.

use app_core::inventory::{list, review_session};
use contracts_core::inventory::{
    InventoryListRequest, InventoryListResponse, InventorySessionReviewRequest,
    InventorySessionReviewResponse,
};
use contracts_core::ContractError;
// Re-exported for tests only.
#[cfg(test)]
use contracts_core::inventory::InventorySessionState;
use sqlx::SqlitePool;
use tauri::State;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use crate::commands::lifecycle::AppState;

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

// ── inventory.session.review ──────────────────────────────────────────────────

/// `inventory.session.review` — apply a session review-state transition.
///
/// Wraps `lifecycle.transition` for the inventory surface.
/// Returns `status: "success"` | `"noop"` | `"error"`.
///
/// # Errors
/// Returns `Err(String)` on infrastructure failure.
#[tauri::command]
#[specta::specta]
pub async fn inventory_session_review(
    req: InventorySessionReviewRequest,
    pool: State<'_, SqlitePool>,
    app_state: State<'_, AppState>,
) -> Result<InventorySessionReviewResponse, ContractError> {
    tracing::debug!(
        "inventory.session.review session_id={} next_state={:?}",
        req.session_id,
        req.next_state
    );

    let resp = review_session(&pool, app_state.repo.as_ref(), &app_state.bus, req).await;
    Ok(resp)
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
                review_filter: Some("needs_review".to_owned()),
            }),
        };
        let json = serde_json::to_value(&req).unwrap();
        assert_eq!(json["contractVersion"], "2.0.0");
        assert_eq!(json["filters"]["frameFilter"], "light");
        assert_eq!(json["filters"]["reviewFilter"], "needs_review");
    }

    #[test]
    fn inventory_session_state_serializes_snake_case() {
        assert_eq!(
            serde_json::to_value(super::InventorySessionState::NeedsReview).unwrap(),
            serde_json::json!("needs_review")
        );
        assert_eq!(
            serde_json::to_value(super::InventorySessionState::Confirmed).unwrap(),
            serde_json::json!("confirmed")
        );
    }
}
