/**
 * Settings layout (S16; plan §3.4 SettingsPage): the page h1 and the section
 * list (NavList on the content surface) beside the open section. Each
 * section is a SettingsPage or a level-2 ListPage, and applies its changes
 * as they are made; there is no global Save button. The Outlet renders
 * straight into the detail pane, a shrinkable flex column: a ListPage fills
 * it and scrolls inside its table frame, a SettingsPage scrolls the pane as
 * one column. The sections are `SETTINGS_SECTIONS` in app/navigation.ts.
 * There is no return link: the toolbar's Back goes back to the task that
 * opened Settings (C S0b).
 */
import { Outlet, useRouterState } from "@tanstack/react-router"
import { SETTINGS_SECTIONS } from "@/app/navigation"
import { useMessages } from "@/app/preferences"
import { NavList, type NavListGroup } from "@/components/app/nav-list"
import { ListDetail, PageHeader } from "@/components/app/page"

function sectionGroups(): NavListGroup[] {
  return SETTINGS_SECTIONS.map((section) => ({
    id: section.items[0]?.to ?? section.group,
    heading: section.group,
    items: section.items.map((item) => ({ id: item.to, label: item.label, link: { to: item.to } })),
  }))
}

/** The section the path is in: the one whose route is the path or a parent of it. */
function currentSection(pathname: string): string | null {
  const items = SETTINGS_SECTIONS.flatMap((section) => section.items)
  return items.find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.to ?? null
}

export function SettingsLayout() {
  const m = useMessages()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <>
      <PageHeader title={m.nav_settings()} />
      <ListDetail list={<NavList label={m.settings_sections()} groups={sectionGroups()} current={currentSection(pathname)} surface="content" />} detail={<Outlet />} />
    </>
  )
}
