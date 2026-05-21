# Implementation Plan: Source Protection Defaults

**Branch**: `016-source-protection-defaults` | **Date**: 2026-05-20
**Spec**: `specs/016-source-protection-defaults/spec.md`

## Summary

Source Protection turns destructive intent into reviewable, acknowledgement-
gated plan items. The system resolves an effective protection level per source
by checking a per-source override first and falling back to the global default.
Plan generators (cleanup spec 017, archive spec 025) consult the resolver while
materializing plan items and refuse to emit a permanent delete against a
`protected` source when `block_permanent_delete` is enabled, preferring archive
or trash actions instead.

## Architecture

### Protection Resolver

A single domain function determines effective protection for any (source,
optional category) pair:

```
resolve_protection(source_id, category?) ->
    override(source_id) ?? global_default
```

The resolver lives in `crates/domain/core/` so both `crates/fs/planner/` and
the `crates/app/core/` use-case layer can call it without circular deps. It
returns a `ProtectionLevel` plus the matched `categories` array so plan items
can record the rule that triggered them.

### Plan Generation Hook

`crates/fs/planner/` invokes the resolver while building each plan item:

- `protected` source: destructive items are emitted with
  `requires_acknowledgement = true` and a human-readable reason; permanent
  delete is rewritten to archive when `block_permanent_delete = true`.
- `normal` source: items are emitted unchanged (plan review still required by
  Constitution principle II).
- `unprotected` source: items are emitted with an `advanced_mode` flag so the
  UI can show the elevated-risk treatment.

### Archive-Over-Delete Preference

When the resolved policy refuses permanent delete, the planner substitutes a
move-to-archive action targeting the project archive root (spec 025). The
substitution is recorded in the plan item so the review UI can show the user
what was rewritten and why.

### Settings Persistence

Global defaults already exist in the desktop mockup
(`apps/desktop/src/data/settings.ts`). Per-source overrides live in the
persistence layer (`crates/persistence/db/`) keyed by `source_id`, and are
surfaced through the `source.protection.get` / `source.protection.set`
contracts.

### Audit

Protection changes and protected-plan acknowledgements emit `audit` events
(`crates/audit/`) so the user can later trace why a destructive plan was
allowed to proceed.

## Constitution Alignment

- **II. Reviewable Filesystem Mutation**: protection is enforced inside the
  reviewable plan, never via silent execution-time refusal.
- **IV. Research-Led Domain Modeling**: protection-level semantics, category
  vs source granularity, and archive/trash semantics are resolved in
  `research.md` before plan integration.
- **V. Portable Contracts and Durable Records**: protection state is exchanged
  through the language-neutral contracts in `contracts/` and persisted in
  SQLite.

## Phasing

- **Phase 0**: research (this folder) and contract drafts.
- **Phase 1**: data model + resolver in `crates/domain/core/`, repository
  surface in `crates/persistence/db/`, contract handlers in
  `crates/app/core/`.
- **Phase 2**: plan-generation integration (spec 017/025) and per-source
  override UI in `apps/desktop/`.
- **Phase 3**: audit wiring and acknowledgement flow.

## Out of Scope

- OS-level ACL enforcement.
- Network-share retention coordination.
- Encryption-at-rest controls.
