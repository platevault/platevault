/**
 * T5 slice: Results, storage custody and observing plans (J26-J30; specs 070, 071, 072).
 * Owned by track T5. Holds T5-local UI state (cleanup selections, transfer
 * plan drafts, the simulated OS notification list) and registers the
 * operation handlers T5 owns ("cleanup", "archive", "filing"). Durable
 * decisions live in the catalog.
 */
import type { ReviewSnapshot } from "@/features/t5/lib/cleanup"
import { t5OperationHandlers } from "@/features/t5/lib/operations"
import { emptyDraft, type TransferDraft } from "@/features/t5/lib/transfer"
import type { ResultId, ViewId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface CleanupDraft {
  /** Selected file keys (`volumeId:path`); null until the user changes the default selection. */
  selected: string[] | null
  stage: "choose" | "review"
  /** What Review cleanup recorded; execution runs against it, never against the live plan (STO-FR-04). */
  review: ReviewSnapshot | null
  /** The cleanup run started from this draft. */
  operationId: string | null
}

/** A product's identity as recorded when the user inspected it (RES-FR-04, D19). */
export interface Inspection {
  path: string
  sha256: string
  sizeBytes: number
  modifiedAt: string
  inode: number
  at: string
}

/**
 * A notification as the operating system would show it. The prototype has no
 * OS notification centre, so the delivered list lives here, outside the
 * catalog, the way the disk lives outside PlateVault.
 */
export interface SimulatedNotification {
  id: string
  windowKey: string
  title: string
  body: string
  at: string
  dismissed: boolean
}

export interface T5State {
  cleanup: Record<ViewId, CleanupDraft>
  /** The latest inspection of each Result candidate; Accept Result re-verifies against it. */
  inspections: Record<ResultId, Inspection>
  archive: TransferDraft
  filing: TransferDraft
  notifications: SimulatedNotification[]
}

export const t5Slice: SliceDefinition<T5State> = {
  id: "t5",
  version: 4,
  initial: () => ({ cleanup: {}, inspections: {}, archive: emptyDraft(), filing: emptyDraft(), notifications: [] }),
  operations: t5OperationHandlers,
}
