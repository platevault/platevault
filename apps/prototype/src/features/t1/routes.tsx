/**
 * T1 pages: onboarding, setup and the Settings menu.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T1 replaces these bodies; it must keep the exported keys.
 */
import { AboutPage } from "./settings/about-page"
import { AppearancePage } from "./settings/appearance-page"
import { EquipmentPage } from "./settings/equipment-page"
import { LocationsPage } from "./settings/locations-page"
import { SettingsLayout } from "./settings/settings-layout"
import { SitesPage } from "./settings/sites-page"
import { TargetLookupPage } from "./settings/target-lookup-page"
import { SetupIndexingPage, SetupLocationsPage, WelcomePage } from "./setup/setup-pages"

export const t1Pages = {
  welcome: WelcomePage,
  setupLocations: SetupLocationsPage,
  setupIndexing: SetupIndexingPage,
  settingsLayout: SettingsLayout,
  settingsAppearance: AppearancePage,
  settingsLocations: LocationsPage,
  settingsEquipment: EquipmentPage,
  settingsSites: SitesPage,
  settingsTargets: TargetLookupPage,
  settingsAbout: AboutPage,
}
