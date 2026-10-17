/**
 * GradeBadges (L2-domain, plan §3.3 P5): one night's grade per filter, as a
 * strip of display-only Pills. The tone carries the grade (good success,
 * marginal warning, poor danger) and an icon repeats it as a shape, so the
 * grade never rests on colour alone. The strip is one image to assistive
 * technology, named "OIII good, Ha marginal". Without a verdict (no window
 * that night) it reads "–": the row says why (its windows and Img time), so
 * no tooltip repeats it (§6.2).
 *
 * `byGrade` (a table column, Q36): one Pill per grade, good then marginal,
 * each listing its filters ("Ha, OIII"); poor filters are left out. When
 * every filter is poor it reads "–".
 */
import { Check, CircleDashed, type LucideIcon, X } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { UnknownValue } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import type { FilterGrade } from "@/domain/planning"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export interface GradeBadge {
  band: string
  grade: FilterGrade
}

export interface GradeBadgesProps {
  /** One badge per filter, in strip order; null when the night gives no verdict. */
  grades: readonly GradeBadge[] | null
  /** Let the strip wrap onto more lines in a narrow place (a detail panel); a table row keeps it on one line. */
  wrap?: boolean
  /** One badge per grade with its filters, poor filters hidden (a table column). */
  byGrade?: boolean
}

/** The grades a badge per grade shows, in order; poor is left out. */
const SHOWN_GRADES: readonly FilterGrade[] = ["good", "marginal"]

const GRADE: Record<FilterGrade, { tone: Tone; icon: LucideIcon }> = {
  good: { tone: "success", icon: Check },
  marginal: { tone: "warning", icon: CircleDashed },
  poor: { tone: "danger", icon: X },
}

function gradeWord(m: Messages, grade: FilterGrade): string {
  return grade === "good" ? m.domain_grade_good() : grade === "marginal" ? m.domain_grade_marginal() : m.domain_grade_poor()
}

/** "OIII good, Ha marginal": the strip's accessible name. */
export function gradeStripLabel(m: Messages, grades: readonly GradeBadge[]): string {
  return grades.map((g) => m.domain_grade_badge({ band: g.band, grade: gradeWord(m, g.grade) })).join(", ")
}

export function GradeBadges({ grades, wrap = false, byGrade = false }: GradeBadgesProps) {
  const m = useMessages()
  if (!grades || grades.length === 0 || (byGrade && grades.every((g) => g.grade === "poor"))) return <UnknownValue label="–" />
  // In badge order, so the strip's name reads as it shows.
  const shown = byGrade ? SHOWN_GRADES.flatMap((grade) => grades.filter((g) => g.grade === grade)) : grades
  const badges = byGrade
    ? SHOWN_GRADES.map((grade) => ({ grade, bands: shown.filter((g) => g.grade === grade).map((g) => g.band) })).filter((badge) => badge.bands.length > 0)
    : shown.map((g) => ({ grade: g.grade, bands: [g.band] }))
  return (
    <span role="img" aria-label={gradeStripLabel(m, shown)} className={cn("inline-flex items-center gap-0.5", wrap && "flex-wrap gap-y-1")} data-grade-badges>
      {badges.map((badge) => (
        <Pill key={badge.bands.join()} tone={GRADE[badge.grade].tone} icon={GRADE[badge.grade].icon} className="gap-0.5 px-1.5">
          {badge.bands.join(", ")}
        </Pill>
      ))}
    </span>
  )
}
