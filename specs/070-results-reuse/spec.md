# Feature Specification: Results, reuse, and completion

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `070-results-reuse`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Results, reuse, and completion (Priority: P1)

Discover outputs in a processing run (View)'s Results folder, and attach others through a visible secondary action. Keep honest lineage, and accept final and reusable products. Pick them as inputs when another run is created, and return an optional mosaic assembly as a group Result. Mark a run Complete independently of acceptance and cleanup, or delete a run that is no longer wanted.

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
- **RES-AC-11**: Given a mosaic run group whose four panel runs were prepared under `<output>/NGC7000 Cygnus/Cygnus Wall/Panel 1/` through `Panel 4/`. Each panel run wrote its stacks to its own `Cygnus Wall/Panel N Results/` folder, one Panel 2 stack carries a header naming Panel 3, and an assembled image was saved to `<output>/NGC7000 Cygnus/Cygnus Wall Results/`. When Results opens, then nothing is discovered inside any prepared `Panel N/` folder. Each panel run lists exactly the candidates in its own `Panel N Results/` folder, so the Panel 2 stack is listed under Panel 2 only. The group lists the assembled image as a group Result candidate of kind Assembled mosaic. Accepting it records it on the run group, the Project and the mosaic subject with lineage Unknown unless tool evidence names the panel products. Every panel run's status, membership and revision stay unchanged. (D-W38, D-W51, D-W73)
- **RES-AC-12**: Given a mosaic run group with no assembled image, when each panel run is marked Complete, then every panel run is Complete with its own panel Results. No group Result is required or shown as missing. (D-W38)
- **RES-AC-13**: Given an accepted Ha linear product from a run in Project A, the user creates a run in Project B and opens its input filters. Results then offers that product with its originating run and Project. The new run records it as a product input. The product stays with its run in Project A, and Project B's members and goal progress gain no sessions from it. (D-W4, D-W8)
- **RES-AC-14**: Given an accepted OIII linear product from a run on rig Esprit. When a run on rig RedCat in the same Project opens its input filters, then Results lists the product labeled with rig Esprit. Picking it adds a product input and no raw Esprit session. (D-W56)
- **RES-AC-15**: Given a run's Results folder gains a generated master dark. When the run's Results step opens, then the master is listed as a candidate, and the once-only Add to calibration library offer of CAL-FR-06 appears there. (D-W55)
- **RES-AC-16**: Given run NGC7000-HOO-Siril was prepared twice and both revisions wrote to NGC7000-HOO-Siril Results/, when Results opens, then every candidate lists the prepared revision it came from. (D-W67)
- **RES-AC-17**: Withdrawn (D-W72).
- **RES-AC-18**: Withdrawn (D-W72).
- **RES-AC-19**: Given a run at Prepare with prepared folders `<Run>/` and `<Run> (rev 2)/`, and a Results folder holding one accepted Result that no other run uses. When the user chooses Delete run, then the review lists the run record, both prepared folders and the Results folder, which is unticked. After the user confirms without ticking it, both prepared folders are in the OS Trash and the Results folder stays at its path. The run leaves the stage rail, its Result is no longer offered as an input, and no library frame or quality decision changes. Nothing is permanently deleted. Putting a prepared folder back from the OS Trash restores the files but not the run. (D-W72)
- **RES-AC-20**: Given an app-owned preparation affecting run A is Running, and an accepted Result of run B is an input to runs C and D. When the user requests Delete run on A and then on B, then both are refused and nothing is removed. A's refusal names the running preparation, and B's refusal names C and D. (D-W72)

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **RES-FR-01**: Results lists candidates from the run's Results folder (PREP-FR-07) with type, path, availability, and processing state where known. The folder is shared by every prepared revision of the run, and each discovered Result records the prepared revision it came from. Files still being written show Pending. Recognized intermediates are kept separate from candidates. They reach the OS Trash only through the Project's Done / Archive sheet (STO-FR-16), or with a deleted run's Results folder when the user ticks it (RES-FR-10). A file appearing in the folder is never treated as accepted or as proof that it came from the full selection. A generated calibration master found there is passed to CAL, which offers it once in this Results step (CAL-FR-06). (D-W4, D-W51, D-W55, D-W67, D-W70, D-W72)
- **RES-FR-02**: Attach Result is a visible secondary action on the Results step, shown beside the discovered list and not inside a menu. A file saved elsewhere can also be dropped there. The user chooses its kind (Final image, Linear integration, Channel product, Mosaic panel, Assembled mosaic for a run group, or another explicit reusable kind) and its run or run group. Attached products are labeled attached in the list. (D-W4, D-W38)
- **RES-FR-03**: Provenance distinguishes run association from actual input-frame lineage. Manual attach records a User-linked run association unless stronger tool evidence exists; absent input-frame evidence remains Unknown and never claims all planned frames were used. (D-W3)
- **RES-FR-04**: Accept one or more products after inspecting them. Inspection records each product's identity and SHA-256, and acceptance requires the current bytes to still match it (D19); a product changed since inspection is refused and needs inspecting again. Acceptance records each product's SHA-256 with its observation fingerprint. Accepted products appear on the run, Project, and Target, stay protected Keep, and are never listed by a run's Clean up (PREP-FR-14). Acceptance never fabricates provenance or claims every planned frame was used. (D-W3, D-W26)
- **RES-FR-05**: When a run is created, its input filters include Results beside sessions, and Add accepted results opens the same picker later. The picker offers accepted products from runs in any Project, grouped by originating Project and run, and shows kind, subject, rig, path, availability, and lineage. Products from runs on another rig may be inputs and show their rig; the one-rig rule applies to raw frames only (VSEL-FR-05). A run whose accepted Result is an input to another run cannot be deleted (RES-FR-10). Reuse across Projects goes only through this picker; a run never joins a second Project. The new run records product identities and originating runs and shows products apart from raw sessions, without counting integration twice. Product inputs add no members to the run's Project and no integration to its goals. The profile must support product inputs; mixed raw and product inputs need profile support, otherwise separate runs are used. Raw calibration controls never imply recalibration. Before a product is offered, added or prepared, PlateVault rehashes it against its acceptance digest; until that finishes it reads verifying and is not offered. Equal size and mtime never stand in for that check. A mismatch is reference drift: the product stays protected Keep with its acceptance and lineage as history, and requires review. It is not reused until the accepted bytes return or the current bytes are explicitly accepted. (D-W4, D-W8, D-W56, D-W72)
- **RES-FR-06**: Mark processing complete records completion even with no accepted Result. It removes nothing, does not infer that the external job stopped or succeeded, and offers Clean up as a separate action. (D-W26)
- **RES-FR-07**: Complete is blocked only by a Running app-owned preparation or storage mutation affecting this run, and the same operation blocks Delete run (RES-FR-10). Creating a new membership/preparation revision requires explicit Reopen, and the 'Add N new sessions' prompt of a Complete run asks for Reopen first (VSEL-FR-17). Reviewed cleanup, identity-preserving reference repair/remap, annotations and Result acceptance remain available on a Complete run without reopening. External launch/exit is never a completion or success signal. (D-W3, D-W34, D-W72)
- **RES-FR-08**: In a mosaic run group, each panel run discovers its Results in its own folder `<output>/<Project>/<Mosaic>/Panel N Results/` (PREP-FR-07), never inside a prepared `Panel N/` folder. A candidate belongs to the panel whose folder it was written to; PlateVault infers no panel from a header or file name. Each panel run accepts its own panel Results under RES-FR-01 through RES-FR-04. Assembly is optional and happens in the processing application; PlateVault does not assemble panels, and there is no whole-mosaic run. The group discovers group Result candidates of kind Assembled mosaic in `<output>/<Project>/<Mosaic> Results/`, and the user can also attach one to the group. A group Result belongs to the run group and appears on the Project and the mosaic subject. Its lineage to panel Results stays Unknown unless tool evidence names them. Accepting it follows RES-FR-04 and changes no panel run's status, membership or revision. A group with no group Result is not incomplete, and each panel run completes on its own under RES-FR-06. (D-W38, D-W51, D-W73)
- **RES-FR-09**: Withdrawn (D-W72).
- **RES-FR-10**: Delete run removes a run that is no longer wanted, at any stage. It is refused while an app-owned preparation or storage mutation affecting the run is Running, and while one of its accepted Results is an input to another run. The refusal names each blocking operation and each run that uses one of its Results. Before anything moves, the review shows what goes: the run record, each prepared folder, which goes to the OS Trash, and the Results folder, which goes to the OS Trash only when the user ticks it. PV-STO moves the files under STO-FR-17. Library frames, their quality decisions and other runs never change. After deletion the run leaves the stage rail and its accepted Results are no longer offered as inputs. Its members stop counting "in project" and "captured" unless they are still candidates (PRJ-FR-04). There is no in-app undo: Put back in the OS Trash restores files only, never the run. (D-W72)

### Owned interaction steps

- H1
- H2
- H3
- H3a
- I1
- Cross-flow: Completion with no Result
- Results surface
- Run group Results: per-panel Results folders and the optional group Result
- Delete run

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision. This feature adds:

- **Processing run (View)**: the UI name for a View; it belongs to exactly one Project and has one subject and one rig. This spec calls it a run. A run ends Complete, and Reopen returns it to the stage it was in. A run that is no longer wanted is deleted (RES-FR-10). (D-W72)
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
- Workflow decisions D-W3, D-W4, D-W8, D-W26, D-W34, D-W38, D-W51, D-W55, D-W56, D-W67 and D-W70 (settled 2026-10-06) and D-W72 and D-W73 (answered 2026-10-07) set the run terminology and Results-folder discovery with a visible Attach Result. They also set reuse through run input filters, including products from another rig, Clean up after Complete, and Delete run for a run that is no longer wanted. A Complete run asks for Reopen before 'Add N new sessions'. The once-only master offer sits in the Results step. The shared Results folder records each Result's revision, each panel run has its own Results folder, and a mosaic can return an optional group Result.
