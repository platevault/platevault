---
paths:
  - "{AGENTS.md,CLAUDE.md,.apm/**,.codex/**,.claude/**,.agents/**,apm.yml,apm.lock.yaml}"
---

# Astro Agentic Ownership

APM owns package-provided agentic runtime files for this repository (agents,
skills, package steering, and the compiled `AGENTS.md` / `CLAUDE.md` bodies).
Regenerate those with APM; do not hand-edit them except for explicit repair.

Project-specific steering is hand-maintained, NOT APM-compiled. It lives as
plain markdown rules in `.claude/rules/` (for example
`05-astro-library-manager.md`, `21-astro-monorepo.md`, `22-astro-build-run.md`,
`76-astro-specs.md`, and this file). Edit these directly — they are not sourced
from `.apm/instructions/` and `apm compile` leaves them untouched as unmanaged
local files. Keep any new project-specific steering here rather than adding it
back into APM.

Project-scoped Codex overrides live in `.codex/config.toml`. Keep
global/shared Codex behavior in `~/.codex/config.toml` and the chezmoi-managed
source, not in this repo.
