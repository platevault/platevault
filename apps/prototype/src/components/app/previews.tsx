/**
 * HoverCard previews (L2; design/R9-COMPOSITION-PLAN.md P9): small,
 * data-bearing cards that open on hover and on focus and close on Escape.
 * Nothing is hover-only: each trigger is itself a link or button to the full
 * place, or, for an unavailable control, the card restates what its
 * accessible description already says.
 *
 * - Preview: the shared host. A `focusOnPress` trigger moves focus into the
 *   card when activated, so the card's links have a keyboard path; Escape
 *   closes it and returns focus to the trigger.
 * - BlockersPreview: why an action is unavailable, one row per blocker,
 *   linked to where it can be resolved; with `columns`, a table of item ·
 *   where ▸ ("Session · Project"). Wraps an unavailable control, or
 *   renders its own "reason ▸" trigger beside a refusal line.
 * - UsedByPreview: "Used by 6 sessions ▸", a link to the full list,
 *   previewing the first rows.
 * - MasterPreview: one dated version of a calibration master (CAL-FR-14):
 *   the master's name, a link to it in the Calibration library, previewing
 *   the record's settings (kind, camera, gain · offset, temperature,
 *   exposure) and that version's own facts (which of the versions it is,
 *   its capture night, frames and origin), the master's age badge and how
 *   many Projects use the master. The card holds no controls, so it takes
 *   no focus. Compact, the trigger is an icon link beside a control that
 *   already shows the name (a master picker), and the card takes the name
 *   as its title.
 * - PlaceLink: the plain link to a place these previews use as their
 *   trigger, for a place with nothing to preview (a raw calibration session).
 *
 * The card opens over the page, so nothing moves when it opens (C-8).
 */
import { Link } from "@tanstack/react-router"
import { ArrowUpRight, ChevronRight } from "lucide-react"
import { type ComponentProps, type ReactElement, type ReactNode, cloneElement, useEffect, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { KIND_NAME } from "@/domain/calibration"
import type { StepLink } from "@/domain/derive"
import { nightOf } from "@/domain/indexing"
import type { CalibrationMaster, MasterVersion } from "@/domain/types"
import { formatCount, formatExposure, formatNight } from "@/lib/format"
import { type MessageRef, msg, say } from "@/lib/i18n"
import { BoxTable } from "./box"
import type { Blocker, BlockerColumns, Column } from "./contracts"
import { KeyValueList } from "./data"
import { Pill } from "./pill"

const FOCUSABLE = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"

export interface PreviewProps {
  /** The trigger: a router link or a button to the full place, or a wrapper around an unavailable control. */
  trigger: ReactElement
  /** A short heading, when the trigger's own text does not already name the card. */
  title?: string
  children: ReactNode
  /** Activating the trigger moves focus into the card, for cards whose links have no other keyboard path. */
  focusOnPress?: boolean
}

export function Preview({ trigger, title, children, focusOnPress = false }: PreviewProps) {
  const [open, setOpen] = useState(false)
  const [presses, setPresses] = useState(0)
  // Typed as the default <a>; it holds whatever element `trigger` renders.
  const triggerRef = useRef<HTMLAnchorElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)

  // After a press opens the card, move focus to its first link or button.
  useEffect(() => {
    if (presses === 0) return
    const frame = requestAnimationFrame(() => popupRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [presses])

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        // Closing with focus inside the card (Escape) hands focus back to the trigger, not the page.
        if (!next && popupRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
        setOpen(next)
      }}
    >
      <HoverCardTrigger
        ref={triggerRef}
        render={trigger}
        onClick={
          focusOnPress
            ? () => {
                setOpen(true)
                setPresses((n) => n + 1)
              }
            : undefined
        }
      />
      <HoverCardContent ref={popupRef} data-preview="">
        {title ? <p className="font-medium text-pretty">{title}</p> : null}
        {children}
      </HoverCardContent>
    </HoverCard>
  )
}

/** The router link a Button renders as, for a trigger that goes to a place. */
function routerLink(link: StepLink) {
  return <Link to={link.to as never} params={link.params as never} search={link.search as never} />
}

/** A link to a place, "Name ▸". It forwards the props a HoverCard trigger merges into it (handlers, ref). */
export function PlaceLink({ link, children, ...props }: Omit<ComponentProps<typeof Button>, "render" | "variant" | "size"> & { link: StepLink }) {
  return (
    <Button {...props} variant="link" size="xs" className="min-h-0 px-0 text-sm" render={routerLink(link)}>
      {children}
      <ChevronRight aria-hidden="true" data-icon="inline-end" />
    </Button>
  )
}

function Rows({ rows }: { rows: { label: string; link?: StepLink }[] }) {
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row) => (
        <li key={row.label} className="min-w-0 [overflow-wrap:anywhere]">
          {row.link ? <PlaceLink link={row.link}>{row.label}</PlaceLink> : row.label}
        </li>
      ))}
    </ul>
  )
}

/** Blockers held by a place, one row each: the item, then the place, linked to where it is resolved (P7). */
function BlockerTable({ caption, blockers, columns }: { caption: string; blockers: Blocker[]; columns: BlockerColumns }) {
  const where = (blocker: Blocker) => blocker.where ?? "–"
  const table: Column<Blocker>[] = [
    { id: "item", header: columns.item, rowHeader: true, truncate: true, sortValue: (blocker) => blocker.label, cell: (blocker) => blocker.label },
    { id: "where", header: columns.where, truncate: true, sortValue: where, cell: (blocker) => (blocker.link ? <PlaceLink link={blocker.link}>{where(blocker)}</PlaceLink> : where(blocker)) },
  ]
  return <BoxTable label={caption} rows={blockers} columns={table} getRowId={(blocker) => `${blocker.label}|${where(blocker)}`} />
}

export interface BlockersPreviewProps {
  /** "Can't archive". */
  action: string
  /** "2 in a Project". */
  reason: string
  blockers: Blocker[]
  /** The headers that show the blockers as a table, item · where ▸; without them, a list. */
  columns?: BlockerColumns
  /** Buttons that resolve the refusal, after the blockers. */
  actions?: ReactNode
  /**
   * The unavailable control, kept focusable while disabled (`focusableWhenDisabled`).
   * The card describes it (`aria-describedby`). Omit it beside a refusal line:
   * the preview then renders its own "reason ▸" trigger.
   */
  children?: ReactElement<{ "aria-describedby"?: string }>
}

export function BlockersPreview({ action, reason, blockers, columns, actions, children }: BlockersPreviewProps) {
  const descriptionId = useId()
  const list = blockers.length === 0 ? null : columns ? <BlockerTable caption={`${action} · ${reason}`} blockers={blockers} columns={columns} /> : <Rows rows={blockers} />
  const body = (
    <>
      {list}
      {actions ? <div className="flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </>
  )
  if (!children) {
    if (blockers.length === 0 && !actions) return <span className="text-muted-foreground">{reason}</span>
    return (
      <Preview
        focusOnPress
        trigger={
          <Button variant="ghost" size="xs" className="px-1 text-muted-foreground" data-blockers-trigger="">
            {reason}
            <ChevronRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        }
      >
        {body}
      </Preview>
    )
  }
  // A disabled control takes no pointer events, so a wrapper is the hover target; focus still bubbles from the control.
  const describedBy = [children.props["aria-describedby"], descriptionId].filter(Boolean).join(" ")
  return (
    <>
      <Preview trigger={<span className="inline-flex" data-blockers-trigger="">{cloneElement(children, { "aria-describedby": describedBy })}</span>} title={`${action} · ${reason}`}>
        {body}
      </Preview>
      <span id={descriptionId} hidden>{`${action} · ${reason}`}</span>
    </>
  )
}

export interface UsedByPreviewProps {
  /** "Used by 6 runs". */
  label: string
  /** The full list, filtered to this use. */
  link: StepLink
  /** The users, each linked to its own page. */
  items: { label: string; link?: StepLink }[]
}

export function UsedByPreview({ label, link, items }: UsedByPreviewProps) {
  const trigger = <PlaceLink link={link}>{label}</PlaceLink>
  if (items.length === 0) return trigger
  return (
    <Preview trigger={trigger}>
      <Rows rows={items} />
    </Preview>
  )
}

/** Where a master version came from (P-CAL3). */
const ORIGIN_NAME: Record<MasterVersion["origin"]["kind"], MessageRef> = {
  library: msg("calibration_origin_indexed"),
  generated: msg("calibration_origin_generated"),
  stacked: msg("calibration_origin_stacked"),
  imported: msg("calibration_origin_imported"),
}

export interface MasterPreviewProps {
  /** The master's name as the page lists it: the trigger's text, or the card's title when compact. */
  label: string
  /** The master in the Calibration library: `{ to: "/calibration", search: { master: id } }`. */
  link: StepLink
  /** The master record: the settings it matches, and its versions' ids (oldest capture first) to place `version` among them. */
  master: Pick<CalibrationMaster, "kind" | "cameraName" | "gain" | "offset" | "ccdTempC" | "exposureS"> & { versions: ReadonlyArray<Pick<MasterVersion, "id">> }
  /** The dated version the place names, such as a session's pin: its capture time, frames and origin. */
  version: Pick<MasterVersion, "id" | "capturedAt" | "frameCount" | "origin">
  /** "Old · 120 d" once the master's newest version is past the age limit (`masterAge`); null while it is younger, and for flats. */
  age: string | null
  /** How many Projects, open or Closed, use the master through their sessions (`masterProjects`). */
  usedBy: number
  /**
   * An icon trigger ("Open master: <name>") for a place that already shows the
   * name, such as a session's Calibration table.
   */
  compact?: boolean
}

export function MasterPreview({ label, link, master, version, age, usedBy, compact = false }: MasterPreviewProps) {
  const m = useMessages()
  const none = "–"
  const position = master.versions.findIndex((v) => v.id === version.id) + 1
  const items = [
    { label: m.run_col_kind(), value: say(m, KIND_NAME[master.kind]) },
    { label: m.calibration_key_camera(), value: master.cameraName ?? none },
    { label: m.session_gain_offset(), value: `${master.gain ?? none} · ${master.offset ?? none}` },
    { label: m.domain_criterion_temperature(), value: master.ccdTempC === null ? none : `${Math.round(master.ccdTempC)} °C` },
    { label: m.calibration_key_exposure(), value: master.exposureS === null ? none : formatExposure(master.exposureS) },
    { label: m.calibration_version(), value: position > 0 ? m.calibration_version_n_of({ n: formatCount(position), count: formatCount(master.versions.length) }) : none },
    { label: m.tonight_night(), value: formatNight(nightOf(version.capturedAt), true) },
    { label: m.calibration_frames(), value: version.frameCount === null ? none : formatCount(version.frameCount) },
    { label: m.calibration_origin(), value: say(m, ORIGIN_NAME[version.origin.kind]) },
    { label: m.calibration_used_by(), value: m.about_count_projects({ count: usedBy, n: formatCount(usedBy) }) },
  ]
  const trigger = compact ? (
    <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`${m.calibration_open_master()}: ${label}`} render={routerLink(link)} data-master-preview="">
      <ArrowUpRight aria-hidden="true" />
    </Button>
  ) : (
    <PlaceLink link={link}>{label}</PlaceLink>
  )
  return (
    <Preview trigger={trigger} title={compact ? label : undefined}>
      {age ? (
        <span className="flex">
          <Pill tone="warning">{age}</Pill>
        </span>
      ) : null}
      <KeyValueList items={items} />
    </Preview>
  )
}
