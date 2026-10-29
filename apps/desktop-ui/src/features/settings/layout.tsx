/**
 * Settings layout (LIB-FR-21; plan §3.4 SettingsPage): the page h1 and the
 * section list (NavList on the content surface) beside the open section.
 * Each section applies its changes as they are made; there is no global
 * Save. The toolbar's Back returns to the task that opened Settings, so the
 * page has no return link.
 */
import { Outlet, useRouterState } from "@tanstack/react-router"
import { useMessages } from "@/app/preferences"
import { NavList, type NavListGroup } from "@/components/app/nav-list"
import { ListDetail, PageHeader } from "@/components/app/page"
import type { Messages } from "@/lib/i18n"

interface Section {
  to: string
  label: string
}

/** The sections by group, in the order the list shows them; every path is a child of `/settings` in src/routes.tsx. */
export function settingsSections(m: Messages): { group: string; items: Section[] }[] {
  return [
    {
      group: m.settings_group_general(),
      items: [
        { to: "/settings/appearance", label: m.settings_appearance() },
        { to: "/settings/help", label: m.settings_help() },
        { to: "/settings/about", label: m.settings_about() },
      ],
    },
    {
      group: m.nav_library(),
      items: [
        { to: "/settings/locations", label: m.common_locations() },
        { to: "/settings/equipment", label: m.settings_equipment() },
        { to: "/settings/matching", label: m.settings_matching() },
        { to: "/settings/naming", label: m.settings_naming() },
        { to: "/settings/sites", label: m.settings_sites() },
        { to: "/settings/targets", label: m.settings_target_lookup() },
      ],
    },
    { group: m.nav_projects(), items: [{ to: "/settings/goal-templates", label: m.settings_goal_templates() }] },
    { group: m.settings_group_processing(), items: [{ to: "/settings/applications", label: m.settings_applications() }] },
  ]
}

export function SettingsLayout() {
  const m = useMessages()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const sections = settingsSections(m)
  const groups: NavListGroup[] = sections.map((section) => ({
    id: section.items[0]?.to ?? section.group,
    heading: section.group,
    items: section.items.map((item) => ({ id: item.to, label: item.label, link: { to: item.to } })),
  }))
  const current = sections.flatMap((section) => section.items).find((item) => pathname === item.to || pathname.startsWith(`${item.to}/`))?.to ?? null
  return (
    <>
      <PageHeader title={m.nav_settings()} />
      <ListDetail list={<NavList label={m.settings_sections()} groups={groups} current={current} surface="content" />} detail={<Outlet />} />
    </>
  )
}
