/**
 * Slice A: S1 Home, S12 Sessions, S13 Import. Owned by the slice A screen
 * agent. Holds Home's Show done filter (D-W48), the Import draft (source,
 * Copy or Move, destinations and the frame types typed for Unclassified
 * holds) and the last started Import or Add folder operation, and registers
 * the "import" operation handler (D-W11, D-W24).
 */
import type { ImageType, ImportSourceId, LocationId, OperationId } from "@/domain/types"
import { importHandler } from "@/features/v5/a-home/import-run"
import type { SliceDefinition } from "./index"

export type ImportSourceChoice = { kind: "saved"; id: ImportSourceId } | { kind: "folder"; path: string }

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
}

export function emptyImportDraft(): ImportDraft {
  return { source: null, newOnly: true, mode: "copy", capturesLocationId: null, calibrationLocationId: null, typed: {} }
}

export interface AState {
  /** Home: Done Projects are hidden behind "Show done" (D-W48). */
  showDone: boolean
  importDraft: ImportDraft
  /** The Import sheet shows this operation's progress and outcome until the user starts another. */
  lastImport: { kind: "import" | "index"; operationId: OperationId } | null
}

export const aSlice: SliceDefinition<AState> = {
  id: "a",
  version: 2,
  initial: () => ({ showDone: false, importDraft: emptyImportDraft(), lastImport: null }),
  operations: [importHandler],
}
