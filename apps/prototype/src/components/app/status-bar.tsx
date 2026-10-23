/**
 * Status bar parts (L2; round 1b "Status bar", round 5 P-SB3, F7): the
 * window's full bottom bar, plain text and glyphs only, no pill backgrounds,
 * and the list popovers that open from it.
 *
 * - `StatusBar`: the `footer` (contentinfo) with a start, a centred middle
 *   and an end, plus one polite live region. The host passes only phase
 *   changes there (a notification arriving: "Import finished"), never a
 *   ticking count, so a screen reader hears each change once.
 * - `StatusGroup`: a named group of items (running work, the counters).
 * - `StatusLink`: an item that opens a page (Locations); `compact` keeps
 *   the glyph and moves the words to its tooltip and accessible name.
 * - `StatusText`, `StatusSelection`: plain words, and the selection count.
 * - `StatusOperation` and `MiniProgress`: one running operation; inline,
 *   Cancel shows on hover or focus in place of what ends the item.
 * - `StatusCounter`: a glyph and a count that opens a menu naming each
 *   page its issues are on, with its count, whether one issue or several
 *   (F7, R11); never a list of the issues themselves.
 * - `ListPopover`: a trigger (glyph plus count) that opens a list panel with
 *   a header. Its body is `ListRows` with `ListNotice` or
 *   `ListOperationRow` rows.
 */
import { Link } from "@tanstack/react-router"
import { CircleCheck, Info, type LucideIcon, OctagonX, SquareCheck, TriangleAlert, X } from "lucide-react"
import type { ReactElement, ReactNode, Ref } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { StepLink } from "@/domain/derive"
import { cn } from "@/lib/utils"
import { MenuItems, useAction } from "./actions"
import type { MenuItem } from "./contracts"
import { titleWhenCut } from "./cut-title"
import { useFollowLink } from "./links"

/** Data attributes a host passes through for its own focus moves and tests. */
type DataAttributes = { [key: `data-${string}`]: string | number | boolean | undefined }

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export interface StatusBarProps {
  /** The landmark's name: "Status bar". */
  label: string
  /** Leading items: locations, the selection. */
  start?: ReactNode
  /** Centred: running work. */
  middle?: ReactNode
  /** Trailing items: the issue counters, notifications. */
  end?: ReactNode
  /** The polite live region's words. Change them only on a phase change (a notification arrives); equal words announce nothing. */
  announcement?: string
}

export function StatusBar({ label, start, middle, end, announcement = "" }: StatusBarProps) {
  return (
    <footer data-chrome aria-label={label} className="relative flex h-6 shrink-0 items-center gap-2 border-t border-separator bg-chrome px-2 text-xs text-muted-foreground" data-status-bar="">
      {start}
      <div className="flex min-w-0 flex-1 justify-center">{middle}</div>
      {end}
      <span role="status" className="sr-only" data-status-announcer="">
        {announcement}
      </span>
    </footer>
  )
}

export interface StatusGroupProps extends DataAttributes {
  label: string
  /** `work` shares and gives up the free width; `counters` keeps its size. */
  layout?: "work" | "counters"
  ref?: Ref<HTMLDivElement>
  children: ReactNode
}

export function StatusGroup({ label, layout = "counters", ref, children, ...data }: StatusGroupProps) {
  return (
    <div ref={ref} role="group" aria-label={label} className={layout === "work" ? "flex min-w-0 shrink items-center gap-3" : "flex shrink-0 items-center gap-0.5"} {...data}>
      {children}
    </div>
  )
}

/** Plain words in the bar: "Idle". */
export function StatusText({ children, ...data }: { children: ReactNode } & DataAttributes) {
  return (
    <span className="shrink-0 px-1" {...data}>
      {children}
    </span>
  )
}

/** The selection a list reports: "3 selected", after a rule. */
export function StatusSelection({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 border-l border-separator pl-2 text-foreground" data-status-selection="">
      <SquareCheck aria-hidden="true" className="size-3 text-link" />
      {children}
    </span>
  )
}

export interface StatusLinkProps extends DataAttributes {
  to: string
  icon: LucideIcon
  /** What the item is: "Locations". Read before the words. */
  label: string
  /** "2 of 3 online". */
  text: string
  /** Narrow windows: the glyph alone, the words in its tooltip. */
  compact?: boolean
}

export function StatusLink({ to, icon: Icon, label, text, compact = false, ...data }: StatusLinkProps) {
  const button = (
    <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" render={<Link to={to as never} />} {...data}>
      <Icon data-icon="inline-start" aria-hidden="true" />
      <span className="sr-only">{`${label}: `}</span>
      <span className={compact ? "sr-only" : undefined}>{text}</span>
    </Button>
  )
  if (!compact) return button
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side="top">{`${label}: ${text}`}</TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Running work
// ---------------------------------------------------------------------------

/** A mini progress bar; work whose size is unknown (a tool stacking) pulses instead. */
export function MiniProgress({ value, label }: { value: number | null; label: string }) {
  const m = useMessages()
  if (value === null) {
    return <span role="progressbar" aria-label={label} aria-valuetext={m.status_bar_working()} className="block h-1 w-10 shrink-0 animate-pulse rounded-full bg-primary/40 motion-reduce:animate-none" />
  }
  return <Progress value={value} aria-label={label} className="w-10 shrink-0 gap-0 [&_[data-slot=progress-track]]:bg-foreground/15" />
}

export interface StatusOperationProps {
  id: string
  /** "Import 54 frames". */
  title: string
  /** Where the operation is shown in full (Activity). */
  href: string
  /** Percent done; null while the size is unknown. */
  value: number | null
  /** What ends the item: "42%", "Paused"; empty for work of unknown size. */
  word: string
  /** Shown when the operation can be cancelled. */
  onCancel?: () => void
  /** A row of the "+N" popover: full width, Cancel always visible. */
  expanded?: boolean
}

/** One operation: its title, progress and word. Inline, Cancel shows on hover or focus in place of the word, else of the pulse. */
export function StatusOperation({ id, title, href, value, word, onCancel, expanded = false }: StatusOperationProps) {
  const m = useMessages()
  const yields = !expanded && onCancel ? "group-focus-within/op:invisible group-hover/op:invisible" : undefined
  const cancel = onCancel ? (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onCancel}
      aria-label={`${m.verb_cancel()}: ${title}`}
      className={cn("size-4 text-muted-foreground", !expanded && "absolute right-0 opacity-0 group-focus-within/op:opacity-100 group-hover/op:opacity-100")}
      data-cancel={id}
    >
      <X aria-hidden="true" className="size-3" />
    </Button>
  ) : null
  return (
    <div className={cn("group/op flex min-w-0 items-center gap-1.5", expanded ? "w-full" : "max-w-60")} data-operation={id}>
      <Link to={href as never} className={cn("min-w-0 truncate text-foreground hover:underline", expanded && "flex-1")} onPointerEnter={titleWhenCut}>
        {title}
      </Link>
      {word || expanded ? (
        <>
          <MiniProgress value={value} label={title} />
          <span className={cn("relative inline-flex h-4 shrink-0 items-center justify-end gap-1", expanded ? "min-w-12" : "min-w-8")}>
            <span className={yields}>{word}</span>
            {cancel}
          </span>
        </>
      ) : (
        <span className="relative inline-flex h-4 shrink-0 items-center justify-end">
          <span className={cn("flex", yields)}>
            <MiniProgress value={value} label={title} />
          </span>
          {cancel}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Issue counters
// ---------------------------------------------------------------------------

/** A page a counter leads to: the owning page, filtered to the rows the issues are on. */
export interface StatusCounterPage {
  id: string
  /** The page and its count: "Sessions › Needs a Target (3)". */
  label: string
  link: StepLink
}

export interface StatusCounterProps extends DataAttributes {
  /** What the count is: "2 warnings". */
  label: string
  icon: LucideIcon
  tone: ListTone
  count: number
  /** The menu lists every page, one or several, so a single issue opens the same menu as many (R11). */
  pages: StatusCounterPage[]
}

/** A count in the bar that opens where its issues are (F7): never a list of the issues, so Dismiss and Restore stay on the rows. */
export function StatusCounter({ label, icon: Icon, tone, count, pages, ...data }: StatusCounterProps) {
  const runner = useAction()
  const follow = useFollowLink()
  const glyph = (
    <>
      <Icon aria-hidden="true" className={cn("size-3", TONE_TEXT[tone])} />
      {count}
    </>
  )
  const items: MenuItem[] = [{ heading: label }, ...pages.map((page) => ({ id: page.id, label: page.label, run: () => follow(page.link) }))]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="xs" className="shrink-0 gap-1 px-1 text-muted-foreground" />} aria-label={label} {...data}>
        {glyph}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-auto min-w-48">
        <MenuItems items={items} runner={runner} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// List popovers
// ---------------------------------------------------------------------------

export type ListTone = "danger" | "warning" | "info" | "success" | "muted"

const TONE_TEXT: Record<ListTone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
  muted: "text-muted-foreground",
}

const WIDTH = { sm: "w-80", md: "w-88", lg: "w-96" } as const

export interface ListPopoverTrigger extends DataAttributes {
  /** The trigger's accessible name: "2 errors", "Issues: 3 issues". */
  label: string
  /** The glyph before the content; none for a bare count ("+2"). */
  icon?: LucideIcon
  /** Tints the glyph; default muted. */
  tone?: ListTone
  /** After the glyph: a count, a CountBadge. */
  content?: ReactNode
  /** `xs` in the status bar (default), `sm` in the toolbar. */
  size?: "xs" | "sm"
}

export interface ListPopoverProps extends DataAttributes {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: ListPopoverTrigger
  /** The panel's name; default the title, else the trigger's label. */
  label?: string
  /** The header's heading; no header without it. */
  title?: string
  /** Beside the heading, muted: "3 issues". */
  meta?: string
  /** One link at the header's end: "Activity". */
  link?: { label: string; to: string }
  side?: "top" | "bottom"
  align?: "start" | "center" | "end"
  width?: keyof typeof WIDTH
  children: ReactNode
}

export function ListPopover({ open, onOpenChange, trigger, label, title, meta, link, side = "top", align = "end", width = "md", children, ...data }: ListPopoverProps) {
  const { label: triggerLabel, icon: Icon, tone = "muted", content, size = "xs", ...triggerData } = trigger
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger render={<Button variant="ghost" size={size} className={cn("shrink-0 gap-1 text-muted-foreground", size === "xs" ? "px-1" : "px-1.5")} />} aria-label={triggerLabel} {...triggerData}>
        {Icon ? <Icon aria-hidden="true" className={cn(size === "xs" ? "size-3" : undefined, TONE_TEXT[tone])} /> : null}
        {content}
      </PopoverTrigger>
      <PopoverContent side={side} align={align} className={cn("max-h-(--available-height) gap-0 overflow-y-auto p-0", WIDTH[width])} aria-label={label ?? title ?? triggerLabel} {...data}>
        {title ? (
          <div data-chrome className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h2>
            {meta ? <span className="shrink-0 text-xs text-muted-foreground">{meta}</span> : null}
            {link ? (
              <Button variant="link" size="xs" render={<Link to={link.to as never} />} onClick={() => onOpenChange(false)}>
                {link.label}
              </Button>
            ) : null}
          </div>
        ) : null}
        {children}
      </PopoverContent>
    </Popover>
  )
}

/** The rows of a list popover (ListNotice, operations). `dense` for operation rows. */
export function ListRows({ ref, dense = false, children }: { ref?: Ref<HTMLUListElement>; dense?: boolean; children: ReactNode }) {
  return (
    <ul ref={ref} className={cn("py-1", dense && "text-xs")}>
      {children}
    </ul>
  )
}

/** One row that holds a status operation in the "+N" popover. */
export function ListOperationRow({ children }: { children: ReactElement }) {
  return <li className="flex min-h-(--row-h) items-center px-3">{children}</li>
}

const NOTICE_GLYPH: Record<"success" | "warning" | "danger" | "neutral", { icon: LucideIcon; tone: ListTone }> = {
  success: { icon: CircleCheck, tone: "success" },
  warning: { icon: TriangleAlert, tone: "warning" },
  danger: { icon: OctagonX, tone: "danger" },
  neutral: { icon: Info, tone: "muted" },
}

export interface ListNoticeProps {
  id: string
  tone: keyof typeof NOTICE_GLYPH
  /** "Import finished · 54 frames". */
  text: string
  /** The words in full plus the detail, shown when the row is cut. */
  full: string
  href?: string
  onNavigate: () => void
  /** ISO time, and its words: "21:04", "27 Sep". */
  at: string
  time: string
}

/** One notification: glyph, words (a link when it has a page) and time. */
export function ListNotice({ id, tone, text, full, href, onNavigate, at, time }: ListNoticeProps) {
  const { icon: Glyph, tone: glyphTone } = NOTICE_GLYPH[tone]
  return (
    <li className="flex min-h-(--row-h) items-center gap-2 px-3 text-sm" data-notice={id}>
      <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", TONE_TEXT[glyphTone])} />
      {href ? (
        <Link to={href as never} onClick={onNavigate} className="min-w-0 flex-1 truncate hover:underline" onPointerEnter={(event) => titleWhenCut(event, full)}>
          {text}
        </Link>
      ) : (
        <span className="min-w-0 flex-1 truncate" onPointerEnter={(event) => titleWhenCut(event, full)}>
          {text}
        </span>
      )}
      <time dateTime={at} className="shrink-0 text-xs text-muted-foreground">
        {time}
      </time>
    </li>
  )
}
