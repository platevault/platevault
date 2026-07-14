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

## Q15 — Durable audit coverage (spec-030 #647)

**Reframe: #647 is architectural, not a coverage gap.** Two disjoint audit
stores exist today — an in-memory `EventBus` (feeds the Q9 Activity/log panel:
settings changes, protection sets, equipment CRUD, `sources.set_active`, rescans
emit **here only**) and the durable `audit_log_entry` table (written **only** by
lifecycle transitions, plan-apply, project-health). So a protection-set returns
an `auditId` that points at an *in-memory* event, not a durable row — violating
constitution §II ("audit record for each attempted action and outcome").

1. **Every attempted mutation of durable state or user data writes a durable
   audit row** — generalized far beyond lifecycle+fs to **settings changes,
   protection overrides, equipment CRUD, source enable/disable/register/delete
   (the Q5 deletes), rescans/root ops** — each with **outcome incl.
   refused/failed + reason/code**.
2. **Unify the two stores.** The durable `audit_log_entry` table is the **single
   source of truth**; audit-worthy actions write there *and* emit to the bus for
   live UI — kill the emit-to-bus-**only** pattern for mutations. The Q9 Activity
   panel then reads durable audit for user-meaningful events + the ephemeral bus
   for transient/internal noise. (Makes Q9's "activity is a view over the audit"
   literally true, and Q10's manifest-history reframe viable.)
3. **Generalize the audit entry shape** from lifecycle-specific to a generic
   mutation record: `timestamp, actor, action, entity(type+id), outcome+reason`
   (constitution §II fields), plus optional before→after for settings/protection.

**The line (NOT durably audited):** reads, navigation, UI state, transient
internal/periodic events.

---

## Q16 — Missing-value semantics + detail-as-delta (spec-030 #620 / #619)

**#620 is a data-model problem wearing a rendering costume.** Today
`PropertyTable.tsx:42` renders missing as `—`, but the model already lost
information: an em-dash still gets a "FITS" **source pill** (absence rendered as
attributed data), and a metadata-less master shows **"Gain 0 · Exposure 0s ·
Size 0 KB"** — default zeros indistinguishable from a real `Gain 0`. **Missing ≠
zero**, and the render layer cannot recover the distinction once `0` overwrote it.

**A. Missing-value semantics — fix at the model, then a shared renderer.** Three
states must be distinguishable everywhere: **real value** (incl. real `0`),
**unresolved/missing** (no data), **not-applicable** (field doesn't apply).
Represent missing as `null`/`None` **end-to-end** (extraction → contract → UI) —
**never default numerics to `0`**. Then one shared `renderValue(value, {source})`:
- real → the value (+ source pill),
- missing → a distinct muted **"unresolved" chip**, **no source pill**, never `0`,
- n/a → blank / "—" without a chip.

Cross-cutting (Sessions, Calibration, Targets, everywhere); it **must** start in
the data model.

**B. Detail-as-delta (#619).** A detail panel **adds** information, not echoes the
row's columns back: **lead with what's new** — full metadata, provenance/source,
related entities, history, actions. **Stay minimal and curated — only relevant
data, not a dump.** A small identifying summary is fine, but lead with new info.

---

## Q17 — Equipment identity & aliases (spec-006 #659)

Equipment (cameras/telescopes/trains/filters, migration 0007) has `name` +
`aliases` (JSON array), and **aliases are the FITS join key**: a frame's
`INSTRUME`/`TELESCOP` string is matched against equipment aliases to resolve
which gear it used. It has **no uniqueness check, client or server** — duplicate
*aliases* are corrupting (two cameras sharing alias `ZWO ASI2600MM Pro` → a
frame's `INSTRUME` matches both → ambiguous session→equipment resolution). This
is the same identity problem as targets (`target_alias`, migration 0031).

1. **Alias uniqueness per equipment type is a hard invariant** (client *and*
   server): an alias maps to **≤1** equipment because it's the join key.
   **Duplicate alias → hard block** ("alias X already used by camera Y").
   **Duplicate name → warn** (allow — two identical camera models is legitimate —
   but flag it).
2. **Equipment is FITS-derived, not hand-entered** (mirroring targets/SIMBAD): on
   ingest, an unrecognized `INSTRUME`/`TELESCOP` **auto-creates or suggests**
   equipment with that exact string as the **canonical alias**, and a **UUID
   identity is assigned on first ingestion**. Manual entry becomes the exception
   (renaming, grouping, adding human-friendly aliases). Feeds Q12's session
   identity (camera is a required grouping field).
3. **Merge path for duplicates** (existing + accidental): combine two equipment
   records, **union their aliases**, repoint references — reuse the **target-merge**
   pattern.

Makes equipment a first-class resolved identity like targets, anchored on the
FITS string.

---

## Q18 — Calibration matching tolerance (spec-040)

Grounds the calibration match/reuse model's tolerance policy.

- **Hard/soft criteria split** as modeled (hard = must-match dimensions; soft =
  confidence-weighted).
- **Exposure exact by default; scaled-dark opt-in** (lower confidence when a dark
  is scaled to a different exposure).
- **Dark age-penalty configurable in Settings** — **soft**: older masters →
  lower confidence, **no hard cutoff**.
- **Temperature tolerance ±2 °C default applied to COOLED cameras only**;
  **uncooled = temp-agnostic** (auto-widen — sensor temperature isn't set-point
  controlled).
- All tolerances **per-rule tunable**.

---

## Q19 — Lifecycle / cleanup (spec-048 / spec-033)

- **Intermediates → trash by default.**
- **Raw subs kept & protected by default.** **Archiving** is available as an
  **explicit user action AFTER the lifecycle gate**, **never auto-suggested**.
- An **explicit verified-complete lifecycle transition is required** before
  cleanup candidates are surfaced.

This preserves local-first custody (§I) and reviewable mutation (§II): raw source
material is never removed without an explicit, gated, user-initiated step.

---

## Q20 — Source-view generation strategy (spec-026 / spec-049)

v1 supports **`symlink`, `junction`, `copy`** (hardlink refused, deferred to
v1.x). The open decisions were the per-platform default and the Windows privilege
problem: **symlink** is free + live but on Windows requires Admin/Developer Mode;
**junction** needs no admin but is **directory-only** (can't link individual
subs); **copy** works everywhere but duplicates GBs and goes stale.

- **Linux/macOS → symlink** (free, live, no privilege).
- **Windows → detect capability: file symlink if Developer Mode/Admin is
  available, else fall back to `copy`** with a clear one-time disk-cost notice
  ("enable Windows Developer Mode for space-free views, or we copy — uses ~N GB").
  Prefer the live link, degrade gracefully — never silently.
- **User-configurable** strategy. **Persistent Settings warning** while Windows
  Developer Mode is off.
- **Junction** reserved for rare directory-level views, and must **make clear
  individual files are copied** (junction is dir-only).
- **Copy = universal safety net** (always works, with the disk-cost notice).
- **On-demand regeneration + a "stale" flag** when inventory changed since
  generation — **never auto-regenerate**. Auto-regen risks mutating a view while
  **PixInsight/WBPP is actively reading it** (corrupting an integration), and on
  a copy-strategy view would silently **re-copy gigabytes** on every added sub.
  The view is a prep artifact, regenerated right before processing anyway.
- Gen/removal/regen are **low-stakes plans → Q7 global queue apply-now default**;
  removed views are **never hard-deleted**.

---

## Q21 — Target recommendation / planning (spec-044 / spec-047; #678)

**Reframe: not an opaque score — a transparent, band-aware planner, and "plan"
is an ephemeral view, not a saved entity.** Spec-044 (Track B) already computes
the honest unit: per-band **moon-free usable hours tonight** (altitude × dark
window × Moon geometry, `apps/desktop/src/features/targets/planner-derive.ts`),
and spec-047 (Track A) owns the per-band Lorentzian
`min_sep(moonAge) = distance/(1+(moonAge/width)²)`. The decision is how those
surface as a "recommendation."

### Grading and factors

- **The grade IS moon-free usable hours per band** — already computed, the best
  actionable unit. Rank the list by a chosen column; "recommendation" = the top
  of that ranked list. No invented composite/0–100 score.
- **Visibility** is graded continuously (hours above the usable-altitude floor,
  which is already a live slider), never a hard "enough" threshold.
- **Season folds into visibility**: opposition proximity manifests as more usable
  dark-window hours tonight; keep a **best-date annotation** (`nextOpposition`)
  for project planning. Season is **not** a third co-equal score.

### Moon integration

- **Hard per-instant threshold integrated to hours** stays the v1 model
  (`planner-derive.ts:172` — `interfering = moonUp && separationDeg <
  minSeparationDeg(band, moonAge)`, summed per sample). This correctly handles
  the Moon crossing the avoidance radius or setting mid-night.
- **Mean and min are both rejected** as the separation aggregate — mean hides the
  Moon setting mid-night; min throws away good hours. Time-resolved integration
  is the honest answer; the three summary separation figures are display only.
- **Graded/soft falloff deferred** (no calibrated narrowband SNR-vs-separation
  curve exists; **Krisciunas & Schaefer 1991** is the future basis). If ever
  added, it's an explicit "Strict ⇄ Graded" toggle with a **linear** ramp and a
  relabel to "Moon-weighted hours" — never a silent exponential.

### Differentiated broadband Moon defaults (spec-047 param change)

- **L/R/G/B must NOT default to identical avoidance** — Rayleigh scattering
  (∝λ⁻⁴) makes moon sky-glow **blue-biased** (peaks ~470 nm far from the Moon):
  **B most affected, R least, G/L between.** Ship differentiated defaults
  **R < G ≲ L < B**, following the same wavelength trend the existing narrowband
  defaults already encode (OIII 110°/10d vs Ha/SII 60°/7d,
  `crates/domain/core/src/settings.rs:319-326`). The current flat `120°/14d` for
  L/R/G/B (`settings.rs:322-323`) is an oversight to correct. Values tunable.

### Band suitability (research-gated; seeded from `ObjectType`)

- **`band_suitability` = which acquisition bands are worth imaging on a target**,
  **seeded once from the existing `ObjectType`** (SIMBAD `otype`, already
  persisted — `crates/targeting/resolver/src/cache.rs:88`,
  `apps/desktop/src/bindings/index.ts:8149`): emission/SNR/PN → narrowband +
  broadband; galaxy/reflection/cluster/star → broadband only; "both"
  first-class. **No separate central mapping surface** — otype just seeds a
  per-target field.
- **Target-level hide vs cell-level n/a.** In a band-filtered view, a target with
  **no applicable band in the selection is hidden** (a broadband-only galaxy
  drops out of the narrowband view); within an **included** target, a
  non-applicable band renders **n/a** (M33 shows Ha, marks SII/OIII n/a). This
  refines "mark-not-hide": marking governs cells, hiding governs row membership.
- **Editable on every target** via a small suitability editor (opened from the
  detail pane / the row's suitability chip): explicit per-band toggles, the
  `ObjectType` default shown, and **reset-to-default**. The **"overridden" badge
  shows only when a target deviates** from its default. A seed dual-target list
  (M33, M31, …) ships the common overrides correct.
- **Ephemeral "Compute all bands (ignore suitability)"** view toggle — computes
  and ranks every band for every target regardless of suitability (the
  "what's best for Ha tonight, galaxies included" workflow). Resets each session.

### Presentation (retires spec-047 pills)

- **Per-band moon-free hour columns** + a **grade-colored `BandProfile`
  fingerprint glyph** (a micro bar-chart; bar height = hours, color = tier
  high≥3h / med 1.5–3h / low <1.5h) + **one summary verdict tier**. The profile
  shows **all applicable bands regardless of which columns are toggled** (it's
  the at-a-glance fingerprint; columns are the numeric drill-down).
- **Retire the seven per-band viability pills** — **spec-047 FR-009a /
  `FilterBadges`** is superseded by the hour columns + fingerprint; a single
  summary chip is fine, seven boolean pills are redundant.

### Aggregates (rotators)

- **Coverage (any / union)** = usable time if you shoot whatever's best each
  moment (default; matches the flexible rotator) and **Balanced (min)** = limited
  by the worst band (can you complete an even set) — both over the **selected
  bands**. **Mean is rejected** (maps to no real observing plan). The fingerprint
  keeps the aggregate transparent.

### Controls and surface

- **Bands selector = All / Narrowband / Broadband presets + per-band checkboxes +
  the Compute-all-bands toggle** — one consolidated control, **no palette
  vocabulary** (uncheck L for RGB-only). The context selector is folded in here,
  not separate buttons. Column visibility + preset **persist** as a UI
  preference; **ignore-suitability stays ephemeral**.
- **Sort** offers Coverage, Balanced, Max-altitude, **+ the currently selected
  bands** (dynamic).
- **Plan is an ephemeral view within Targets** — a **Manage ⇄ Plan** mode switch
  on `/targets` reusing the existing table (no separate page, no second target
  list; Targets stays primary nav). Components stay **presentation-agnostic** so
  a future dedicated Plan page / saved observing-plan entity is a cheap
  extraction, not a rewrite. **"Multiple plans open" = multiple planner windows**
  (each its own date/site/band context) via the existing multi-window support.
- **plan → project** = a **"Create project for this target"** action reusing the
  existing `create_project(canonical_target_id)` use case
  (`crates/app/projects/src/project_setup.rs:450,491`); the plan itself is
  advisory and unpersisted — the durable artifact is the project.
- **Selection continuity**: switching Manage⇄Plan keeps the selected target
  (Q13 id-based stable selection).
- **Adopt the skymath planning surface wholesale** (twilight `Night`/`NeverDark`/
  `AlwaysDark`, topocentric `lunar_separation`, `moon_illumination`, rise/set,
  88-constellation metadata — AstroPy-validated). **High-latitude honesty**:
  surface `NeverDark`/`AlwaysDark` as real states, never a fabricated window.
  **Constellation metadata** for grouping/filter/display.

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
| **Q15** durable audit coverage | **spec-030** campaign (+ audit model crate) |
| **Q16** missing-value semantics + detail-as-delta | **spec-030** campaign (data-model + shared renderer) |
| **Q17** equipment identity / aliases | **spec-006** equipment-model iterate |
| **Q18** calibration matching tolerance | **spec-040** calibration-matching iterate |
| **Q19** lifecycle / cleanup | **spec-048 / spec-033** lifecycle iterate |
| **Q20** source-view generation strategy | **spec-026 / spec-049** iterate |
| **Q21** target recommendation / planner | **spec-044 / spec-047** iterate (differentiated LRGB defaults, band suitability, hour columns + fingerprint, Coverage/Balanced, pill retirement, Plan mode) |

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
