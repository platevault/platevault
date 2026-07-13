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

## Q8 — Frame-type override + heuristics (NEW)

The original worry was that a bulk frame-type override could mix heterogeneous
frames and corrupt classification. **Resolution: the override is scoped to a
single session — no cross-session bulk edits.**

- A **session is one capture run**, therefore homogeneous by construction.
  Within-session bulk-set is safe; cross-session mixing is impossible by
  construction. This dissolves the heterogeneity problem, so **no warning
  heuristic is needed for a safe override**.
- Keep **reset-to-detected** as the undo. Provenance already exists:
  `classification_source ∈ { rule, manual_override, fallback }`.

The median-ADU classifier idea does **not** graduate into the override UI. It
becomes a **separate follow-up: a heuristic frame-type SUGGESTION on ingestion**,
research-gated per constitution §IV. See the iterate map and the appended
research handoff.

### Empirical findings (real `/mnt/d` library, no numpy)

Measured against the real astrophotography library (doc 077 corpus) with a
header/pixel probe — no numpy, direct byte reads:

- **Mean/median ADU is NOT in any header.** Verified across NINA, DWARF, and
  WBPP outputs. Frame-type inference from brightness requires reading pixels,
  not headers.
- **RAW flats sit at ≈ 50% of full-well on BOTH sensors sampled** — Poseidon
  **50.5%** and ZWO ASI2600 **50.1%**. Camera-independent, as expected for a
  properly exposed flat.
- **Lights ≈ 1%** of full-well; **bias ≈ dark ≈ 0.2%**. ADU alone cannot split
  bias from dark (both near the floor) — **EXPTIME** separates them.
- **MASTERS are normalized** — a DWARF master flat reads **3.5%**, not 50%.
  So a brightness classifier must **sample RAW frames only**, never masters.
- **Sample, never full-read.** A central-80-row median sample costs
  **34–97 ms/frame** vs **2.6–7.9 s** for a full read on the (slow WSL) mount.
  Full reads are two-to-three orders of magnitude more expensive for no
  classification benefit.

### Header-signal notes (what is and isn't a tell)

- **EXPTIME** is the primary discriminator (bias vs dark; long vs short).
- **OBJECT value is tool-specific** — NINA writes `"FlatWizard"`; the mere
  *presence* of OBJECT does not imply a light frame.
- **Flats carry RA/DEC** (mount was pointed) — so pointing ≠ light frame.
- **DATE-OBS contiguity is useless** for typing (all frame types are contiguous
  within a run).
- **Zenith / altitude is not a tell.**
- **FILTER on darks is camera-dependent** (some rigs record a filter on darks).

The full research handoff prompt is reproduced in the appendix.

---

## Q9 — Log panel (spec-030 #582 / #668 / #583 / #666 / #626 / #667 / #647)

**Activity-feed-first.** The panel defaults to user-meaningful events, not an
internal firehose.

- **Default view = user-meaningful events** classified via `LogEntrySource`.
  Internal / system / periodic events are **hidden by default** behind the
  already-present-but-unwired **`source_filter`** UI (#666).
- **Coalesce / rate-limit internal events** so periodic chatter cannot bury the
  feed (#668).
- **Severity filter = level-and-above.** Wire the backend's existing `level_min`
  and fix the current bug where selecting a level shows **only** that level
  instead of that level and higher (#582).
- **Structured lines** — operation + subject + outcome + code — with entity
  cross-links fixed using `entity_type` / `entity_id` (#626).
- **Export-title fix** (#667).
- **Audit is the durable record; this panel is the live view over it** (#647).

---

## Q10 — Manifests (spec-024 iterate; #665)

**Reframe: a manifest is a projection, not a stored entity** (constitution §V —
generated projections are reproducible unless a research decision marks an
artifact canonical).

- **On disk, always** — only a minimal **identity marker**
  (`.marker.json`: project id + name + a "generated by PlateVault" tag + schema
  version). Its sole job is onboard / remap / DB-loss re-association (FR-006).
  It is **not** a full source dump.
- **Manifest-as-documentation is rendered on demand** from live DB relationships
  (current composition) plus the audit log (history). It is **exported** to
  `.md` / `.json` only on an explicit Export / handoff.
- **Optional frozen "as-processed" snapshot** may be bundled with a generated
  source view at prep time — this is the **real reproducibility boundary**.
- This **kills #665's dead-trigger problem**: there is no full manifest to
  auto-regenerate, so there is no stale-trigger to chase.
- **Dependency:** arbitrary historical reconstruction needs comprehensive audit
  coverage (#647). The **prep-time snapshot is the guaranteed record** regardless
  of audit completeness.
- **Collapses** the old versioned-checkpoint model into **current-state + audit +
  prep-snapshot**.

---

## Q11 — Buttons / one-CTA (spec-030 #627 / #628)

- **Delete `accent`.** It is byte-identical to `primary`; migrate its 4 uses to
  `primary`.
- **Codify a four-rung emphasis hierarchy** (primary / secondary / ghost / and
  the retired accent folded into primary).
- **Split danger onto a `tone` axis.** Variants become
  **`emphasis` (primary / secondary / ghost) × `tone` (neutral / destructive)**,
  so destructive composes with any emphasis level (this is what serves Q5's
  heavy-gated destructive controls).
- **Distinct, variant-independent disabled state.** Today disabled is just
  `opacity: 0.5` on `.alm-btn:disabled`
  (`apps/desktop/src/styles/components/primitives.css:31`), which leaves a
  saturated primary/danger button looking clickable and a ghost button barely
  changed (#628). Collapse **all** variants to **one muted neutral disabled
  surface** via dedicated tokens across all 4 themes, plus
  `cursor: not-allowed` and `aria-disabled`.
- **Enforce one-CTA structurally.** Introduce a
  **`<Actions primary secondary>` container** (grown incrementally from the
  existing `alm-*__actions` slots) and a **lint guard** that flags more than one
  primary `Btn` per container.

---

## Q12 — Sessions: strict ingest completeness, no fallback (spec-006 / spec-033 / spec-041; #564 / #654 / #651 / #567 / #652)

**No folder-based grouping fallback.** Partial/derived session states recreate
the exact ambiguity this decision removes, so there is no soft/derivable tier —
no mtime or folder-date guessing.

**Strict ingest gate.** Every attribute needed for **path generation AND session
identity** is **required at confirm** — the **full union** of:

- the naming-pattern tokens (spec 015), and
- the type-specific session-grouping key: optic-train, filter, exposure, gain,
  offset, binning, pointing/rotation (for lights), observing-night, etc.

Values are sourced from headers or user-set. Confirm is **blocked until
complete**. This extends the existing `inbox.missing_path_attributes` gate
(`crates/app/inbox/src/confirm.rs`) and now applies to **catalogue-in-place**,
not just move.

**Friction is handled by an "Apply to all" batch fill** — set a missing value
once and apply it across the whole selection/session. This is safe because Q8
scopes edits to a single homogeneous session.

**Independent reveal fix (NOT a fallback).** Derive and store each session's
**folder** = the common frame-path ancestor, so "Show in File Explorer" opens
the session's frames rather than the root (#651 / #567). Use a single-source
derivation for both count and list (#652).

Result: sessions are always well-formed and distinguishable at the source
(#564 / #654), with no partial-metadata rows.

---

## Q13 — Inbox interaction correctness → app-wide principles (#644 / #643)

- **Id-based stable selection as an app-wide shared pattern.** Adopt the existing
  `use-stale-selection` hook, replacing Inbox's positional `selectedIdx`
  (`InboxList.tsx:152`). The detail follows the item across reorder/filter. This
  applies to **Inbox + Sessions + Targets + Calibration** — any list → detail
  surface — not per-page.
- **Selected item filters out of view → keep the detail open** with a "not in
  current filter" hint (option A). Do not clear it.
- **Confirm gate fails closed + backend is authoritative.** The client
  `canConfirm` (`InboxPage.tsx:600`) defaults **disabled** until metadata is
  loaded AND complete — never optimistically enabled. The backend
  (`missing_path_attributes`) is the real gate; a refused confirm surfaces via
  the Q1 error popover. This matters more under Q12's full-union requirement: the
  last control before a §II mutation must fail closed.

---

## Q14 — Design-system sizing + density / font-size, token-driven (#587 / #616)

**Root cause:** there is no canonical density-aware sizing token. Density only
sets `--alm-row-height`, while controls use hardcoded heights (`.alm-btn 28px`,
`--sm 24px`), so the density/font-size settings persist but never reach the
components; heights drift (statusbar 26 / toolbar 40 / row 32 / btn 28 /
btn-sm 24).

- **One canonical `--alm-control-h` token** (plus size steps) that buttons,
  inputs, and selects derive from; replace the hardcoded heights (#616).
- **Density (compact / default / spacious) scales the sizing tokens together** —
  `--alm-control-h` + `--alm-row-height` + spacing — so the whole UI responds
  (#587 density).
- **Font-size = root `rem` scale**, discrete 3-step (small / default / large), so
  all rem-based text scales and it respects OS zoom / accessibility (#587
  font-size).
- **Reach = full-UI.** Tokenize the hardcoded sizes so the settings are honest
  across the app — a design-system hygiene pass.

---

## SpecKit iterate map

Each decision is formalized through a SpecKit iterate when its wave is picked up:

| Decision | Iterate target |
|----------|----------------|
| **Q1** app-wide feedback | **spec-030** UI-audit campaign |
| **Q2** Targets default + catalog data-model | **spec-030** campaign |
| **Q3** real Advanced settings | **spec-030** campaign |
| **Q4** settings integrity | **spec-030** campaign |
| **Q5** data-source delete/remap | **spec-003 / spec-006** iterate |
| **Q6** shared path-entry combobox | **spec-030** campaign |
| **Q7** global plan/queue | **spec-041** iterate (already drafted — `specs/041-inbox-plan-surface/pending-iteration.md`) |
| **Q8** frame-type override | new **research-gated spec** (heuristic frame-type suggestion), folding Q8 |
| **Q9** log panel | **spec-030** campaign |
| **Q10** manifests | **spec-024** iterate |
| **Q11** buttons / one-CTA | **spec-030** campaign |
| **Q12** sessions strict ingest completeness | **spec-006 / spec-033 / spec-041** iterate |
| **Q13** id-based selection + fail-closed confirm | **spec-030** campaign (shared selection hook + gate) |
| **Q14** design-system sizing / density / font-size | **spec-030** campaign / design-system (spec-043 tokens) |

Q8's override decision is small enough to fold into the ingestion/confirm flow
directly; the **heuristic ADU suggestion** is the part that needs a new
research-gated spec — see the appended handoff.

---

## Appendix — Frame-type research handoff prompt

Hand this to the research-gated frame-type-suggestion spec. Reproduce the
empirical findings and open questions below.

### Established findings (verified on `/mnt/d`, no numpy)

- Mean/median ADU is **not** present in any header (NINA / DWARF / WBPP checked).
- RAW flats ≈ **50% full-well**, camera-independent (Poseidon 50.5%, ZWO2600
  50.1%). Lights ≈ 1%. Bias ≈ dark ≈ 0.2% (EXPTIME, not ADU, splits bias/dark).
- Masters are **normalized** (DWARF master flat read 3.5%) → sample **RAW only**.
- Central-80-row median sample = **34–97 ms/frame** vs **2.6–7.9 s** full read →
  **sample, never full-read**.
- Header signals: **EXPTIME** primary; **OBJECT value** tool-specific (NINA
  "FlatWizard"), presence ≠ light; flats carry **RA/DEC** so pointing ≠ light;
  **DATE-OBS contiguity** useless; **zenith** not a tell; **FILTER on darks**
  camera-dependent.
- Provenance sink: results feed `classification_source`
  (`rule | manual_override | fallback`).

### Open questions to research

1. **Exact EXPTIME bands per camera/gain** — the numeric cutoffs that separate
   bias / dark / flat / light for each sensor and gain setting.
2. **Flat ADU cutoff** — confirm the ~30–50% full-well band holds across more
   sensors, DSLR, and OSC-vs-mono.
3. **Unresolvable combinations** — where headers + sampled ADU cannot decide,
   emit a **low-confidence** classification rather than a guess.
4. **Confidence scoring** — combine EXPTIME + sampled-ADU + OBJECT-value +
   folder / filename tokens into a single score.
5. **Sampling strategy robust to hot pixels / stars** — median-based, resistant
   to bright outliers; validate against real light frames with stars.
6. **UX** — grouped per-session suggestions on ingestion; an opt-in "deep
   classify" ADU pass; results feed `classification_source` provenance.

### Corpus and constraints

- Corpus: `/mnt/d` real library + doc 077 header inventory.
- **No numpy.** Read pixels via direct byte access.
- **XISF masters are uncompressed Float32** at
  `location="attachment:offset:size"` — read directly from the attachment
  offset.
