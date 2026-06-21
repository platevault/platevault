//! Developer Contract Diagnostics use cases (spec 021).
//!
//! This module is only compiled when the `dev-tools` Cargo feature is active.
//! It exposes two use-case functions consumed by the Tauri command layer:
//!
//! - `list_contracts()` — returns one `ContractMeta` per registered operation.
//! - `list_calls(limit)` — reads the in-memory ring buffer from Tauri state.
//!
//! The contract registry is built at compile time from the known set of
//! operations and the `packages/contracts/` directory layout.
//! This module does NOT import the ring buffer itself; that lives in the
//! desktop_shell crate and is passed in via the call buffer state.

use contracts_core::dev::{
    ContractMeta, DevCallsListRequest, DevCallsListResponse, DevContractsListRequest,
    DevContractsListResponse,
};
use contracts_core::{error_code::ErrorCode, ContractError, ErrorSeverity};

// ── Registry ──────────────────────────────────────────────────────────────────

/// One statically-described entry in the built-in contract registry.
struct RegistryEntry {
    name: &'static str,
    version: &'static str,
    direction: &'static str,
    replay_safe: bool,
    sensitive_fields: &'static [&'static str],
}

/// All contracts registered at build time (spec 021 T005).
///
/// `schema_path` is computed at runtime from the repo-relative
/// `packages/contracts/` tree so the absolute path reflects the actual
/// filesystem layout of the running binary.
const REGISTRY: &[RegistryEntry] = &[
    // ── Lifecycle ──
    RegistryEntry {
        name: "lifecycle.transition",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: false,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "provenance.read",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    // ── Sessions ──
    RegistryEntry {
        name: "sessions.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "sessions.get",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    // ── Settings ──
    RegistryEntry {
        name: "settings.get",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "settings.update",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: false,
        sensitive_fields: &[],
    },
    // ── Projects ──
    RegistryEntry {
        name: "projects.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "projects.create",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: false,
        sensitive_fields: &[],
    },
    // ── Plans ──
    RegistryEntry {
        name: "plans.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "plans.approve",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: false,
        sensitive_fields: &[],
    },
    // ── Audit ──
    RegistryEntry {
        name: "audit.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    // ── Developer Diagnostics (dev-tools only) ──
    RegistryEntry {
        name: "dev.contracts.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "dev.calls.list",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: true,
        sensitive_fields: &[],
    },
    RegistryEntry {
        name: "dev.export",
        version: "1.0.0",
        direction: "ui-to-core",
        replay_safe: false,
        sensitive_fields: &[],
    },
];

// ── list_contracts ─────────────────────────────────────────────────────────

fn dev_mode_disabled_err() -> ContractError {
    ContractError::new(
        ErrorCode::DevModeDisabled,
        "Developer mode is disabled. Enable devMode in settings.",
        ErrorSeverity::Blocking,
        false,
    )
}

/// List all contracts registered at build time (spec 021 T005, T006, T011).
///
/// # Errors
/// Returns `dev_mode.disabled` when `dev_mode` is false.
pub fn list_contracts(
    dev_mode: bool,
    _request: DevContractsListRequest,
) -> Result<DevContractsListResponse, ContractError> {
    if !dev_mode {
        return Err(dev_mode_disabled_err());
    }

    let mut contracts: Vec<ContractMeta> = REGISTRY
        .iter()
        .map(|e| ContractMeta {
            name: e.name.to_owned(),
            version: e.version.to_owned(),
            // schema_path is intentionally empty in the Rust layer because
            // absolute paths are filesystem-location-specific; the frontend
            // computes them from the known packages/contracts directory.
            schema_path: String::new(),
            direction: e.direction.to_owned(),
            replay_safe: e.replay_safe,
            sensitive_fields: e.sensitive_fields.iter().map(|s| (*s).to_owned()).collect(),
            ts_hash: None,
            rust_hash: None,
            mismatch: None,
        })
        .collect();

    // Sort by name ascending (spec dev.contracts.list.json description).
    contracts.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(DevContractsListResponse { contracts })
}

// ── list_calls ────────────────────────────────────────────────────────────────

/// Maximum ring buffer capacity (spec 021 plan.md).
pub const CALL_BUFFER_CAPACITY: usize = 100;

/// Clamp `limit` to `[1, CALL_BUFFER_CAPACITY]`.
fn clamp_limit(limit: Option<u32>) -> usize {
    match limit {
        None => CALL_BUFFER_CAPACITY,
        Some(n) => (n as usize).clamp(1, CALL_BUFFER_CAPACITY),
    }
}

/// Return the most recent `limit` call records from the provided buffer.
///
/// The buffer is expected to be in newest-first order (as maintained by the
/// desktop-side recorder). When `dev_mode` is false, returns
/// `dev_mode.disabled` error.
///
/// # Errors
/// Returns `dev_mode.disabled` when `dev_mode` is false.
#[allow(clippy::needless_pass_by_value)] // dev-tools-only (spec 021); signature kept by-value to mirror list_contracts + the dev command boundary
pub fn list_calls(
    dev_mode: bool,
    request: DevCallsListRequest,
    buffer: Vec<contracts_core::dev::ContractCall>,
) -> Result<DevCallsListResponse, ContractError> {
    if !dev_mode {
        return Err(dev_mode_disabled_err());
    }

    let limit = clamp_limit(request.limit);
    let calls: Vec<_> = buffer.into_iter().take(limit).collect();

    Ok(DevCallsListResponse { calls })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use contracts_core::dev::{ContractCall, DevCallsListRequest, DevContractsListRequest};

    use super::{clamp_limit, list_calls, list_contracts, ErrorCode, CALL_BUFFER_CAPACITY};

    fn make_call(id: &str, contract: &str) -> ContractCall {
        ContractCall {
            id: id.to_owned(),
            contract: contract.to_owned(),
            contract_version: "1.0.0".to_owned(),
            request: contracts_core::JsonAny::from(serde_json::json!({})),
            response: Some(contracts_core::JsonAny::from(serde_json::json!({"status": "ok"}))),
            error: None,
            started_at: "2026-06-01T00:00:00Z".to_owned(),
            duration_ms: 1.5,
            payload_truncated: false,
        }
    }

    // ── dev.contracts.list ────────────────────────────────────────────────────

    #[test]
    fn list_contracts_returns_dev_mode_disabled_when_off() {
        let err = list_contracts(false, DevContractsListRequest::default()).unwrap_err();
        assert_eq!(err.code, ErrorCode::DevModeDisabled);
    }

    #[test]
    fn list_contracts_happy_path_returns_sorted_contracts() {
        let resp = list_contracts(true, DevContractsListRequest::default()).unwrap();
        assert!(!resp.contracts.is_empty(), "registry must not be empty");
        // Sorted by name ascending.
        let names: Vec<&str> = resp.contracts.iter().map(|c| c.name.as_str()).collect();
        let mut sorted = names.clone();
        sorted.sort_unstable();
        assert_eq!(names, sorted, "contracts must be sorted by name");
    }

    #[test]
    fn list_contracts_dev_contracts_are_present() {
        let resp = list_contracts(true, DevContractsListRequest::default()).unwrap();
        let names: Vec<&str> = resp.contracts.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"dev.contracts.list"), "dev.contracts.list must be in registry");
        assert!(names.contains(&"dev.calls.list"), "dev.calls.list must be in registry");
        assert!(names.contains(&"dev.export"), "dev.export must be in registry");
    }

    #[test]
    fn list_contracts_write_contracts_not_replay_safe() {
        let resp = list_contracts(true, DevContractsListRequest::default()).unwrap();
        // settings.update and projects.create must not be replay_safe.
        for c in &resp.contracts {
            if ["settings.update", "projects.create", "plans.approve"].contains(&c.name.as_str()) {
                assert!(!c.replay_safe, "write contract {} must not be replay_safe", c.name);
            }
        }
    }

    // ── dev.calls.list ────────────────────────────────────────────────────────

    #[test]
    fn list_calls_returns_dev_mode_disabled_when_off() {
        let err = list_calls(false, DevCallsListRequest::default(), vec![]).unwrap_err();
        assert_eq!(err.code, ErrorCode::DevModeDisabled);
    }

    #[test]
    fn list_calls_happy_path_returns_all_when_no_limit() {
        let buf = vec![make_call("1", "sessions.list"), make_call("2", "projects.list")];
        let resp = list_calls(true, DevCallsListRequest::default(), buf).unwrap();
        assert_eq!(resp.calls.len(), 2);
    }

    #[test]
    fn list_calls_limit_clamped_to_buffer_capacity() {
        // More than CALL_BUFFER_CAPACITY entries in the request.
        let limit = clamp_limit(Some(200));
        assert_eq!(limit, CALL_BUFFER_CAPACITY);
    }

    #[test]
    fn list_calls_limit_minimum_is_one() {
        let limit = clamp_limit(Some(0));
        assert_eq!(limit, 1);
    }

    #[test]
    fn list_calls_respects_limit() {
        let buf: Vec<ContractCall> = (1..=10).map(|i| make_call(&i.to_string(), "x")).collect();
        let req = DevCallsListRequest { limit: Some(3), request_id: None };
        let resp = list_calls(true, req, buf).unwrap();
        assert_eq!(resp.calls.len(), 3);
    }

    #[test]
    fn list_calls_none_limit_returns_up_to_capacity() {
        let buf: Vec<ContractCall> = (1..=150).map(|i| make_call(&i.to_string(), "x")).collect();
        let resp = list_calls(true, DevCallsListRequest::default(), buf).unwrap();
        assert_eq!(resp.calls.len(), CALL_BUFFER_CAPACITY);
    }
}
