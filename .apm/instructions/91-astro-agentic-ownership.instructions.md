---
description: Astro Library Manager APM ownership rules.
applyTo: "{AGENTS.md,CLAUDE.md,.apm/**,.codex/**,.claude/**,.agents/**,apm.yml,apm.lock.yaml}"
---

# Astro Agentic Ownership

APM owns project-local agentic runtime files for this repository.

Keep project-specific steering in `.apm/instructions/`, `.apm/context/`, or
`PRODUCT.md`, then regenerate runtime files with APM. Do not hand-edit compiled
`AGENTS.md`, `CLAUDE.md`, `.claude/rules`, `.claude/agents`, `.codex/agents`, or
`.agents/skills` except for explicit repair work.

Project-scoped Codex overrides live in `.codex/config.toml`. Keep
global/shared Codex behavior in `~/.codex/config.toml` and the chezmoi-managed
source, not in this repo.
