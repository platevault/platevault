/**
 * ChecklistRing (plan §3.3 P14; spec 056; user item 316): a progress ring in
 * the sidebar footer, above Activity and Settings, that opens the checklist
 * as a non-modal popover to its right. The page stays usable while it is
 * open; Escape, an outside click or a link inside closes it.
 *
 * - Expanded sidebar: ring, title and "2/5". Collapsed rail: the bare ring,
 *   named "Getting started, 2 of 5 done", with the title as its tooltip.
 * - The popover: title, "2 of 5 done" and a progress bar, then each section
 *   (the Getting started steps, then goals) as a list. A pending item shows
 *   its one action; an unavailable action stays focusable and disabled with
 *   its reason under the label.
 * - The host owns the items and hides the ring once every item is done or
 *   the user dismisses it (`onDismiss`).
 *
 * Item actions take the parts of `Action` a checklist row renders: a label,
 * `run`, `unavailable` and `opensDialog`. A confirmation or a destructive
 * step does not belong in a checklist.
 */
import { Circle, CircleCheck, X } from "lucide-react"
import { type Ref, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { navRowClass } from "@/components/app/nav-list"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export type ChecklistAction = Pick<Action, "id" | "label" | "run" | "unavailable" | "opensDialog">

export interface ChecklistItem {
  id: string
  label: string
  done: boolean
  /** Shown while the item is pending. */
  action?: ChecklistAction
}

export interface ChecklistSection {
  id: string
  /** "Steps", "Goals". */
  title: string
  items: ChecklistItem[]
}

export interface ChecklistRingProps {
  /** "Getting started". */
  title: string
  sections: ChecklistSection[]
  /** The sidebar's icon rail: the bare ring. */
  collapsed?: boolean
  /** Removes the checklist; the host records it and stops rendering the ring. */
  onDismiss?: () => void
  /** Catalogue and tests: start open. */
  defaultOpen?: boolean
}

const RING_SIZE = 16
const RING_STROKE = 2.5
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** The progress donut: a track and an arc that fills clockwise from the top. */
function Ring({ fraction }: { fraction: number }) {
  const centre = RING_SIZE / 2
  return (
    <svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true" className="shrink-0" data-checklist-ring>
      <circle cx={centre} cy={centre} r={RING_RADIUS} fill="none" strokeWidth={RING_STROKE} className="stroke-sidebar-foreground/20" />
      <circle
        cx={centre}
        cy={centre}
        r={RING_RADIUS}
        fill="none"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
        transform={`rotate(-90 ${centre} ${centre})`}
        className="stroke-primary transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
      />
    </svg>
  )
}

function ItemRow({ item, actionRef, onRun }: { item: ChecklistItem; actionRef?: Ref<HTMLButtonElement>; onRun: () => void }) {
  const m = useMessages()
  const reasonId = useId()
  const action = item.done ? undefined : item.action
  const unavailable = action?.unavailable
  return (
    <li className="flex min-h-(--row-h) items-center gap-2 px-3 py-(--row-py)" data-check={item.id} data-done={item.done || undefined}>
      {item.done ? <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate", item.done && "text-muted-foreground")} title={item.label}>
          {item.label}
          {item.done ? <span className="sr-only"> · {m.status_done()}</span> : null}
        </span>
        {unavailable ? (
          <span id={reasonId} className="truncate text-xs text-muted-foreground" title={unavailable.reason}>
            {unavailable.reason}
          </span>
        ) : null}
      </span>
      {action ? (
        <Button
          ref={unavailable ? undefined : actionRef}
          variant="outline"
          size="xs"
          className="shrink-0"
          disabled={Boolean(unavailable)}
          focusableWhenDisabled
          aria-describedby={unavailable ? reasonId : undefined}
          onClick={() => {
            onRun()
            void action.run()
          }}
          data-check-action={action.id}
        >
          {action.opensDialog ? `${action.label}…` : action.label}
        </Button>
      ) : null}
    </li>
  )
}

export function ChecklistRing({ title, sections, collapsed = false, onDismiss, defaultOpen }: ChecklistRingProps) {
  const m = useMessages()
  const firstPending = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(defaultOpen ?? false)
  const items = sections.flatMap((section) => section.items)
  const done = items.filter((item) => item.done).length
  const total = items.length
  const fraction = total > 0 ? done / total : 0
  const progress = m.onboarding_check_progress({ done, total })
  const name = m.checklist_ring_name({ title, done, total })
  const firstPendingId = items.find((item) => !item.done && item.action && !item.action.unavailable)?.id

  const trigger = (
    <PopoverTrigger className={cn(navRowClass({ collapsed }), "aria-expanded:bg-sidebar-foreground/10")} aria-label={collapsed ? name : undefined} data-checklist-trigger>
      <Ring fraction={fraction} />
      {collapsed ? null : (
        <>
          <span className="min-w-0 flex-1 truncate">{title}</span>
          <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
            {`${done}/${total}`}
          </span>
          <span className="sr-only">{progress}</span>
        </>
      )}
    </PopoverTrigger>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {collapsed ? (
        <Tooltip>
          <TooltipTrigger render={trigger} />
          <TooltipContent side="right">{title}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <PopoverContent side="right" align="end" sideOffset={8} initialFocus={firstPendingId ? firstPending : undefined} className="max-h-(--available-height) w-80 gap-0 overflow-y-auto p-0" data-checklist>
        <div data-chrome className="flex flex-col gap-1.5 border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <PopoverTitle className="min-w-0 flex-1 truncate font-semibold">{title}</PopoverTitle>
            <span className="text-xs text-muted-foreground tabular-nums">{progress}</span>
            {onDismiss ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button variant="ghost" size="icon-sm" className="-mr-1.5 text-muted-foreground" aria-label={m.checklist_dismiss({ title })} onClick={onDismiss} data-checklist-dismiss>
                      <X aria-hidden="true" />
                    </Button>
                  }
                />
                <TooltipContent>{m.checklist_dismiss({ title })}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <Progress value={done} max={Math.max(total, 1)} aria-label={progress} />
        </div>
        {sections.map((section) => (
          <section key={section.id} className="border-b border-border py-1 last:border-0" data-checklist-section={section.id}>
            <h3 data-chrome className="px-3 py-1 text-xs font-semibold text-muted-foreground">
              {section.title}
            </h3>
            <ol className="text-sm">
              {section.items.map((item) => (
                <ItemRow key={item.id} item={item} actionRef={item.id === firstPendingId ? firstPending : undefined} onRun={() => setOpen(false)} />
              ))}
            </ol>
          </section>
        ))}
      </PopoverContent>
    </Popover>
  )
}
