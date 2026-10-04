/**
 * T4 slice: Calibration and application handoff (J23, J24; specs 068, 069).
 * Owned by track T4. Holds T4-local plan state (preparation choices per View,
 * adoption reviews) and the prototype world T4 simulates (application
 * bundles on disk, the J24 P7 and J26 P6 pause faults). Registers the
 * "prepare" and "adopt-master" operation handlers. Bump `version` when the
 * shape changes.
 */
import { t4OperationHandlers } from "@/features/t4/operations"
import type { InputMode, MetadataDecision, PreparationId, ProfileId, ViewId } from "@/domain/types"
import type { SliceDefinition } from "./index"

/** Preparation choices for one View. They persist across reloads (PREP-AC-10) and touch no file. */
export interface PrepDraft {
  /** Null keeps the suggested mode. */
  mode: InputMode | null
  linkType: "symlink" | "hardlink"
  /** Null keeps the suggested folder name. */
  folderName: string | null
  /** Override parent for the output folder; null keeps `<View folder>/output/`. */
  outputParent: string | null
  /** Keyed `<sessionId>:<field>`. */
  metadata: Record<string, MetadataDecision["decision"]>
  /** Membership revision the user confirmed in Review preparation. */
  confirmedRevision: number | null
  reviewing: boolean
}

export interface AdoptionDraft {
  destinationFolder: string | null
  fileName: string
  /** Identity and SHA-256 recorded when the review was read (D05). */
  reviewedSha256: string | null
  reviewedAt: string | null
  operationId: string | null
}

/** An application bundle on the simulated computer, outside PlateVault. */
export interface SimulatedApp {
  id: string
  name: string
  path: string
  /** The bundle exists at `path`. */
  present: boolean
  /** The next launch of this bundle fails. */
  launchFails: boolean
}

export interface T4State {
  prep: Record<ViewId, PrepDraft>
  adoption: Record<string, AdoptionDraft>
  world: {
    apps: SimulatedApp[]
    /** J24 P7: pause the next Prepare right after one source snapshot. */
    pauseAfterSnapshot: boolean
    /** J26 P6: pause the next adoption after the copy verifies, before registration. */
    pauseBeforeRegister: boolean
  }
  /** Simulated running application per View (launch is not processing). */
  running: Record<ViewId, { profileId: ProfileId; at: string } | null>
  /**
   * Prepared entries that no longer matched their preparation snapshot at the
   * last Open (PREP-FR-10, PREP-AC-15). Cleared when a later Open re-verifies.
   */
  unverified: Record<PreparationId, { at: string; changed: Array<{ path: string; reason: string }> } | null>
}

export function emptyPrepDraft(): PrepDraft {
  return { mode: null, linkType: "symlink", folderName: null, outputParent: null, metadata: {}, confirmedRevision: null, reviewing: false }
}

export const t4Slice: SliceDefinition<T4State> = {
  id: "t4",
  version: 3,
  initial: () => ({
    prep: {},
    adoption: {},
    world: {
      apps: [
        { id: "app_pixinsight", name: "PixInsight", path: "/Applications/PixInsight/PixInsight.app", present: true, launchFails: false },
        { id: "app_siril", name: "Siril", path: "/Applications/Siril.app", present: true, launchFails: false },
        { id: "app_seti", name: "SETI Astro Suite Pro", path: "/Applications/SetiAstroSuitePro.app", present: true, launchFails: false },
        { id: "app_astap", name: "ASTAP", path: "/Applications/ASTAP.app", present: true, launchFails: false },
      ],
      pauseAfterSnapshot: false,
      pauseBeforeRegister: false,
    },
    running: {},
    unverified: {},
  }),
  operations: t4OperationHandlers,
}
