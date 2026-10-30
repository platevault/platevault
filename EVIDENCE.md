DIAGNOSIS: Library invalid-input refusals now carry an optional stable field path (`ErrorResponse.field: FieldPath | null`), and `useDialogForm` maps matching path refusals to field-level accessible errors. The shared PlanCriteria editor, settings profile/equipment/site forms, Matching settings, and Moon limits use mappings only for paths their validators return. Removed speculative paths from settings where no library validation names a relevant field, including dark/bias window days; unknown site time-zone refusals are fieldless in the current core validator. The regenerated binding is included.

EVIDENCE:
- Branch `feat/error-field-path`, commit `ce0b711b81f2c04c5e1c141aedb096932bc57b5a` plus the changes in this working tree; worktree `/Users/sjors/tmp/worktrees/platevault/feat-error-field-path`.
- Restored `apps/desktop-ui/src/features/settings/settings.test.tsx` from HEAD before adding one matching refusal test; no rewrite of the existing cases/helper.
- `pnpm exec tsc -p tsconfig.json --noEmit --incremental false` (apps/desktop-ui): passed.
- `pnpm exec eslint --max-warnings 0` on changed desktop-ui files: passed.
- `pnpm exec vitest run --pool=forks --maxWorkers=1 src/features/settings/settings.test.tsx src/features/library/library.test.tsx src/components/domain`: passed, 12 files / 103 tests. Also focused settings test alone passed, 1 file / 37 tests.
- `cargo fmt --all --check`: passed.
- `cargo test -p platevault_model -p persistence_library`: passed, 253 tests across 30 suites.
- `cargo test -p desktop_shell --test library_commands --test library_errors`: passed, 21 tests across 2 suites.
- `just library-bindings`: passed; regenerated `apps/desktop/src/bindings/library-index.ts` (library_bindings test passed, 1 test).
- `just check-generated`: attempted before committing the generated binding and failed only because the expected `library-index.ts` working-tree diff was uncommitted. Re-run after committing; do not claim it passed.
- Focused core tests `cargo test -p platevault_core --test calibration_model --test frame_review_model --test home_criteria --test import --test home_planning --test targets_list`: failed in `import::unclassified_held_until_typed` (actual `(Unclassified, Settling)`, expected `(Unclassified, Unclassified)`). No changed file is in the import classifier; failure is recorded as unverified/unrelated, not proven.
- NOT RUN: clippy `-D warnings` on touched Rust crates; post-commit `just check-generated`; full desktop-ui typecheck/lint/vitest requested by brief beyond the focused scopes already listed; no post-rebase verification because rebase onto `origin/main` has not been done. Core focused suite otherwise included named targets; the import failure halted the command.
- Push / draft PR: not yet performed.