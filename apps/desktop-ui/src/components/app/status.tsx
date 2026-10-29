/**
 * Shared status vocabulary (foundation-owned). Every domain state shown in
 * the UI goes through `StatusBadge` so labels, tone and icon stay identical
 * across tracks. State is never conveyed by colour alone: each badge carries
 * an icon and a text label. Labels reuse the spec terms exactly.
 *
 * The one registry (R9-COMPOSITION-PLAN P10): a run step's gate is
 * `<StatusBadge kind="gate" value={state} />` (replaces GateLabel), and the
 * application-profile states are the `profile`, `executable`, `check` and
 * `write` kinds (replace T4Badge).
 *
 * A track that needs a new status value asks the integration owner; it does
 * not render ad-hoc coloured pills.
 */
import {
  Archive,
  Ban,
  CalendarClock,
  Check,
  CheckCheck,
  Circle,
  CircleAlert,
  CircleArrowRight,
  CircleArrowUp,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleEllipsis,
  CircleHelp,
  CirclePlus,
  CircleSlash,
  CircleX,
  Copy,
  CopyX,
  Clock,
  EyeOff,
  FileDiff,
  Hourglass,
  Link2,
  Loader,
  Lock,
  type LucideIcon,
  OctagonX,
  Pause,
  Plug,
  ShieldCheck,
  ShieldQuestion,
  Trash2,
  TriangleAlert,
  Unplug,
  Wrench,
} from "lucide-react"
import type { ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { Badge } from "@/components/ui/badge"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export type Tone = "neutral" | "muted" | "info" | "success" | "warning" | "danger"

interface StatusMeta {
  /** The status word in the chosen language, read at render. */
  readonly label: string
  tone: Tone
  icon: LucideIcon
}

function s(message: () => string, tone: Tone, icon: LucideIcon): StatusMeta {
  return {
    get label() {
      return message()
    },
    tone,
    icon,
  }
}

export const STATUS = {
  availability: {
    online: s(m.status_online, "success", Plug),
    offline: s(m.status_offline, "warning", Unplug),
    unreadable: s(m.status_unreadable, "danger", Lock),
    absent: s(m.status_not_found, "danger", CircleX),
    retired: s(m.status_retired, "muted", Archive),
    available: s(m.status_available, "success", Check),
  },
  access: {
    ok: s(m.status_readable, "success", Check),
    denied: s(m.status_access_denied, "danger", Lock),
    unknown: s(m.status_not_checked, "muted", CircleHelp),
  },
  scanScope: {
    never: s(m.status_not_indexed, "muted", CircleDashed),
    complete: s(m.status_complete_scope, "success", CheckCheck),
    incomplete: s(m.status_incomplete_scope, "warning", TriangleAlert),
    provisional: s(m.status_provisional, "info", Hourglass),
  },
  role: {
    captures: s(m.status_role_captures, "neutral", CircleDot),
    calibration: s(m.status_role_calibration, "neutral", CircleDot),
    results: s(m.status_role_results, "neutral", CircleDot),
    archive: s(m.status_role_archive, "neutral", Archive),
    unset: s(m.status_not_set, "muted", CircleDashed),
  },
  quality: {
    unreviewed: s(m.status_unreviewed, "muted", CircleDashed),
    usable: s(m.status_usable, "success", Check),
    unusable: s(m.status_unusable, "neutral", Ban),
    "changed-content": s(m.status_changed_content, "warning", FileDiff),
    "verification-pending": s(m.status_verification_pending, "info", Hourglass),
    "project-rejected": s(m.status_rejected_for_project, "neutral", CircleSlash),
    excluded: s(m.status_excluded_from_view, "neutral", CircleSlash),
  },
  association: {
    confirmed: s(m.status_confirmed, "success", ShieldCheck),
    associated: s(m.status_associated, "info", Link2),
    "needs-review": s(m.status_needs_review, "warning", TriangleAlert),
    unresolved: s(m.status_unresolved, "warning", CircleHelp),
  },
  copies: {
    conflicting: s(m.status_conflicting_copies, "warning", CopyX),
  },
  operation: {
    running: s(m.status_running, "info", Loader),
    paused: s(m.status_paused, "neutral", Pause),
    succeeded: s(m.status_finished, "success", Check),
    partial: s(m.status_partial, "warning", CircleDashed),
    failed: s(m.status_failed, "danger", CircleX),
    canceled: s(m.status_canceled, "muted", CircleSlash),
    interrupted: s(m.status_interrupted, "warning", CircleAlert),
  },
  item: {
    pending: s(m.status_pending, "muted", Clock),
    running: s(m.status_running, "info", Loader),
    done: s(m.status_done, "success", Check),
    blocked: s(m.status_blocked, "danger", Ban),
    failed: s(m.status_failed, "danger", CircleX),
    skipped: s(m.status_skipped, "muted", CircleSlash),
    uncertain: s(m.status_uncertain, "warning", CircleHelp),
  },
  /** A Project's lifecycle (PRJ-FR-14, PRJ-FR-25, PRJ-FR-32): the library's `ProjectLifecycle`. Closing: Close was confirmed and its archive runs. */
  project: {
    open: s(m.status_open, "info", CircleDot),
    closing: s(m.status_closing, "warning", Hourglass),
    closed: s(m.status_closed, "success", ShieldCheck),
    archived: s(m.status_archived, "neutral", Archive),
  },
  /** A record's custody: a session or frame in the OS Trash. */
  record: {
    trashed: s(m.status_trashed, "muted", Trash2),
  },
  /** A step's gate: each state its own glyph shape, so colour only reinforces. The triangle stays for warnings. */
  gate: {
    done: s(m.status_done, "success", CircleCheck),
    ready: s(m.status_ready, "info", CircleArrowRight),
    review: s(m.status_needs_review, "warning", CircleEllipsis),
    blocked: s(m.status_blocked, "danger", OctagonX),
    running: s(m.status_running, "info", Loader),
    partial: s(m.status_partial, "warning", CircleDashed),
    idle: s(m.status_not_started, "muted", Circle),
  },
  /** An application profile's capability claims. */
  profile: {
    verified: s(m.apps_badge_verified, "success", ShieldCheck),
    unverified: s(m.run_profile_not_verified, "muted", ShieldQuestion),
  },
  executable: {
    found: s(m.apps_badge_found, "success", Check),
    "not-configured": s(m.apps_badge_not_configured, "muted", CircleDashed),
    missing: s(m.status_missing, "danger", CircleX),
    "launch-fails": s(m.apps_badge_launch_failed, "danger", TriangleAlert),
  },
  /** A review check on an application profile. */
  check: {
    ok: s(m.apps_badge_checked, "success", Check),
    blocked: s(m.status_blocked, "danger", Ban),
    warning: s(m.apps_badge_needs_attention, "warning", TriangleAlert),
  },
  /** Whether an application writes to its inputs. */
  write: {
    "read-only": s(m.apps_badge_read_only, "success", Check),
    unknown: s(m.apps_badge_writes_unknown, "warning", CircleHelp),
    "write-prone": s(m.apps_badge_write_prone, "danger", TriangleAlert),
  },
  assignment: {
    suggested: s(m.status_suggested, "info", CircleDot),
    accepted: s(m.status_accepted, "success", Check),
    exception: s(m.status_exception, "warning", Wrench),
    deferred: s(m.status_deferred, "muted", Clock),
    unresolved: s(m.status_unresolved, "warning", CircleHelp),
  },
  match: {
    compatible: s(m.status_compatible, "success", Check),
    incompatible: s(m.status_incompatible, "danger", CircleX),
    unknown: s(m.status_unknown, "warning", CircleHelp),
  },
  processing: {
    pending: s(m.status_pending, "muted", Clock),
    written: s(m.status_written, "neutral", Check),
    unknown: s(m.status_state_unknown, "muted", CircleHelp),
  },
  content: {
    unchanged: s(m.status_unchanged, "muted", Check),
    drifted: s(m.status_drifted, "warning", FileDiff),
  },
  custody: {
    keep: s(m.status_keep, "neutral", ShieldCheck),
    protected: s(m.status_protected, "neutral", Lock),
  },
  master: {
    adopted: s(m.status_adopted, "success", ShieldCheck),
    candidate: s(m.status_candidate, "muted", CircleDashed),
  },
  measurement: {
    valid: s(m.status_measured, "success", Check),
    pending: s(m.status_pending, "muted", Clock),
    // PIX-FR-01: a cached measurement reads Verifying until its bytes rehash to the recorded digest.
    verifying: s(m.status_verifying, "info", Hourglass),
    failed: s(m.status_failed_fit, "danger", CircleX),
    unavailable: s(m.status_not_measured, "muted", CircleDashed),
  },
  /** A calibration process's state, as the feature that owns the process maps it. */
  process: {
    "awaiting-stack": s(m.status_to_stack, "info", CircleArrowRight),
    stacking: s(m.status_stacking, "info", Loader),
    importing: s(m.status_importing, "info", Loader),
    "trashing-raws": s(m.status_trashing_raws, "info", Loader),
    failed: s(m.status_failed, "danger", CircleX),
    done: s(m.status_done, "success", CircleCheck),
  },
  /** A master file's match against the library in an import preview (CAL-FR-13); "New version of {master}" passes its own label. */
  masterMatch: {
    new: s(m.status_new, "success", CirclePlus),
    version: s(m.status_new_version, "info", CircleArrowUp),
    duplicate: s(m.status_duplicate, "muted", Copy),
    "not-master": s(m.status_not_a_master, "muted", CircleSlash),
  },
  /** A generated master's offer to the library: still offered, or hidden by the user. */
  offer: {
    offered: s(m.status_offered, "info", CircleDot),
    hidden: s(m.status_declined, "muted", EyeOff),
  },
  /** A master past its age limit; the caller's label carries the age ("Old · 40 d"). */
  masterAge: {
    old: s(m.status_old, "warning", CalendarClock),
  },
  /** A rule the product owner has not settled yet. */
  rule: {
    provisional: s(m.status_provisional, "muted", Hourglass),
  },
  developerMode: {
    on: s(m.status_on, "success", Check),
    off: s(m.status_off, "warning", TriangleAlert),
  },
  save: {
    saved: s(m.status_saved, "neutral", Check),
    unsaved: s(m.status_unsaved_changes, "warning", CircleAlert),
    saving: s(m.status_saving, "info", Loader),
    failed: s(m.status_not_saved, "danger", CircleX),
    stale: s(m.status_changed_elsewhere, "warning", TriangleAlert),
  },
  reminders: {
    disabled: s(m.status_notifications_off, "muted", CircleSlash),
    enabled: s(m.status_notifications_on, "success", Check),
    denied: s(m.status_permission_denied, "danger", Ban),
  },
  trash: {
    supported: s(m.status_os_trash_supported, "success", Check),
    unsupported: s(m.status_os_trash_unsupported, "danger", Ban),
  },
  source: {
    manual: s(m.status_manual, "neutral", Wrench),
    detected: s(m.status_detected, "info", CircleDot),
    "built-in": s(m.status_built_in, "muted", ShieldCheck),
  },
  site: {
    default: s(m.status_default_site, "info", CircleDot),
  },
  checklist: {
    met: s(m.status_met, "success", Check),
    partial: s(m.status_partial, "warning", CircleDashed),
    missing: s(m.status_missing, "danger", CircleX),
    unknown: s(m.status_unknown, "muted", CircleHelp),
  },
} satisfies Record<string, Record<string, StatusMeta>>

export type StatusKind = keyof typeof STATUS
export type StatusValue<K extends StatusKind> = keyof (typeof STATUS)[K] & string

/**
 * Harness v4: a status reads as a native status label, a tinted glyph and its
 * word, never a filled pill. Tone colours are text colours that meet 4.5:1 on
 * every surface; info keeps foreground text with an accent glyph.
 */
const STATUS_CLASS = "h-auto min-h-5 gap-1 rounded-none border-0 bg-transparent px-0 py-0 text-[0.75rem] font-medium [&>svg]:size-3.5!"

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-foreground [&>svg]:text-muted-foreground",
  muted: "text-muted-foreground",
  info: "text-foreground [&>svg]:text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
}

export function statusMeta<K extends StatusKind>(kind: K, value: StatusValue<K>): StatusMeta {
  return (STATUS[kind] as Record<string, StatusMeta>)[value] ?? s(() => String(value), "muted", CircleHelp)
}

export interface StatusBadgeProps<K extends StatusKind> {
  kind: K
  value: StatusValue<K>
  /** Override the label, e.g. "Offline since 12 Sep". Keep the spec term first. */
  label?: string
  className?: string
}

/** The status as glyph and word; the spec term reads in the chosen language, a caller's `label` as given. */
export function StatusBadge<K extends StatusKind>({ kind, value, label, className }: StatusBadgeProps<K>) {
  // Subscribes to the language: the word comes from `meta.label`.
  useMessages()
  const meta = statusMeta(kind, value)
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS, TONE_CLASS[meta.tone], className)} data-status={`${kind}:${value}`}>
      <Icon aria-hidden="true" className={cn(meta.icon === Loader && "motion-safe:animate-spin")} />
      {label ?? meta.label}
    </Badge>
  )
}

/** Several statuses of one object side by side, 8 px apart; they wrap onto the next line when the row runs out of room. */
export function StatusBadges({ children }: { children: ReactNode }) {
  return <span className="inline-flex flex-wrap items-center gap-2">{children}</span>
}
