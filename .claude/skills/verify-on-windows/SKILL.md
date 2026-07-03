---
name: verify-on-windows
description: >-
  Generates a self-contained Windows validation scenario for a code change in
  the astro-plan / PlateVault repo, to hand to Claude computer-use ("cowork")
  driving the real Tauri desktop app on Windows. Use after implementing a change
  that needs real-app verification beyond unit/integration tests — new or changed
  UI behavior, an IPC/backend command, or an interactive flow. The invoking agent
  describes exactly what changed (spec/feature, files, Tauri commands, UI
  surfaces, new user-visible behavior); the skill emits a numbered click-by-click
  test script with preconditions, exact expected results, and explicit failure
  signals, plus the Windows dev-app launch/reset/recompile mechanics and the
  Tauri-MCP-bridge details, and guidance on the matching Layer-2 tauri-driver E2E
  journey + coverage-matrix update so manual and automated verification stay in
  sync. Triggers include "verify on windows", "validate on the real app",
  "generate a cowork/computer-use scenario", "test my change on windows".
---

# verify-on-windows

Turn "I changed X" into a **scenario document a Windows computer-use agent can
execute with zero access to this repo's context**. The Windows agent (Claude
cowork) can only see the running app and the scenario — so the scenario must
carry every fact it needs.

## When to use

After a change whose correctness depends on the **real running app**: a new/changed
UI affordance, a Tauri command / IPC round-trip, a navigation or routing change, a
first-run/reset-sensitive flow. Not for pure-logic changes already covered by
`cargo test` / vitest — say so and skip.

## Procedure

1. **Collect the change facts** — do not guess; read the diff. Fill every field of
   the *Change Facts* block (see `references/scenario-template.md`). Minimum:
   spec/feature id, branch, changed files, each new/changed **user-visible
   behavior**, and any **Tauri command / IPC** involved (snake_case name + args).
2. **Classify each behavior**: `manual` (needs human-like click/observe — native
   dialogs, OS file browser, visual state) vs `automatable` (deterministic
   UI→IPC→backend round-trip a tauri-driver journey could assert). List both.
3. **Write the scenario file** by filling `references/scenario-template.md`. One
   numbered, click-by-click **Test** per changed behavior, each with an exact
   **Expected** and an explicit **FAIL if** line. Embed the Windows mechanics the
   agent needs *inline* (branch to pull, how to launch/reset/recompile) — pull the
   canonical steps from `references/windows-mechanics.md`; never assume the Windows
   agent knows them.
4. **Emit E2E-sync guidance**: for every `automatable` behavior, state whether a
   Layer-2 `tauri-driver` journey should be added (`just test-e2e`) and add/append
   the row to `specs/037-e2e-integration-testing/contracts/coverage-matrix.md`.
   For `manual` behaviors, note explicitly that automation is not feasible and why.
5. **Save + report**: write to
   `docs/development/windows-validation/<branch-or-spec>-<slug>.md` (committable
   alongside the PR). Tell the user the path and paste the scenario's **Preconditions**
   + first Test so they can hand it off immediately.

## Hard rules

- The scenario is **self-contained**: no "see the repo", no task IDs without
  explanation, no assumed context. If the Windows agent needs a value (a path, a
  command name, a testid), it must be in the scenario.
- Every Test has an **observable** Expected and a **FAIL if** — never "verify it
  works". Prefer states a human/vision agent can see (text, enabled/disabled,
  a window opening) over internal assertions.
- **Recompile trap**: if the change touches Rust, the scenario MUST instruct the
  Windows agent to force a rebuild after `git reset --hard` (mtime trap) — see
  `references/windows-mechanics.md`. A frontend-only change may skip the Rust
  rebuild (hard refresh suffices).
- Keep manual (computer-use) and automated (tauri-driver) coverage **in sync**:
  every scenario ends with the E2E-sync section, even if it just records "manual
  only, no journey added".

## References

- `references/windows-mechanics.md` — canonical launch / reset / recompile /
  Tauri-MCP-bridge / Layer-1&2 test mechanics (source: project memory + `docs/development/testing.md`).
- `references/scenario-template.md` — the fill-in template (Change Facts →
  Preconditions → Tests → E2E-sync → Report-back).
- `references/example-scenario.md` — a complete worked scenario (spec-006 Ignore
  action + Reveal-in-OS) showing the expected output quality.
