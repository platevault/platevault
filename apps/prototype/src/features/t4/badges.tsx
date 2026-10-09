/**
 * T4-local status badges for values the shared STATUS table does not have
 * yet (profile verification, executable state, review checks, a preparation
 * whose entries failed re-verification at Open). Same shape as
 * `StatusBadge`: shared `Badge`, shared tone classes, an icon and a label, so
 * state is never colour alone. Requested from the integration owner as
 * STATUS additions; replace with `StatusBadge` once they land.
 */
import { Ban, Check, CircleDashed, CircleHelp, CircleX, type LucideIcon, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { STATUS_CLASS, TONE_CLASS, type Tone } from "@/components/app/status"
import { Badge } from "@/components/ui/badge"
import type { ApplicationProfile } from "@/domain/types"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** The label is a catalogue message, worded at render so a language change applies. */
const META = {
  "profile:verified": { label: m.apps_badge_verified, tone: "success", icon: ShieldCheck },
  "profile:unverified": { label: m.run_profile_not_verified, tone: "muted", icon: ShieldQuestion },
  "executable:found": { label: m.apps_badge_found, tone: "success", icon: Check },
  "executable:not-configured": { label: m.apps_badge_not_configured, tone: "muted", icon: CircleDashed },
  "executable:missing": { label: m.status_missing, tone: "danger", icon: CircleX },
  "executable:launch-fails": { label: m.apps_badge_launch_failed, tone: "danger", icon: TriangleAlert },
  "check:ok": { label: m.apps_badge_checked, tone: "success", icon: Check },
  "check:blocked": { label: m.status_blocked, tone: "danger", icon: Ban },
  "check:warning": { label: m.apps_badge_needs_attention, tone: "warning", icon: TriangleAlert },
  "write:read-only": { label: m.apps_badge_read_only, tone: "success", icon: Check },
  "write:unknown": { label: m.apps_badge_writes_unknown, tone: "warning", icon: CircleHelp },
  "write:write-prone": { label: m.apps_badge_write_prone, tone: "danger", icon: TriangleAlert },
  "preparation:unverified": { label: m.status_unverified, tone: "warning", icon: TriangleAlert },
} satisfies Record<string, { label: () => string; tone: Tone; icon: LucideIcon }>

export type T4BadgeValue = keyof typeof META

export function T4Badge({ value, label, className }: { value: T4BadgeValue; label?: string; className?: string }) {
  // Subscribes to the language: the default label is read below.
  useMessages()
  const meta = META[value]
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn(STATUS_CLASS, TONE_CLASS[meta.tone], className)} data-status={value}>
      <Icon aria-hidden="true" />
      {label ?? meta.label()}
    </Badge>
  )
}

export function ProfileBadge({ profile }: { profile: ApplicationProfile }) {
  return <T4Badge value={profile.capability.verified ? "profile:verified" : "profile:unverified"} />
}
