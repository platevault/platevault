# Coverage Matrix: Feature Area → Test Layer

**Feature**: 037-e2e-integration-testing

This feature exposes **no new product contracts** — it consumes the existing
language-neutral command contracts unchanged. This file is the auditable coverage
mapping required by FR-019 / SC-001. Final per-test names are filled in by
`/speckit.tasks`; this fixes the required coverage.

Legend: **L1** = real-backend integration test required; **L2** = appears in a
Layer-2 smoke journey; **—** = covered implicitly via screen-load smoke.

| # | Feature area | L1 | L2 | Notes |
|---|---|:--:|:--:|---|
| 1 | First-run source setup | ✅ | ✅ | setup wizard → root persisted |
| 2 | Native filesystem controls | ✅ | — | path validation/side effects via L1 |
| 3 | Inbox mixed-folder split | ✅ | ✅ | classify + split |
| 4 | Inventory / data lifecycle state | ✅ | ✅ | ledger + transitions |
| 5 | Calibration matching & masters | ✅ | ✅ | suggest + assign |
| 6 | Sessions | ✅ | ✅ | list/merge/split/transition |
| 7 | Projects: create/onboard/edit | ✅ | ✅ | CRUD round-trip |
| 8 | Project lifecycle model | ✅ | ✅ | blocked/ready transitions |
| 9 | Project manifests & notes | ✅ | ✅ | manifest + note persistence |
| 10 | Processing tool launch | ✅ | smoke | wiring only; **no real launch** |
| 11 | Processing artifact observation | ✅ | ✅ | artifact detection |
| 12 | Target lookup from FITS OBJECT | ✅ | ✅ | OBJECT → canonical |
| 13 | Target identity, history, notes | ✅ | ✅ | identity + notes |
| 14 | SIMBAD target resolution | ✅ | ✅ | **HTTP-boundary mocked** (wiremock) |
| 15 | Token pattern builder | ✅ | ✅ | parse/resolve tokens |
| 16 | Source protection defaults | ✅ | — | protection asserted via L1 + plans |
| 17 | Cleanup & archive review plans | ✅ | ✅ | plan generation/review |
| 18 | Filesystem plan application | ✅ | ✅ | **mutation + audit record assert** |
| 19 | Settings / configuration model | ✅ | ✅ | persist + reload |
| 20 | Bottom log viewer | ✅ | ✅ | log stream render |
| 21 | Router & URL state | n/a | ✅ | **all top-level screens load** (FR-007) |
| 22 | Audit event model (cross-cutting) | ✅ | via #18 | bus + stale propagation |

**Required round-trip proof (FR-008)**: areas #1, #7, #12/#14 each round-trip a
UI value through the real backend.

**Required mutation+audit proof (FR-009)**: area #18 (filesystem plan
application).

**Explicit exclusions (not implemented-feature backend areas)**: Catalog index
licensing (014), Developer contract diagnostics (021, dev-only), Design/UI specs
(022, 026–032) — covered implicitly by #21 screen-load smoke; remediation specs
033/036 fold into the areas above. Any area later found implemented but unmapped
MUST be added here or reported as a gap (FR-002).
