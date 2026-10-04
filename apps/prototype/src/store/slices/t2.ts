/**
 * T2 slice: Library home, scans, sessions, corrections, quality, Targets and Projects (J19, J20; specs 064, 065).
 * Owned by track T2. Holds T2-local UI state only: the Sessions display
 * grouping and the unsaved New Project draft (so it survives a trip to
 * Settings › Equipment and a reload). Durable data lives in the catalog.
 * T2 owns no operation kind: indexing is the foundation's `startIndexing`.
 */
import type { ChecklistItem, MosaicPanel, OpticalTrainId, SessionId, TargetId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface ProjectDraft {
  name: string
  notes: string
  targetIds: TargetId[]
  panels: MosaicPanel[]
  equipmentId: OpticalTrainId | null
  linkedSessionIds: SessionId[]
  checklist: ChecklistItem[]
  updatedAt: string
}

export interface T2State {
  /** Sessions: group the display by observing night (display only, LIB-FR-04). */
  groupByNight: boolean
  /** Unsaved New Project form; null when there is none. */
  projectDraft: ProjectDraft | null
}

export const t2Slice: SliceDefinition<T2State> = {
  id: "t2",
  version: 2,
  initial: () => ({ groupByNight: false, projectDraft: null }),
}
