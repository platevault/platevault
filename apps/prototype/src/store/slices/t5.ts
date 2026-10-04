/**
 * T5 slice: Results, storage custody and observing plans (J26-J30; specs 070, 071, 072).
 * Owned by track T5. Holds T5-local UI state (cleanup selections, transfer
 * plan drafts, the simulated OS notification list) and registers the
 * operation handlers T5 owns ("cleanup", "archive", "filing"). Durable
 * decisions live in the catalog.
 */
import { t5OperationHandlers } from "@/features/t5/lib/operations"
import { emptyDraft, type TransferDraft } from "@/features/t5/lib/transfer"
import type { ViewId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface CleanupDraft {
  /** Selected file keys (`volumeId:path`); null until the user changes the default selection. */
  selected: string[] | null
  stage: "choose" | "review"
  /** The cleanup run started from this draft. */
  operationId: string | null
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
  archive: TransferDraft
  filing: TransferDraft
  notifications: SimulatedNotification[]
}

export const t5Slice: SliceDefinition<T5State> = {
  id: "t5",
  version: 3,
  initial: () => ({ cleanup: {}, archive: emptyDraft(), filing: emptyDraft(), notifications: [] }),
  operations: t5OperationHandlers,
}
