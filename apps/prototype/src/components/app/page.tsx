/**
 * Page-level layout primitives (foundation-owned): page header, sections,
 * list + detail, step indicator and the pre-created placeholder page.
 */
import { Check, ChevronRight } from "lucide-react"
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react"
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
  /** Small context line above the title, e.g. the parent Target or Project. */
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
 * Harness v4: a pane header, not a web page header. One compact bar: an
 * optional path (the eyebrow, rendered inline as a path control before the
 * title, never as a kicker above it), the title at 17 px, meta badges, and
 * actions on the right; the description is a one-line caption (11 px) that
 * truncates, with the whole text in its tooltip. Level 1 sticks to the top
 * of its pane so the title and actions never scroll away, and publishes its
 * height as --pane-header-h so focused controls scroll clear of it.
 */
export function PageHeader({ title, description, eyebrow, meta, actions, className, level = 1 }: PageHeaderProps) {
  useDocumentTitle(title, level)
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = ref.current
    const pane = header?.closest<HTMLElement>("#main")
    if (level !== 1 || !header || !pane) return
    const update = () => pane.style.setProperty("--pane-header-h", `${header.offsetHeight}px`)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(header)
    return () => {
      observer.disconnect()
      pane.style.removeProperty("--pane-header-h")
    }
  }, [level])
  const Heading = level === 1 ? "h1" : "h2"
  return (
    <header
      ref={ref}
      data-chrome
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-5",
        level === 1 ? "sticky top-0 z-10 border-b border-separator bg-background py-2" : "pt-3 pb-1",
        className,
      )}
    >
      <div className="min-w-0 flex-[1_1_16rem]">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {eyebrow ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&_a]:hover:text-foreground">
              {eyebrow}
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
            </span>
          ) : null}
          <Heading className={cn("font-semibold text-balance", level === 1 ? "text-xl" : "text-lg")}>{title}</Heading>
          {meta ? <span className="ml-1 flex flex-wrap items-center gap-2">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={typeof description === "string" ? description : undefined}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">{actions}</div> : null}
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

/** A pane section: an h2 at 15 px (h3 at 13 px) with a one-line caption at 11 px; actions sit beside the heading. */
export function Section({ title, description, actions, children, className, level = 2, id }: SectionProps) {
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <section aria-labelledby={id ? `${id}-title` : undefined} className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2" data-chrome>
        {/* Like PageHeader: the heading block takes the free space and wraps its description, so actions stay beside it. */}
        <div className="min-w-0 flex-1">
          <Heading id={id ? `${id}-title` : undefined} className={cn("font-semibold", level === 2 ? "text-lg" : "text-sm")}>
            {title}
          </Heading>
          {description ? <p className="mt-0.5 max-w-[80ch] text-xs text-pretty text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1.5 self-start">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** Scrollable pane body with the standard 20 px margins and vertical rhythm. */
export function PageBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("space-y-5 px-5 py-4", className)}>{children}</div>
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
                "flex size-6 items-center justify-center rounded-full border text-xs tabular-nums",
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
