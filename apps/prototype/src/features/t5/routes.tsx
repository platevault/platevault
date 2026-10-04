/**
 * T5 pages: View Results and cleanup, Storage (archive, filing, transfers)
 * and observing plans.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T5 replaces these bodies; it must keep the exported keys.
 */
import { PlaceholderPage } from "@/components/app/page"

const owner = { track: "T5", name: "Results, storage and observing plans" } as const

export const t5Pages = {
  viewResults: () => (
    <PlaceholderPage level={2} title="Results" route="/views/$viewId/results" owner={owner} covers="J26 steps 1-6, J27 steps 1-3; product flow H1-H3a, I1; RES-FR-01 to RES-FR-07" />
  ),
  viewCleanup: () => (
    <PlaceholderPage level={2} title="Clean up View" route="/views/$viewId/cleanup" owner={owner} covers="J27 steps 4-10; product flow I2-I5; STO-FR-01 to STO-FR-05, STO-FR-10" />
  ),
  storage: () => <PlaceholderPage title="Storage" route="/storage" owner={owner} covers="J28 entry; STO-FR-11 locations, footprints, duplicates, transfers" />,
  storageArchive: () => (
    <PlaceholderPage title="Archive" route="/storage/archive" owner={owner} covers="J28 steps 1-5; product flow J; STO-FR-06, STO-FR-07" />
  ),
  storageFiling: () => (
    <PlaceholderPage title="File into library" route="/storage/filing" owner={owner} covers="J30; product flow L; STO-FR-09, D14" />
  ),
  storageTransfer: () => (
    <PlaceholderPage title="Transfer" route="/storage/transfers/$operationId" owner={owner} covers="J28 steps 5-9, J30 steps 4-6; STO-FR-07, STO-FR-08, D06" />
  ),
  plans: () => <PlaceholderPage title="Plans" route="/plans" owner={owner} covers="J29 reminders and exports overview; PLAN-FR-03, PLAN-FR-06" />,
  targetPlan: () => (
    <PlaceholderPage title="Plan" route="/targets/$targetId/plan" owner={owner} covers="J29; product flow B3, K; PLAN-FR-01 to PLAN-FR-07" />
  ),
}
