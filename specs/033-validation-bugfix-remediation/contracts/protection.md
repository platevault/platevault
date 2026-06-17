# Contract: Protection Gating (FR-016, FR-017, FR-018)

Fixes spec 016 (T1-1): the protection gate is structurally dead because every real plan generator
hardcodes `protection:"normal"`; `source_id` is hardcoded `None`; global defaults are unwired.

## Plan item (generator output)
Real generators (`prepared_views.rs`, `project_setup.rs`, `plans.rs`) MUST set, per item:
```
{ source_id: <real source FK>, category: <real category>, protection: <resolve_protection(source_id, category)> }
```
`plan_protection_check` then fires on real plans (FR-016). No more hardcoded `"normal"`.

## Protected plan item (response)
```
ProtectedPlanItem { item_id, source_id: <real>, category, reason }
```
`source_id` is populated (was `None` at `protection.rs:287`) so the audit + UI identify the source (FR-017).

## Global defaults & audit
```
protection_defaults(scope, key, value)        // persisted (FR-018; fixes 016 T-003/T-005)
event: protection.default.changed { scope, key, old, new, changed_at }   // FR-018 (was missing T-004)
```

## Conformance / tests
- Test: a real cleanup/archive plan over a protected source is **blocked**, protected items carry real
  `source_id`, and an audit event records the block.
- Test: changing a global default persists and emits `protection.default.changed`.
- Test: a plan over a non-protected source applies (gate is real, not always-on).
