/**
 * Sample library values the catalogue's specimens share: filter bands,
 * Target and rig names, one channel's frame breakdown and a session's Target
 * evidence, as the library's reads would return them. Catalogue only.
 */
import type { QualityBreakdown } from "@/components/app/data"
import type { Evidence } from "@/components/app/evidence-list"
import { type GoalChannel, type GoalTemplateValue, qualityBarFor } from "@/components/domain/goal-fields"
import { verbatim } from "@/lib/i18n"

/** Filter bands in the Targets Filters column's strip order. */
export const BANDS: readonly string[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

/** Target names, as the library's catalogue holds them. */
export const TARGET_NAMES: readonly string[] = ["M 31", "NGC 7000", "IC 5070"]

/** Optical train names. */
export const RIG_NAMES: readonly string[] = ["RedCat 51 / ASI2600MM", "Esprit 100 / ASI533MC"]

/** Projects by id and name, newest first. */
export const SAMPLE_PROJECTS: ReadonlyArray<{ id: string; name: string }> = [
  { id: "prj_cygnus", name: "Cygnus HOO 2026" },
  { id: "prj_m31", name: "M 31 LRGB" },
  { id: "prj_ic5070", name: "IC 5070 mosaic" },
]

const hours = (channels: GoalChannel[], h: number, maxArcsec: number | null = null): GoalTemplateValue[] =>
  channels.map((channel) => ({ channel, integrationS: h * 3600, frameCount: null, qualityBar: qualityBarFor(maxArcsec) }))

/** The built-in goal templates, by name: palettes are their own names in every language. */
export const GOAL_TEMPLATES: ReadonlyArray<{ id: string; name: string; values: GoalTemplateValue[] }> = [
  { id: "gtpl_hoo", name: "HOO", values: hours(["Ha", "OIII"], 10) },
  { id: "gtpl_sho", name: "SHO", values: hours(["Ha", "OIII", "SII"], 10) },
  { id: "gtpl_lrgb", name: "LRGB", values: [...hours(["L"], 6, 3), ...hours(["R", "G", "B"], 2)] },
]

const totals = (frames: number, exposureS = 300) => ({ frames, seconds: frames * exposureS })

/** One Ha session's frames by review state: some unreviewed, a few unusable, one changed on disk, two offline. */
export const HA_BREAKDOWN: QualityBreakdown = {
  captured: totals(120),
  usable: totals(84),
  unreviewed: totals(26),
  unusable: totals(7),
  changedContent: totals(1),
  verificationPending: totals(0),
  unavailable: totals(2),
}

/** Why a session reads as NGC 7000: the header and the pointing agree, the resolver has no record, the user's earlier choice conflicts. */
export const TARGET_EVIDENCE: Evidence[] = [
  { source: "header", label: verbatim("OBJECT"), value: verbatim("NGC 7000"), agrees: true },
  { source: "pointing", label: verbatim("RA / DEC"), value: verbatim("20h 59m 17s · +44° 31′ 44″"), agrees: true },
  { source: "resolver", label: verbatim("SIMBAD"), value: verbatim("–"), agrees: null },
  { source: "user", label: verbatim("OBJECT"), value: verbatim("IC 5070"), agrees: false },
]
