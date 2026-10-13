/**
 * GradeBadges (L2-domain, plan §3.3 P5): one night's grade per filter, as a
 * strip of display-only Pills. The tone carries the grade (good success,
 * marginal warning, poor danger) and an icon repeats it as a shape, so the
 * grade never rests on colour alone. The strip is one image to assistive
 * technology, named "OIII good, Ha marginal". Without a verdict (no window
 * that night) it reads "–", with the reason when the host gives one.
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
  /** Why there is no verdict, for the "–". */
  empty?: string
  /** Let the strip wrap onto more lines in a narrow place (a detail panel); a table row keeps it on one line. */
  wrap?: boolean
}

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

export function GradeBadges({ grades, empty, wrap = false }: GradeBadgesProps) {
  const m = useMessages()
  if (!grades || grades.length === 0) return <UnknownValue label="–" reason={empty} />
  return (
    <span role="img" aria-label={gradeStripLabel(m, grades)} className={cn("inline-flex items-center gap-0.5", wrap && "flex-wrap gap-y-1")} data-grade-badges>
      {grades.map((g) => (
        <Pill key={g.band} tone={GRADE[g.grade].tone} icon={GRADE[g.grade].icon} className="gap-0.5 px-1.5">
          {g.band}
        </Pill>
      ))}
    </span>
  )
}
