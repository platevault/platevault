# Specs Steering

This `AGENTS.md` applies only to the `specs/` subtree and overrides the repo root where needed.

## Purpose

- Keep `specs/` focused on feature artifacts, not implementation code.
- Treat spec artifacts as the source of truth for feature intent, scope, and sequencing.
- Keep phase outputs aligned: `spec.md`, `plan.md`, `tasks.md`, and supporting artifacts should not drift.

## Working Rules

- Prefer bounded feature directories under `specs/NNN-feature-name/`.
- Update the feature artifacts you change together instead of patching one file in isolation.
- Keep implementation details at the planning level unless they are true requirements.
- Record explicit exclusions, trims, and deferred work instead of leaving silent gaps.

## Validation

- Before closing a feature, verify artifact consistency and task truthfulness.
- If a subtree under `specs/` needs stricter local rules, add another nested `AGENTS.md` there.
