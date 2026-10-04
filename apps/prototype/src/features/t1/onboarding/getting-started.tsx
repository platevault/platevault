/**
 * Getting started (J18 S6-S9, S14-S17; HLD §14): a sidebar trigger with a
 * progress ring and a non-modal flyout checklist. Items tick only from catalog
 * state, never manually. Outside clicks and nav links close the flyout; the
 * page underneath stays usable (J18 S18).
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { ChevronDown, Circle, CircleCheck, Lock, MoreHorizontal } from "lucide-react"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"
import { type PrototypeState, useStore } from "@/store/core"
import { replayTour, setChecklistCollapsed, setChecklistHidden } from "../lib/writes"

export interface ChecklistEntry {
  id: string
  label: string
  hint: string
  done: boolean
  /** Why the item cannot be done yet, naming the missing prerequisite. */
  gate: string | null
  jump: { to: string; label: string } | { tour: true; label: string } | null
}

/** The five HLD §14 items, derived from catalog state only. */
export function checklist(state: PrototypeState): ChecklistEntry[] {
  const { catalog, settings } = state
  const locations = Object.values(catalog.locations)
  const hasCaptures = locations.some((l) => l.role === "captures")
  const indexed = locations.some((l) => l.lastIndexedAt !== null)
  const sessions = Object.values(catalog.sessions).filter((s) => !s.supersededBy && s.imageType === "light")
  const reviewed =
    sessions.some((s) => s.target.status === "confirmed" || s.equipment.status === "confirmed") || Object.values(catalog.assets).some((a) => a.quality.value !== "unreviewed")
  const locationsJump = { to: "/settings/locations", label: "Go to Locations" }
  const sessionsJump = { to: "/sessions", label: "Go to Sessions" }
  return [
    { id: "capture", label: "Add a capture location", hint: "Register a folder of light frames. Nothing in it changes.", done: hasCaptures, gate: null, jump: { to: "/settings/locations?add=captures", label: "Add a capture location" } },
    { id: "index", label: "Index your captures", hint: "Reads metadata in place and builds sessions.", done: indexed, gate: hasCaptures ? null : "Add a capture location first.", jump: locationsJump },
    {
      id: "review",
      label: "Review a session",
      hint: "Confirm a Target or equipment, or mark frames Usable.",
      done: reviewed,
      gate: sessions.length ? null : "Index your captures first; there are no sessions yet.",
      jump: sessions.length ? sessionsJump : locationsJump,
    },
    {
      id: "view",
      label: "Create a View",
      hint: "Select sessions, then Create View.",
      done: Object.keys(catalog.views).length > 0,
      gate: sessions.length ? null : "Index your captures first; a View needs sessions.",
      jump: sessions.length ? sessionsJump : locationsJump,
    },
    { id: "tour", label: "Take the tour", hint: "Six stops through the main pages.", done: settings.onboarding.tourCompletedAt !== null, gate: null, jump: { tour: true, label: "Start the tour" } },
  ]
}

// Flyout open state is shared with the command palette entry; it is not persisted.
let flyoutOpen = false
const flyoutListeners = new Set<() => void>()
export function setChecklistOpen(open: boolean) {
  flyoutOpen = open
  for (const listener of flyoutListeners) listener()
}
function useChecklistOpen() {
  return useSyncExternalStore(
    (listener) => {
      flyoutListeners.add(listener)
      return () => flyoutListeners.delete(listener)
    },
    () => flyoutOpen,
  )
}

/** Decorative ring; the trigger's accessible name carries the count (modern-web-guidance `progress-ring`). */
function Ring({ done, total }: { done: number; total: number }) {
  const pct = Math.round((done / total) * 100)
  return (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full"
      style={{
        background: `conic-gradient(var(--primary) ${pct}%, var(--input) 0)`,
        mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
      }}
    />
  )
}

export function GettingStarted({ collapsed }: { collapsed: boolean }) {
  const hidden = useStore((s) => s.settings.onboarding.checklistHidden)
  const items = useStore(checklist)
  const listCollapsed = useStore((s) => s.slices.t1.checklistCollapsed)
  const open = useChecklistOpen()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [announcement, setAnnouncement] = useState("")
  const done = items.filter((i) => i.done).length
  const previous = useRef(done)

  // Announce progress changes politely, never on first render.
  useEffect(() => {
    if (previous.current !== done) setAnnouncement(`Getting started: ${done} of ${items.length} done`)
    previous.current = done
  }, [done, items.length])

  if (hidden) return null
  const name = `Getting started, ${done} of ${items.length} done`

  return (
    <>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <PopoverPrimitive.Root open={open} onOpenChange={(next) => setChecklistOpen(next)}>
        <PopoverPrimitive.Trigger
          data-getting-started-trigger=""
          aria-label={collapsed ? name : undefined}
          title={collapsed ? name : undefined}
          className={cn(
            "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground aria-expanded:bg-sidebar-accent aria-expanded:text-sidebar-accent-foreground",
            collapsed && "justify-center px-0",
          )}
        >
          <Ring done={done} total={items.length} />
          {collapsed ? null : (
            <>
              <span className="truncate">Getting started</span>
              <span className="ml-auto text-xs text-sidebar-foreground/60 tabular-nums">
                {done}/{items.length}
                <span className="sr-only"> done</span>
              </span>
            </>
          )}
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner side="right" align="end" sideOffset={8} className="isolate z-30">
            <PopoverPrimitive.Popup className="w-80 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <PopoverPrimitive.Title className="text-sm font-semibold">Getting started</PopoverPrimitive.Title>
                  <Progress value={(done / items.length) * 100} aria-label="Getting started progress" getAriaValueText={() => `${done} of ${items.length} done`}>
                    <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
                      {done} of {items.length} done
                    </span>
                  </Progress>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Getting started options" />}>
                    <MoreHorizontal aria-hidden="true" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem
                      onClick={() => {
                        setChecklistOpen(false)
                        setConfirmRemove(true)
                      }}
                    >
                      Remove Getting started…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Collapsible open={!listCollapsed} onOpenChange={(next) => setChecklistCollapsed(!next)} className="mt-2">
                <CollapsibleTrigger className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground">
                  <ChevronDown aria-hidden="true" className={cn("size-3.5", listCollapsed && "-rotate-90")} />
                  Steps
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ol className="mt-1 space-y-1">
                    {items.map((item) => {
                      const Icon = item.done ? CircleCheck : item.gate ? Lock : Circle
                      return (
                        <li key={item.id} className="flex gap-2 rounded-md p-1.5">
                          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", item.done ? "text-success" : "text-muted-foreground")} />
                          <div className="min-w-0 flex-1 space-y-0.5">
                            <p className={cn("font-medium", item.done && "text-muted-foreground")}>
                              {item.label}
                              <span className="sr-only">{item.done ? ", done" : item.gate ? ", locked" : ", not done"}</span>
                            </p>
                            <p className="text-xs text-pretty text-muted-foreground">{item.done ? "Done" : (item.gate ?? item.hint)}</p>
                            {!item.done && item.jump ? (
                              "tour" in item.jump ? (
                                <Button
                                  size="xs"
                                  variant="link"
                                  className="h-auto px-0"
                                  onClick={() => {
                                    setChecklistOpen(false)
                                    replayTour()
                                  }}
                                >
                                  {item.jump.label}
                                </Button>
                              ) : (
                                <Button size="xs" variant="link" className="h-auto px-0" render={<a href={`#${item.jump.to}`} onClick={() => setChecklistOpen(false)} />}>
                                  {item.jump.label}
                                </Button>
                              )
                            ) : null}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                </CollapsibleContent>
              </Collapsible>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove Getting started?"
        description="The checklist and its sidebar entry go away until you restore them."
        changes={["Hide the Getting started entry and its checklist"]}
        unchanged={["Your library and everything you did", "Restore it any time in Settings › About this prototype"]}
        confirmLabel="Remove Getting started"
        onConfirm={() => setChecklistHidden(true)}
      />
    </>
  )
}
