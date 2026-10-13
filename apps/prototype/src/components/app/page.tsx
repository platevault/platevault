/**
 * Page-level layout primitives (foundation-owned): page header, sections,
 * list + detail, step indicator and the pre-created placeholder page. The
 * page templates (components/templates) build on PageHeader.
 */
import { Check, ChevronRight } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import { CurrentLink } from "@/components/app/run-step"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import type { StepLink } from "@/domain/derive"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { NoticeSlot, type PageNotice } from "./feedback"

const mountedTitles = new Map<symbol, string>()

function applyDocumentTitle() {
  document.title = [...mountedTitles.values(), m.app_document_title()].join(" · ")
}

/**
 * Names the browser tab after the page: "Sessions · PlateVault prototype"
 * (WCAG 2.4.2). Only a page-level heading names it; a child area, a tab or
 * a catalogue specimen (level 2) passes null and adds nothing.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title === null) return
    const key = Symbol(title)
    mountedTitles.set(key, title)
    applyDocumentTitle()
    return () => {
      mountedTitles.delete(key)
      applyDocumentTitle()
    }
  }, [title])
}

/** One parent of the page in its header path: "Projects", "M 42". */
export interface PathItem {
  label: string
  /** Where the parent opens; a parent without a link reads as plain text. */
  link?: StepLink
}

export interface PageHeaderProps {
  title: string
  /** The page's parents, outermost first, as a breadcrumb before the title: Projects › M 42 › title. */
  path?: PathItem[]
  /** One short fact beside the title, such as a list's count ("128 sessions"). Never a sentence. */
  summary?: string
  /**
   * @deprecated W4 removes it (plan §3.4, §6.1 W1): no description caption
   * under the title. The title stands alone; a count goes in `summary`.
   */
  description?: ReactNode
  /** @deprecated W4 removes it: pass the parents as `path`. */
  eyebrow?: ReactNode
  /** Status badges shown beside the title. */
  meta?: ReactNode
  /** Page-level actions; the primary action goes last. Templates pass an ActionBar. */
  actions?: ReactNode
  /** The page's standing state (P7): one notice, fixed under the header bar. */
  notice?: PageNotice | null
  className?: string
  /**
   * Heading level. Layout routes (View workspace, Settings) own the page h1;
   * their child areas render their title as h2.
   */
  level?: 1 | 2
}

/**
 * Harness v4: a pane header, not a web page header. One compact bar: the
 * path (a breadcrumb inline before the title, never a kicker above it), the
 * title at 17 px, the summary, meta badges, and actions on the right. The
 * notice slot sits under the bar, inside the header, so a standing state
 * stays in view with it. Level 1 sticks to the top of its pane so the title
 * and actions never scroll away, and publishes its height as
 * --pane-header-h so focused controls scroll clear of it.
 */
export function PageHeader({ title, path, summary, description, eyebrow, meta, actions, notice, className, level = 1 }: PageHeaderProps) {
  useDocumentTitle(level === 1 ? title : null)
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
          {path && path.length > 0 ? <HeaderPath path={path} /> : null}
          {eyebrow ? (
            <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground [&_a]:hover:text-foreground">
              {eyebrow}
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />
            </span>
          ) : null}
          <Heading className={cn("font-semibold text-balance", level === 1 ? "text-xl" : "text-lg")}>{title}</Heading>
          {summary ? <span className="ml-1 text-sm text-muted-foreground tabular-nums">{summary}</span> : null}
          {meta ? <span className="ml-1 flex flex-wrap items-center gap-2">{meta}</span> : null}
        </div>
        {description ? (
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={typeof description === "string" ? description : undefined}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">{actions}</div> : null}
      {notice ? (
        <div className="basis-full">
          <NoticeSlot notice={notice} />
        </div>
      ) : null}
    </header>
  )
}

/** The header path: a breadcrumb of the page's parents, ending in the separator before the title. */
function HeaderPath({ path }: { path: PathItem[] }) {
  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="gap-1.5">
        {path.map((item, index) => (
          <Fragment key={`${index}:${item.label}`}>
            <BreadcrumbItem className="min-w-0">
              {item.link ? (
                <BreadcrumbLink
                  render={<CurrentLink to={item.link.to as never} params={item.link.params as never} search={item.link.search as never} />}
                  className="truncate"
                >
                  {item.label}
                </BreadcrumbLink>
              ) : (
                <span className="truncate">{item.label}</span>
              )}
            </BreadcrumbItem>
            <BreadcrumbSeparator className="opacity-70" />
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
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
      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto">{detail}</div>
    </div>
  )
}

/** @deprecated Removed in W4 with `StepIndicator`: a flow's steps are `FlowStep`s (components/app/contracts.ts). */
export interface Step {
  id: string
  label: string
}

/**
 * Progress through a short, ordered flow (onboarding, review → apply).
 * @deprecated Removed in W4: render `StepStrip` and `StepFooter` (components/app/step-flow.tsx) from a `StepFlow` (plan P11).
 */
export function StepIndicator({ steps, current, completed = [], label }: { steps: Step[]; current: string; completed?: string[]; label: string }) {
  const m = useMessages()
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
              {isDone && !isCurrent ? <span className="sr-only"> {m.page_step_done()}</span> : null}
            </span>
            {index < steps.length - 1 ? <span aria-hidden="true" className="h-px w-6 bg-border" /> : null}
          </li>
        )
      })}
    </ol>
  )
}
