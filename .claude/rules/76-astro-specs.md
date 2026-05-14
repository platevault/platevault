---
paths:
  - "{specs/**,.specify/**}"
---

# Astro Specs

Keep `specs/` focused on feature artifacts, not implementation code. Treat
feature artifacts as the source of truth for feature intent, scope, and
sequencing.

Keep phase outputs aligned: `spec.md`, `plan.md`, `tasks.md`, and supporting
artifacts should not drift. Update the feature artifacts you change together
instead of patching one file in isolation.

Prefer bounded feature directories under `specs/NNN-feature-name/`.

Keep implementation details at the planning level unless they are true
requirements. Record explicit exclusions, trims, and deferred work instead of
leaving silent gaps.

Before closing a feature, verify artifact consistency and task truthfulness.
The active feature currently lives under `specs/001-astro-library-manager/`.
