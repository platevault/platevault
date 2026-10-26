/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.3 P5, §8.3): GradeBadges, the
 * display-only grade strip of one night per filter. Every grade, a full
 * broadband-plus-narrowband strip, one badge per grade (the table column),
 * one filter, and the "–" without a verdict.
 * Captions are reviewer labels; band names are filter names.
 */
import { useMessages } from "@/app/preferences"
import { type GradeBadge, GradeBadges } from "@/components/domain/grade-badges"
import { ComponentSection, Specimen } from "./specimen"

const EVERY_GRADE: GradeBadge[] = [
  { band: "Ha", grade: "good" },
  { band: "OIII", grade: "marginal" },
  { band: "L", grade: "poor" },
]

const FULL_STRIP: GradeBadge[] = [
  { band: "L", grade: "poor" },
  { band: "R", grade: "poor" },
  { band: "G", grade: "marginal" },
  { band: "B", grade: "poor" },
  { band: "Ha", grade: "good" },
  { band: "OIII", grade: "good" },
  { band: "SII", grade: "good" },
]

export function GradeBadgesCatalogue() {
  const m = useMessages()
  return (
    <ComponentSection components={["GradeBadges"]} description={m.catalogue_grade_badges_desc()}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_grade_badges_grades()}>
          <GradeBadges grades={EVERY_GRADE} />
        </Specimen>
        <Specimen caption={m.catalogue_grade_badges_full()}>
          <GradeBadges grades={FULL_STRIP} />
        </Specimen>
        <Specimen caption={m.catalogue_grade_badges_wrap()}>
          <span className="w-40">
            <GradeBadges grades={FULL_STRIP} wrap />
          </span>
        </Specimen>
        <Specimen caption={m.catalogue_grade_badges_by_grade()}>
          <GradeBadges grades={FULL_STRIP} byGrade />
        </Specimen>
        <Specimen caption={m.catalogue_grade_badges_one()}>
          <GradeBadges grades={[{ band: "OIII", grade: "good" }]} />
        </Specimen>
        <Specimen caption={m.catalogue_grade_badges_none()}>
          <GradeBadges grades={null} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}
