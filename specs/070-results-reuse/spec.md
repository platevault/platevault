# Feature Specification: Results, reuse, and completion

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `070-results-reuse`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Results, reuse, and completion (Priority: P1)

Discover or attach outputs, keep honest lineage, accept final and reusable products, use them as inputs to another View, and mark an attempt complete independently of acceptance and cleanup.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **RES-AC-01**: Given View/output holds registered intermediates, a stacked file, and a file still being written, when Results opens, then the intermediates are listed separately, the stack is an unaccepted candidate, and the growing file is Pending.
- **RES-AC-02**: Given a file outside the output location, when it is manually attached to a chosen View as a Linear integration, then its View association is User-linked and its actual input-frame lineage remains Unknown unless stronger evidence exists.
- **RES-AC-03**: Given a product is accepted, then its lineage is not upgraded to Tool-recorded and nothing claims that all 208 planned frames were used.
- **RES-AC-04**: Given accepted Ha and OIII linear products, when the user runs Create View from results 'NGC7000 HOO combine', then the View lists two product inputs with their originating Views and adds no raw session integration.
- **RES-AC-05**: Given a profile without product-input support, then preparing the product View is refused and named unsupported, with no silent conversion.
- **RES-AC-06**: Given no accepted Result, when the user marks processing complete, then the View is Complete, no file is removed, and cleanup has not started.
- **RES-AC-07**: Given an app-owned preparation or storage mutation affecting this View is Running, when Mark Complete is requested, then it is blocked with that operation; otherwise Complete needs neither a Result nor evidence that an external job stopped. An unrelated View's operation does not block it.
- **RES-AC-08**: Given a Complete View, when creating a new membership or preparation revision is requested, then explicit Reopen is required. Reviewed cleanup, identity-preserving archive/filing reference repair, verified remap, notes and Result acceptance do not reopen the View or change membership.
- **RES-AC-09**: Given an accepted product replaced in place with its size and mtime preserved, when its product View is reopened or the result picker opens, then its rehash differs from its acceptance digest. The product reads drifted and requires review. Its acceptance and lineage remain as history for the earlier bytes, and the picker does not offer it for reuse. Restoring the accepted bytes makes it available again with no new acceptance.
- **RES-AC-10**: Given three inspected products, when one is replaced in place with its size and mtime preserved before Accept Result, then that product's acceptance is refused with the change named. The other two are accepted, and the changed product can be accepted after it is inspected again.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **RES-FR-01**: Results lists candidates from the recorded output location with type, path, availability, and processing state where known. Files still being written show Pending. Recognized intermediates are kept separate from candidates. A file appearing in the folder is never treated as accepted or as proof that it came from the full selection.
- **RES-FR-02**: Attach Result, or drop a file saved elsewhere, then choose its kind (Final image, Linear integration, Channel product, Mosaic panel, or another explicit reusable kind) and its View.
- **RES-FR-03**: Provenance distinguishes View association from actual input-frame lineage. Manual attach records a User-linked View association unless stronger tool evidence exists; absent input-frame evidence remains Unknown and never claims all planned frames were used.
- **RES-FR-04**: Accept one or more products after inspecting them. Inspection records each product's identity and SHA-256, and acceptance requires the current bytes to still match it (D19); a product changed since inspection is refused and needs inspecting again. Acceptance records each product's SHA-256 with its observation fingerprint. Accepted products appear on the View, Project, and Target and default to Keep in cleanup. Acceptance never fabricates provenance or claims every planned frame was used.
- **RES-FR-05**: Create View from results, or Add accepted results: a picker grouped by originating View shows kind, path, availability, and lineage. The new View records product identities and originating Views and shows products apart from raw sessions, without counting integration twice. The profile must support product inputs; mixed raw and product inputs need profile support, otherwise separate Views are used. Raw calibration controls never imply recalibration. Before a product is offered, added or prepared, PlateVault rehashes it against its acceptance digest; until that finishes it reads verifying and is not offered. Equal size and mtime never stand in for that check. A mismatch is reference drift: the product stays protected Keep with its acceptance and lineage as history, and requires review. It is not reused until the accepted bytes return or the current bytes are explicitly accepted.
- **RES-FR-06**: Mark processing complete records completion even with no accepted Result. It removes nothing, does not infer that the external job stopped or succeeded, and offers Clean up View as a separate action.
- **RES-FR-07**: Complete is blocked only by a Running app-owned preparation or storage mutation affecting this View. Creating a new membership/preparation revision requires explicit Reopen. Reviewed cleanup, identity-preserving reference repair/remap, annotations and Result acceptance remain available without reopening. External launch/exit is never a completion or success signal.

### Owned interaction steps

- H1
- H2
- H3
- H3a
- I1
- Cross-flow: Completion with no Result
- Results surface

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-RES-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-RES-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-RES-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D04 and D09 define qualified product-input support and explicit reopening/revision semantics. Complete without a Result remains supported and never infers external processing success.
- Root decision D19 binds Result acceptance and reuse to re-verified content.
