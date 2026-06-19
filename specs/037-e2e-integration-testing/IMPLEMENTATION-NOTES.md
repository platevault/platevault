# Spec 037 — Layer-1 Integration Suite: Seeded-Regression Validation (T036 / SC-007)

Date: 2026-06-19

This document records the four seeded-regression exercises performed to prove
the Layer-1 integration suite catches regressions in covered behaviors.  Each
exercise follows the same procedure: introduce a minimal one-line regression in
product `src/`, confirm the target test FAILS with the verbatim assertion
message, then revert and confirm the test passes again.

---

## Regression 1 — patterns crate: Lower transform omitted

**Target behavior:** `resolve_v1` applies a `Lower` transform to `frame_type`
tokens, so `"Light"` → `"light"` in the resolved path.

**Regression introduced:**
File: `crates/patterns/src/resolver.rs`, line 230

```diff
-        TokenTransform::Lower => value.to_lowercase(),
+        TokenTransform::Lower => value.to_owned(), // REGRESSION: omit lowercase transform
```

**Test that caught it:**
`crates/patterns/tests/pattern_integration.rs` —
`canonical_pattern_resolves_to_expected_path`

**Verbatim failure message:**
```
thread 'canonical_pattern_resolves_to_expected_path' (253) panicked at crates/patterns/tests/pattern_integration.rs:102:5:
assertion `left == right` failed
  left: "M101/Ha/2026-04-12/Light/"
 right: "M101/Ha/2026-04-12/light/"
```

**Revert confirmed:** test passes after restoring `value.to_lowercase()`.

---

## Regression 2 — calibration assign: audit event publish skipped

**Target behavior:** `assign` writes a `calibration.assignment.created` event
to the `events` table via `EventBus::publish` after persisting the assignment
row.

**Regression introduced:**
File: `crates/app/core/src/calibration.rs`, lines 341–356

The entire `bus.publish(...)` block was commented out.

```diff
-            // Emit audit event (T030).
-            let _ = bus
-                .publish(
-                    "calibration.assignment.created",
-                    Source::User,
-                    serde_json::json!({ ... }),
-                )
-                .await;
+            // REGRESSION: audit publish skipped to test T036 catch
+            // (entire block commented out)
```

**Test that caught it:**
`crates/app/core/tests/calibration_integration.rs` —
`assign_persists_assignment_and_emits_audit_event`

**Verbatim failure message:**
```
thread 'assign_persists_assignment_and_emits_audit_event' (563) panicked at crates/app/core/tests/calibration_integration.rs:244:5:
assertion `left == right` failed: expected 1 audit event for assignment, found 0
  left: 0
 right: 1
```

**Revert confirmed:** test passes after restoring the publish block.

---

## Regression 3 — project_notes: note content not persisted

**Target behavior:** `update_note` upserts the caller-supplied `content` string
into SQLite; a subsequent read returns the same content.

**Regression introduced:**
File: `crates/app/core/src/project_notes.rs`, line 120

```diff
-    let updated_at = upsert_note(pool, &note_id, &req.project_id, &req.content)
+    let updated_at = upsert_note(pool, &note_id, &req.project_id, "") // REGRESSION: content dropped
```

**Test that caught it:**
`crates/app/core/tests/projects_integration.rs` —
`note_add_update_read_round_trip`

**Verbatim failure message:**
```
thread 'note_add_update_read_round_trip' (54) panicked at crates/app/core/tests/projects_integration.rs:148:5:
assertion `left == right` failed
  left: ""
 right: "First draft notes about the Crab Nebula session."
```

**Revert confirmed:** test passes after restoring `&req.content`.

---

## Regression 4 — project_setup create: plan_id suppressed in response

**Target behavior:** `create` builds a reviewable `FilesystemPlan` for the new
project's folder structure and returns the plan id in `ProjectCreateResult`.

**Regression introduced:**
File: `crates/app/core/src/project_setup.rs`, line 415

```diff
-        plan_id: Some(plan_id),
+        plan_id: None, // REGRESSION: suppress plan_id to test T036 catch
```

**Test that caught it:**
`crates/app/core/tests/projects_integration.rs` —
`create_then_get_returns_persisted_fields`

**Verbatim failure message:**
```
thread 'create_then_get_returns_persisted_fields' (452) panicked at crates/app/core/tests/projects_integration.rs:70:5:
create must return a plan_id
```

**Revert confirmed:** test passes after restoring `Some(plan_id)`.

---

## Coverage gaps

None identified. All four regressions were caught immediately by existing
integration tests. No silent-pass observed.

---

## Final state

```
git status (product src/ files):  no modifications
git diff --stat:  4 pre-existing branch files (AGENTS.md, CLAUDE.md, GEMINI.md,
                  specs/AGENTS.md) — tooling churn from worktree setup, not
                  product code
cargo test -p app_core -p patterns --tests:  398 passed (16 suites, 12.56s)
```
