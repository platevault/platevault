# Research: Source View Generation

**Spec**: `specs/049-source-view-generation/spec.md`
**Status**: Decisions recorded (Constitution IV gate)

Most domain modeling is **reused** from prior specs; this feature adds only the
generation surface. The decisions below are the ones this spec introduces.

## R1 — Link kind: per-drive-scope settings pair (not single-kind, not per-probe)

**Decision**: Two persisted defaults — intra-drive (`hardlink`) and cross-drive
(`symlink`) — resolved deterministically at plan time per `(view × drive-scope)`,
recorded per item. UI is capability-constrained so invalid choices are
impossible; plan-time fallback is a rare drift-only path with a non-silent notice.

**Alternatives rejected**:
- *Single kind per whole view (spec 026 FR-008 original)* — impossible when
  selected lights span volumes (hardlink can't cross); forced a refuse-or-copy
  choice that users found too strict. CL-2 relaxes it.
- *Silent per-probe best-effort kind* — violates Constitution II (silent,
  unaudited variation). Rejected.
- *Always symlink* — fails on Windows without Developer Mode and wastes the
  same-volume hardlink fast path.

**Tradeoff**: recording per-item kind means a view may be multi-kind; mitigated
by making the kind rule-driven and recorded (authoritative per item), with
`PreparedSourceView.kind` as a display-dominant value.

## R2 — Layout: profile-driven token patterns (crate `patterns`)

**Decision**: Each workflow profile (spec 011) owns a token pattern (spec 015)
resolved to destination-relative paths; WBPP ships first (session/night → filter
→ exposure). No hardcoded tree.

**Constraint**: patterns that aggregate across sessions MUST carry a
session/night/setup token; each session otherwise links into its own directory.
Collisions are a plan-time validation error, never a silent suffix (CL-5).

## R3 — Calibration: consume, never compute; not a prerequisite

**Decision**: Consume resolved matches (specs 007/040); masters when the match
resolved masters, else raw sets (CL-4). Generation is **not** gated on matching —
when unmatched, generate the light view and warn "no calibration applied" listing
unmatched groups (CL-7). Never auto-run matching (Constitution III boundary).

## R4 — Plan origin: distinct `prepared_view_generation`

**Decision**: First-materialization uses a new origin/plan-type
(`prepared_view_generation` / `source_view_generation`), distinct from spec 026's
regeneration origin, for clear audit routing (CL-1). Requires migration `0061`
(CHECK-constraint enum expansion only).

## R5 — Destination: project envelope default + overrides

**Decision**: Default `<project>/source-views/<view>/` (spec 024 envelope);
per-project override persisted via KV; per-generation override in the dialog
(CL-6). Overrides still obey all cross-platform safety FRs.

## R6 — Reuse of spec 017/025 pipeline and spec 026 machinery

**Decision**: Generation produces a plan only; approval, apply, per-item
revalidation, pause/resume, and per-item audit are the spec 017/025 executor.
Removal/regeneration/stale detection stay with spec 026. This feature adds no
executor and no remove/regenerate logic (FR-013).
