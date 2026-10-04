/**
 * T5 pages: View Results and cleanup, Storage (archive, filing, transfers)
 * and observing plans.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 */
import { CleanupPage } from "./cleanup"
import { PlansPage, TargetPlanPage } from "./plans"
import { ResultsPage } from "./results"
import { StoragePage } from "./storage"
import { ArchivePage, FilingPage, TransferPage } from "./transfers"

export const t5Pages = {
  viewResults: ResultsPage,
  viewCleanup: CleanupPage,
  storage: StoragePage,
  storageArchive: ArchivePage,
  storageFiling: FilingPage,
  storageTransfer: TransferPage,
  plans: PlansPage,
  targetPlan: TargetPlanPage,
}
