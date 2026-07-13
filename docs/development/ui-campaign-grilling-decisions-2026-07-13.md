# UI-campaign grilling decisions — 2026-07-13

Product/UX decisions captured from a design grilling of the PlateVault desktop
app. These are user-made decisions recorded to durable form so the relevant
SpecKit iterations can encode them when each wave is picked up. This document is
the decision record; it does not implement product code.

Issue references point at the spec-030 UI-audit campaign and the specs named per
decision. File paths are given so the implementing iteration inherits the exact
shared surfaces to reuse (economy: one component/one class, never per-feature
clones).

---

## Q1 — App-wide feedback policy (spec-030 #604)

No silent mutation. Every mutating action — plan apply, Inbox confirm, master
register, project create, settings save, lifecycle transition — fires a
transient **SUCCESS toast** via the existing `apps/desktop/src/shared/toast.ts`.

**ERRORS do not use a fleeting toast.** They render in a prominent, obvious,
**dismiss-on-acknowledge error popover on the page** that carries the error
code/reason. This error popover is the shared surface for:

- W2-refusals (#600 / #603), and
- the spec-025 resume-refusal codes.

Ships with:

- **Unit tests** — toast on success, error popover on failure, and an explicit
  assertion that there is no silent path.
- **Integration tests** — each mutating action routes through this feedback
  surface.

---

## Q2 — Targets default view + 13k-catalog freeze (spec-030 #573 / #574)

Default the Targets view to **"my targets"** = in-use `canonical_target` rows.
This aligns with the spec-052 persistence gating.

The full seed catalog (13,073 rows) is **NEVER loaded into the table model**. It
is browsable **paginated** — page through AND search — via the resolver facade.

The sidebar/status count shows **"my targets"**, not 13073.

Fix this at the **data-model level**, not merely at the virtualization level: the
table model must not hold the full catalog in the first place.

---

## Q3 — Advanced settings (spec-030 #601 / #602)

Build all three for real — no fiction, no placeholder UI:

1. **Real `db.stats` backend command** returning real row counts, database size,
   and last-modified.
2. **Real Export database** — copy the SQLite file to a user-chosen path, with a
   success toast (Q1).
3. **Real Reset preferences** — settings → defaults, behind a confirm.

---

## Q4 — Settings integrity (spec-030 #623 / #624 / #639 / #641 / #645 / #646)

- **Audit EACH orphaned settings key individually.** Keep and surface the ones
  that drive real behavior; prune the truly dead. This is per-key, not a blanket
  keep or blanket prune.
- **Consolidate the duplicate scan-behavior stores** to the single one the
  ingestion pipeline actually reads, and point the UI at that one.
- **Fix the silent-reject persistence bugs** (the `scope_keys` omission) so saves
  actually persist, with the Q1 feedback surface reporting success/failure.

---

## Q5 — Data Source delete + remap (spec-003 / spec-006, #559 / #560 / #563)

Separate the two intents that were conflated:

- **MOVED / disconnected drive → Remap.** Records are preserved and re-resolved.
  This is the "recover to another location" path.
- **FORGET a library → Delete.**
  - Empty root → trivial deregister.
  - Root with dependents → a **heavy-gated cascade of registration/metadata
    ONLY, never the files on disk** (constitution §I, local-first file custody).

**Delete confirm** must:

- Itemize every dependent: N frames / M sessions / K masters / links /
  decisions.
- Require **typing the root's name to proceed, with copy-paste BLOCKED**.
- Write an audit record.

**Remap Verify (#560)** must check a meaningful set (or show real coverage) and
must **never enable Apply on a vacuous "all found"**.

---

## Q6 — Manual path entry everywhere paths are set (spec-030 #662)

The reason this matters is **not** the human happy-path — the native picker works
fine when the target directory exists and is mounted. It matters because:

1. Native OS dialogs **cannot be driven by E2E**, and
2. The picker only yields **existing directories**, so the reject-invalid and
   reject-file validation paths are **unreachable** through it.

**Solution:** a **backend-driven live-completion combobox** in the SHARED
component `apps/desktop/src/ui/DirPicker.tsx`, consumed by:

- the wizard source step,
- Settings → Data Sources add-source, and
- the RemapRootDialog.

One component; all three inherit it.

Backend commands:

- `fs.suggest_paths(partial) → dirs`
- `fs.validate_path(path)`

Frontend reuses the existing `@base-ui-components/react/combobox` pattern (as
`TargetSearch.tsx` already does).

**Rust canonicalization dependency:** adopt **`dunce`** — a no-op off-Windows;
avoids the `\\?\` UNC prefix, which helps nested-root detection (#501) and
display/compare.

**Do NOT adopt `shellexpand`:** its env-var syntax is Unix-only (`$VAR`), with no
Windows `%VAR%` support. Tilde-only expansion, if ever needed, can be done via
`dirs::home_dir()`.

Unit tests mock the FS commands.

---

## Q7 — Plan architecture (spec-041 iterate; touches spec-019 chrome + spec-025)

### Plan-origin inventory and verdicts

| Plan origin | Verdict |
|-------------|---------|
| Inbox move | **Valuable** |
| Inbox catalogue-in-place | **Ceremony** (no mutation) |
| Cleanup | **Valuable** (core §II) |
| Archive | **Valuable** |
| Restructure | **Valuable** |
| PreparedView gen/regen/removal | **Low-stakes** (reproducible §V projection) |
| Project-scaffold | **Ceremony** (already mkdir-auto-applies per 2026-07-04) |

### Decisions

1. **Every plan-producing action gets a combined "Apply now / Add to plan"
   control.**
2. **A single GLOBAL plan/queue, visible app-wide** (NOT per-window):
   - a **status-bar counter** — `queuedActionCount` in `useStatusSummary`, a peer
     chip; and
   - a **fold-out Plan/Queue panel** modeled on `LogPanel` (its own
     `PlanQueueContext`), listing all queued actions across origins with
     origin + from → to + per-item Apply/Remove + Apply-all.
3. **"Add to plan"** routes into this global queue; **"Apply now"** bypasses it.
4. **Plan record + audit are always written** — even for ceremony/auto-apply
   origins — following the `project_create.rs` mkdir precedent.
5. **"Apply now" is not silent:** destructive/move origins still show from → to
   inline before executing (§II: reviewable + explicit); ceremony origins just do
   it.
6. **Catalogue-in-place: register directly at confirm.** Move the `plan_listener`
   registration to confirm-time for catalogue items — no plan is needed because
   nothing mutates.

This stays within the constitution **without amendment** (Principles II
reviewable mutation and V durable records both hold: every action still yields a
reviewable from → to and a durable audit record).

---

## Pending formalization

Each decision above still needs its own SpecKit iterate when its wave is picked
up:

- **Q1–Q4, Q6** — fold into the **spec-030** UI-audit campaign.
- **Q5** — a **spec-003 / spec-006** iterate.
- **Q7** — the **spec-041** iterate defined alongside this document (see
  `specs/041-inbox-plan-surface/pending-iteration.md`).
