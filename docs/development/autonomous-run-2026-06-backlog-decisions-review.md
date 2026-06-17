# Backlog & Judgment-Call Review (2026-06-17)

> Item-by-item assessment of the autonomous run's **integration backlog**
> (`autonomous-run-2026-06-master-plan.md`) and **decisions log**
> (`autonomous-run-2026-06-decisions.md`), now checked against the independent
> validation evidence (`autonomous-run-2026-06-validation-findings.md`).
> Legend: ✓ accurate/sound · ⚠ accurate but needs update/escalation · ✗ wrong/overstated.

## A. Integration backlog (master plan §"Integration backlog")

| # | Item | Verdict | Assessment |
|---|---|---|---|
| 1 | Live event-bus subscriber startup spawns | ✓ | **Confirmed exactly.** 005 plan_listener, 012 watcher, 024 workflow_run subscriber, 019 push-forwarder, 010 auto-advance are all implemented+tested but never `tokio::spawn`'d in `run_app`. Highest-leverage task: one wiring pass activates five features. |
| 2 | Cross-spec data plumbing (plan-item tagging, FK population) | ⚠ | Accurate but **understates 016**: the run frames protection as needing "source_id/category tagging," but validation shows the gate is a **phantom** — every real generator hardcodes `protection:"normal"`, so it is *dead*, not merely untagged. Same class: 007 fingerprints, 006 root_id, 023 target_id FK. |
| 3 | External astro-plan-catalogs repo unpublished | ⚠ | Accurate (downloads inert). **Add:** minisign signature verification is *not implemented* in-app (checksum only, 014 T1-4) — must be built/decided before the catalogs repo ships, or signed catalogs are accepted unverified. |
| 4 | Hardening (HMAC, trash crate, table reconc., vocab, slug, knip/madge) | ⚠ | Good list, but **mis-prioritized**: the 025 *path-resolution* + *confirm-inversion* + *bulk-cancel-audit* holes (T1-2) are safety-critical and rank **above** the HMAC upgrade. Also add: 028 still-broken token refs + no CI token guard (T1-10). |
| 5 | GUI/visual Playwright smoke — Windows-native | ✓→partly done | Partially executed in WSL (dev server + mocks) this pass — found **R-1** (index route crash, returning users) and **R-2** (calibration crash). Full real-backend pass still owed; runbook written (`windows-validation-runbook.md`). |

## B. Known cross-spec reconciliation items (master plan §"Known…")

| # | Item | Verdict | Assessment |
|---|---|---|---|
| 1 | Two project tables (002 `project` vs 008 `projects`) | ⚠ HIGH | **Confirmed real & live.** Auto-transitions/health write `projects.lifecycle`; user IPC writes legacy `project.state`. Both active → silent divergence. Data-integrity risk; reconcile to one table. |
| 2 | `destructive_destination` vocab drift (0014 vs 0019: archive/os_trash vs trash/archive/none) | ⚠ open | Real schema-vocabulary inconsistency across migrations; pick one canonical vocab before any code writes the non-canonical value. 005 still silently coerces to `archive`. |
| 3 | Catalog slug mismatch (013 enum vs 014 strings) | ⚠ | **Confirmed** (013 verifier): 013 closed enum `common/openngc/abell_pn` vs 014 string `opengc`… Mismatched slugs parse to `Unknown` and are **silently skipped**. Resolve before equivalence seeding. |
| 4 | inbox confirm doesn't set session `root_id` | ✓ | **Confirmed** (006). Real sessions will be ungrouped/orphaned in the inventory ledger. |
| 5 | plan_listener startup spawn | ✓ | Confirmed; subset of backlog A-1. |
| 6 | External catalog blocker | ✓ | Duplicate of backlog A-3. |
| 7 | HMAC approval token + trash crate (025) | ✓ | Accurate. Re-rank below the 025 T1-2 safety holes. |
| 8 | `project.unarchived` named event not emitted | ✓ | **Confirmed** (009): archived→ready uses the generic transition event. Minor. |

## C. Decisions (D-NNN) — process / judgment calls

| ID | Verdict | Assessment |
|---|---|---|
| D-001 token policy (tokenize colors/shadows, not intrinsic px) | ⚠ | Policy is reasonable, but enforcement is incomplete: 028 validation found `--alm-radius` (undefined) refs + raw-hex `var()` fallbacks the guard misses, and `check-tokens.sh` is not in CI. |
| D-002 theme contracts via allowlist (no `theme/` dir) | ✓ | Follows the working pattern; low risk. |
| D-003 T031 audit-not-refactor | ✓ | Sound; avoids regressing approved v4 UI. |
| D-004 manual checkbox ticks (022) | ✓ (noted) | Fine for an audit pass; the broader lesson is that checkboxes drifted everywhere — treat the validation doc as the ledger. |
| D-005 T053 visual check deferred as "no-op" | ⚠ | Now **superseded**: visual smoke run this pass. The "token edits are visual no-ops" claim is mostly true but 028 found a broken `--alm-radius` (renders radius 0) — not a pure no-op. |
| D-006 STOP+escalate on 020 (pre-v4 spec) | ✓ | Correct call — material deviation, correctly escalated rather than auto-implemented. |
| D-007 020 rescoped to desktop features (user-approved) | ⚠ | Sound rescope (URL state, back/forward, multi-window). **But** its URL-search work is the *proximate cause of R-1*: the index route renders `SessionsPage`, which now requires the `/shell/sessions` search context it doesn't have. The rescope is fine; the index-route integration is broken. |
| D-008 020 implementation specifics (route id vs path; layout-route nuance) | ⚠ | The documented `useSearch({from:'/shell/sessions'})` nuance is exactly what breaks at the index route (R-1). The pattern is correct *within* `/sessions`; it must not be invoked from the index match. |
| D-009 stale CommandPalette routes (`/review`,`/plans`,`/audit`) noted, not fixed | ⚠ | Still valid follow-up — dead nav targets. Cheap to fix; align palette PAGES with real routes. |
| D-010 020 runtime smoke deferred (sandbox) | ✓→done | Superseded: smoke executed this pass; found R-1. |
| D-013 installed opt-in speckit layers | ✓ | Reasonable; user ran the install. |
| D-014 ground-truth recon before resuming | ✓ | Correct methodology; vindicated (checkbox counts were unreliable). |

## D. Divergences (DV-NNN) — spec-vs-reality

| ID | Verdict | Assessment |
|---|---|---|
| DV-001 022 primitive vocabulary superseded by v4 | ✓ | Correct. Recommend `speckit-iterate` on 022 (or fold into 032) so the spec names the real `ui/`+`components/` set. |
| DV-006 020 describes a pre-v4 app | ✓ | Accurate; resolved via D-007 rescope. |
| DV-011 016 US2–US4 blocked on unbuilt foundation | ⚠ | The **caution was right**; the run's later "016 US2–US4 done" claim **overstated it** — validation shows the gating is a phantom (T1-1). Reconcile: 016 US2–US4 are *coded* but *inert on real plans*. |
| DV-012 024 partially buildable; depends on 012 + projects | ✓ | Accurate; validation confirms the workflow_run subscriber + on-disk-notes gaps. |
| DV-015 017 plan-review UI deferred to consumer specs | ✓ | Sound (v4 has no Plans page). Backend is solid; the one real backend gap is the approve-time mtime/size snapshot (R-FS-1), not the UI. |

## E. Net recommendation

The run's self-assessment is **largely honest and the backlog is real** — but three
things need correction before this is "done":
1. **Two items are more severe than disclosed**: 016 protection (phantom, not
   "tagging") and 025 path-resolution/confirm-inversion (safety, not "HMAC polish").
2. **Two undisclosed runtime crashes** (R-1 index route, R-2 calibration) block a
   returning-user launch — neither is in the backlog because the run never booted
   the GUI.
3. **The 020 rescope (D-007/D-008), though sound, introduced R-1** at the index
   route — fix the index route to redirect to `/sessions`.

Suggested first PR after this review: **R-1 + R-2 fix** (tiny, unblocks the app) →
**`run_app` subscriber wiring** (backlog A-1, activates 5 features) → **025 T1-2
safety fix** (before any real apply) → **016 plan-item tagging** (revives protection).
