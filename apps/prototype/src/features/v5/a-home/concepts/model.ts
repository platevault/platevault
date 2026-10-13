/**
 * Home concepts (bead astro-plan-5kpyp, input to decision C8): the
 * cross-page summaries `#/home-concepts` compares. Each one joins existing
 * derives; none of them owns a rule.
 *
 * - `goalHorizon`: every unmet goal of an open Project (`targetStatus`),
 *   graded on each night of a 30-night horizon under its filter's
 *   Moon-avoidance curve (`nightImaging`, C6), plus each subject's Img time
 *   per night. The Sun and Moon samples (`skyNight`) are computed once per
 *   night and shared by every subject.
 * - `upNext`: the one next action of each open Project (`projectNext`),
 *   most urgent first.
 * - `recentProgress`: what the light sessions of a recent period added to
 *   each open goal: `goalProgress` now, minus `goalProgress` on the same
 *   catalogue without those sessions.
 */
import {
  findSubject,
  type GoalProgress,
  goalProgress,
  liveLightSessions,
  type NextAction,
  projectNext,
  projectWrapUp,
  subjectCentre,
  subjectTarget,
  targetStatus,
  type World,
} from "@/domain/derive"
import { BANDS, DEFAULT_MOON_AVOIDANCE } from "@/domain/labels"
import { altitudeDeg, defaultCriteria, type FilterGrade, julianDay, nightImaging, nightSummary, shiftNight, skyNight, type Tonight } from "@/domain/planning"
import type { Band, Catalog, GoalChannel, NightDate, ObservingSite, Project, Session, Subject, Target } from "@/domain/types"

/** The nights a horizon covers: the chosen night and the 29 after it (R9-HOME-DEBATE §4.1). */
export const HORIZON_NIGHTS = 30

/** One subject of an open Project that still has unmet goals. */
export interface SubjectOutlook {
  /** `projectId/subjectId`. */
  key: string
  project: Project
  subject: Subject
  target: Target
  /** Img time in minutes on each horizon night: the windows of every unmet filter, merged. Zero without a position. */
  minutes: number[]
}

/** One unmet goal and its filter's grade on each horizon night. */
export interface GoalOutlook {
  subject: SubjectOutlook
  progress: GoalProgress
  /** One grade per horizon night; null when the subject has no position or the channel has no curve of its own (OSC, Dual-band). */
  grades: FilterGrade[] | null
  /** Per night: poor only because of the Moon, the position being up in darkness for at least the minimum duration. */
  moonLimited: boolean[] | null
}

export interface Horizon {
  nights: NightDate[]
  /** Darkness and the Moon at the site, per night. */
  summaries: Tonight[]
  subjects: SubjectOutlook[]
  goals: GoalOutlook[]
}

function isBand(channel: GoalChannel): channel is Band {
  return (BANDS as readonly string[]).includes(channel)
}

/** The unmet goals of open Projects graded over `count` nights from `firstNight` at `site`. */
export function goalHorizon(catalog: Catalog, site: ObservingSite, nowMs: number, firstNight: NightDate, count = HORIZON_NIGHTS): Horizon {
  const criteria = defaultCriteria(site)
  const nights = Array.from({ length: count }, (_, i) => shiftNight(firstNight, i))

  const bySubject = new Map<string, { outlook: SubjectOutlook; centre: { ra: number; dec: number } | null; goals: GoalOutlook[] }>()
  for (const { project, subject, progress } of targetStatus(catalog)) {
    const target = subjectTarget(catalog, subject)
    if (!target) continue
    const key = `${project.id}/${subject.id}`
    let entry = bySubject.get(key)
    if (!entry) {
      entry = { outlook: { key, project, subject, target, minutes: [] }, centre: subjectCentre(catalog, subject), goals: [] }
      bySubject.set(key, entry)
    }
    const graded = entry.centre !== null && isBand(progress.goal.channel)
    entry.goals.push({ subject: entry.outlook, progress, grades: graded ? [] : null, moonLimited: graded ? [] : null })
  }

  const entries = [...bySubject.values()]
  for (const night of nights) {
    const sky = skyNight(site, night, criteria.darkness)
    for (const { outlook, centre, goals } of entries) {
      if (!centre) {
        outlook.minutes.push(0)
        continue
      }
      const altitudes = sky.samples.map((sample) => altitudeDeg(centre.ra, centre.dec, site.latitude, site.longitude, julianDay(sample.ms)))
      const bands = [...new Set(goals.map((g) => g.progress.goal.channel).filter(isBand))]
      const imaging = nightImaging(sky, altitudes, centre, criteria, DEFAULT_MOON_AVOIDANCE, bands, nowMs)
      outlook.minutes.push(imaging.minutes)
      for (const goal of goals) {
        const filter = imaging.filters.find((f) => f.band === goal.progress.goal.channel)
        if (!goal.grades || !goal.moonLimited || !filter) continue
        goal.grades.push(filter.grade)
        goal.moonLimited.push(filter.grade === "poor" && imaging.darkMinutes >= criteria.minDurationMin)
      }
    }
  }

  return {
    nights,
    summaries: nights.map((night) => nightSummary(site, night)),
    subjects: entries.map((e) => e.outlook),
    goals: entries.flatMap((e) => e.goals),
  }
}

/** Index of the first good night after `from`, else null. */
export function nextGoodNight(grades: readonly FilterGrade[], from = 0): number | null {
  for (let i = from + 1; i < grades.length; i += 1) if (grades[i] === "good") return i
  return null
}

/** The Monday that starts the week of `night` (`YYYY-MM-DD`). */
export function weekOf(night: NightDate): NightDate {
  const weekday = new Date(`${night}T12:00:00Z`).getUTCDay()
  return shiftNight(night, -((weekday + 6) % 7))
}

/** One open Project's next action. */
export interface NextStep {
  project: Project
  next: NextAction
}

/**
 * Urgency of a next action, by the link `projectNext` gives it: a blocked
 * run first, then frames to review, Wrap up, a night to plan and a run to
 * start (R9-HOME-DEBATE §4.2).
 */
function urgency(next: NextAction): number {
  if (next.step !== null) return 0
  if (next.link.search?.candidates === "unreviewed") return 1
  if (next.link.search?.stage === "wrap-up") return 2
  if (next.link.to === "/plan") return 3
  return 4
}

/**
 * Every open Project's next action, most urgent first, then by name. Wrap up
 * reads without its derived Trash step (slice B's `wrapUpOf`, outside this
 * area): it decides only which Wrap up step the reason names.
 */
export function upNext(world: World, nowMs: number): NextStep[] {
  const steps: NextStep[] = []
  for (const project of Object.values(world.catalog.projects)) {
    if (project.state !== "open") continue
    const next = projectNext(world, project, nowMs, (p) => projectWrapUp(world.catalog, p))
    if (next) steps.push({ project, next })
  }
  return steps.sort((a, b) => urgency(a.next) - urgency(b.next) || a.project.name.localeCompare(b.project.name))
}

/** One goal of an open Project that the period's captures moved. */
export interface GoalMovement {
  project: Project
  subject: Subject
  target: Target | undefined
  progress: GoalProgress
  /** Captured in the period, in the goal's unit (`progress.measure.unit`). */
  added: number
}

export interface RecentProgress {
  /** The current light sessions captured on or after the period's first night. */
  sessions: Session[]
  goals: GoalMovement[]
}

/** What the light sessions captured from `since` on added to the goals of open Projects. */
export function recentProgress(catalog: Catalog, since: NightDate): RecentProgress {
  const before: Catalog = { ...catalog, sessions: Object.fromEntries(Object.entries(catalog.sessions).filter(([, s]) => s.night < since)) }
  const goals: GoalMovement[] = []
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    const then = goalProgress(before, project)
    goalProgress(catalog, project).forEach((now, i) => {
      const added = now.measure.captured - (then[i]?.measure.captured ?? 0)
      const subject = findSubject(project, now.goal.subjectId)
      if (added <= 0 || !subject) return
      goals.push({ project, subject, target: subjectTarget(catalog, subject), progress: now, added })
    })
  }
  return { sessions: liveLightSessions(catalog).filter((s) => s.night >= since), goals }
}
