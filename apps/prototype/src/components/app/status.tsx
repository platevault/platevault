/**
 * Shared status vocabulary (foundation-owned). Every domain state shown in
 * the UI goes through `StatusBadge` so labels, tone and icon stay identical
 * across tracks. State is never conveyed by colour alone: each badge carries
 * an icon and a text label. Labels reuse the spec terms exactly.
 *
 * A track that needs a new status value asks the integration owner; it does
 * not render ad-hoc coloured pills.
 */
import {
  Archive,
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleSlash,
  CircleX,
  Clock,
  FileDiff,
  Hourglass,
  Link2,
  Loader,
  Lock,
  type LucideIcon,
  Pause,
  Plug,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  Wrench,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export type Tone = "neutral" | "muted" | "info" | "success" | "warning" | "danger"

interface StatusMeta {
  label: string
  tone: Tone
  icon: LucideIcon
}

function s(label: string, tone: Tone, icon: LucideIcon): StatusMeta {
  return { label, tone, icon }
}

export const STATUS = {
  availability: {
    online: s("Online", "success", Plug),
    offline: s("Offline", "warning", Unplug),
    unreadable: s("Unreadable", "danger", Lock),
    absent: s("Not found", "danger", CircleX),
    available: s("Available", "success", Check),
  },
  access: {
    ok: s("Readable", "success", Check),
    denied: s("Access denied", "danger", Lock),
    unknown: s("Not checked", "muted", CircleHelp),
  },
  scanScope: {
    never: s("Not indexed", "muted", CircleDashed),
    complete: s("Complete scope", "success", CheckCheck),
    incomplete: s("Incomplete scope", "warning", TriangleAlert),
    provisional: s("Provisional", "info", Hourglass),
  },
  role: {
    captures: s("Captures", "neutral", CircleDot),
    calibration: s("Calibration", "neutral", CircleDot),
    results: s("Results", "neutral", CircleDot),
    archive: s("Archive", "neutral", Archive),
    unset: s("Not set", "muted", CircleDashed),
  },
  quality: {
    unreviewed: s("Unreviewed", "muted", CircleDashed),
    usable: s("Usable", "success", Check),
    unusable: s("Unusable", "neutral", Ban),
    "changed-content": s("Changed content", "warning", FileDiff),
    "project-rejected": s("Rejected for Project", "neutral", CircleSlash),
    excluded: s("Excluded from View", "neutral", CircleSlash),
  },
  association: {
    confirmed: s("Confirmed", "success", ShieldCheck),
    associated: s("Associated", "info", Link2),
    "needs-review": s("Needs review", "warning", TriangleAlert),
    unresolved: s("Unresolved", "warning", CircleHelp),
  },
  operation: {
    running: s("Running", "info", Loader),
    paused: s("Paused", "neutral", Pause),
    succeeded: s("Finished", "success", Check),
    partial: s("Partial", "warning", TriangleAlert),
    failed: s("Failed", "danger", CircleX),
    canceled: s("Canceled", "muted", CircleSlash),
    interrupted: s("Interrupted", "warning", CircleAlert),
  },
  item: {
    pending: s("Pending", "muted", Clock),
    running: s("Running", "info", Loader),
    done: s("Done", "success", Check),
    blocked: s("Blocked", "danger", Ban),
    failed: s("Failed", "danger", CircleX),
    skipped: s("Skipped", "muted", CircleSlash),
    uncertain: s("Uncertain", "warning", CircleHelp),
  },
  view: {
    draft: s("Draft", "muted", CircleDashed),
    saved: s("Saved", "neutral", Check),
    prepared: s("Prepared", "success", CheckCheck),
    complete: s("Complete", "success", ShieldCheck),
  },
  preparation: {
    running: s("Running", "info", Loader),
    prepared: s("Prepared", "success", CheckCheck),
    partial: s("Partial", "warning", TriangleAlert),
    failed: s("Failed", "danger", CircleX),
    canceled: s("Canceled", "muted", CircleSlash),
    paused: s("Paused", "neutral", Pause),
  },
  assignment: {
    suggested: s("Suggested", "info", CircleDot),
    accepted: s("Accepted", "success", Check),
    exception: s("Exception", "warning", Wrench),
    excluded: s("Excluded", "neutral", CircleSlash),
    deferred: s("Deferred", "muted", Clock),
    unresolved: s("Unresolved", "warning", CircleHelp),
  },
  match: {
    compatible: s("Compatible", "success", Check),
    incompatible: s("Incompatible", "danger", CircleX),
    unknown: s("Unknown", "warning", CircleHelp),
  },
  lineage: {
    "tool-recorded": s("Tool-recorded", "info", Link2),
    "user-linked": s("User-linked", "neutral", Link2),
    unknown: s("Unknown lineage", "muted", CircleHelp),
  },
  acceptance: {
    candidate: s("Candidate", "muted", CircleDashed),
    accepted: s("Accepted", "success", Check),
  },
  processing: {
    pending: s("Pending", "muted", Clock),
    written: s("Written", "neutral", Check),
    unknown: s("State unknown", "muted", CircleHelp),
  },
  content: {
    unchanged: s("Unchanged", "muted", Check),
    drifted: s("Drifted", "warning", FileDiff),
  },
  custody: {
    keep: s("Keep", "neutral", ShieldCheck),
    protected: s("Protected", "neutral", Lock),
  },
  master: {
    adopted: s("Adopted", "success", ShieldCheck),
    candidate: s("Candidate", "muted", CircleDashed),
  },
  measurement: {
    valid: s("Measured", "success", Check),
    pending: s("Pending", "muted", Clock),
    failed: s("Failed fit", "danger", CircleX),
    unavailable: s("Not measured", "muted", CircleDashed),
  },
  save: {
    saved: s("Saved", "neutral", Check),
    unsaved: s("Unsaved changes", "warning", CircleAlert),
    saving: s("Saving", "info", Loader),
    failed: s("Not saved", "danger", CircleX),
    stale: s("Changed elsewhere", "warning", TriangleAlert),
  },
  reminders: {
    disabled: s("Notifications off", "muted", CircleSlash),
    enabled: s("Notifications on", "success", Check),
    denied: s("Permission denied", "danger", Ban),
  },
  trash: {
    supported: s("OS Trash supported", "success", Check),
    unsupported: s("OS Trash unsupported", "danger", Ban),
  },
  source: {
    manual: s("Manual", "neutral", Wrench),
    detected: s("Detected", "info", CircleDot),
    "built-in": s("Built-in", "muted", ShieldCheck),
  },
  site: {
    default: s("Default site", "info", CircleDot),
  },
} satisfies Record<string, Record<string, StatusMeta>>

export type StatusKind = keyof typeof STATUS
export type StatusValue<K extends StatusKind> = keyof (typeof STATUS)[K] & string

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-secondary text-secondary-foreground",
  muted: "border-border bg-transparent text-muted-foreground",
  // Info stays neutral text with an accent icon so badges never compete with
  // the one accent used for primary actions and selection.
  info: "bg-secondary text-secondary-foreground [&>svg]:text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/14 text-warning",
  danger: "bg-destructive/12 text-destructive",
}

export function statusMeta<K extends StatusKind>(kind: K, value: StatusValue<K>): StatusMeta {
  return (STATUS[kind] as Record<string, StatusMeta>)[value] ?? s(String(value), "muted", CircleHelp)
}

export interface StatusBadgeProps<K extends StatusKind> {
  kind: K
  value: StatusValue<K>
  /** Override the label, e.g. "Offline since 12 Sep". Keep the spec term first. */
  label?: string
  className?: string
}

export function StatusBadge<K extends StatusKind>({ kind, value, label, className }: StatusBadgeProps<K>) {
  const meta = statusMeta(kind, value)
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn("rounded-md border-transparent", TONE_CLASS[meta.tone], className)} data-status={`${kind}:${value}`}>
      <Icon aria-hidden="true" className={cn(value === "running" && "motion-safe:animate-spin")} />
      {label ?? meta.label}
    </Badge>
  )
}
