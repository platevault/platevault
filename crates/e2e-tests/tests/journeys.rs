//! Spec 037 Layer-2 real-UI E2E journey stubs.
//!
//! All journeys are `#[ignore]`d. They compile and appear in
//! `cargo nextest list` but execution is deferred until the
//! `__APP_E2E__` bridge and tauri-driver caps are wired in.
//!
//! Run (once wired):
//! ```text
//! cargo nextest run -p e2e_tests --profile e2e --run-ignored all
//! ```

mod common;
use common::E2eApp;

/// First-run wizard → SIMBAD target resolve → project creation.
///
/// Backend REAL: search.global, targeting.resolve, projects.create.
///
/// Steps:
/// 1. Launch app in first-run state (fresh DB).
/// 2. Complete wizard (library root, organisation state choice).
/// 3. Navigate to Targets; invoke search.global with a known target name.
/// 4. Invoke targeting.resolve; assert RA/Dec round-trips from real backend (FR-008).
/// 5. Create a project linked to the resolved target; assert project appears in list.
#[tokio::test]
#[ignore = "spec-037: thirtyfour journey scaffold; wiring deferred"]
async fn first_run_resolve_create_project() -> anyhow::Result<()> {
    let _app = E2eApp::launch().await?;
    // TODO step 1: assert wizard screen is visible.
    // TODO step 2: fill wizard form fields and submit.
    // TODO step 3: navigate to Targets; search for "M42".
    // TODO step 4: invoke search.global, assert result count > 0.
    // TODO step 5: invoke targeting.resolve, assert ra/dec fields present.
    // TODO step 6: create project; invoke projects.list, assert record present.
    todo!("spec-037: first_run_resolve_create_project journey not yet wired")
}

/// Filesystem plan review → apply → audit record assertion.
///
/// Backend REAL: fs planner/executor + audit.
///
/// Steps:
/// 1. Register a disposable test library root with known temp files.
/// 2. Trigger plan generation; assert plan appears in Plan panel.
/// 3. Apply the plan via UI; assert the real filesystem side effect (FR-009).
/// 4. Invoke audit.list; assert a matching audit record exists (FR-016).
/// 5. Clean up temp files.
#[tokio::test]
#[ignore = "spec-037: thirtyfour journey scaffold; wiring deferred"]
async fn plan_review_apply_with_audit() -> anyhow::Result<()> {
    let _app = E2eApp::launch().await?;
    // TODO step 1: create temp dir + files; register as library root.
    // TODO step 2: navigate to Inbox/Plan panel; assert plan item visible.
    // TODO step 3: click Apply; assert file moved/created on disk.
    // TODO step 4: invoke audit.list; assert record with matching path.
    // TODO step 5: remove temp dir.
    todo!("spec-037: plan_review_apply_with_audit journey not yet wired")
}

/// Inbox confirm → sessions grouped → calibration suggest → search by alias.
///
/// Backend REAL: sessions.list, calibration.match.suggest, search.global.
///
/// Steps:
/// 1. Seed inbox with a known FITS file path via env/fixture.
/// 2. Confirm the inbox item; assert session list shows root_id set.
/// 3. Invoke calibration.match.suggest; assert real candidate list returned.
/// 4. Invoke search.global with a target alias; assert alias resolves (FR-008).
#[tokio::test]
#[ignore = "spec-037: thirtyfour journey scaffold; wiring deferred"]
async fn ingestion_sessions_search() -> anyhow::Result<()> {
    let _app = E2eApp::launch().await?;
    // TODO step 1: pre-seed inbox item (fixture path set via env).
    // TODO step 2: navigate to Inbox; confirm item; invoke sessions.list.
    // TODO step 3: assert session.root_id is set (not null).
    // TODO step 4: invoke calibration.match.suggest; assert candidates.len() >= 0.
    // TODO step 5: invoke search.global with alias; assert result.slug matches.
    todo!("spec-037: ingestion_sessions_search journey not yet wired")
}

/// Lifecycle integrity: blockedReason from real DTO, auto-block audit row,
/// unarchive event.
///
/// Backend: lifecycle (note: sessions.transition is still a STUB, so
/// transition-driven asserts remain TODO inside the body).
///
/// Steps:
/// 1. Create a project and advance it to a state that triggers auto-block.
/// 2. Invoke lifecycle DTO; assert blockedReason is present and non-empty.
/// 3. Invoke audit.list; assert auto-block event record exists.
/// 4. Trigger unarchive; assert an event is emitted (invoke events.recent).
#[tokio::test]
#[ignore = "spec-037: thirtyfour journey scaffold; wiring deferred"]
async fn lifecycle_integrity() -> anyhow::Result<()> {
    let _app = E2eApp::launch().await?;
    // TODO step 1: create project + advance state via UI or invoke.
    // TODO step 2: invoke lifecycle DTO; assert blockedReason field present.
    // TODO step 3: invoke audit.list; assert auto-block row exists.
    // TODO step 4: invoke unarchive; assert events.recent contains unarchive event.
    // NOTE: sessions.transition is still a STUB — transition-driven asserts
    // must remain TODO until that backend command is real.
    todo!("spec-037: lifecycle_integrity journey not yet wired")
}
