/**
 * T4-local status badges for values the shared STATUS table does not have
 * yet (profile verification, executable state, review checks). Same shape as
 * `StatusBadge`: shared `Badge`, shared tone classes, an icon and a label, so
 * state is never colour alone. Requested from the integration owner as
 * STATUS additions; replace with `StatusBadge` once they land.
 */
import { Ban, Check, CircleDashed, CircleHelp, CircleX, type LucideIcon, ShieldCheck, ShieldQuestion, TriangleAlert } from "lucide-react"
import { TONE_CLASS, type Tone } from "@/components/app/status"
import { Badge } from "@/components/ui/badge"
import type { ApplicationProfile } from "@/domain/types"
import { cn } from "@/lib/utils"

const META = {
  "profile:verified": { label: "Verified profile", tone: "success", icon: ShieldCheck },
  "profile:unverified": { label: "Not verified", tone: "muted", icon: ShieldQuestion },
  "executable:found": { label: "Found", tone: "success", icon: Check },
  "executable:not-configured": { label: "Not configured", tone: "muted", icon: CircleDashed },
  "executable:missing": { label: "Missing", tone: "danger", icon: CircleX },
  "executable:launch-fails": { label: "Launch failed", tone: "danger", icon: TriangleAlert },
  "check:ok": { label: "Checked", tone: "success", icon: Check },
  "check:blocked": { label: "Blocked", tone: "danger", icon: Ban },
  "check:warning": { label: "Needs attention", tone: "warning", icon: TriangleAlert },
  "write:read-only": { label: "Read-only inputs", tone: "success", icon: Check },
  "write:unknown": { label: "Input writes unknown", tone: "warning", icon: CircleHelp },
  "write:write-prone": { label: "Writes into inputs", tone: "danger", icon: TriangleAlert },
} satisfies Record<string, { label: string; tone: Tone; icon: LucideIcon }>

export type T4BadgeValue = keyof typeof META

export function T4Badge({ value, label, className }: { value: T4BadgeValue; label?: string; className?: string }) {
  const meta = META[value]
  const Icon = meta.icon
  return (
    <Badge variant="outline" className={cn("rounded-md border-transparent", TONE_CLASS[meta.tone], className)} data-status={value}>
      <Icon aria-hidden="true" />
      {label ?? meta.label}
    </Badge>
  )
}

export function ProfileBadge({ profile }: { profile: ApplicationProfile }) {
  return <T4Badge value={profile.capability.verified ? "profile:verified" : "profile:unverified"} />
}
