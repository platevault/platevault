# Feature Specification: Results, reuse, and completion

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `070-results-reuse`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Results, reuse, and completion (Priority: P1)

Discover outputs in a processing run (View)'s Results folder, and attach others through a visible secondary action. Keep honest lineage, and accept final and reusable products. Pick them as inputs when another run is created, and return an optional mosaic assembly as a group Result. Mark a run complete independently of acceptance and cleanup.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **RES-AC-01**: Given the run's Results folder holds registered intermediates, a stacked file, and a file still being written, when Results opens, then the intermediates are listed separately, the stack is an unaccepted candidate, and the growing file is Pending. (D-W4, D-W51)
- **RES-AC-02**: Given a file outside the Results folder, the user attaches it to a chosen run as a Linear integration with the Attach Result action shown on the Results step. It is then listed beside the discovered candidates and labeled attached. Its run association is User-linked, and its actual input-frame lineage remains Unknown unless stronger evidence exists. (D-W4)
- **RES-AC-03**: Given a product is accepted, then its lineage is not upgraded to Tool-recorded and nothing claims that all 208 planned frames were used.
- **RES-AC-04**: Given accepted Ha and OIII linear products from two runs, the user creates the run 'NGC7000 HOO combine' in the Project and picks both under Results in its input filters. The run then lists two product inputs with their originating runs and adds no raw session integration. (D-W4)
- **RES-AC-05**: Given a profile without product-input support, then preparing the product run is refused and named unsupported, with no silent conversion. (D-W3)
- **RES-AC-06**: Given no accepted Result, when the user marks processing complete, then the run is Complete, no file is removed, and cleanup has not started. (D-W3)
- **RES-AC-07**: Given an app-owned preparation or storage mutation affecting this run is Running, when Mark Complete is requested, then it is blocked with that operation; otherwise Complete needs neither a Result nor evidence that an external job stopped. An unrelated run's operation does not block it. (D-W3)
- **RES-AC-08**: Given a Complete run, when creating a new membership or preparation revision is requested, including through its 'Add N new sessions' prompt (VSEL-FR-17), then explicit Reopen is required. Reviewed cleanup, identity-preserving archive reference repair, verified remap, notes and Result acceptance do not reopen the run or change membership. (D-W3, D-W11, D-W34)
- **RES-AC-09**: Given an accepted product replaced in place with its size and mtime preserved, when its product run is reopened or the result picker opens, then its rehash differs from its acceptance digest. The product reads drifted and requires review. Its acceptance and lineage remain as history for the earlier bytes, and the picker does not offer it for reuse. Restoring the accepted bytes makes it available again with no new acceptance. (D-W3)
- **RES-AC-10**: Given three inspected products, when one is replaced in place with its size and mtime preserved before Accept Result, then that product's acceptance is refused with the change named. The other two are accepted, and the changed product can be accepted after it is inspected again.
- **RES-AC-11**: Given a mosaic run group whose four panel runs were prepared under `<output>/NGC7000 Cygnus/Cygnus Wall/Panel 1/` through `Panel 4/`, with outputs under the sibling `<output>/NGC7000 Cygnus/Cygnus Wall Results/`. When Results opens, then nothing is discovered inside `Cygnus Wall/`. Each panel run lists only the candidates under `Cygnus Wall Results/Panel N/` for its own panel. An assembled image saved directly in `Cygnus Wall Results/` is a group Result candidate, not a panel candidate. Accepting it records it on the run group, the Project and the mosaic subject with lineage Unknown unless tool evidence names the panel products, and leaves every panel run's status, membership and revision unchanged. (D-W38, D-W51)
- **RES-AC-12**: Given a mosaic run group with no assembled image, when each panel run is marked Complete, then every panel run is Complete with its own panel Results. No group Result is required or shown as missing. (D-W38)
- **RES-AC-13**: Given an accepted Ha linear product from a run in Project A, the user creates a run in Project B and opens its input filters. Results then offers that product with its originating run and Project. The new run records it as a product input. The product stays with its run in Project A, and Project B's members and goal progress gain no sessions from it. (D-W4, D-W8)
- **RES-AC-14**: Given an accepted OIII linear product from a run on rig Esprit. When a run on rig RedCat in the same Project opens its input filters, then Results lists the product labeled with rig Esprit. Picking it adds a product input and no raw Esprit session. (D-W56)
- **RES-AC-15**: Given a run's Results folder gains a generated master dark. When the run's Results step opens, then the master is listed as a candidate, and the once-only Add to calibration library offer of CAL-FR-06 appears there. (D-W55)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **RES-FR-01**: Results lists candidates from the run's Results folder (PREP-FR-07) with type, path, availability, and processing state where known. Files still being written show Pending. Recognized intermediates are kept separate from candidates. A file appearing in the folder is never treated as accepted or as proof that it came from the full selection. A generated calibration master found there is passed to CAL, which offers it once in this Results step (CAL-FR-06). (D-W4, D-W51, D-W55)
- **RES-FR-02**: Attach Result is a visible secondary action on the Results step, shown beside the discovered list and not inside a menu. A file saved elsewhere can also be dropped there. The user chooses its kind (Final image, Linear integration, Channel product, Mosaic panel, Assembled mosaic for a run group, or another explicit reusable kind) and its run or run group. Attached products are labeled attached in the list. (D-W4, D-W38)
- **RES-FR-03**: Provenance distinguishes run association from actual input-frame lineage. Manual attach records a User-linked run association unless stronger tool evidence exists; absent input-frame evidence remains Unknown and never claims all planned frames were used. (D-W3)
- **RES-FR-04**: Accept one or more products after inspecting them. Inspection records each product's identity and SHA-256, and acceptance requires the current bytes to still match it (D19); a product changed since inspection is refused and needs inspecting again. Acceptance records each product's SHA-256 with its observation fingerprint. Accepted products appear on the run, Project, and Target, stay protected Keep, and are never listed by a run's Clean up (PREP-FR-14). Acceptance never fabricates provenance or claims every planned frame was used. (D-W3, D-W26)
- **RES-FR-05**: When a run is created, its input filters include Results beside sessions, and Add accepted results opens the same picker later. The picker offers accepted products from runs in any Project, grouped by originating Project and run, and shows kind, subject, rig, path, availability, and lineage. Products from runs on another rig may be inputs and show their rig; the one-rig rule applies to raw frames only (VSEL-FR-05). Reuse across Projects goes only through this picker; a run never joins a second Project. The new run records product identities and originating runs and shows products apart from raw sessions, without counting integration twice. Product inputs add no members to the run's Project and no integration to its goals. The profile must support product inputs; mixed raw and product inputs need profile support, otherwise separate runs are used. Raw calibration controls never imply recalibration. Before a product is offered, added or prepared, PlateVault rehashes it against its acceptance digest; until that finishes it reads verifying and is not offered. Equal size and mtime never stand in for that check. A mismatch is reference drift: the product stays protected Keep with its acceptance and lineage as history, and requires review. It is not reused until the accepted bytes return or the current bytes are explicitly accepted. (D-W4, D-W8, D-W56)
- **RES-FR-06**: Mark processing complete records completion even with no accepted Result. It removes nothing, does not infer that the external job stopped or succeeded, and offers Clean up as a separate action. (D-W26)
- **RES-FR-07**: Complete is blocked only by a Running app-owned preparation or storage mutation affecting this run. Creating a new membership/preparation revision requires explicit Reopen, and the 'Add N new sessions' prompt of a Complete run asks for Reopen first (VSEL-FR-17). Reviewed cleanup, identity-preserving reference repair/remap, annotations and Result acceptance remain available without reopening. External launch/exit is never a completion or success signal. (D-W3, D-W34)
- **RES-FR-08**: In a mosaic run group, Results are discovered in the group's sibling folder `<output>/<Project>/<Mosaic> Results/` (PREP-FR-07), never inside the prepared `<Mosaic>/` folder. A candidate under a `Panel N/` folder there, or one whose tool evidence names a panel, is listed for that panel run, which accepts its own panel Results under RES-FR-01 through RES-FR-04. Assembly is optional and happens in the processing application; PlateVault does not assemble panels, and there is no whole-mosaic run. Any other image found in `<Mosaic> Results/`, or attached to the group, is a group Result candidate of kind Assembled mosaic. A group Result belongs to the run group and appears on the Project and the mosaic subject. Its lineage to panel Results stays Unknown unless tool evidence names them. Accepting it follows RES-FR-04 and changes no panel run's status, membership or revision. A group with no group Result is not incomplete, and each panel run completes on its own under RES-FR-06. (D-W38, D-W51)

### Owned interaction steps

- H1
- H2
- H3
- H3a
- I1
- Cross-flow: Completion with no Result
- Results surface
- Run group Results: panel discovery and the optional group Result

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision. This feature adds:

- **Processing run (View)**: the UI name for a View; it belongs to exactly one Project and has one subject and one rig. This spec calls it a run.
- **Run group**: the panel runs created for one mosaic subject, one per panel, sharing one setup.
- **Group Result**: an Assembled mosaic product owned by a run group rather than by one panel run.

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
- Workflow decisions D-W3, D-W4, D-W8, D-W26, D-W34, D-W38, D-W51, D-W55 and D-W56 (settled 2026-10-06) set the run terminology and Results-folder discovery with a visible Attach Result. They also set reuse through run input filters, including products from another rig, and Clean up after Complete. A Complete run asks for Reopen before 'Add N new sessions', the once-only master offer sits in the Results step, and a mosaic can return an optional group Result.
