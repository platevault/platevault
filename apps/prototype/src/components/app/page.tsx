/**
 * Page-level layout primitives (foundation-owned): page header, sections,
 * list + detail, step indicator and the pre-created placeholder page.
 */
import { Check } from "lucide-react"
import { useEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

const APP_TITLE = "PlateVault prototype"
const mountedTitles = new Map<symbol, { title: string; level: 1 | 2 }>()

function applyDocumentTitle() {
  const parts = [...mountedTitles.values()].sort((a, b) => b.level - a.level).map((entry) => entry.title)
  document.title = [...parts, APP_TITLE].join(" · ")
}

/**
 * Names the browser tab after the mounted page headings, child area first:
 * "Sessions · View workspace · PlateVault prototype" (WCAG 2.4.2).
 */
export function useDocumentTitle(title: string, level: 1 | 2 = 1) {
  useEffect(() => {
    const key = Symbol(title)
    mountedTitles.set(key, { title, level })
    applyDocumentTitle()
    return () => {
      mountedTitles.delete(key)
      applyDocumentTitle()
    }
  }, [title, level])
}

export interface PageHeaderProps {
  title: string
  /** One sentence: what this surface is for. */
  description?: ReactNode
  /** Path to the parent (Views › Project …): shown inline before the title, Finder path-bar style. */
  eyebrow?: ReactNode
  /** Status badges shown beside the title. */
  meta?: ReactNode
  /** Page-level actions; the primary action goes last. */
  actions?: ReactNode
  className?: string
  /**
   * Heading level. Layout routes (View workspace, Settings) own the page h1;
   * their child areas render their title as h2.
   */
  level?: 1 | 2
}

/**
 * Pane header (Harness V3): one compact row, parent path inline before the
 * title, actions on the trailing edge, the one-sentence purpose in small
 * secondary text under it. No hero block, no eyebrow stacked above.
 */
export function PageHeader({ title, description, eyebrow, meta, actions, className, level = 1 }: PageHeaderProps) {
  useDocumentTitle(title, level)
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b px-4 py-2", className)}>
      <div className="min-w-0 flex-[1_1_16rem] space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {eyebrow ? (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-chrome>
              {eyebrow}
              <span aria-hidden="true">›</span>
            </div>
          ) : null}
          <Heading className={cn("font-semibold text-balance", level === 1 ? "text-lg" : "text-base")}>{title}</Heading>
          {meta}
        </div>
        {description ? <p className="max-w-[90ch] text-xs text-pretty text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5" data-chrome>{actions}</div> : null}
    </header>
  )
}

export interface SectionProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Heading level; sections directly under the page title use h2. */
  level?: 2 | 3
  id?: string
}

export function Section({ title, description, actions, children, className, level = 2, id }: SectionProps) {
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        {/* Like PageHeader: the heading block takes the free space and wraps its description, so actions stay beside it. */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <Heading id={id ? `${id}-title` : undefined} className="text-sm font-semibold">
            {title}
          </Heading>
          {description ? <p className="text-xs text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2 self-start">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Scrollable page body with the standard padding and vertical rhythm. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 px-4 py-3", className)}>{children}</div>
}

export interface ListDetailProps {
  list: ReactNode
  detail: ReactNode
  /** Accessible name for the list pane, e.g. "Sessions". */
  listLabel: string
  className?: string
}

/**
 * List + detail pattern: the list stays visible while the detail changes.
 * At 1024 px the list keeps 18rem and the detail takes the rest. Below
 * 768 px the panes stack and scroll with the page (WCAG 1.4.10).
 */
export function ListDetail({ list, detail, listLabel, className }: ListDetailProps) {
  return (
    <div
      className={cn(
        "grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)] max-md:flex-none max-md:grid-cols-1 xl:grid-cols-[22rem_minmax(0,1fr)]",
        className,
      )}
    >
      <nav aria-label={listLabel} className="min-h-0 overflow-y-auto border-r max-md:border-r-0 max-md:border-b">
        {list}
      </nav>
      <div className="min-h-0 min-w-0 overflow-y-auto">{detail}</div>
    </div>
  )
}

export interface Step {
  id: string
  label: string
}

/** Progress through a short, ordered flow (onboarding, review → apply). */
export function StepIndicator({ steps, current, completed = [], label }: { steps: Step[]; current: string; completed?: string[]; label: string }) {
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {steps.map((step, index) => {
        const isCurrent = step.id === current
        const isDone = completed.includes(step.id)
        return (
          <li key={step.id} aria-current={isCurrent ? "step" : undefined} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-5 items-center justify-center rounded-full border text-xs tabular-nums",
                isCurrent && "border-primary bg-primary text-primary-foreground",
                isDone && !isCurrent && "border-success text-success",
                !isCurrent && !isDone && "text-muted-foreground",
              )}
            >
              {isDone && !isCurrent ? <Check aria-hidden="true" className="size-3.5" /> : index + 1}
            </span>
            <span className={cn(isCurrent ? "font-medium text-foreground" : "text-muted-foreground")}>
              {step.label}
              {isDone && !isCurrent ? <span className="sr-only"> (done)</span> : null}
            </span>
            {index < steps.length - 1 ? <span aria-hidden="true" className="h-px w-6 bg-border" /> : null}
          </li>
        )
      })}
    </ol>
  )
}

export interface PlaceholderPageProps {
  title: string
  route: string
  owner: { track: "T1" | "T2" | "T3" | "T4" | "T5"; name: string }
  /** Journeys and specs this screen serves. */
  covers: string
  /** Child route outlet, for pre-created layout routes. */
  children?: ReactNode
  /** 2 for areas rendered inside a layout route that owns the h1. */
  level?: 1 | 2
}

/**
 * Pre-created page for a track (foundation scaffold). Shows only the screen
 * title, its fixed route and the owning track; the track replaces the body.
 */
export function PlaceholderPage({ title, route, owner, covers, children, level = 1 }: PlaceholderPageProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-placeholder-page={owner.track}>
      <PageHeader title={title} level={level} />
      <PageBody>
        <dl className="grid max-w-xl grid-cols-[8rem_1fr] gap-x-4 gap-y-2 rounded-lg border p-4 text-sm">
          <dt className="text-muted-foreground">Route</dt>
          <dd className="font-mono text-xs leading-5">#{route}</dd>
          <dt className="text-muted-foreground">Owner</dt>
          <dd>
            Track {owner.track}: {owner.name}
          </dd>
          <dt className="text-muted-foreground">Covers</dt>
          <dd>{covers}</dd>
        </dl>
      </PageBody>
      {children}
    </div>
  )
}
