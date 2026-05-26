# Spec Kit Memory Workflow

This project uses the layered memory model for durable cross-feature knowledge.

## Memory Layers

1. **Constitution / Principles** — stable operating rules (`.specify/memory/constitution.md`)
2. **Durable Project Memory** — reusable cross-feature knowledge (`docs/memory/`)
3. **Active Feature Memory** — feature-local constraints, open questions (`specs/<feat>/memory.md`)
4. **Memory Synthesis** — compact retrieval for planning (`specs/<feat>/memory-synthesis.md`)
5. **Ephemeral Run Context** — temporary prompt/terminal state (never committed)

## Mandatory Commands

- `/speckit.memory-md.plan-with-memory` — run BEFORE `/speckit.plan` to synthesize relevant memory
- `/speckit.memory-md.capture` — run AFTER implementation to capture durable lessons
- `/speckit.memory-md.capture-from-diff` — fast capture from git diff after a fix
- `/speckit.memory-md.audit` — periodic health check on memory quality

## Index

`docs/memory/INDEX.md` is the compact routing map. Keep entries under 20 lines.
Each entry points to a durable memory file with a one-line summary.

## SQLite Optimizer

Enabled. Config at `.specify/extensions/memory-md/config.yml`.
DB at `.spec-kit-memory/memory.sqlite`.
