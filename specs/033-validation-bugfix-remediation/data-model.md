# Data Model: Validation Bugfix & Remediation (Spec 033)

Phase 1 output. Covers only what this feature **changes or adds** over the existing 0001–0030 migrations.
SQLite is canonical (§V). New migrations are sequential from 0031. Each change ties to FR(s) and a research
decision (D#).

## Migration plan (sequential from 0031)

| Migration | Purpose | FR / Decision |
|---|---|---|
| 0031 | Plan-item safety fields: `source_id`, `category`, `requires_destructive_confirm`, `approved_mtime`, `approved_size_bytes`, `resolved_pattern` | FR-001/003/005/016, D7/D8/D9 |
| 0032 | Destructive-destination normalization: `os_trash`→`trash`; drop `none` on destructive items; CHECK `destination IN ('archive','trash')` | FR-038, D1 |
| 0033 | Project lifecycle reconciliation: backfill `projects.lifecycle` from `project.state`, map states, **drop** `project.state` | FR-019/021, D2 |
| 0034 | Typed blocked reason on `project_health`/lifecycle: `blocked_reason_kind`, `blocked_reason_note` | FR-020 |
| 0035 | Protection defaults persistence: `protection_defaults` (scope, key, value) + ensure `protected_plan_items.source_id` not null when applicable | FR-016/017/018 |
| 0036 | Calibration fingerprints populated/queryable; ensure masters table backs `list`/`get` (indices on fingerprint) | FR-013 |
| 0037 | Ingestion FKs: session `root_id` (NOT NULL where applicable), `target_id` on sessions/captures | FR-012/014 |
| 0038 | Catalog: signature-verification status column; license CHECK against recognized set; unique constraints for atomic upsert | FR-026/027/028 |

> Exact column types/constraints finalized during implementation; ordering is fixed (backend specs share
> the migration surface → sequential, never parallel).

## Changed / new entities

### Plan Item (`crates/fs/planner`, `plan_items`)
Existing reviewable filesystem action. **New/changed fields:**
- `source_id` (FK → source) — real originating source; replaces hardcoded `None` (FR-016/017).
- `category` — real classification used by protection resolution (FR-016).
- `protection` — keep, but now **set by the generator from `resolve_protection`**, not hardcoded
  `"normal"` (T1-1 fix).
- `requires_destructive_confirm` (bool) — derived from action type (delete/trash), **independent of**
  `is_protected` (FR-003, D9).
- `destination` — destructive destination ∈ `{archive, trash}` (FR-038, D1).
- `approved_mtime`, `approved_size_bytes` — staleness baseline captured at `approve_plan` (FR-007, D7).
- `resolved_pattern` — snapshot of the resolved naming pattern at approval (spec 005 gap).

**State transitions** (executor): `draft → approved (CAS, baseline captured) → applying (CAS) →
{applied | refused(reason) | failed} `; `pending → cancelled` (per-item audit row each — FR-005).
Refusal reasons: `root_escape`, `symlink`, `stale`, `destination_exists`, `destructive_unconfirmed`,
`protected`.

### Audit Event (`crates/audit`)
Durable record (§V). **New emissions:**
- Per-item rows for **every** transition incl. bulk cancel (FR-005) — not one aggregate update.
- Auto-block / auto-ready / unarchive transitions (FR-021) — previously event-bus only.
- `protection.default.changed` (FR-018).
- Topic added to the event bus: `artifact.classified` (FR-009).

### Project & Lifecycle (`crates/project/structure`, `projects.lifecycle` — canonical per D2)
- **Single canonical state**: `projects.lifecycle` (spec-002 `project.state` migrated out, 0033).
- `blocked_reason_kind` (typed enum: e.g. `source_missing`, `tool_unconfigured`, `user`, …) +
  `blocked_reason_note` (FR-020). The `BlockedBanner` DTO carries the typed kind, not a hardcoded `user`.
- Transitions (user IPC + automatic) write the same row; both surfaces read it (FR-019).

### Protection Default & Protected Source (`crates/audit`/persistence, `protection_defaults`)
- Persisted global defaults (scope/key/value) (FR-018, fixes 016 T-003/T-005).
- `ProtectedPlanItem.source_id` populated (FR-017).

### Session (`crates/sessions`, `sessions`)
- `root_id` (FK → library root) set on inbox confirm/apply so sessions group under their root (FR-012).
- `target_id` (FK → target, nullable) persisted from ingestion (FR-014).
- Calibration/acquisition fingerprints populated from extracted metadata (FR-013).

### Master / Calibration Fingerprint (`crates/calibration/core`)
- Masters `list`/`get` backed by **real rows** (not fixtures); matching runs on populated fingerprints
  (FR-013). Aging-threshold consumer reads the persisted setting (D-settings) not `m.age_days > 90`.

### Target & Alias (`crates/targeting`)
- `target_id` FK lets a target's detail show real linked sessions/projects (FR-014).
- Global search executes a real cross-entity query over targets/aliases/sessions/projects (FR-015);
  replaces the query-ignoring fixture stub.

### Catalog & Attribution (`crates/targeting/catalogs`)
- Signature **verified** (minisign, D5) before accept; verification status persisted (FR-026).
- License code validated against the recognized set; unknown ⇒ hard-fail (FR-027, D3).
- Catalog upsert + attribution written in **one transaction** (FR-028).
- Slugs validated against the canonical closed enum `{common, openngc, abell_pn}` (FR-029, D3).

### Settings (`crates/persistence`/contracts, settings scopes/keys)
- Calibration aging threshold persisted to a **real scope/key** (not the non-existent
  `calibration_matching` scope) and read by its consumer (FR-023). Same fix for spec 007's control.
- Snapshot/debounce timer actually emits (`emit_snapshot` gains its caller) (FR-024).

## Domain Events (runtime; consumed by subscribers + UI)
| Event | Producer | Consumer(s) | FR |
|---|---|---|---|
| `inventory.confirmed` | inbox confirm | guided bridge (advance) | FR-010 |
| `project.created` | project create | guided bridge | FR-010 |
| `tool.opened` | tool launch | guided bridge | FR-010 |
| workflow-run completed | workflow runner | manifest subscriber (async root resolve) | FR-008 |
| `artifact.detected` | artifact watcher | UI/audit | FR-009 |
| `artifact.classified` | artifact watcher | UI/audit | FR-009 |

All consumers must be **spawned in `run_app`** (US2) — the central gap.

## Validation rules (enforced + tested)
- A plan item MUST resolve under its root; escape/symlink ⇒ refuse pre-mutation (FR-001/002).
- A destructive item MUST NOT apply without `requires_destructive_confirm` satisfied (FR-003).
- An item whose on-disk mtime/size ≠ approved baseline ⇒ `stale` refusal (FR-007).
- `destination ∈ {archive, trash}` only (FR-038).
- Project lifecycle has exactly one canonical row per project (FR-019).
- Catalog: invalid signature OR unknown license OR unknown slug ⇒ reject (FR-026/027/029).
- Settings write to a known scope/key or it is a hard error, never silently dropped (FR-023).
