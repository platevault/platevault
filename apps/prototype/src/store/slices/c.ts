/**
 * Slice C: the Project's View step and its Apply sheet (VSEL-FR-14,
 * PREP-FR-06). Screen-local state: the Apply sheet open on a Project, which
 * holds the fingerprint of the plan it shows and the files PlateVault didn't
 * place that the user ticked to move into the new View. Apply hands that
 * sheet to `startApply` (store/actions/project-view.ts), which refuses it
 * when anything changed after it opened. The "apply" operation handler is
 * the store's (`PROJECT_VIEW_HANDLERS`); durable outcomes live in the
 * catalog.
 */
import type { ProjectId } from "@/domain/types"
import type { ApplySheet } from "@/store/actions/project-view"
import type { SliceDefinition } from "./index"

export interface CState {
  /** The open Apply sheet, by Project; absent while it is closed. */
  apply: Record<ProjectId, ApplySheet>
}

export const cSlice: SliceDefinition<CState> = {
  id: "c",
  version: 3,
  initial: () => ({ apply: {} }),
}
