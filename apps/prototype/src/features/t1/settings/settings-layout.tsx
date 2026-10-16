/**
 * Settings layout (S16; plan §3.4 SettingsPage): the page h1 and the section
 * list (NavList on the content surface) beside the open section. Each
 * section is a SettingsPage or a level-2 ListPage, and applies its changes
 * as they are made; there is no global Save button. The Outlet renders
 * straight into the detail pane, a shrinkable flex column: a ListPage fills
 * it and scrolls inside its table frame, a SettingsPage scrolls the pane as
 * one column. The sections are `SETTINGS_SECTIONS` in app/navigation.ts.
 */
import { Outlet, useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import { Undo2 } from "lucide-react"
import { SETTINGS_SECTIONS } from "@/app/navigation"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { NavList, type NavListGroup } from "@/components/app/nav-list"
import { ListDetail, PageHeader } from "@/components/app/page"
import type { Messages } from "@/lib/i18n"

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
      <ListDetail
        listLabel={m.settings_sections()}
        list={<NavList label={m.settings_sections()} groups={sectionGroups()} current={currentSection(pathname)} surface="content" />}
        detail={<Outlet />}
      />
    </>
  )
}

/** Internal route paths only: no scheme, no protocol-relative `//`, no `#`. */
function safeReturnPath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || !/^[\w\-/.~%]+$/.test(value)) return null
  return value
}

function returnLabel(m: Messages, path: string): string {
  if (/^\/sessions\/[^/]+$/.test(path)) return m.settings_back_to_session()
  if (path.startsWith("/plan")) return m.settings_back_to_plan()
  if (/^\/targets\/[^/]+$/.test(path)) return m.settings_back_to_target()
  if (/^\/projects\/[^/]+\/(runs|groups)\//.test(path)) return m.settings_back_to_run()
  if (path.startsWith("/storage")) return m.settings_back_to_storage()
  if (path.startsWith("/projects/")) return m.settings_back_to_project()
  return m.settings_go_back()
}

/**
 * `?return=` (HLD §4): one link back to the task that sent the user here.
 * @deprecated No Settings section renders it (plan §3.3 P7, C S0b: the toolbar's Back covers the return). Kept only for the P8 and P10 sections until W3b moves them off it; W4 removes it.
 */
export function ReturnNotice() {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const path = safeReturnPath(search.return)
  if (!path) return null
  return <ActionButton action={{ id: "return", label: returnLabel(m, path), icon: Undo2, run: () => void navigate({ to: path }) }} />
}
