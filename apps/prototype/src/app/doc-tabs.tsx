/**
 * Document tabs (Harness V3, from direction E): every record you open
 * (Target, Session, View, Project, calibration item, transfer) gets a tab
 * above the main pane. A single click from a list opens it as the italic
 * preview tab, which the next record replaces; double-click the tab, or
 * choose Keep open, to keep it. A View keeps one tab whatever area is
 * showing, and returns to that area. List surfaces (Targets, Sessions…)
 * are source-list places, not tabs.
 */
import { Link, useRouter, useRouterState } from "@tanstack/react-router"
import { Crosshair, FileStack, Goal, Layers, ListChecks, SlidersHorizontal, X } from "lucide-react"
import { useEffect, useSyncExternalStore } from "react"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu"
import type { Catalog } from "@/domain/types"
import { formatExposure, formatNight } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"

interface DocTab {
  /** Document identity, e.g. "/views/view_1". */
  key: string
  /** Last route shown for it, e.g. "/views/view_1/frames". */
  path: string
  preview: boolean
}

const MAX_TABS = 8
const DOCUMENT = /^\/(views|targets|sessions|projects|calibration|storage\/transfers)\/([^/]+)/

let tabs: DocTab[] = []
const listeners = new Set<() => void>()
function emit() {
  for (const listener of listeners) listener()
}

function documentKey(pathname: string): string | null {
  const match = DOCUMENT.exec(pathname)
  // "/views/new" and "/projects/new" are creation pages, not records.
  if (!match || match[2] === "new") return null
  return `/${match[1]}/${match[2]}`
}

/** Called on every route change: activate, retarget or open the document's tab. */
function visit(pathname: string) {
  const key = documentKey(pathname)
  if (!key) return
  const existing = tabs.find((t) => t.key === key)
  if (existing) {
    if (existing.path !== pathname) {
      // Moving within a document (another View area) keeps it: it is being worked on.
      tabs = tabs.map((t) => (t.key === key ? { ...t, path: pathname, preview: false } : t))
      emit()
    }
    return
  }
  const preview = tabs.findIndex((t) => t.preview)
  const tab: DocTab = { key, path: pathname, preview: true }
  if (preview >= 0) tabs = tabs.map((t, i) => (i === preview ? tab : t))
  else tabs = [...tabs, tab].slice(-MAX_TABS)
  emit()
}

function keep(key: string) {
  tabs = tabs.map((t) => (t.key === key ? { ...t, preview: false } : t))
  emit()
}

function useTabs(): DocTab[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => tabs,
  )
}

function describe(catalog: Catalog, key: string): { title: string; icon: typeof Crosshair } | null {
  const [, kind = "", id = ""] = /^\/(views|targets|sessions|projects|calibration|storage\/transfers)\/(.+)$/.exec(key) ?? []
  switch (kind) {
    case "views":
      return catalog.views[id] ? { title: catalog.views[id].name, icon: ListChecks } : null
    case "targets":
      return catalog.targets[id] ? { title: catalog.targets[id].name, icon: Crosshair } : null
    case "projects":
      return catalog.projects[id] ? { title: catalog.projects[id].name, icon: Goal } : null
    case "sessions": {
      const s = catalog.sessions[id]
      return s ? { title: `${formatNight(s.night)} · ${s.channel ?? "No filter"} · ${formatExposure(s.exposureS)}`, icon: Layers } : null
    }
    case "calibration":
      return { title: "Calibration item", icon: SlidersHorizontal }
    case "storage/transfers":
      return { title: "Transfer", icon: FileStack }
    default:
      return null
  }
}

/** Mounted once by the shell, above the main pane. */
export function DocumentTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const catalog = useStore((s) => s.catalog)
  const router = useRouter()
  const open = useTabs()
  useEffect(() => visit(pathname), [pathname])
  const activeKey = documentKey(pathname)
  // A record that no longer exists (discarded draft View) drops its tab.
  const shown = open.flatMap((tab) => {
    const info = describe(catalog, tab.key)
    return info ? [{ ...tab, ...info }] : []
  })
  if (shown.length === 0) return null

  function close(key: string) {
    const index = tabs.findIndex((t) => t.key === key)
    tabs = tabs.filter((t) => t.key !== key)
    emit()
    if (key !== activeKey) return
    const next = tabs[Math.min(index, tabs.length - 1)]
    // Closing the shown document goes to its neighbour, else to the document's list.
    router.history.push(next ? next.path : `/${key.split("/")[1]}`)
  }
  function closeOthers(key: string) {
    tabs = tabs.filter((t) => t.key === key)
    emit()
  }

  return (
    <nav aria-label="Open documents" data-chrome className="flex h-7.5 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar [scrollbar-width:none]">
      <ul className="flex min-w-0 items-stretch">
        {shown.map((tab) => {
          const active = tab.key === activeKey
          const Icon = tab.icon
          return (
            <li key={tab.key} className="relative flex shrink-0">
              <ContextMenu>
                <ContextMenuTrigger
                  render={
                    <div
                      className={cn(
                        "group/tab flex max-w-56 items-center border-r text-sm",
                        active ? "bg-background text-foreground shadow-[inset_0_2px_0_var(--primary)]" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                      )}
                    />
                  }
                >
                  <Link
                    to={tab.path}
                    aria-current={active ? "page" : undefined}
                    onDoubleClick={() => keep(tab.key)}
                    className={cn("flex h-full min-w-0 items-center gap-1.5 pr-1 pl-2.5", tab.preview && "italic")}
                    title={tab.preview ? `${tab.title} (preview: double-click to keep open)` : tab.title}
                  >
                    <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                    <span className="truncate">{tab.title}</span>
                    {tab.preview ? <span className="sr-only"> (preview)</span> : null}
                  </Link>
                  <button
                    type="button"
                    aria-label={`Close ${tab.title}`}
                    onClick={() => close(tab.key)}
                    className="mr-1 grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground hover:opacity-100 group-hover/tab:opacity-100 focus-visible:opacity-100"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <DropdownMenuItem disabled={!tab.preview} onClick={() => keep(tab.key)}>
                    Keep open
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => close(tab.key)}>Close tab</DropdownMenuItem>
                  <DropdownMenuItem disabled={shown.length < 2} onClick={() => closeOthers(tab.key)}>
                    Close other tabs
                  </DropdownMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
