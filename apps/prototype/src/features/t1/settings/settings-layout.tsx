/**
 * Settings layout (J10 S1): the page h1 and a section menu; each section
 * renders its own `PageHeader level={2}`. Every section applies changes as
 * they are made; there is no global Save button.
 */
import { Link, Outlet, useSearch } from "@tanstack/react-router"
import { Undo2 } from "lucide-react"
import { Notice } from "@/components/app/feedback"
import { ListDetail, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const SECTIONS: Array<{ group: string; items: Array<{ to: string; label: string }> }> = [
  { group: "General", items: [{ to: "/settings/appearance", label: "Appearance" }] },
  {
    group: "Library",
    items: [
      { to: "/settings/locations", label: "Locations" },
      { to: "/settings/equipment", label: "Equipment" },
      { to: "/settings/sites", label: "Observing sites" },
      { to: "/settings/targets", label: "Target lookup" },
    ],
  },
  { group: "Processing", items: [{ to: "/settings/applications", label: "Applications" }] },
  { group: "Prototype", items: [{ to: "/settings/about", label: "About this prototype" }] },
]

function SettingsMenu() {
  return (
    <div className="space-y-4 p-2">
      {SECTIONS.map((section) => (
        <div key={section.group} className="space-y-0.5">
          <div id={`settings-group-${section.group}`} className="px-2 pb-1 text-xs text-muted-foreground">
            {section.group}
          </div>
          <ul aria-labelledby={`settings-group-${section.group}`} className="space-y-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={cn(
                    "flex h-8 items-center rounded-md px-2 text-sm text-foreground/85 hover:bg-accent hover:text-accent-foreground",
                    "data-[status=active]:bg-accent data-[status=active]:font-medium data-[status=active]:text-accent-foreground data-[status=active]:shadow-[inset_2px_0_0_var(--primary)]",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

export function SettingsLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Settings" description="Changes apply as you make them. Library changes are recorded in Activity." />
      <ListDetail
        listLabel="Settings sections"
        className="grid-cols-[13rem_minmax(0,1fr)] xl:grid-cols-[15rem_minmax(0,1fr)]"
        list={<SettingsMenu />}
        // One content width for every section, so right edges match across Settings.
        detail={
          <div className="max-w-5xl">
            <Outlet />
          </div>
        }
      />
    </div>
  )
}

/** Internal route paths only: no scheme, no protocol-relative `//`, no `#`. */
function safeReturnPath(value: string | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || !/^[\w\-/.~%]+$/.test(value)) return null
  return value
}

function returnLabel(path: string): string {
  if (/^\/sessions\/[^/]+$/.test(path)) return "Back to the session"
  if (/^\/targets\/[^/]+\/plan$/.test(path)) return "Back to the plan"
  if (/^\/targets\/[^/]+$/.test(path)) return "Back to the Target"
  if (path.startsWith("/views/")) return "Back to the View"
  if (path.startsWith("/storage")) return "Back to Storage"
  if (path.startsWith("/projects/")) return "Back to the Project"
  return "Go back"
}

/** `?return=` (HLD §4): one link back to the task that sent the user here. */
export function ReturnNotice({ task }: { task: string }) {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const path = safeReturnPath(search.return)
  if (!path) return null
  return (
    <Notice
      tone="info"
      title={`Opened from another task: ${task}`}
      actions={
        <Button size="sm" variant="outline" render={<a href={`#${path}`} />}>
          <Undo2 aria-hidden="true" data-icon="inline-start" />
          {returnLabel(path)}
        </Button>
      }
    >
      When you are done here, go back to continue where you were.
    </Notice>
  )
}
