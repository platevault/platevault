/**
 * Slice A: S1 Home, S12 Sessions, S13 Import. Owned by the slice A screen
 * agent. Holds Home's Show closed filter (D-W48), the Import draft (source,
 * Copy or Move, destinations, the frame types typed for Unclassified holds,
 * the Target chosen per incoming session (P-IMP2), the captures whose
 * framings import as one session (D-W107), the centre and rotation limits
 * the import splits by when review overrides Settings', the calibration
 * folders added to the batch and the calibration choices made in review
 * (LIB-FR-23)) and the
 * last started Import or Add folder operation, and registers the "import"
 * operation handler (D-W11, D-W24).
 */
import type { CalibrationSource, FramingMargins, ImageType, ImportSourceId, LocationId, OperationId, PinKind, TargetId } from "@/domain/types"
import { importHandler } from "@/features/v5/a-home/import-run"
import type { SliceDefinition } from "./index"

export type ImportSourceChoice = { kind: "saved"; id: ImportSourceId } | { kind: "folder"; path: string }

/** A calibration choice made in import review for one kind of an incoming session; applied once its frames are imported. */
export type ImportCalibrationChoice = { state: "confirm" } | { state: "none" } | { state: "pick"; source: CalibrationSource }

export interface ImportDraft {
  source: ImportSourceChoice | null
  /** Saved sources only: skip files already imported from this source (STO-IMP-FR-01). */
  newOnly: boolean
  mode: "copy" | "move"
  /** Destinations; null picks the first writable location of the role. */
  capturesLocationId: LocationId | null
  calibrationLocationId: LocationId | null
  /** Frame type typed for an Unclassified hold, by source path; typing releases it (D-W24). */
  typed: Record<string, ImageType>
  /** Target chosen per incoming light session, by its grouping key; null is Unclassified, absent takes the pointing's Target (P-IMP2). */
  targets: Record<string, TargetId | null>
  /** Capture keys whose framings import as one session (Merge framings); removing one re-splits it (D-W107). */
  merged: string[]
  /** Folders added to the batch ("Add calibration files…"), read beside the source. */
  extraFolders: string[]
  /** Calibration chosen in review, by incoming session key and kind; a kind not listed is left to matching (LIB-FR-23). */
  calibration: Record<string, Partial<Record<PinKind, ImportCalibrationChoice>>>
  /** The centre and rotation limits this import splits its captures by, set in review; null takes Settings' (D-W107, the owner's answer of 2026-10-20). */
  limits: FramingMargins | null
}

export function emptyImportDraft(): ImportDraft {
  return { source: null, newOnly: true, mode: "copy", capturesLocationId: null, calibrationLocationId: null, typed: {}, targets: {}, merged: [], extraFolders: [], calibration: {}, limits: null }
}

/** The draft with the review's per-file and per-session choices cleared: a new source, or an import that started, begins from matching again. */
export function withoutReviewChoices(draft: ImportDraft): ImportDraft {
  const { typed, targets, merged, extraFolders, calibration, limits } = emptyImportDraft()
  return { ...draft, typed, targets, merged, extraFolders, calibration, limits }
}

export interface AState {
  /** Home: Closed and Archived Projects are hidden behind "Show closed" (D-W48). */
  showClosed: boolean
  importDraft: ImportDraft
  /** The Import page shows this operation's progress and outcome until the user starts another. */
  lastImport: { kind: "import"; operationId: OperationId } | null
}

export const aSlice: SliceDefinition<AState> = {
  id: "a",
  version: 6,
  initial: () => ({ showClosed: false, importDraft: emptyImportDraft(), lastImport: null }),
  operations: [importHandler],
}
