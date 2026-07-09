# Quickstart: Cleanup And Archive Review Plans

## Prerequisites

- Node.js 20+, pnpm
- Rust toolchain (for backend/generator changes)
- `just` task runner

## Development

```bash
just dev                      # Vite dev server, mock mode (VITE_USE_MOCKS=true)
just tauri-dev                # Full Tauri mode, real generators/executor
```

Plan review works end-to-end in mock mode — no Tauri backend required for
overlay/table changes; the mock plan fixture is
`apps/desktop/src/data/fixtures/plans.ts`.

## Testing

```bash
pnpm --filter @astro-plan/desktop vitest run src/features/plans/ src/features/archive/
just typecheck
just lint
cargo nextest run -p app_core   # generator + state-machine tests
```

## Key files

There is no standalone Plans list/detail page in the shipped v4 UI — review
is always contextual, driven off the generating feature (a v4-design
reconciliation; see T015/T016 notes in `tasks.md`).

| What | Where |
|------|-------|
| Shared review overlay (list+detail, approve, apply progress, retry) | `apps/desktop/src/features/plans/PlanReviewOverlay.tsx` |
| Spec-016 protection acknowledgement gate | `apps/desktop/src/features/plans/PlanProtectionGate.tsx` |
| Live apply-progress reducer | `apps/desktop/src/features/plans/usePlanApplyProgress.ts` |
| Cleanup flow entry point (project detail) | `apps/desktop/src/features/projects/OutputsCleanupSections.tsx` |
| Archive flow entry point (project detail) | `apps/desktop/src/features/projects/ProjectDetail.tsx` (`handleGenerateArchivePlan`) |
| Archive management (send to trash / permanently delete) | `apps/desktop/src/features/archive/ArchivePage.tsx` |
| Cleanup candidate generator (US1) | `crates/app/core/src/cleanup_generator.rs` |
| Archive plan generator (US2) | `crates/app/core/src/archive_generator.rs` |
| Shared protection-resolved plan tail (destination computation) | `crates/app/core/src/protection.rs` |
| Review/approve/discard/retry use cases | `crates/app/core/src/plans.rs` |
| Tauri command surface | `apps/desktop/src-tauri/src/commands/plans.rs` |

## Walking through a review

1. From a project's Outputs/Cleanup section, click "Generate cleanup plan"
   (or trigger the completed → archived lifecycle transition for an archive
   plan) — this calls `cleanup.plan.generate` / `archive.plan.generate` and
   opens `PlanReviewOverlay` automatically.
2. Every item lists its name, action, source path, destination (or a
   deletion cue for `delete`-action items), and protection level (FR-003).
3. Protected items must be acknowledged via the spec-016 gate before
   "Approve & apply" unlocks.
4. Approving drives `plans.approve` → `plans.apply`, with live per-item
   progress streamed over the apply run.
5. If the run finishes `failed` or `partially_applied`, the footer offers
   "Generate retry plan" (US5), which calls `plans.retry` and re-points the
   same overlay at the new plan.

## Regenerating TypeScript bindings

Bindings live in `apps/desktop/src/bindings/index.ts`, generated from the
Rust command surface — see `apps/desktop/src-tauri/tests/bindings.rs`.
