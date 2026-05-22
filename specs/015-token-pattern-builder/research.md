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

## R4 — Token Value Sanitization and Path Safety

**Question**: How are OS-invalid and dangerous characters in metadata values handled?

**Decision** (updated 2026-05-22 to incorporate Unicode hardening, path traversal
protection, reserved name rejection, and path length caps — Ref: A1, A2, A3, A4):

The resolver applies the following sanitization steps to all resolved token
*values* (never to separators, which are whitelisted):

### Step 1 — Unicode Normalization (Ref: A1)

- Apply NFC normalization to all resolved token values.
- Strip the following Unicode character ranges:
  - C0 controls: U+0000–U+001F
  - C1 controls: U+0080–U+009F
  - Format characters: U+00AD (soft hyphen), U+200B–U+200F (zero-width spaces),
    U+2028–U+202F (line/paragraph separators, narrow no-break space),
    U+FEFF (BOM / zero-width no-break space)
  - Bidi overrides: U+202A–U+202E (LRE, RLE, PDF, LRO, RLO),
    U+2066–U+2069 (LRI, RLI, FSI, PDI)
- Apply Unicode confusables detection per Unicode Technical Standard #39
  (`confusables.txt` / Rust `unicode-security` crate). Confusable characters
  in resolved token values are flagged with error code `pattern.invalid.unicode`.

### Step 2 — OS Character Substitution

- Windows-reserved: `<`, `>`, `:`, `"`, `/`, `\`, `|`, `?`, `*` → replaced with `_`.
- Leading/trailing whitespace and dots → trimmed.
- Empty result after all sanitization → treated as missing (fallback applies).

### Step 3 — Path Traversal Rejection (Ref: A2)

After all sanitization, if any resolved token value equals `.` or `..`, or if
the assembled relative path contains a `..` segment, the resolver returns
error code `path.traversal`. This is checked after fallback substitution.

### Step 4 — Windows Reserved Device Name Rejection (Ref: A3)

If any path segment (case-insensitive, all platforms) matches a Windows
reserved device name — `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`,
`LPT1`–`LPT9` — with or without a file extension, the resolver returns error
code `path.reserved_name`.

### Step 5 — Path Length Caps (Ref: A4)

- Maximum segment length: ≤ 200 UTF-8 bytes per path segment.
- Maximum total relative path: ≤ 200 characters.
- If either limit is exceeded, the resolver returns `pattern.invalid` with
  `segmentLengthBytes` and `resolvedLength` in the details payload.

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

**Decision** (updated 2026-05-22 — Ref: R-Date-1):

The `{date}` token resolves to the **local date** in
`AcquisitionSession.observer_location.tz` at the frame's `exposure_start`
time, using the observing-night boundary rule from spec 023 (solar-noon to
solar-noon, i.e. `captured_on = date_of(exposure_start_utc − 12h)` in the
observer's local timezone).

When `observer_location` is unset (or the session is in `needs_review` with
no observer location), the resolver falls back to the UTC date of
`exposure_start`. This is a degraded result; the `missing_tokens` array will
include `date` and the token renders with the UTC fallback value.

Format is ISO-like `YYYY-MM-DD`. Locale-sensitive formats are explicitly
forbidden — audit consistency depends on a single representation. A
configurable date format is deferred to a future spec.

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
