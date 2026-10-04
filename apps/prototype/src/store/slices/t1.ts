/**
 * T1 slice: Onboarding, setup and Settings (J18, J10, J15, J19 registration; spec 064 locations).
 * Owned by track T1. Holds T1-local UI state only; durable data (locations,
 * equipment, sites, settings) lives in the catalog and settings and is written
 * through `commit()` (see src/features/t1/lib/writes.ts).
 */
import type { OperationId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface TargetLookupTest {
  at: string
  query: string
  provider: "cds-sesame" | "simbad"
  outcome: "resolved" | "not-found" | "failed" | "off"
  message: string
  result: { name: string; ra: number; dec: number; objectType: string; aliases: string[] } | null
}

export interface T1State {
  /** Indexing runs started from the setup flow, oldest first. */
  setupOperationIds: OperationId[]
  /** J18 S15: the checklist steps collapsed inside the Getting started flyout. */
  checklistCollapsed: boolean
  /**
   * When each Getting started item first read done (item id → ISO time). A
   * completed item never regresses on its own (J18 SC8); Restore reseeds it
   * from the catalog.
   */
  checklistDone: Record<string, string>
  /** Orientation tour position. `replaying` opens it again after it ran once (J18 S5). */
  tour: { replaying: boolean; stop: number }
  /** Last simulated Target lookup on Settings › Target lookup. */
  lastLookupTest: TargetLookupTest | null
}

export const t1Slice: SliceDefinition<T1State> = {
  id: "t1",
  version: 3,
  initial: () => ({
    setupOperationIds: [],
    checklistCollapsed: false,
    checklistDone: {},
    tour: { replaying: false, stop: 0 },
    lastLookupTest: null,
  }),
}
