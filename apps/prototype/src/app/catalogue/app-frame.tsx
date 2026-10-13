/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.4, §8.3): AppFrame and SetupFrame
 * as specimens: the wide sidebar, the icon rail, the narrow drawer and setup.
 * Component content uses the real catalogue copy; captions are reviewer labels.
 */
import { Activity, Aperture, House, Settings } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { IconButton } from "@/components/app/actions"
import { type NavListGroup, NavList } from "@/components/app/nav-list"
import { StatusBar, StatusText } from "@/components/app/status-bar"
import { AppFrame, type AppFrameSidebar, SetupFrame } from "@/components/templates/app-frame"
import { ChevronLeft } from "lucide-react"
import { ComponentSection, Specimen } from "./specimen"

function useSidebar(): AppFrameSidebar {
  const m = useMessages()
  const main: NavListGroup[] = [{ id: "primary", items: [{ id: "home", label: m.nav_home(), icon: House, link: { to: "/design-system" } }] }]
  const utilities: NavListGroup[] = [
    {
      id: "utilities",
      items: [
        { id: "activity", label: m.nav_activity(), icon: Activity, link: { to: "/activity" } },
        { id: "settings", label: m.nav_settings(), icon: Settings, link: { to: "/settings" } },
      ],
    },
  ]
  return {
    nav: ({ collapsed, onNavigate }) => <NavList label={m.shell_nav_main()} groups={main} current="home" collapsed={collapsed} onNavigate={onNavigate} />,
    utilities: ({ collapsed, onNavigate }) => <NavList label={m.shell_nav_utilities()} groups={utilities} current={null} collapsed={collapsed} onNavigate={onNavigate} />,
  }
}

function Frame({ narrow = false, startCollapsed = false }: { narrow?: boolean; startCollapsed?: boolean }) {
  const m = useMessages()
  const sidebar = useSidebar()
  const [collapsed, setCollapsed] = useState(startCollapsed)
  return (
    <AppFrame
      specimen={{ narrow }}
      brand={{ name: m.app_name(), icon: Aperture }}
      sidebar={sidebar}
      collapsed={collapsed}
      onToggleCollapsed={() => setCollapsed((value) => !value)}
      toolbar={{ leading: <IconButton label={m.history_back()} icon={ChevronLeft} /> }}
      statusBar={<StatusBar label={m.status_bar()} middle={<StatusText>{m.status_bar_idle()}</StatusText>} />}
    >
      <p className="m-auto text-sm text-muted-foreground">{m.nav_home()}</p>
    </AppFrame>
  )
}

export function AppFrameCatalogue() {
  const m = useMessages()
  return (
    <ComponentSection components={["AppFrame", "SetupFrame", "MainArea"]} description={m.catalogue_app_frame_desc()}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_frame_wide()}>
          <div className="w-full">
            <Frame />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_frame_rail()}>
          <div className="w-full">
            <Frame startCollapsed />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_frame_narrow()}>
          <div className="w-96">
            <Frame narrow />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_frame_setup()}>
          <div className="w-full">
            <SetupFrame specimen brand={{ name: m.app_name(), icon: Aperture }}>
              <p className="m-auto text-sm text-muted-foreground">{m.onboarding_getting_started()}</p>
            </SetupFrame>
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}
