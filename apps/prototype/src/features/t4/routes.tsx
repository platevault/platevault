/**
 * T4 pages: Calibration library, View calibration, preparation and handoff,
 * and Settings › Applications.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 */
import { SettingsApplicationsPage } from "./applications"
import { ViewCalibrationArea } from "./calibration-area"
import { CalibrationLibraryPage } from "./library"
import { ViewPrepareArea } from "./prepare-area"

export const t4Pages = {
  calibration: CalibrationLibraryPage,
  calibrationItem: CalibrationLibraryPage,
  viewCalibration: ViewCalibrationArea,
  viewPrepare: ViewPrepareArea,
  settingsApplications: SettingsApplicationsPage,
}
