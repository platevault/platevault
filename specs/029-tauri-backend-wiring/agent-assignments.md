# Agent Assignments
# Feature: Tauri Backend Wiring
# Generated: 2026-05-25
# Command: /speckit.agent-assign.assign

agents_scanned:
  - name: "rust-pro"
    source: "project"
    description: "Rust development specialist"
  - name: "typescript-pro"
    source: "project"
    description: "TypeScript specialist"
  - name: "frontend-developer"
    source: "project"
    description: "Frontend React/TypeScript specialist"
  - name: "debugger"
    source: "project"
    description: "Debugging and integration verification"
  - name: "coder"
    source: "project"
    description: "General implementation subagent"

assignments:
  T001:
    agent: "rust-pro"
    reason: "Rust dependency configuration in Cargo.toml"
  T002:
    agent: "coder"
    reason: "Simple justfile config task"
  T003:
    agent: "rust-pro"
    reason: "Rust DTO with specta/serde derives"
  T004:
    agent: "rust-pro"
    reason: "Tauri command stub with specta rename"
  T005:
    agent: "rust-pro"
    reason: "Rust Tauri specta_builder registration"
  T006:
    agent: "rust-pro"
    reason: "Cargo test + binding generation validation"
  T007:
    agent: "debugger"
    reason: "Cross-stack end-to-end PoC validation"
  T008:
    agent: "rust-pro"
    reason: "Rust DTO definitions (sessions)"
  T009:
    agent: "rust-pro"
    reason: "Rust DTO definitions (calibration)"
  T010:
    agent: "rust-pro"
    reason: "Rust DTO definitions (targets)"
  T011:
    agent: "rust-pro"
    reason: "Rust DTO definitions (projects)"
  T012:
    agent: "rust-pro"
    reason: "Rust DTO definitions (plans)"
  T013:
    agent: "rust-pro"
    reason: "Rust DTO definitions (audit)"
  T014:
    agent: "rust-pro"
    reason: "Rust DTO definitions (review)"
  T015:
    agent: "rust-pro"
    reason: "Rust DTO definitions (roots/equipment)"
  T016:
    agent: "rust-pro"
    reason: "Rust DTO definitions (settings)"
  T017:
    agent: "rust-pro"
    reason: "Rust DTO definitions (search)"
  T018:
    agent: "rust-pro"
    reason: "Rust DTO definitions (preferences)"
  T019:
    agent: "rust-pro"
    reason: "Shared enum definitions with variant reconciliation"
  T020:
    agent: "rust-pro"
    reason: "Register DTO modules in contracts_core lib.rs"
  T021:
    agent: "rust-pro"
    reason: "Stub command module (sessions remaining)"
  T022:
    agent: "rust-pro"
    reason: "Stub command module (calibration)"
  T023:
    agent: "rust-pro"
    reason: "Stub command module (targets)"
  T024:
    agent: "rust-pro"
    reason: "Stub command module (projects)"
  T025:
    agent: "rust-pro"
    reason: "Stub command module (plans)"
  T026:
    agent: "rust-pro"
    reason: "Stub command module (audit)"
  T027:
    agent: "rust-pro"
    reason: "Stub command module (review)"
  T028:
    agent: "rust-pro"
    reason: "Stub command module (roots/scan/equipment)"
  T029:
    agent: "rust-pro"
    reason: "Stub command module (settings)"
  T030:
    agent: "rust-pro"
    reason: "Stub command module (preferences)"
  T031:
    agent: "rust-pro"
    reason: "Stub command module (search)"
  T032:
    agent: "rust-pro"
    reason: "Stub command module (tour)"
  T033:
    agent: "rust-pro"
    reason: "Register command modules in mod.rs"
  T034:
    agent: "rust-pro"
    reason: "Register all commands in specta_builder"
  T035:
    agent: "debugger"
    reason: "Full Tauri dev integration verification"
  T036:
    agent: "typescript-pro"
    reason: "Cross-stack argument type audit"
  T037:
    agent: "typescript-pro"
    reason: "Cross-stack response shape audit"
  T038:
    agent: "debugger"
    reason: "Stub vs mock mode integration verification"
  T039:
    agent: "rust-pro"
    reason: "Tauri + SQLite init refactor for persistent DB"
  T040:
    agent: "debugger"
    reason: "Platform DB persistence verification"
  T041:
    agent: "rust-pro"
    reason: "Binding regeneration with all commands"
  T042:
    agent: "rust-pro"
    reason: "Rust test assertion updates"
  T043:
    agent: "typescript-pro"
    reason: "Type name audit: hand-written vs generated"
  T044:
    agent: "typescript-pro"
    reason: "TypeScript compatibility barrel creation"
  T045:
    agent: "frontend-developer"
    reason: "Bulk frontend import migration"
  T046:
    agent: "frontend-developer"
    reason: "Delete types.ts and verify typecheck"
  T047:
    agent: "typescript-pro"
    reason: "Update commands.ts type annotations"
  T048:
    agent: "frontend-developer"
    reason: "Update mocks.ts imports"
  T049:
    agent: "debugger"
    reason: "Mock mode integration verification"
  T050:
    agent: "coder"
    reason: "CI validation pass"
  T051:
    agent: "debugger"
    reason: "Full quickstart milestone validation"
  T052:
    agent: "debugger"
    reason: "Observability verification"
