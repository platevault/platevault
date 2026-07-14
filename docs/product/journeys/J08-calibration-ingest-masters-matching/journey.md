## Journey 8 — Calibration: ingest cal frames → masters → matching

**Goal:** get calibration master frames (darks/flats/bias) into the library
as individually tracked items, and match them against acquisition sessions
that need calibration.

**Preconditions:** a calibration root registered; master and light frames
available to ingest.

**Narrative flow:**

1. Master calibration files ingest through the same Inbox pipeline as lights
   (Journey 2): a folder containing several master files (e.g. two darks, a
   flat, a bias) classifies as separate individual items, not one folder-level
   aggregate — each carries its own type and fingerprint (gain, temperature,
   binning, filter where relevant).
2. Confirming and applying registers each master into the calibration store.
   The **Calibration** page shows one row per master file, with
   kind-conditional fingerprint columns (a dark's temperature/gain columns
   don't apply to a bias, and show as a dash by design, not a bug) — master
   *light* frames never appear here.
3. On a project (or the Calibration page's matching view), selecting a
   master surfaces ranked candidate sessions to calibrate, each showing real
   context (target, filter, night, frame count) rather than opaque ids.
   Sessions whose fingerprint doesn't match a hard rule (e.g. wrong gain) are
   shown with a mismatch indicator rather than silently hidden.
4. Assigning a master to a session is advisory and confirmable — cancelling
   fires no backend call; confirming records the assignment and its usage
   count.
5. An "Offset tolerance" setting (Settings → Calibration) controls whether
   sessions with a different sensor offset can match; it persists across
   restarts and immediately changes what the matching engine considers a
   clean candidate.

**Touch & validate:**

- List: one row per master; kind-conditional fingerprint columns (bias hides
  temp/exposure by design); sort headers; search; group-by; the kind filter
  appears once a second kind exists; a search with no matches reads as a
  filter miss, not as an empty library.
- Master detail: fingerprint values render real data or an explicit
  unresolved state (a metadata-less master must never show plausible zeros
  like "Gain 0 · 0 KB"); age/created date visible as a value, not only as an
  aging warning; "Used by" and "Compatible" lists open and navigate.
- Master actions: "Use in project" and "Replace master" each perform their
  documented action with an answer-back, or are absent — a rendered button
  with no behavior fails the run; "Show in File Explorer" opens the
  master's own folder.
- Matching, unassigned master: ranked candidate sessions visible *before*
  any assignment, each with target/filter/night/frame-count context,
  confidence, and mismatch indicators (mismatches shown, not hidden).
- Assign: advisory confirm (cancel fires nothing); confirming records the
  assignment, updates usage counts, and answers back; un-assign reverses it.
- Tolerances: change temperature/aging/offset requirements in Settings →
  Calibration Matching and validate the candidate set changes immediately
  and persists across restart.
- Cross-surface: the same master's usage visible from the session/project
  side (round-trip navigation).

**Safety & trust notes:** matching never auto-applies a calibration
assignment — every match is proposed with confidence and must be confirmed;
hard-rule mismatches are surfaced, not hidden, so a user doesn't accidentally
calibrate with the wrong dark.

**Scenario files:**
`e2e-agentic-test/040-calibration-masters/masters-detection-individual-items/scenario.md`,
`e2e-agentic-test/007-calibration-matching/match-suggest-assign-tolerances/scenario.md`,
`e2e-agentic-test/journeys/calibration-journey-ingest-to-match/scenario.md`
(canonical end-to-end version of Journey 8 — also the data source that
Journeys 4's `043-sessions-parity` and Journey 9's matching-adjacent checks
build on).

**Known gaps:** none beyond the general "Calibration page shows only
dark/flat/bias columns; `dark_flat`/`bad_pixel_map` kinds never surface in
v1" — this is by design, not a defect.
