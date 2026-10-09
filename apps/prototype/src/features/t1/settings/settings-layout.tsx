/**
 * Settings layout (S16): the page h1 and a section menu; each section
 * renders its own `PageHeader level={2}`. Every section applies changes as
 * they are made; there is no global Save button. The sections are
 * `SETTINGS_SECTIONS` in app/navigation.ts.
 */
import { Link, Outlet, useSearch } from "@tanstack/react-router"
import { Undo2 } from "lucide-react"
import { SETTINGS_SECTIONS as SECTIONS } from "@/app/navigation"
import { ListDetail, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

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
      <PageHeader title="Settings" />
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
  if (/^\/sessions\/[^/]+$/.test(path)) return "Back to session"
  if (path.startsWith("/plan")) return "Back to Plan"
  if (/^\/targets\/[^/]+$/.test(path)) return "Back to Target"
  if (/^\/projects\/[^/]+\/(runs|groups)\//.test(path)) return "Back to run"
  if (path.startsWith("/storage")) return "Back to Storage"
  if (path.startsWith("/calibration")) return "Back to Calibration"
  if (path.startsWith("/projects/")) return "Back to Project"
  return "Go back"
}

/** `?return=` (HLD §4): one link back to the task that sent the user here. */
export function ReturnNotice() {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const path = safeReturnPath(search.return)
  if (!path) return null
  return (
    <Button size="sm" variant="outline" render={<a href={`#${path}`} />} data-return-link>
      <Undo2 aria-hidden="true" data-icon="inline-start" />
      {returnLabel(path)}
    </Button>
  )
}
