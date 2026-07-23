// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

//! Developer Contract Diagnostics Tauri commands (spec 021).
//!
//! **Compile-time gated**: this entire module is only compiled when the
//! `dev-tools` Cargo feature is enabled. Release binaries MUST NOT enable
//! that feature, so these commands are absent from the released binary.
//!
//! Commands:
//! - `dev.contracts.list` — enumerate all registered contracts
//! - `dev.calls.list`     — return the most recent N calls from the ring buffer
//! - `dev.calls.push`     — record a call captured by the JS recording proxy
//! - `dev.export`         — dump registry + calls to a JSON file

use std::path::PathBuf;
use std::sync::Mutex;

use contracts_core::dev::{
    ContractCall, DevCallsListRequest, DevCallsListResponse, DevContractsListRequest,
    DevContractsListResponse, DevExportRequest, DevExportResponse, DevSchemaGetRequest,
    DevSchemaGetResponse,
};
use contracts_core::ContractError;
use tauri::State;

use crate::commands::lifecycle::AppState;

// ── Call ring buffer Tauri state ──────────────────────────────────────────────

/// Maximum number of calls retained in the ring buffer (spec 021 plan.md).
const CALL_BUFFER_CAP: usize = 100;

/// In-memory ring buffer of captured contract calls.
///
/// Exposed as a `tauri::State` so the Tauri command layer can read it.
/// The JS recording proxy pushes new entries via `dev_calls_push` and
/// `dev.calls.list` reads from here. Oldest entries are evicted when the
/// buffer exceeds `CALL_BUFFER_CAP`.
pub struct CallBuffer {
    inner: Mutex<CallBufferInner>,
}

struct CallBufferInner {
    /// Entries stored in insertion order (newest appended at back).
    calls: Vec<ContractCall>,
    /// Total entries evicted since session start (diagnostic counter).
    dropped: u64,
}

impl CallBuffer {
    /// Create an empty buffer.
    #[must_use]
    pub fn new() -> Self {
        Self { inner: Mutex::new(CallBufferInner { calls: Vec::new(), dropped: 0 }) }
    }

    /// Append a new call record. Evicts the oldest entry when over capacity.
    ///
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (a prior panic while holding
    /// the lock).
    pub fn push(&self, call: ContractCall) {
        let mut guard = self.inner.lock().unwrap();
        guard.calls.push(call);
        if guard.calls.len() > CALL_BUFFER_CAP {
            guard.calls.remove(0);
            guard.dropped += 1;
        }
    }

    /// Return up to `limit` entries in newest-first order.
    ///
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (a prior panic while holding
    /// the lock).
    pub fn snapshot(&self, limit: usize) -> Vec<ContractCall> {
        let guard = self.inner.lock().unwrap();
        // Entries are oldest-first internally; reverse for newest-first output.
        guard.calls.iter().rev().take(limit).cloned().collect()
    }

    /// Total entries dropped due to capacity overflow since session start.
    ///
    /// # Panics
    ///
    /// Panics if the internal mutex is poisoned (a prior panic while holding
    /// the lock).
    pub fn dropped(&self) -> u64 {
        self.inner.lock().unwrap().dropped
    }
}

impl Default for CallBuffer {
    fn default() -> Self {
        Self::new()
    }
}

// ── Schema path resolution ────────────────────────────────────────────────────
//
// `app_core::dev_contracts::list_contracts` intentionally leaves `schema_path`
// empty (its doc comment says the frontend computes it, but no such
// computation exists client-side — the schema files live on disk and only
// the Rust process knows where its own source checkout is). This table fills
// in the subset of registry contracts whose JSON Schema file location is
// currently known. Contracts without a discoverable schema file (most of the
// non-dev registry — no schema was ever authored for them) legitimately keep
// an empty path and render `schema.missing` (spec 021 follow-up #736).

/// `(contract name, path relative to the repo root)` for every contract with
/// a known schema file on disk.
const KNOWN_SCHEMA_PATHS: &[(&str, &str)] = &[
    (
        "lifecycle.transition",
        "specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json",
    ),
    ("provenance.read", "specs/002-data-lifecycle-state-model/contracts/provenance.read.json"),
    ("settings.get", "specs/018-settings-configuration-model/contracts/settings.get.json"),
    ("settings.update", "specs/018-settings-configuration-model/contracts/settings.update.json"),
    ("dev.contracts.list", "packages/contracts/dev/dev.contracts.list.json"),
    ("dev.calls.list", "packages/contracts/dev/dev.calls.list.json"),
    ("dev.export", "packages/contracts/dev/dev.export.json"),
];

/// Repo root, resolved from this crate's manifest dir (`apps/desktop/src-tauri`)
/// at compile time. Three levels up: `src-tauri` -> `desktop` -> `apps` -> root.
fn repo_root() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let joined = manifest_dir.join("../../..");
    std::fs::canonicalize(&joined).unwrap_or(joined)
}

/// Fill in `schema_path` for contracts present in [`KNOWN_SCHEMA_PATHS`].
fn attach_schema_paths(mut resp: DevContractsListResponse) -> DevContractsListResponse {
    let root = repo_root();
    for contract in &mut resp.contracts {
        for (name, rel) in KNOWN_SCHEMA_PATHS {
            if *name == contract.name {
                contract.schema_path = root.join(rel).to_string_lossy().into_owned();
                break;
            }
        }
    }
    resp
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// `dev.contracts.list` — list all registered contracts (spec 021 US1).
///
/// Returns `dev_mode.disabled` when the runtime `devMode` setting is off.
///
/// # Errors
/// Returns `Err(String)` on database failure or when `devMode` is disabled.
#[tauri::command]
#[specta::specta]
pub async fn dev_contracts_list(
    state: State<'_, AppState>,
    request: DevContractsListRequest,
) -> Result<DevContractsListResponse, ContractError> {
    let pool = state.repo.pool();
    let dev_mode = app_core::settings::resolve_setting(pool, "devMode", None)
        .await
        .is_ok_and(|v| v.as_bool().unwrap_or(false));

    app_core::dev_contracts::list_contracts(dev_mode, request).map(attach_schema_paths)
}

/// `dev.calls.push` — record a call captured by the JS-side recording proxy
/// (spec 021 US2 / follow-up #736) into the shared ring buffer, so
/// `dev.calls.list` and `dev.export` observe live calls too. The frontend
/// recorder (`apps/desktop/src/dev/recorder.ts`) keeps its own buffer for
/// instant, reactive rendering; this is a best-effort mirror for backend
/// consumers (export). The call is already redacted client-side before this
/// is invoked.
///
/// # Errors
/// Returns `Err(String)` when `devMode` is disabled.
#[tauri::command]
#[specta::specta]
pub async fn dev_calls_push(
    state: State<'_, AppState>,
    buffer: State<'_, CallBuffer>,
    call: ContractCall,
) -> Result<(), ContractError> {
    let pool = state.repo.pool();
    let dev_mode = app_core::settings::resolve_setting(pool, "devMode", None)
        .await
        .is_ok_and(|v| v.as_bool().unwrap_or(false));

    if !dev_mode {
        return Err(ContractError::internal("dev_mode.disabled: Developer mode is disabled."));
    }

    buffer.push(call);
    Ok(())
}

/// `dev.calls.list` — return recent recorded calls (spec 021 US2).
///
/// Reads from the in-memory `CallBuffer` Tauri state.
///
/// # Errors
/// Returns `Err(String)` when `devMode` is disabled or on database failure.
#[tauri::command]
#[specta::specta]
pub async fn dev_calls_list(
    state: State<'_, AppState>,
    buffer: State<'_, CallBuffer>,
    request: DevCallsListRequest,
) -> Result<DevCallsListResponse, ContractError> {
    let pool = state.repo.pool();
    let dev_mode = app_core::settings::resolve_setting(pool, "devMode", None)
        .await
        .is_ok_and(|v| v.as_bool().unwrap_or(false));

    let limit = request.limit.map_or(CALL_BUFFER_CAP, |n| (n as usize).clamp(1, CALL_BUFFER_CAP));

    let calls = buffer.snapshot(limit);

    app_core::dev_contracts::list_calls(dev_mode, request, calls)
}

/// `dev.export` — dump contract registry + calls to a JSON file (spec 021 US4).
///
/// # Errors
/// Returns `Err(String)` when `devMode` is disabled, the path is outside the
/// allowed write envelope, or the file cannot be written.
#[tauri::command]
#[specta::specta]
pub async fn dev_export(
    state: State<'_, AppState>,
    buffer: State<'_, CallBuffer>,
    request: DevExportRequest,
) -> Result<DevExportResponse, ContractError> {
    use std::path::Path;

    let pool = state.repo.pool();
    let dev_mode = app_core::settings::resolve_setting(pool, "devMode", None)
        .await
        .is_ok_and(|v| v.as_bool().unwrap_or(false));

    if !dev_mode {
        return Err(ContractError::internal("dev_mode.disabled: Developer mode is disabled."));
    }

    // Resolve contracts list.
    let contracts_resp =
        app_core::dev_contracts::list_contracts(dev_mode, DevContractsListRequest::default())?;

    // Snapshot calls.
    let calls = buffer.snapshot(CALL_BUFFER_CAP);
    let call_count = u32::try_from(calls.len()).unwrap_or(u32::MAX);
    let contract_count = u32::try_from(contracts_resp.contracts.len()).unwrap_or(u32::MAX);

    // Build export payload.
    let export = serde_json::json!({
        "exportedAt": time::OffsetDateTime::now_utc()
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_else(|_| "unknown".to_owned()),
        "contracts": if request.include_contracts { serde_json::to_value(&contracts_resp.contracts).unwrap_or_default() } else { serde_json::Value::Array(vec![]) },
        "calls": if request.include_calls { serde_json::to_value(&calls).unwrap_or_default() } else { serde_json::Value::Array(vec![]) },
        "includeVerbatimPaths": request.include_verbatim_paths,
    });

    // Validate output path — must be absolute.
    let output_path = Path::new(&request.output_path);
    if !output_path.is_absolute() {
        return Err(ContractError::internal("path.write.denied: Output path must be absolute."));
    }

    // Write the file.
    let json_bytes = serde_json::to_vec_pretty(&export).map_err(|e| {
        ContractError::internal(format!("path.write.failed: Serialization error: {e}"))
    })?;

    tokio::fs::write(&request.output_path, json_bytes)
        .await
        .map_err(|e| ContractError::internal(format!("path.write.failed: {e}")))?;

    Ok(DevExportResponse { written_path: request.output_path, call_count, contract_count })
}

/// `dev.schema.get` — read a JSON Schema file server-side (spec 021 US3).
///
/// Reads `request.schema_path` from disk and returns the pretty-printed
/// content. Returns `found: false` when the file is absent or unreadable,
/// avoiding any client-side filesystem dependency.
///
/// # Errors
/// Returns `Err(String)` when `devMode` is disabled.
#[tauri::command]
#[specta::specta]
pub async fn dev_schema_get(
    state: State<'_, AppState>,
    request: DevSchemaGetRequest,
) -> Result<DevSchemaGetResponse, ContractError> {
    let pool = state.repo.pool();
    let dev_mode = app_core::settings::resolve_setting(pool, "devMode", None)
        .await
        .is_ok_and(|v| v.as_bool().unwrap_or(false));

    if !dev_mode {
        return Err(ContractError::internal("dev_mode.disabled: Developer mode is disabled."));
    }

    if request.schema_path.is_empty() {
        return Ok(DevSchemaGetResponse { found: false, content: None });
    }

    match tokio::fs::read_to_string(&request.schema_path).await {
        Ok(raw) => {
            // Parse and re-serialize with 2-space indent for a stable pretty-print.
            let content = serde_json::from_str::<serde_json::Value>(&raw)
                .ok()
                .and_then(|v| serde_json::to_string_pretty(&v).ok())
                .unwrap_or(raw);
            Ok(DevSchemaGetResponse { found: true, content: Some(content) })
        }
        Err(_) => Ok(DevSchemaGetResponse { found: false, content: None }),
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::dev::ContractCall;

    use super::{CallBuffer, CALL_BUFFER_CAP};

    fn make_call(id: &str) -> ContractCall {
        ContractCall {
            id: id.to_owned(),
            contract: "test.op".to_owned(),
            contract_version: "1.0.0".to_owned(),
            request: contracts_core::JsonAny::from(serde_json::json!({})),
            response: Some(contracts_core::JsonAny::from(serde_json::json!({"status": "ok"}))),
            error: None,
            started_at: "2026-06-01T00:00:00Z".to_owned(),
            duration_ms: 1.0,
            payload_truncated: false,
        }
    }

    #[test]
    fn call_buffer_snapshot_is_newest_first() {
        let buf = CallBuffer::new();
        buf.push(make_call("1"));
        buf.push(make_call("2"));
        buf.push(make_call("3"));

        let snap = buf.snapshot(10);
        assert_eq!(snap[0].id, "3");
        assert_eq!(snap[1].id, "2");
        assert_eq!(snap[2].id, "1");
    }

    #[test]
    fn call_buffer_respects_capacity() {
        let buf = CallBuffer::new();
        for i in 1..=(CALL_BUFFER_CAP + 5) {
            buf.push(make_call(&i.to_string()));
        }
        let snap = buf.snapshot(CALL_BUFFER_CAP + 10);
        assert_eq!(snap.len(), CALL_BUFFER_CAP);
        assert_eq!(buf.dropped(), 5);
    }

    #[test]
    fn call_buffer_respects_snapshot_limit() {
        let buf = CallBuffer::new();
        for i in 1..=20 {
            buf.push(make_call(&i.to_string()));
        }
        let snap = buf.snapshot(5);
        assert_eq!(snap.len(), 5);
        // Newest is entry 20.
        assert_eq!(snap[0].id, "20");
    }

    #[test]
    fn call_buffer_starts_empty_with_zero_dropped() {
        let buf = CallBuffer::new();
        assert_eq!(buf.snapshot(10).len(), 0);
        assert_eq!(buf.dropped(), 0);
    }

    // ── attach_schema_paths (#736) ────────────────────────────────────────────

    use contracts_core::dev::{ContractMeta, DevContractsListResponse};

    use super::attach_schema_paths;

    fn make_meta(name: &str) -> ContractMeta {
        ContractMeta {
            name: name.to_owned(),
            version: "1.0.0".to_owned(),
            schema_path: String::new(),
            direction: "ui-to-core".to_owned(),
            replay_safe: true,
            sensitive_fields: vec![],
            ts_hash: None,
            rust_hash: None,
            mismatch: None,
        }
    }

    #[test]
    fn attach_schema_paths_fills_known_contracts_with_absolute_existing_path() {
        let resp = DevContractsListResponse {
            contracts: vec![make_meta("dev.contracts.list"), make_meta("settings.get")],
        };
        let resp = attach_schema_paths(resp);

        for contract in &resp.contracts {
            assert!(!contract.schema_path.is_empty(), "{} should get a path", contract.name);
            let path = std::path::Path::new(&contract.schema_path);
            assert!(path.is_absolute(), "{} path should be absolute", contract.name);
            assert!(
                path.exists(),
                "{} schema file should exist at {}",
                contract.name,
                contract.schema_path
            );
        }
    }

    #[test]
    fn attach_schema_paths_leaves_unknown_contracts_empty() {
        let resp = DevContractsListResponse { contracts: vec![make_meta("sessions.list")] };
        let resp = attach_schema_paths(resp);

        assert_eq!(resp.contracts[0].schema_path, "");
    }
}
