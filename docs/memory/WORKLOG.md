# Worklog

Use concise high-value entries only.
This is not a changelog. Do not record routine releases, version bumps, or implementation summaries.

---

### 2026-05-26 - Reconciliation workflow for specs that predate later merges

- **Why durable**: specs are often written before dependent specs land. The reconciliation pattern (clarify → update plan/tasks → re-analyze) avoids both full rewrites and stale artifact drift.
- **Future mistake prevented**: Implementing against stale file paths, command names, or route paths from a pre-merge spec, causing widespread find-and-replace rework mid-implementation.
- **Evidence**: Spec 003 was written before specs 027 (frontend) and 029 (Tauri wiring) merged. Routes were `/welcome` → `/setup`, commands were `source_register` → `roots.register`, file paths were `features/welcome/` → `features/setup/`. Clarify resolved all 5 divergences in 10 minutes.
- **Where to look**: Spec 003 clarifications section in `specs/003-first-run-source-setup/spec.md`

---

### 2026-05-26 - Parallel agent execution saves significant time on large specs

- **Why durable**: Spec 003 had 32 tasks. Sequential execution would take hours. Parallel Rust + frontend agents cut wall-clock time roughly in half.
- **Future mistake prevented**: Running all tasks sequentially when the dependency graph allows parallelism. Check the task DAG for independent workstreams before starting execution.
- **Evidence**: Spec 003 — rust-pro agent (T004-T008) ran in parallel with frontend-developer agent (T017-T024). Total implementation ~40 min wall-clock vs estimated ~80 min sequential.
- **Where to look**: `specs/003-first-run-source-setup/tasks.md` dependency graph, agent-assignments.md
