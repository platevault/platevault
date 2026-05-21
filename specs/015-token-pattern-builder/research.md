# Research: Token Pattern Builder

**Feature**: `015-token-pattern-builder`

## R1 — Token Vocabulary Scope for v1

**Question**: Which metadata tokens are user-selectable in v1?

**Options considered**:

- A. Minimal: only `target`, `filter`, `date`, `frame_type`.
- B. Mockup vocabulary: A + `camera`, `exposure`, `gain`, `binning`, `set_temp`.
- C. Mockup + telescope + project + workflow.

**Decision**: **Option B**. Matches `availableTokens` in
`apps/desktop/src/data/mock.ts` and the FITS fields already extracted by
`crates/metadata/fits/`. Telescope, project, and workflow tokens are deferred
because their source-of-truth fields are not finalized.

**Tradeoffs**: Option C would unify pattern vocabulary with project/workflow
metadata but locks in field shapes that are still under research; Option A
underserves narrowband workflows where filter/exposure-driven layouts matter.

---

## R2 — Separator Vocabulary

**Question**: Which literal separators are permitted between tokens?

**Decision**: `/`, `-`, `_`, and space (matches `TokenPatternBuilder` default
prop). `/` is the only path-segment introducer; the others are intra-segment
literals.

**Tradeoffs considered**: Allowing `.` was considered for filename-style
patterns but rejected — patterns are folder structures in v1, and `.` invites
accidental hidden directories on POSIX. Backslash is excluded because the
canonical pattern uses forward slashes and platform mapping is the planner's
responsibility.

---

## R3 — Fallback for Missing Token Values

**Question**: When a metadata field is absent, what does the resolver emit?

**Decision**: Per-token configurable fallback, with documented defaults:

| Token        | Default fallback   |
|--------------|--------------------|
| `target`     | `unclassified`     |
| `filter`     | `nofilter`         |
| `date`       | `undated`          |
| `frame_type` | `unknown`          |
| `camera`     | `unknown-camera`   |
| `exposure`   | `unknown-exposure` |
| `gain`       | `unknown-gain`     |
| `binning`    | `1x1`              |
| `set_temp`   | `untempered`       |

Every missing-token substitution is reported in the resolver response's
`missing_tokens` array so callers can decide whether to require user
confirmation before applying a plan that depends on a fallback.

**Tradeoffs considered**: Hard-failing on missing fields would force users to
confirm every legacy import; emitting an empty string would create
double-separator paths that violate OS rules. Configurable fallbacks
preserve forward progress while keeping the audit trail honest.

---

## R4 — Token Value Escape Rules

**Question**: How are OS-invalid characters in metadata values handled?

**Decision**: The resolver applies a conservative substitution table on
token *values only* (never on separators, which are whitelisted):

- Windows-reserved: `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*` → replaced with `_`.
- Control characters (U+0000–U+001F) → replaced with `_`.
- Leading/trailing whitespace and dots → trimmed.
- Empty result after sanitization → treated as missing (fallback applies).

Sanitization is applied **before** the value enters the path. The validator's
post-resolution OS-path check is a defense-in-depth assert that should never
trip if sanitization is correct.

---

## R5 — Pattern Structural Validation

**Question**: What structural rules does the validator enforce?

**Decision**:

- **Error: empty pattern** (`pattern.empty`). No tokens, no separators.
- **Error: unknown token name** (`token.unknown`). Token name not in registry.
- **Warning: consecutive separators**. Allowed but flagged (e.g. `//` collapses to one segment delimiter on resolve; user should know).
- **Warning: leading separator**. Allowed; the planner anchors the result under each source root.
- **Warning: no `/` at all**. Allowed (produces a single segment) but flagged.
- **No required tokens.** Users with single-target libraries may legitimately omit `{target}`.

**Tradeoffs considered**: Requiring `{target}` would surface a clearer error
for misconfigured patterns, but breaks legitimate single-target archive
layouts. Warnings preserve user agency.

---

## R6 — Date Token Format

**Question**: How is the `date` token rendered?

**Decision**: ISO-like `YYYY-MM-DD`, derived from the FITS `DATE-OBS` header
in UTC. Locale-sensitive formats are explicitly forbidden — audit consistency
depends on a single representation.

**Future**: A configurable date format may be added once we have an explicit
research decision for time-zone handling around midnight observation
sessions; out of scope here.

---

## R7 — Unknown Token Handling on Persisted Patterns

**Question**: What happens when a stored pattern references a token name no
longer in the registry?

**Decision**: The resolver fails with `token.unknown` and reports the
offending token in the error payload. The UI surfaces this as a banner on
the Naming & Structure settings surface and blocks Inbox confirmation against
that pattern until the user edits or replaces the unknown token.

**Tradeoffs considered**: Silently dropping unknown tokens would preserve
flow but corrupt destinations; treating an unknown token as a missing value
would also be silent. An explicit error keeps the audit log honest.

---

## R8 — Pattern Editing Affordances

**Question**: What edit operations does v1 support?

**Decision**: Append (via "+ Token" / "+ Separator" menus) and remove
(per-chip X). Reorder is deferred; users can rebuild a pattern in a few
clicks, and dnd ergonomics are out of v1 scope.
