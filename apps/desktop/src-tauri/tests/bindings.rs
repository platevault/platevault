//! Regenerate the TypeScript bindings on every `cargo test`.
//!
//! The bindings file lives at `apps/desktop/src/bindings/index.ts` and is
//! committed to the tree. CI is expected to run this test then
//! `git diff --exit-code apps/desktop/src/bindings/` to catch unsynced
//! changes to the typed command surface (spec 002 plan, research.md §9.5).
//!
//! Failure modes:
//! - `Builder::export` errors: a derived `Type` for a contract DTO is broken
//!   (most often a generic bound or a missing `#[specta(rename_all = ...)]`
//!   matching the serde rename).
//! - `git diff` shows changes: regenerate by running this test locally and
//!   commit the resulting file.
//!
//! ## IPC name alignment regression
//!
//! `collect_commands!` registers each command under its **Rust fn name**
//! (`snake_case`). The `#[specta::specta]` attribute (without a `rename`)
//! generates an invoke string that matches that fn name. Any
//! `#[specta::specta(rename = "dotted.name")]` on a command fn causes the
//! binding to invoke a name that Tauri never registered → "command not found"
//! for every affected command.
//!
//! The `no_dotted_invoke_strings` test below makes this class of bug
//! impossible to reintroduce silently: it parses every `__TAURI_INVOKE("…")`
//! call in the generated bindings file and asserts that none of the strings
//! contain a dot (which is the unmistakable signature of a dotted rename).

use specta_typescript::Typescript;

// The full list of snake_case invoke strings produces >100 lines of test body.
#[allow(clippy::too_many_lines)]
#[test]
fn exports_typescript_bindings() {
    let out_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings")
        .join("index.ts");

    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent).expect("create bindings directory");
    }

    desktop_shell::specta_builder()
        .export(Typescript::default(), &out_path)
        .expect("export typescript bindings");

    // Redirect the generated invoke import through our mock/recorder dispatch
    // switcher (spec 037 FR-002) so generated `commands.*` honor VITE_USE_MOCKS
    // and the spec-021 recording proxy. Fail loudly if the upstream import
    // string changes (e.g. a tauri-specta rc bump) so this can't silently break.
    {
        let generated =
            std::fs::read_to_string(&out_path).expect("read generated bindings for redirect");

        // tauri-specta now emits `Channel` alongside `invoke` because the
        // plan-apply command takes a `Channel<OperationEvent>` parameter
        // (spec 042 US16, T240). `Channel` must keep coming from the real
        // `@tauri-apps/api/core` (the mock/recorder `../api/ipc` shim only
        // re-exports `invoke`), so redirect only the `invoke` symbol and leave
        // `Channel` on its upstream import.
        let needle_with_channel =
            "import { invoke as __TAURI_INVOKE, Channel } from \"@tauri-apps/api/core\";";
        let needle_invoke_only =
            "import { invoke as __TAURI_INVOKE } from \"@tauri-apps/api/core\";";

        let redirected = if generated.contains(needle_with_channel) {
            generated.replace(
                needle_with_channel,
                "import { invoke as __TAURI_INVOKE } from \"../api/ipc\";\n\
                 import { Channel } from \"@tauri-apps/api/core\";",
            )
        } else {
            assert!(
                generated.contains(needle_invoke_only),
                "tauri-specta invoke import not found — did specta-typescript change its output?"
            );
            generated.replace(
                needle_invoke_only,
                "import { invoke as __TAURI_INVOKE } from \"../api/ipc\";",
            )
        };
        std::fs::write(&out_path, redirected).expect("write redirected bindings");
    }

    let written = std::fs::read_to_string(&out_path).expect("read written bindings");

    // Core lifecycle commands (always `snake_case` — these were already correct).
    assert!(written.contains("provenanceRead"), "binding contains provenance_read command");
    assert!(
        written.contains("lifecycleTransitionApply"),
        "binding contains lifecycle_transition_apply command"
    );
    assert!(
        written.contains("lifecycleLedgerList"),
        "binding contains lifecycle_ledger_list command"
    );
    assert!(
        written.contains("lifecycleTransitionPreview"),
        "binding contains lifecycle_transition_preview command"
    );

    // All formerly-dotted commands are now `snake_case` invoke strings.
    // Each entry is the snake_case fn name as it appears inside __TAURI_INVOKE("…").
    let snake_case_invoke_strings = [
        // sessions
        "sessions_list",
        "sessions_get",
        "sessions_calendar",
        "sessions_transition",
        "sessions_split",
        "sessions_merge",
        // calibration
        "calibration_masters_list",
        "calibration_masters_get",
        "calibration_matches",
        "calibration_match_suggest",
        "calibration_match_assign",
        "calibration_match_suggest_batch",
        "calibration_tolerances_get",
        "calibration_tolerances_update",
        // targets
        "targets_list",
        "targets_get",
        "target_get",
        "target_list",
        "target_alias_add",
        "target_alias_remove",
        "target_display_alias_set",
        "target_display_alias_clear",
        "target_search",
        "target_resolve",
        "target_resolution_settings",
        "target_resolution_settings_update",
        // projects
        "projects_list",
        "projects_get",
        "projects_create",
        "projects_update",
        "projects_source_add",
        "projects_source_remove",
        "projects_channels_reinfer",
        "projects_channels_dismiss_drift",
        "projects_create_plan",
        // plans
        "plans_list",
        "plans_get",
        "plans_approve",
        "plans_discard",
        "plans_retry",
        "archive_send_to_trash",
        "archive_permanently_delete",
        "plans_apply_real",
        "plans_cancel",
        "plans_resume",
        "plans_item_skip",
        "plans_item_retry",
        "plans_apply_status",
        // audit & log
        "audit_list",
        "audit_export",
        "log_recent",
        "log_export",
        // catalogs
        // review / roots / scan / equipment
        "review_queue",
        "roots_list",
        "roots_register",
        "roots_register_batch",
        "roots_remap",
        "roots_remap_apply",
        "scan_start",
        "equipment_list",
        // first-run
        "firstrun_state",
        "firstrun_complete",
        "firstrun_restart",
        // patterns
        "pattern_validate",
        "pattern_resolve",
        "pattern_preview",
        // protection
        "source_protection_get",
        "source_protection_set",
        "plan_protection_check_cmd",
        "protection_plan_acknowledged",
        // settings / preferences / search / tour
        "settings_get",
        "settings_update",
        "settings_restore_defaults",
        "settings_source_override_set",
        "preferences_get",
        "preferences_set",
        "search_global",
        "tour_complete_step",
        // guided
        "guided_state_get",
        "guided_step_complete",
        "guided_dismiss",
        "guided_restart",
        "guided_activate",
        // native
        "native_directory_pick",
        "native_file_pick",
        "native_reveal",
        // equipment CRUD
        "equipment_cameras_list",
        "equipment_cameras_create",
        "equipment_cameras_update",
        "equipment_cameras_delete",
        "equipment_telescopes_list",
        "equipment_telescopes_create",
        "equipment_telescopes_update",
        "equipment_telescopes_delete",
        "equipment_trains_list",
        "equipment_trains_create",
        "equipment_trains_update",
        "equipment_trains_delete",
        "equipment_filters_list",
        "equipment_filters_create",
        "equipment_filters_update",
        "equipment_filters_delete",
        // status / cleanup
        "status_summary",
        "cleanup_policy_get",
        "cleanup_policy_update",
        "cleanup_scan",
        // inbox / inventory / ingestion
        "inbox_scan",
        "inbox_scan_folder",
        "inbox_classify",
        "inbox_confirm",
        "inbox_reclassify",
        "inventory_list",
        "inventory_session_review",
        "ingestion_settings_get",
        "ingestion_settings_update",
        // tools / artifacts
        "tools_launch",
        "tools_list",
        "tools_update",
        "tools_validate_path",
        "tools_discover",
        "artifact_list",
        "artifact_classify",
        "artifact_mark_resolved",
        // manifests / notes / prepared views
        "manifest_list",
        "manifest_get",
        "note_get",
        "note_update",
        "manifest_reveal_in_os",
        "preparedview_list",
        "preparedview_remove",
        "preparedview_regenerate",
    ];

    for cmd in &snake_case_invoke_strings {
        assert!(written.contains(cmd), "binding missing snake_case invoke string: {cmd}");
    }
}

/// Regression guard: every `__TAURI_INVOKE("…")` string in the generated
/// bindings MUST be a `snake_case` name (no dots).
///
/// A dot in an invoke string means a `#[specta::specta(rename = "x.y")]`
/// slipped back onto a command function. Tauri registers commands by their
/// Rust fn name (`snake_case`); the dotted rename only affects the TS binding
/// while the registration stays `snake_case` → every invocation silently fails
/// with "command not found" at runtime.
///
/// To verify the guard actually catches the bug, try temporarily changing any
/// `#[specta::specta]` in a command file to
/// `#[specta::specta(rename = "x.dotted")]` and re-running this test — it
/// will fail.
#[test]
fn no_dotted_invoke_strings() {
    let out_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("bindings")
        .join("index.ts");

    let written = std::fs::read_to_string(&out_path)
        .expect("bindings file missing — run exports_typescript_bindings first");

    let mut violations: Vec<String> = Vec::new();

    for line in written.lines() {
        // Extract the string literal from __TAURI_INVOKE("...") calls.
        // The pattern is: __TAURI_INVOKE("<name>"
        let mut search = line;
        while let Some(start) = search.find("__TAURI_INVOKE(\"") {
            let after = &search[start + "__TAURI_INVOKE(\"".len()..];
            if let Some(end) = after.find('"') {
                let invoke_name = &after[..end];
                if invoke_name.contains('.') {
                    violations.push(invoke_name.to_owned());
                }
            }
            // Advance past this match.
            search = &search[start + 1..];
        }
    }

    assert!(
        violations.is_empty(),
        "Found dotted invoke strings in bindings/index.ts — these will NEVER reach \
         the Tauri backend (registered as snake_case fn names). Fix by removing \
         #[specta::specta(rename = \"x.y\")] from the command function. \
         Violations: {violations:?}",
    );
}
