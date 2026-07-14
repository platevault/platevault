## Journey 3 — Ingest → confirm (catalogue-in-place)

**Goal:** teach PlateVault about a folder of files that is *already*
organized the way the user wants, without moving a single byte.

**Preconditions:** a light-frames (or similar) root registered with
organization state **organized**, containing already-sorted files.

**Narrative flow:**

1. Files under an organized root are ingested and classified exactly like
   Journey 2 — the same needs-review gate applies if metadata is missing.
2. The deciding factor for move-vs-catalogue is the root's **organization
   state**, not the frame type and not the file's kind. Confirming an item
   that came from an organized root produces a plan whose actions are all
   "catalogue in place": the response reports a move count of zero and a
   catalogue count matching the file count, and no destination-root picker
   is ever shown (there's nothing to pick — the files are staying put).
3. Reviewing the plan (same overlay as Journey 2) shows catalogue actions
   instead of move actions, with the same destructive-destination control
   present (Archive vs System Trash) even though these actions don't need it.
4. Applying the plan writes the files' identity and metadata into the
   library's index. On disk, the file set and content hashes are unchanged
   byte-for-byte — the only thing that happened is the database now knows
   about these files, and they become visible in derived views like Sessions.

**Touch & validate:**

- Confirm an item from an organized root: response reports move count 0 and
  catalogue count = file count; no destination-root picker appears.
- Review overlay: actions read as catalogue-in-place; each item still shows
  its (unchanged) path; destructive-destination control is absent or
  visibly inert for pure catalogue plans.
- Apply: on-disk file set and hashes unchanged (scenario-level assertion);
  files become visible in Sessions; success signal + audit record as in
  Journey 2.
- Mixed library: one organized and one unorganized root in the same run —
  the same frame type routes to catalogue vs move purely by root state.

**Safety & trust notes:** "organized" is an explicit, per-root choice made in
the setup wizard (or when registering a source), and its consequence (move
vs. leave-in-place) is documented at the point of choice.

**Scenario files:**
`e2e-agentic-test/041-inbox-plan-surface/confirm-move-vs-catalogue/scenario.md`
(Part B), `e2e-agentic-test/journeys/grand-inbox-journey/scenario.md`.

**Known gaps:** none specific to catalogue-mode beyond those noted in
Journey 2 (shared confirm/plan pipeline).
