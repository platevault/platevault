/**
 * T4 pages: Calibration library, View calibration, preparation and handoff,
 * and Settings › Applications.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T4 replaces these bodies; it must keep the exported keys.
 */
import { PlaceholderPage } from "@/components/app/page"

const owner = { track: "T4", name: "Calibration and application handoff" } as const

export const t4Pages = {
  calibration: () => <PlaceholderPage title="Calibration" route="/calibration" owner={owner} covers="J23, J26 step 7; CAL-FR-01, CAL-FR-06" />,
  calibrationItem: () => (
    <PlaceholderPage title="Calibration master or set" route="/calibration/$calibrationId" owner={owner} covers="J26 step 7; product flow H4; CAL-FR-06, CAL-FR-07" />
  ),
  viewCalibration: () => (
    <PlaceholderPage level={2} title="Calibration for this View" route="/views/$viewId/calibration" owner={owner} covers="J23 steps 1-7; product flow E1-E2; CAL-FR-02 to CAL-FR-05, CAL-FR-08" />
  ),
  viewPrepare: () => (
    <PlaceholderPage level={2} title="Prepare and open" route="/views/$viewId/prepare" owner={owner} covers="J23 steps 8-11, J24; product flow E3-E4, F1-F6; PREP-FR-01 to PREP-FR-11" />
  ),
  settingsApplications: () => (
    <PlaceholderPage level={2} title="Applications" route="/settings/applications" owner={owner} covers="J23 step 8; PREP-FR-01, PREP-FR-02 profiles and Open in…" />
  ),
}
