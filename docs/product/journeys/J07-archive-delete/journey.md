## Journey 7 — Archive → (delete from archive)

**Goal:** move a finished project's files out of the active library into an
archive location, as a deliberate, plan-gated, reviewable step, and — later
— permanently remove archived files if desired.

**Preconditions:** a project in a `completed` lifecycle state.

**Narrative flow:**

1. Clicking "Archive" on a completed project is **refused** unless a
   filesystem plan for the archive already exists and has been applied —
   the app never silently flips a project's lifecycle state.
2. Generating the archive plan, reviewing it (protected items must be
   acknowledged, same as cleanup), approving, and applying moves the
   project's files into an app-managed archive folder
   (`.astro-plan-archive/<planId>/`) and only *then* does the project's
   lifecycle actually flip to `archived`. The project's Edit pane becomes
   read-only at that point.
3. The **Archive** page lists archived projects with their real audit
   history (not placeholder rows) — but scope is deliberately narrower than
   you might expect (see Known gaps: no Masters/Targets tabs, no Sessions
   tab, no working Restore button yet).
4. From the Archive page, the user can **Send to trash** (moves to the OS
   Recycle Bin) or **Delete permanently**, which requires typing the literal
   word `DELETE` to confirm — a half-typed or lowercase confirmation leaves
   the button disabled. "Reveal" uses the platform-native label ("Show in
   File Explorer" on Windows) and is disabled when there's nothing to reveal.

**Touch & validate:**

- Entry: the Archive action's location and its refusal behavior pre-plan
  (refusal must name the missing precondition, not just no-op).
- Plan: generate on a project with real files (items list source **and**
  destination per item) and on one without (empty plan explained, Approve
  disabled with reason); protected-item acknowledgement gate.
- Apply: progress, success signal, lifecycle flips to `archived` only after
  apply; project Edit pane becomes read-only with a stated reason.
- Archive page: archived project listed; detail shows information beyond the
  row (audit history with outcome + actor per entry, originating plan
  reference); reveal opens the archive folder.
- Send to trash: confirmation, progress, post-state (row state change,
  audit row); files present in OS recycle bin.
- Permanent delete: gate requires the literal word `DELETE` (wrong case /
  partial input leaves the button disabled); cancel path; with
  "Block permanent delete" ON in Cleanup settings, the action must be
  unavailable and say why.

**Safety & trust notes:** archiving is the one and only legitimate way a
project's lifecycle reaches `archived` — every other edge into that state
requires the same plan-gate; permanent deletion requires a literal typed
word, not just a click-through confirm.

**Scenario files:**
`e2e-agentic-test/017-cleanup-archive-review-plans/archive-lifecycle/scenario.md`,
`e2e-agentic-test/journeys/full-project-lifecycle/scenario.md` (Phase F).

**Known gaps (2026-07-04) — read before testing or demoing this journey:**
- **There is no shipped UI button that generates an archive plan yet.**
  Archive-plan generation is currently only reachable by invoking the
  backend command directly; the "Archive" action in the UI only refuses the
  transition until a plan exists. This is the single most important gap in
  this journey.
- **Restore (un-archive) is deferred by design (decision D15).** It would be
  a filesystem mutation (moving files back), so it needs its own reviewable
  plan generator, which doesn't exist yet — the Restore control ships
  hidden/disabled rather than pretending to work.
- **No Master/Target archival concept exists** (decision D7) — the Archive
  page only covers Projects (plus Sessions/Plans-as-rows were considered and
  rejected). No Sessions tab either (decision D14) — sessions don't have a
  lifecycle to archive since Journey 4's derived-inventory redesign.
- Archive destination and layout polish (single-column page, richer list,
  native reveal labels) requires **PR #415** (open) for parts of the page;
  the core plan-gated archive/trash/delete flow works without it.
- Archive plans move files to an app-managed folder rather than the
  originally-specced token-pattern destination (documented deviation, PR
  #401 / decision D24) so that trash/delete can key off the plan id.
