# Feature Specification: i18n Infrastructure & Unified Error-Code Translation

**Feature Branch**: `046-i18n-error-codes`

**Created**: 2026-06-22

**Status**: Implemented

**Input**: User description: "Internationalization (i18n) infrastructure and unified error-code translation — a type-safe message catalog (multilingual-ready, not user-exposed) plus precise internal error codes shared Rust↔TS that translate to friendly user messages."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Every user-facing string comes from one catalog (Priority: P1)

All text the user reads — labels, buttons, placeholders, tooltips, empty-states,
toasts, validation and error messages — is sourced from a single message catalog
keyed by stable identifiers, instead of literals scattered across components. The
app reads English today; the catalog is structured so additional languages can be
added later without touching component code. No language switcher is shown to the
user in this release.

**Why this priority**: This is the foundation. Without a single catalog there is
no consistent vocabulary, no place to fix wording once, and no path to
multilingual. It also removes the recurring defect where developer status text
leaks into the UI, because strings become reviewed catalog entries.

**Independent Test**: Pick any screen; confirm every visible string resolves
through the catalog (no hardcoded literal in the component), the app renders
identically to today in English, and a missing key is caught at build time rather
than shipping a blank or raw key.

**Acceptance Scenarios**:

1. **Given** a component that renders a label, **When** the label text must
   change, **Then** it is edited in exactly one catalog entry and updates
   everywhere that key is used.
2. **Given** a developer references a catalog key that does not exist, **When**
   the project is built, **Then** the build fails with a clear error (the key set
   is type-checked), not a silent blank or raw-key render at runtime.
3. **Given** the app runs with no network and no locale configured, **When** any
   screen loads, **Then** all text renders in English with no async loading delay
   or flash of missing text.

---

### User Story 2 — Errors show a friendly message; codes stay internal (Priority: P1)

When a backend operation fails, the user sees a clear, plain-language message
appropriate to what went wrong. The precise machine-readable error code is never
shown to the user but is available internally for logs and diagnostics. The set of
error codes is defined once and shared between the backend and the frontend so the
two can never drift.

**Why this priority**: Error recovery is a core trust moment, and today the app
exposes raw codes (`(db.error)`), generic "Something went wrong" text, and
duplicates the code→message mapping in ~6 places that can disagree. A single
shared registry + one translation point fixes correctness and consistency at once.

**Independent Test**: Trigger a known failure (e.g. duplicate project name); the
user sees the friendly message for that code, the raw code does not appear in the
UI, the code IS present in the diagnostic log, and removing/renaming a code in the
backend surfaces as a compile-time gap in the frontend translation map.

**Acceptance Scenarios**:

1. **Given** a backend command returns a known error code, **When** the failure is
   surfaced, **Then** the user sees the friendly catalog message for that code and
   never the raw code or a backend exception string.
2. **Given** a backend command returns an unknown/unmapped error code, **When**
   the failure is surfaced, **Then** the user sees a safe generic fallback message
   AND the unknown code is logged for diagnosis.
3. **Given** a new error code is added in the backend, **When** the frontend is
   type-checked, **Then** the absence of a translation for that code is detectable
   before release (no silent fallback in normal development).

---

### User Story 3 — Consistent vocabulary across the app (Priority: P2)

The same concept is named the same way everywhere. Destructive-action verbs
(`archive` / `trash`), the "My Targets / favourites" concept, section titles, and
punctuation (ellipsis) follow one canonical vocabulary defined in the catalog.

**Why this priority**: Consistency is a usability heuristic and a trust signal for
expert users, but it depends on US1 (the catalog) existing first, so it is P2.

**Independent Test**: Audit the catalog for synonyms of the same concept; confirm
one canonical key per concept and that previously-divergent screens now read the
same term.

**Acceptance Scenarios**:

1. **Given** a destructive action appears on two screens, **When** both are
   inspected, **Then** they use the same canonical verb from the catalog.
2. **Given** the catalog is reviewed, **When** searching for a concept (e.g. the
   favourites view), **Then** exactly one user-facing term is defined and used.

---

### Edge Cases

- A catalog key is referenced but has no entry → build-time failure (never a
  runtime blank or raw key).
- A backend error code has no frontend translation → safe generic fallback shown +
  the unmapped code logged.
- A message needs a runtime value (count, name, path) → interpolation is supported
  and type-checked; values are never concatenated ad hoc.
- A backend error carries `details` (e.g. mismatched dimensions) → the translation
  layer may use them for a richer message without exposing the raw structure.
- Pluralization/number/date formatting differences across future locales → the
  catalog mechanism must not preclude them (not implemented now, not blocked).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST source every user-facing string from a single
  message catalog keyed by stable identifiers; components MUST NOT contain
  user-facing string literals.
- **FR-002**: Catalog keys MUST be type-checked so that referencing a non-existent
  key fails the build rather than rendering blank or raw at runtime.
- **FR-003**: The catalog MUST support runtime value interpolation (e.g. counts,
  names) in a type-checked way.
- **FR-004**: The app MUST render English with the locale hard-pinned; it MUST NOT
  expose a user-facing language switcher in this release.
- **FR-005**: The catalog structure MUST allow adding further languages later
  without modifying component code (multilingual-ready).
- **FR-006**: The set of backend error codes MUST be defined as an explicit,
  enumerated registry (single source of truth) rather than ad-hoc string literals
  at each error site.
- **FR-007**: The error-code registry MUST be shared between backend and frontend
  as a language-neutral contract so the two cannot drift; the frontend MUST consume
  the generated/exported code set.
- **FR-008**: The frontend MUST translate each error code to a friendly catalog
  message at a single translation point; the per-component code→message mappers
  MUST be removed.
- **FR-009**: The system MUST NOT display raw error codes or raw backend exception
  strings to the user.
- **FR-010**: The system MUST expose error codes internally (logs/diagnostics) for
  every surfaced error, including unmapped ones.
- **FR-011**: When an error code has no translation, the system MUST show a safe
  generic fallback message AND record the unmapped code.
- **FR-012**: No user-facing string may contain developer status markers (e.g.
  STUB, MOCK, "pending", "coming soon", issue references); the catalog is the
  review gate enforcing this.
- **FR-013**: Each user-facing concept MUST have exactly one canonical term in the
  catalog (no synonyms for the same concept).
- **FR-014**: The migration MUST preserve current English wording (post-cleanup)
  unless a wording change is explicitly part of the consistency pass (US3).

### Key Entities *(include if feature involves data)*

- **Message catalog**: the set of stable keys → human text (English now), with
  interpolation placeholders. The single source of user-facing wording.
- **Error-code registry**: the enumerated set of machine-readable failure codes
  (e.g. `project.name_taken`, `match.observer_location_missing`), defined in the
  backend and exported as a language-neutral contract to the frontend. Carries an
  optional structured `details` payload per the existing error shape.
- **Error translation map**: the single frontend mapping from error code →
  catalog key → friendly message, with a generic fallback.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of user-facing strings on every screen resolve through the
  catalog; a repository scan finds zero hardcoded user-facing literals in
  components (excluding tests/fixtures).
- **SC-002**: Zero developer status markers (STUB/MOCK/pending/coming soon/issue
  refs) appear in any user-facing string or tooltip.
- **SC-003**: Referencing a missing catalog key or an untranslated error code is
  caught before release (build/type check), in 100% of cases — no runtime blanks
  or raw keys.
- **SC-004**: The number of distinct code→message mapping sites drops from ~6 to
  exactly 1; backend and frontend share one error-code set with zero drift.
- **SC-005**: Users never see a raw error code or backend exception string; every
  surfaced error shows a plain-language message, and every error (including
  unmapped) is recorded internally with its code.
- **SC-006**: Each audited concept (destructive verbs, favourites view, section
  titles, ellipsis) has exactly one canonical user-facing term.
- **SC-007**: Adding a second language later requires no changes to component code
  — only new catalog entries (demonstrated by a throwaway proof, not shipped).

## Assumptions

- The desktop app is offline/local-first; the catalog mechanism must work with no
  network and no async resource fetch (no loading flash).
- English is the only shipped language in this release; multilingual is enabled
  structurally but not exposed.
- The existing UI→core error shape (`{ code, message, details? }`) remains; this
  feature formalizes `code` into a registry and changes how `message` is derived
  for display, not the transport.
- The backend already exports types to the frontend via the existing
  contract-generation toolchain; the error-code registry rides that same path.
- The copy-cleanup pass that removed developer-status leakage from current strings
  has already landed; this feature relocates those clean strings into the catalog
  rather than re-authoring them.
- Scope is UI + contract plumbing only: error semantics, backend control flow, and
  product-domain behavior are unchanged.

## Out of Scope

- Shipping additional languages or actual translations.
- A user-facing locale picker / language switcher.
- Changing error semantics, backend control flow, or when errors are raised.
- Reworking logging/telemetry infrastructure beyond ensuring codes are recorded.

## Implementation Notes

Documents how the implementation realises the requirements above. Added
post-implementation; does not change scope.

- **Catalog & plurals.** Messages live in `apps/desktop/messages/en.json`
  (Paraglide / `@inlang/plugin-message-format`), compiled to type-safe
  `m.<key>()` accessors. Plurals use inlang **variant** messages
  (`declarations`/`selectors`/`match` → `Intl.PluralRules`), **not** inline ICU
  (`{count, plural, …}`), which this plugin does not support — inline ICU
  syntax mis-parses into a bogus variable rather than a plural selector.
  `@inlang/plugin-icu1` is the separate plugin that would add inline-ICU
  support; it is not installed and not used. The `alm/no-js-plural` rule blocks
  JS-side suffix pluralization.
- **The lint gate is the enforcing mechanism for SC-001/SC-002**, not
  speckit-verify. `alm/no-user-string` runs at ERROR on `src/**` and in CI
  (`pnpm --filter @astro-plan/desktop run lint:eslint`). It catches: JSX text,
  user-facing attributes, toast args, object-label keys
  (`label`/`title`/`desc`/`description`/`heading`/`subtitle`/`body`/…),
  attribute & child ternaries, `??`/`||` literal fallbacks, template literals,
  and — via limited single-function data-flow — user strings **assigned to a
  variable and then rendered** (gated by a machine-token/prose heuristic to
  avoid flagging enum values). This closed the original SC-001 false-green
  where CI never actually ran the frontend lint step. `eslint-plugin-jsx-a11y`
  was promoted from `warn` to `error` (all resulting violations remediated) as
  part of the same lint-gate hardening.
- **Render-time thunks (locale re-read).** Module-level config objects whose
  labels call `m.*()` evaluate once at import, freezing the locale. Such configs
  expose labels as render-time thunks (`label: () => m.key()`, called
  `x.label()`); shared option-array configs (`FilterOption[]`, `RadioOption[]`)
  use render-time **factories** instead of changing the shared type. This is
  structural multilingual-readiness only — the app is English-pinned (no
  switcher; see Out of Scope), so there is no runtime behaviour change today.
- **Known eager exceptions.** Zod schema messages (`features/projects/schemas.ts`)
  and the zustand guided-tour store (`features/guided/store.ts`) remain eager —
  they are constructed at module load and would need a different mechanism
  (custom error map / store restructure), deferred to the multilingual work.
- **Wireframe-stub strings** in the project-create wizard (`StepCalibration`,
  `StepReview`) are mock illustrative data, not real copy; tracked for
  replacement + de-mocking in issue #327.
