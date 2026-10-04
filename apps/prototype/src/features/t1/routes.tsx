/**
 * T1 pages: onboarding, setup and the Settings menu.
 * Route paths are fixed by the foundation in src/routes.tsx (HLD §5).
 * T1 replaces these bodies; it must keep the exported keys.
 */
import { Outlet } from "@tanstack/react-router"
import { PlaceholderPage } from "@/components/app/page"

const owner = { track: "T1", name: "Onboarding, setup and Settings" } as const

export const t1Pages = {
  welcome: () => <PlaceholderPage title="Welcome to PlateVault" route="/welcome" owner={owner} covers="J18 orientation; J19 first launch; spec 064 LIB-FR-01" />,
  setupLocations: () => (
    <PlaceholderPage title="Choose locations" route="/setup/locations" owner={owner} covers="J19 steps 1-3; product flow A1-A2; LIB-FR-01, LIB-FR-02" />
  ),
  setupIndexing: () => (
    <PlaceholderPage title="Index your captures" route="/setup/indexing" owner={owner} covers="J19 step 4; product flow A3-A4; LIB-FR-03" />
  ),
  settingsLayout: () => (
    <PlaceholderPage title="Settings" route="/settings/*" owner={owner} covers="J10 settings menu; J15 equipment and sites">
      <Outlet />
    </PlaceholderPage>
  ),
  settingsAppearance: () => (
    <PlaceholderPage level={2} title="Appearance" route="/settings/appearance" owner={owner} covers="J10 theme and density" />
  ),
  settingsLocations: () => (
    <PlaceholderPage level={2} title="Locations" route="/settings/locations" owner={owner} covers="J19 registration; LIB-FR-01, LIB-FR-07 access and remap" />
  ),
  settingsEquipment: () => (
    <PlaceholderPage level={2} title="Equipment" route="/settings/equipment" owner={owner} covers="J15 cameras, telescopes, optical trains, filters; D11" />
  ),
  settingsSites: () => (
    <PlaceholderPage level={2} title="Observing sites" route="/settings/sites" owner={owner} covers="J15 sites; PLAN-FR-01 default site" />
  ),
  settingsAbout: () => (
    <PlaceholderPage level={2} title="About this prototype" route="/settings/about" owner={owner} covers="Prototype label, seed switch, Reset, simulation controls" />
  ),
}
