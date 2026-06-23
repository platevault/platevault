# Task #102 — Session Review-State Analysis

**Question:** Is the per-session "review state" (Needs review / Confirmed) still
needed now that the Inbox move/confirm flow reviews light frames during
ingestion?

**Scope:** Analysis only. No product code changed. This doc cites file paths so
the product owner can verify each claim.

---

## 1. What session review-state currently does + where it is surfaced

### The data model

There are two distinct "review" concepts in the codebase; the Sessions page uses
the **lifecycle SessionState**, not the domain `ReviewState`:

- **`SessionState`** — the canonical six-state session lifecycle
  (`discovered | candidate | needs_review | confirmed | rejected | ignored`).
  Defined in `crates/contracts/core/src/lifecycle.rs:86-93`. This is what the
  Sessions UI calls "review state".
- **`domain_core::ReviewState`** (`Unreviewed | Confirmed | Corrected | Rejected
  | Ignored`) on `Reviewed<T>` — `crates/domain/core/src/lib.rs:110-132`. A
  generic wrapper type; **not** wired to the Sessions surface and not the subject
  of this analysis.

The session state lives in the `acquisition_session.state` / `calibration_session.state`
TEXT columns (see `crates/app/core/src/sessions.rs:56-58`,
`crates/persistence/db/src/repositories/inventory.rs`).

### Where it is surfaced (UI)

- **Sessions table "State" column** —
  `apps/desktop/src/features/sessions/SessionsTable.tsx:158-280`. Renders a
  full-label `Pill`; all `discovered | candidate | needs_review` collapse to
  "Needs review", everything else uses `sessionStateLabel` (`isNeedsReview`,
  `stateLabel`, lines 162-169).
- **SessionDetail "Review state" section + contextual actions** —
  `apps/desktop/src/features/sessions/SessionDetail.tsx:160-169` (the read-only
  Pill) and `:111-129` (the Confirm / Re-open / Reject buttons in the detail
  header).
- **Review filter** — the `reviewFilter` URL param and the `Review` Select on the
  top bar: `apps/desktop/src/features/sessions/SessionsPage.tsx:68-78, 173-216`.
  Action visibility (`confirmVisible` / `reopenVisible` / `rejectVisible`) is
  derived from the selected session's state at `SessionsPage.tsx:173-179`.
- **Review mutation** — `useSessionReview` dispatches `inventorySessionReview`
  with `nextState` confirmed / needs_review / rejected:
  `apps/desktop/src/features/sessions/store.ts:71-134`.

### Where it is enforced (backend)

- `crates/app/core/src/inventory.rs` `review_session` wraps the spec-002
  `lifecycle.transition` use case, with two guards: refuse if the owning root is
  disabled; refuse `mixed`-type sessions with `session.mixed_state`
  (`inventory.rs:14-19`, `115-`).
- Allowed transitions are governed by the lifecycle edge table
  (`crates/domain/core/tests/session_transitions.rs`,
  `crates/app/lifecycle/src/transition_use_case.rs`).

### Original product intent (spec 006)

`specs/006-inventory-library-lifecycle/spec.md`:

- **US1 (P1)** — "Move **Reviewed** Inbox Items To Inventory" (line 14): light
  frames are expected to arrive in inventory already carrying a review state.
- **US2 (P2)** — "Confirm Inventory Metadata" (lines 30-42): the user reviews and
  confirms inferred frame type / session data **before** it is used in a project.
  AC2: "Given an Inventory item is not confirmed, When it is offered for project
  selection, Then the UI indicates that review is still needed."
- **FR-004 / FR-010** (lines 64, 70): review state shown as plain structured
  data; a Cmd+K "Show ignored items" entry filters `reviewFilter=ignored`.

So the *designed* purpose of session review-state is a **gate before a session
feeds a project** — confirming that inferred (low-confidence) metadata is correct.

---

## 2. What the Inbox move / confirm flow does

The Inbox confirm path (`crates/app/core/src/inbox/confirm.rs`):

1. Validates the classification, runs the TOCTOU `content_signature` guard,
   enumerates classified files from evidence rows.
2. Resolves a destination per file via the active Naming & Structure pattern, or
   catalogues-in-place for organized sources (`confirm.rs:172-249`).
3. Builds a **reviewable Plan** in `ready_for_review` with one plan item per file
   (`confirm.rs:251-322`) and links it to the inbox item.

The "review" the user performs in the Inbox is therefore a review of the **move
Plan** (which files go where), reviewed and approved through the spec-002/spec-025
plan lifecycle — not a review of a session's metadata. On plan apply:

- For **calibration masters**, `crates/app/inbox/src/plan_listener.rs:170-205`
  inserts a `calibration_session` row directly at **`state = 'confirmed'`** (no
  needs-review step) plus a `calibration_fingerprint`.
- For **light frames**, **no session row is created at all** (see §3).

The classification step does carry confidence levels (frame-type inference), but
that confidence is resolved in the Inbox classify/confirm step, before the move —
not re-surfaced as a session review state afterward.

---

## 3. Overlap vs distinct value — the load-bearing finding

**There is no production code path that creates an `acquisition_session`
(light-frame session) row.** The only two non-test `INSERT INTO
acquisition_session` statements in the tree are both inside `#[cfg(test)]`
blocks:

- `crates/app/calibration/src/matching.rs:1005` (test block from line 913).
- `crates/app/core/src/search.rs:383` (test fixture).

`crates/app/core/src/plan_apply.rs` and `crates/app/core/src/inbox_plan.rs` —
the apply paths — never insert `acquisition_session`. Grep confirms the only
production session-creation site is the calibration master listener
(`plan_listener.rs`), and it writes **`calibration_session`** rows pre-stamped
`'confirmed'`.

Consequences:

| Concern | Reality today |
| --- | --- |
| Light-frame sessions in the Sessions ledger | None are produced by the app; the table is populated only by tests / fixtures. |
| Calibration sessions | Created already-`confirmed` by `plan_listener.rs`; they never pass through `needs_review`, so Confirm is a no-op for them in practice. |
| The Confirm / Re-open / Reject actions | Operate on session rows that, in production, either do not exist (lights) or are born confirmed (calibration). |
| The `reviewFilter` Select + Cmd+K "Show ignored" | Filter a ledger with no app-produced needs-review rows. |

So the **overlap is near-total but inverted from the premise**: it is not that
"inbox-move duplicates session review"; it is that the inbox/calibration ingest
path is now the *only* thing that produces sessions, and it produces them
**already confirmed**. The session-level review step is effectively **dead UI**
for the current ingest model. The genuine review happens once, on the move Plan,
in the Inbox.

### What would still have distinct value (if it were wired)

The one thing session review-state was designed to do that the inbox move does
**not** do is **US2 AC2: gate a session from feeding a project until its inferred
metadata is confirmed.** If light-frame sessions were created (e.g. by a future
plan-apply step) at `candidate` / `needs_review` with low-confidence inferred
target/filter, the Confirm gate before project selection would be real, distinct
value. That wiring does not exist today.

---

## 4. Recommendation

**Simplify, do not delete the model — gate the UI on a real ingest path first.**

Rationale:

1. **Keep the `SessionState` lifecycle enum and the lifecycle.transition
   machinery.** It is the canonical, contract-defined six-state model
   (`lifecycle.rs`), shared with calibration and other entities, and removing it
   is a contract-version change with broad blast radius. Calibration sessions are
   real and persisted; they legitimately have a `state`.

2. **Demote / hide the per-session "review" *workflow* on the Sessions page**
   (the Confirm / Re-open / Reject actions, the `reviewFilter` Select, the
   "Needs review" framing) until there is a production path that creates sessions
   in a non-confirmed state. As built, these controls act on rows that are either
   absent (lights) or born confirmed (calibration), so they are dead affordances
   that imply a workflow the app does not perform. Showing read-only state
   (Confirmed / the actual `state`) is fine and matches FR-004; offering Confirm
   when nothing is ever unconfirmed is misleading.

3. **Decide the light-frame session story explicitly.** Either:
   - (a) **Wire light-frame session creation** into plan-apply (the inbox move),
     created at `confirmed` if classification confidence is high, or
     `needs_review` when target/filter were inferred — which makes the Sessions
     review gate meaningful and realizes US1/US2 as specified; or
   - (b) **Accept that sessions are a calibration-only concept** for now and
     reframe the page accordingly (drop the light-frame-oriented review
     vocabulary).

The premise in the task ("inbox move now reviews lights during ingestion, so the
session review-state may be redundant") is **correct in spirit**: the meaningful
review is the inbox/plan review, and the session-level review is redundant *as
currently wired*. But the right move is to **stop surfacing a review workflow that
the backend never exercises**, not to rip out the lifecycle model that calibration
and the contracts depend on.

### Migration / impact notes

- Hiding the Sessions review actions + `reviewFilter` is a **frontend-only**
  change (`SessionsPage.tsx`, `SessionDetail.tsx`, `SessionsTable.tsx`,
  `store.ts`); no contract or DB change, fully reversible.
- The `inventorySessionReview` command, `review_session` use case, and the
  lifecycle edge table can **stay** — they cost nothing while idle and are needed
  the moment option (a) is chosen.
- The Cmd+K "Show ignored items" entry (FR-010) and the `reviewFilter=ignored`
  route would lose their only data source if review is hidden; confirm whether any
  ignored-session path produces rows before removing it.
- Removing the model outright would touch `crates/contracts/core/src/lifecycle.rs`
  (contract v2.0.0), `inventory.rs`, the transition use case, persistence
  repositories, and the spec-002 contracts — high blast radius, **not
  recommended**.

---

## 5. Open questions for the product owner

1. **Is light-frame inventory a v1 concept at all?** No production path creates
   `acquisition_session` rows. Was that intentionally deferred, or is wiring it
   into plan-apply still in scope?
2. **Should sessions be created `needs_review` when frame-type / target / filter
   were inferred** (low confidence), so the US2 "confirm before project use" gate
   becomes real — or is the inbox classify/confirm step considered sufficient
   review for v1?
3. **Should project selection actually be gated on session confirmation**
   (US2 AC2)? Nothing enforces that today; if it is dropped, session review-state
   loses its last distinct purpose.
4. **Calibration masters are auto-`confirmed` at apply time** — is a review/Reject
   path for masters wanted, or is auto-confirm the intended behavior?
5. If the answer to (1)–(3) is "defer", do we **hide the Sessions review
   vocabulary** (Confirm/Re-open/Reject + reviewFilter + "Needs review") now to
   avoid implying a workflow the app does not perform?
