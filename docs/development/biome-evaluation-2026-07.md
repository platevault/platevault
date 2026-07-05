# Biome evaluation for JS/TS lint + format (2026-07)

**Verdict: do NOT adopt Biome.** Keep ESLint as the sole JS/TS linter; do not
add a formatter in this pass. This is a reasoned "no", recorded so the question
isn't re-opened without new information.

## What was evaluated

Whether Biome (v2.4.14) should replace or augment the current frontend lint
stack for `apps/desktop/src` (337 real source files, excluding generated
`src/bindings/**` and `src/paraglide/**`).

Full replacement is off the table by construction:

- Biome has **no custom-rule plugin system**, so the spec-046 i18n catalog gate
  (`alm/no-user-string`) and `alm/no-js-plural` — both in
  `apps/desktop/eslint-rules/no-user-string.js` — **cannot move**.
- Biome does **not do type-aware linting** (no TS type program), so the entire
  `typescript-eslint` `recommendedTypeChecked` layer (`no-floating-promises`,
  `no-misused-promises`, `no-unsafe-*`, `no-base-to-string`, `require-await`,
  `only-throw-error`, …) must stay in ESLint.
- The `no-restricted-syntax` inline-`style={…}` gate uses an esquery AST
  selector; Biome has no equivalent generic-selector rule, so it stays too.
- `jsx-a11y` (enforced at **error** across `src/**`) and `react-hooks` are only
  partially covered by Biome's a11y/correctness rules; parity is not guaranteed.

So the only live question was the **hybrid**: Biome as formatter + fast
core-lint first pass, with ESLint retained for the custom + type-aware + a11y +
selector layer.

## Measurements (warm runs, `apps/desktop`)

| Task | Tool | Wall time | Peak RSS |
|------|------|-----------|----------|
| Lint `src/` (full gate) | ESLint | **17.25 s** | ~2.0 GB |
| Lint `src` (core rules only) | Biome | **0.51 s** | ~89 MB |
| `check` (lint+format+assist) | Biome | 0.77 s | — |
| `tsc --noEmit` (type program) | tsc | **6.53 s** | — |

ESLint gate result: 0 errors / 223 warnings (green).

## Why the hybrid does not win

**Lint:** Biome is ~34× faster, but only because it runs a *strict subset* of
the cheap, non-type-aware core rules. Every rule that actually gates this
repo's CI — the i18n custom rules, the type-aware `@typescript-eslint` layer,
a11y-at-error, and the inline-style selector — **must remain in ESLint**.
ESLint's dominant cost is building the TypeScript type program (`tsc` alone is
6.5 s; ESLint's `projectService` pays that plus per-rule evaluation). Offloading
the handful of core-style rules Biome could cover removes **none** of that
fixed cost. Net effect of the hybrid: a second tool + config + CI step for
~0 s saved on the critical path, plus the ongoing risk of the two tools
double-firing or disagreeing.

**Format:** There is **no formatter today** (no Prettier, no config). Adopting
Biome's formatter — even with a config style-matched to the existing code
(2-space, single quotes, semicolons, trailing commas, always-arrow-parens) —
still reformats **336 of 337** files (~24k changed lines), driven almost
entirely by Biome's line-wrapping opinions. Per the task constraint ("if Biome
formatting would produce a large diff, don't reformat the tree in this PR"),
that rules out adopting Biome-as-formatter here.

## Deferred option (not done)

Introducing a formatter at all is a genuine gap. If the team later wants one, it
should be a **separate, dedicated "format the whole tree" PR** (Biome *or*
Prettier), reviewed as pure churn, not smuggled into a toolchain change. That is
explicitly out of scope for this change.

## vitest

Already the frontend test runner (`vitest@4.1.7`, `vitest run`). Config
(`apps/desktop/vitest.config.ts`) is clean — jsdom env, correct
include/exclude, dev-tools statically false for the release gate. **No changes
made.**
