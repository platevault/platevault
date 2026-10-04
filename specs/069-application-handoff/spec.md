# Feature Specification: Application preparation: profiles, input modes, locations, prepare and open

**Feature Branch**: `063-clean-rebuild-contract`

**Spec ID**: `069-application-handoff`

**Created**: 2026-10-03

**Status**: Draft; product defaults and all human-approval gate waivers follow the root autonomous objective. Requirements analysis, implementation and verification remain required.

**Input**: Clean rebuild with selective reuse of verified code and the agreed PlateVault product flow.

## User Scenarios & Testing

### User Story 1 - Application preparation: profiles, input modes, locations, prepare and open (Priority: P1)

Turn a reviewed membership into a verified Linked, Direct-source, Copy, or Clone handoff for a maintained profile or a generic Open in..., with a per-View output location. The app never runs processing.

**Why this priority**: This feature owns the workflow steps listed below without imposing unrelated product features.

**Independent Test**: Exercise the acceptance scenarios through the running product with isolated inputs. Existing baseline code does not prove the redesigned behavior.

**Acceptance Scenarios**:

- **PREP-AC-01**: Given a reviewed 208-light selection and a Siril profile with recorded read-only input capability evidence, Linked View mode, and parent Work/Processing, when Review preparation opens, then it shows Work/Processing/NGC7000-HOO-Siril, its output subfolder, 208 entries, the link type and its limits, the footprint, and free space.
- **PREP-AC-02**: Given the suggested View folder already exists with unrelated content, then preparation asks for another name or location and the existing folder is unchanged.
- **PREP-AC-03**: Given a qualified read-only profile and linking unsupported at the destination, when alternatives are reviewed, then only supported Clone, Copy or exact Direct-source modes are offered with footprints. Nothing is applied until the user chooses; no silent copy occurs.
- **PREP-AC-04**: Given a qualified read-only profile consumes a whole folder containing six excluded frames, when Direct-source handoff is reviewed, then the folder handoff is refused and supported isolated alternatives are offered.
- **PREP-AC-05**: Given the reviewed 56-light `28 Sep Ha copy check` View and three inputs become unreadable during Prepare, then the outcome is Partial, listing 53 prepared and 3 blocked; verified Open is not offered; the sources are untouched.
- **PREP-AC-06**: Given a catalog filter correction that differs from the header, when isolated patched Copy or supported Clone is chosen, then only the isolated entries carry the patched value and original hashes remain identical. Linked symlinks/hardlinks and Direct-source originals are never patched; review names the effective source value. A Direct-source View changes mode only after approval.
- **PREP-AC-07**: Given an unsupported profile configuration, when review opens, then the unsupported capability is named; generic Open in does not claim verified-profile support.
- **PREP-AC-08**: Given a requested symlink cannot be created but hardlinks are eligible, when alternatives are reviewed, then hardlink use requires explicit approval and verifies volume, permissions and filesystem. A failed eligibility check leaves the item blocked rather than copying silently.
- **PREP-AC-09**: Given the last selected parent is unavailable, when a View location is reviewed, then another parent must be chosen explicitly and no different drive is substituted.
- **PREP-AC-10**: Given a verified preparation and a missing or failing executable, when Open is attempted, then Choose application or Reveal View is offered and all decisions persist. Closing an external application never marks Complete or claims processing success.
- **PREP-AC-11**: Given a profile has unknown or write-prone input behavior, when Linked or Direct-source mode is reviewed, then the input-write risk is named, those modes are refused, and isolated Copy or supported Clone is offered without changing mode automatically.
- **PREP-AC-12**: Given accepted membership refresh while an external app uses an existing preparation, when reprepare is reviewed, then a new revision is proposed and old prepared entries remain unchanged unless their separate STO cleanup is approved.
- **PREP-AC-13**: Given a draft selection with default inclusions, explicit exclusions and unresolved sources, when Review preparation opens, then exact identities and membership need confirmation; unresolved sources remain blocked and quality decisions are not changed.
- **PREP-AC-14**: Given a confirmed Copy preparation, when one source's bytes change after its snapshot is hashed and before terminal success, with size and mtime preserved, then that item is blocked with source drift named. The outcome is Partial, no verified Open is offered and PlateVault does not write to the changed source. After the reviewed bytes are restored, Retry prepares the item only when its source matches a fresh snapshot and its copy re-reads to match.

### Edge Cases

The [root contract](../063-clean-rebuild-contract/spec.md) governs file custody, uncertainty, exact membership, failed writes, and independent lifecycle decisions. Each acceptance scenario tests observable outcomes; no mock acknowledgment counts as terminal success.

## Requirements

### Functional Requirements

- **PREP-FR-01**: The required profile targets are PixInsight/WBPP, Siril, and SETI Astro Suite Pro. Decision D04 requires verified input, layout, configuration, product-input capabilities and recognized output evidence before any verified-profile claim. The user configures or locates the executable. Unsupported configuration is named. No profile invents an API or claims that renaming files overrides headers.
- **PREP-FR-02**: Generic Open in... takes a configured executable and launch arguments, without claiming a verified profile.
- **PREP-FR-03**: Corrected metadata: the review shows the catalog value next to the value the application will read. Options: supported application configuration, isolated patched copies or clones, accepting the source value, or excluding the input. A Direct-source View changes mode only with approval. Originals and links are never patched. A correction is never claimed as delivered while the tool still reads the original value.
- **PREP-FR-04**: Input modes: Linked View is suggested for verified read-only profiles; Direct source, Copy, and supported Clone are alternatives. Review shows each mode's semantics, concrete link type, limits and storage. Changing symlink to hardlink needs an explicit choice. Hardlink eligibility checks volume, permissions and filesystem. Unknown or write-prone input behavior refuses Linked/Direct-source use and offers isolated Copy or Clone under root decision D04.
- **PREP-FR-05**: Direct source passes exact original paths through supported configuration or input lists and creates no links or copies. A folder handoff is allowed only when the application consumes exactly the reviewed membership; otherwise it is refused with alternatives.
- **PREP-FR-06**: View location: suggest a unique subfolder under the last chosen parent; on first use there is no assumed root. An existing directory is never reused or cleared. An unavailable parent prompts a new choice and is never silently replaced by another drive.
- **PREP-FR-07**: The output location defaults to View/output/. An override parent gets a View-specific subfolder. The location is recorded for discovery and cleanup.
- **PREP-FR-08**: Review preparation shows the immutable selection, profile, source references, calibration choices, exceptions, excluded count, paths, mode, operation count, footprint, and free space. Saved criteria are shown apart from browsing filters and confirmed. Source presence, collisions, and permissions are checked. Any subset that cannot use the mode is listed with paths and footprint, and per-item mode changes need approval. Unknown or omitted inputs never count as prepared.
- **PREP-FR-09**: Prepare View shows Running and progress, cancel or pause where safe, and per-item failures. It ends in exactly one of Prepared, Partial, Failed, Canceled, or Paused. Success requires the prepared entries to match the recorded selection and each source's SHA-256 snapshot taken during Prepare. Copy and Clone destinations are durably written and re-read against that snapshot; an isolated patched entry may differ only by its reviewed header change. Linked and Direct-source entries must resolve to the snapshotted source identity. Immediately before terminal success, each source's current identity and digest must still match its snapshot. Drift, a destination mismatch or an unreadable source blocks the item. So does an observation fingerprint differing from the confirmed membership, or a snapshot differing from a decided input's reviewed digest. A blocked item never counts as prepared. Partial lists succeeded and blocked items. Sources are untouched.
- **PREP-FR-10**: After verified success, the user gets Open in the chosen app, Reveal View, and preparation details. Launching is not processing completion, and closing the application never marks the View Complete. A missing executable offers Choose application or Reveal View. A launch failure keeps the View and its decisions.
- **PREP-FR-11**: A revised selection needs a new review. A previous preparation can be kept for comparison. Removing replaced entries follows STO cleanup rules.

### Owned interaction steps

- E3
- E4
- F1
- F2
- F3
- F4
- F5
- F6
- Cross-flow: Unsupported input mode
- Cross-flow: Direct-source exclusion unsupported by tool
- Cross-flow: Partial preparation

### Key Entities

Use the [root vocabulary](../063-clean-rebuild-contract/spec.md#key-entities). Feature-specific evidence and decisions retain their input identity, scope, and revision.

## Success Criteria

### Measurable Outcomes

- **PV-PREP-SC-01**: Every acceptance scenario produces its stated outcome and refusal behavior.
- **PV-PREP-SC-02**: Every owned interaction step has a requirement and independently observable acceptance evidence.
- **PV-PREP-SC-03**: Original inputs remain unchanged except through separately reviewed and approved filesystem operations.

## Assumptions

- [Product flow](../../docs/reviews/2026-10-03-product-flow-and-journeys.md) supplies the confirmed interactions and illustrative worked example.
- This feature is independently specified; dependencies on other feature contracts are resolved in planning.
- Conservative defaults and all human-approval gate waivers follow the root autonomous objective and decision register. Tests, requirements analysis, independent review and delivery evidence remain mandatory.

## Decisions before feature approval

- Root decisions D02, D04, D09, D13 and D15 govern exact inclusion confirmation, profile qualification, input-write refusal, reviewed calibration/preparation revisions and isolated header corrections. No unsupported tool capability is claimed without evidence.
