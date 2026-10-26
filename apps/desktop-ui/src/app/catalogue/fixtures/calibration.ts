/**
 * A sample calibration library for the catalogue's F4 specimens and the
 * calibration component tests: a master dark with two dated versions, a
 * master flat and a master bias, four light sessions whose kinds hold every
 * choice state between them, and the CalibrationDiagram groups of three
 * Projects (one group, two groups, mosaic panels) plus a what-if with mixed
 * dark versions and a second flat set. Values are the library's facts as a
 * read would return them; names and paths are sample data. Catalogue and
 * test only.
 */
import type { StepLink } from "@/components/app/contracts"
import type { MasterSummary, MasterVersionSummary } from "@/components/app/previews"
import { type CalibrationChoiceRow, type CalibrationOffer, calibrationSourceLink } from "@/components/domain/calibration-choices"
import type { DiagramCalibration, DiagramGroup, DiagramLights, DiagramNight } from "@/components/domain/calibration-diagram"
import type { CalibrationChoice, CalibrationSource, MatchCriterion, MatchCriterionName, MatchEvidence, PinHealth, PinKind } from "@/components/domain/calibration-model"
import { joinRefs, type MessageRef, msg, nightRef, verbatim } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

const CAMERA = "ZWO ASI2600MM Pro"

export const DARK_MAY: MasterVersionSummary = { id: "mv_dark_may", capturedAt: "2026-05-02T22:10:00.000Z", frameCount: 30, origin: "library" }
export const DARK_SEP: MasterVersionSummary = { id: "mv_dark_sep", capturedAt: "2026-09-14T21:40:00.000Z", frameCount: 40, origin: "stacked" }
/** A master dark with two dated versions, oldest first. */
export const MASTER_DARK: MasterSummary = { kind: "dark", cameraName: CAMERA, gain: 100, offset: 50, ccdTempC: -10, exposureS: 300, versions: [DARK_MAY, DARK_SEP] }
/** The same settings with only the May version: its newest version is past the age limit. */
export const MASTER_DARK_OLD: MasterSummary = { ...MASTER_DARK, versions: [DARK_MAY] }
export const MASTER_DARK_FILE = "masterDark_BIN-1_EXPOSURE-300.00s.xisf"

const FLAT_HA: MasterVersionSummary = { id: "mv_flat_ha_0918", capturedAt: "2026-09-18T19:05:00.000Z", frameCount: 25, origin: "generated" }
const FLAT_HA_LATER: MasterVersionSummary = { id: "mv_flat_ha_0920", capturedAt: "2026-09-20T19:10:00.000Z", frameCount: 25, origin: "generated" }
const MASTER_FLAT: MasterSummary = { kind: "flat", cameraName: CAMERA, gain: 100, offset: 50, ccdTempC: -10, exposureS: 2.5, versions: [FLAT_HA, FLAT_HA_LATER] }
const BIAS_JUL: MasterVersionSummary = { id: "mv_bias_jul", capturedAt: "2026-07-11T23:00:00.000Z", frameCount: 100, origin: "imported" }
const MASTER_BIAS: MasterSummary = { kind: "bias", cameraName: CAMERA, gain: 100, offset: 50, ccdTempC: -10, exposureS: 0.00003, versions: [BIAS_JUL] }

const MASTERS = {
  mst_dark_300: { record: MASTER_DARK, file: MASTER_DARK_FILE },
  mst_flat_ha: { record: MASTER_FLAT, file: "masterFlat_FILTER-Ha.xisf" },
  mst_bias: { record: MASTER_BIAS, file: "masterBias_GAIN-100.xisf" },
} as const

type MasterId = keyof typeof MASTERS

const VERSIONS: Record<string, MasterVersionSummary> = Object.fromEntries([DARK_MAY, DARK_SEP, FLAT_HA, FLAT_HA_LATER, BIAS_JUL].map((v) => [v.id, v]))

// ---------------------------------------------------------------------------
// Sources and evidence
// ---------------------------------------------------------------------------

const master = (masterId: MasterId, versionId: string): CalibrationSource => ({ type: "master", masterId, versionId })
const raw = (sessionId: string): CalibrationSource => ({ type: "raw", sessionId })

/** How a list names a source: the master's file and its version's night, or a raw session's night and filter. */
function sourceLabel(source: CalibrationSource): MessageRef {
  if (source.type === "raw") return msg("domain_calibration_source_raw", { name: joinRefs([nightRef("2026-09-20"), verbatim("OIII")], " · ") })
  const version = VERSIONS[source.versionId]!
  return joinRefs([verbatim(MASTERS[source.masterId as MasterId].file), nightRef(version.capturedAt.slice(0, 10))], " · ")
}

const check = (name: MatchCriterionName, result: MatchCriterion["result"], light: string, calibration: string = light): MatchCriterion => ({
  name,
  result,
  lightValue: verbatim(light),
  calibrationValue: verbatim(calibration),
})

const SHARED_CHECKS: MatchCriterion[] = [
  check("camera", "compatible", CAMERA),
  check("dimensions", "compatible", "6248 × 4176"),
  check("binning", "compatible", "1×1"),
  check("gain", "compatible", "100"),
  check("offset", "compatible", "50"),
]

function darkEvidence(capturedAt: string, apart: number): MatchEvidence {
  return { capturedAt, apart, rotationDeltaDeg: null, criteria: [...SHARED_CHECKS, check("exposure", "compatible", "300 s"), check("temperature", "compatible", "-10 °C"), check("age", "compatible", `${apart} d`)] }
}

function flatEvidence(capturedAt: string, apart: number, rotationDeltaDeg: number | null): MatchEvidence {
  const rotation = rotationDeltaDeg === null ? check("rotation", "unknown", "–") : check("rotation", rotationDeltaDeg > 2 ? "warning" : "compatible", "91.2°", `${(91.2 + rotationDeltaDeg).toFixed(1)}°`)
  return { capturedAt, apart, rotationDeltaDeg, criteria: [...SHARED_CHECKS, check("channel", "compatible", "Ha"), check("optical-train", "compatible", "RedCat 51"), rotation] }
}

function biasEvidence(apart: number): MatchEvidence {
  return { capturedAt: BIAS_JUL.capturedAt, apart, rotationDeltaDeg: null, criteria: [...SHARED_CHECKS, check("temperature", "compatible", "-10 °C")] }
}

const AT = "2026-10-10T12:00:00.000Z"
const pinned = (source: CalibrationSource, evidence: MatchEvidence, by: "matching" | "user" = "matching"): CalibrationChoice => ({ state: "pinned", source, evidence, at: AT, by })
const suggested = (source: CalibrationSource, evidence: MatchEvidence): CalibrationChoice => ({ state: "suggested", source, evidence })
const WAITING: CalibrationChoice = { state: "waiting" }
const none = (by: "user" | "camera-default"): CalibrationChoice => ({ state: "none", at: AT, by })

const sourceKey = (source: CalibrationSource) => (source.type === "master" ? `master:${source.versionId}` : `raw:${source.sessionId}`)

function offer(source: CalibrationSource, verdict: CalibrationOffer["verdict"], evidence: MatchEvidence): CalibrationOffer {
  return { key: sourceKey(source), source, label: sourceLabel(source), verdict, evidence }
}

// ---------------------------------------------------------------------------
// Light sessions
// ---------------------------------------------------------------------------

interface SampleSession {
  id: string
  night: string
  filter: string
  exposure: string
  revision: number
  frames: number
  calibration: Record<PinKind, { choice: CalibrationChoice; health?: PinHealth; offers?: CalibrationOffer[] }>
}

const DARK_PIN = pinned(master("mst_dark_300", DARK_SEP.id), darkEvidence(DARK_SEP.capturedAt, 4))
const BIAS_PIN = pinned(master("mst_bias", BIAS_JUL.id), biasEvidence(69))
const OLDER_DARK_OFFER = offer(master("mst_dark_300", DARK_MAY.id), "pin", darkEvidence(DARK_MAY.capturedAt, 139))

/** A suggested flat with an unknown rotation, pinned dark and bias. */
const M31: SampleSession = {
  id: "ses_m31_0902",
  night: "2026-09-02",
  filter: "L",
  exposure: "300 s",
  revision: 7,
  frames: 55,
  calibration: {
    dark: { choice: DARK_PIN, offers: [OLDER_DARK_OFFER] },
    flat: {
      choice: suggested(master("mst_flat_ha", FLAT_HA.id), flatEvidence(FLAT_HA.capturedAt, 16, null)),
      offers: [offer(master("mst_flat_ha", FLAT_HA.id), "suggest", flatEvidence(FLAT_HA.capturedAt, 16, null)), offer(master("mst_flat_ha", FLAT_HA_LATER.id), "pin", flatEvidence(FLAT_HA_LATER.capturedAt, 18, 0.4))],
    },
    bias: { choice: BIAS_PIN },
  },
}

/** A flat still waiting: nothing matches yet. */
const NGC7000: SampleSession = {
  id: "ses_ngc7000_0918",
  night: "2026-09-18",
  filter: "Ha",
  exposure: "300 s",
  revision: 3,
  frames: 52,
  calibration: { dark: { choice: DARK_PIN, offers: [OLDER_DARK_OFFER] }, flat: { choice: WAITING }, bias: { choice: BIAS_PIN } },
}

/** No darks by the camera's default, and a flat from raw calibration frames the user chose. */
const IC5070: SampleSession = {
  id: "ses_ic5070_0920",
  night: "2026-09-20",
  filter: "OIII",
  exposure: "600 s",
  revision: 5,
  frames: 36,
  calibration: { dark: { choice: none("camera-default") }, flat: { choice: pinned(raw("ses_flats_oiii_0920"), flatEvidence("2026-09-20T19:20:00.000Z", 0, 0.2), "user") }, bias: { choice: BIAS_PIN } },
}

/** Every kind pinned automatically. */
const NGC7000_OIII: SampleSession = {
  id: "ses_ngc7000_0920",
  night: "2026-09-20",
  filter: "OIII",
  exposure: "300 s",
  revision: 4,
  frames: 48,
  calibration: {
    dark: { choice: DARK_PIN, offers: [OLDER_DARK_OFFER] },
    flat: { choice: pinned(master("mst_flat_ha", FLAT_HA_LATER.id), flatEvidence(FLAT_HA_LATER.capturedAt, 0, 0.3)) },
    bias: { choice: BIAS_PIN },
  },
}

/** The sessions whose kinds hold every choice state between them, by the state that names them. */
export const CHOICE_SESSIONS = { suggested: M31.id, waiting: NGC7000.id, cameraNo: IC5070.id, pinned: NGC7000_OIII.id } as const

const PIN_ORDER: readonly PinKind[] = ["dark", "flat", "bias"]

const sessionLabel = (s: SampleSession): MessageRef => joinRefs([nightRef(s.night), verbatim(s.filter), verbatim(s.exposure)], " · ")
const sessionLink = (s: SampleSession): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId: s.id } })

function rowsOf(session: SampleSession): CalibrationChoiceRow[] {
  return PIN_ORDER.map((kind) => {
    const { choice, health = "ok", offers = [] } = session.calibration[kind]
    const source = choice.state === "pinned" || choice.state === "suggested" ? choice.source : null
    return {
      sessionId: session.id,
      revision: session.revision,
      session: sessionLabel(session),
      sessionLink: sessionLink(session),
      kind,
      choice,
      source: source ? sourceLabel(source) : null,
      sourceLink: source ? calibrationSourceLink(source) : null,
      health,
      offers,
    }
  })
}

/** The four sessions' rows, three kinds each, in session order. */
export const CHOICE_ROWS: CalibrationChoiceRow[] = [M31, NGC7000, IC5070, NGC7000_OIII].flatMap(rowsOf)

/** One session's rows: a suggested flat, with offers under Choose ▸. */
export const ONE_SESSION_ROWS: CalibrationChoiceRow[] = rowsOf(M31)

/** A what-if where choices can't change: No bias set by the user, and a pinned flat whose file changed on disk. */
export const READ_ONLY_ROWS: CalibrationChoiceRow[] = [
  ...rowsOf({ ...M31, calibration: { ...M31.calibration, bias: { choice: none("user") } } }),
  ...rowsOf({ ...NGC7000_OIII, calibration: { ...NGC7000_OIII.calibration, flat: { ...NGC7000_OIII.calibration.flat, health: "changed" } } }),
]

// ---------------------------------------------------------------------------
// CalibrationDiagram groups
// ---------------------------------------------------------------------------

function cell(session: SampleSession, kind: PinKind, mixed = false, override?: CalibrationChoice): DiagramCalibration {
  const { choice: own, health = "ok" } = session.calibration[kind]
  const choice = override ?? own
  const source = choice.state === "pinned" || choice.state === "suggested" ? choice.source : null
  const masterOf =
    source?.type === "master"
      ? { record: MASTERS[source.masterId as MasterId].record, version: VERSIONS[source.versionId]!, age: source.versionId === DARK_MAY.id ? msg("flow_master_old", { n: 165 }) : null, usedBy: 2 }
      : null
  return { kind, choice, source: source ? sourceLabel(source) : null, link: source ? calibrationSourceLink(source) : null, master: masterOf, evidence: choice.state === "pinned" || choice.state === "suggested" ? choice.evidence : null, health, mixed }
}

function lights(session: SampleSession, options: { mixedDark?: boolean; dark?: CalibrationChoice; bias?: CalibrationChoice; offline?: number } = {}): DiagramLights {
  return {
    sessionId: session.id,
    session: sessionLabel(session),
    link: sessionLink(session),
    frames: session.frames,
    offline: options.offline ?? 0,
    // Flat, dark, bias: the order a light set reads them.
    calibration: [cell(session, "flat"), cell(session, "dark", options.mixedDark, options.dark), cell(session, "bias", false, options.bias)],
  }
}

const night = (folder: string, nightOf: string, sets: DiagramLights[]): DiagramNight => ({ folder, night: nightOf, lights: sets })

/** M 31: one group, so no group folder; the nights and the shared bias sit right under View. */
export const DIAGRAM_ONE_GROUP: DiagramGroup[] = [{ id: "grp_m31", name: "FRA400 / ASI2600MM", panel: false, folder: null, nights: [night("NIGHT_2026-09-02", "2026-09-02", [lights(M31)])], mixed: [] }]

/** Cygnus HOO: two groups, each in its GROUP_ folder; one session set to No bias, one with offline frames. */
export const DIAGRAM_GROUPS: DiagramGroup[] = [
  {
    id: "grp_cyg_redcat",
    name: "RedCat 51 / ASI2600MM",
    panel: false,
    folder: "GROUP_RedCat-51-ASI2600MM",
    nights: [night("NIGHT_2026-09-18", "2026-09-18", [lights(NGC7000, { bias: none("user") })]), night("NIGHT_2026-09-20", "2026-09-20", [lights(NGC7000_OIII, { offline: 6 })])],
    mixed: [],
  },
  { id: "grp_cyg_esprit", name: "Esprit 100 / ASI533MC", panel: false, folder: "GROUP_Esprit-100-ASI533MC", nights: [night("NIGHT_2026-09-20", "2026-09-20", [lights(IC5070)])], mixed: [] },
]

const OLDER_DARK_PIN = pinned(master("mst_dark_300", DARK_MAY.id), darkEvidence(DARK_MAY.capturedAt, 139), "user")

/** Cygnus what-if: one session pins the older dark (mixed versions, darks in every night) and a second flat set gets NIGHT_…-2. */
export const DIAGRAM_MIXED: DiagramGroup[] = [
  {
    id: "grp_cyg_redcat",
    name: "RedCat 51 / ASI2600MM",
    panel: false,
    folder: "GROUP_RedCat-51-ASI2600MM",
    nights: [
      night("NIGHT_2026-09-18", "2026-09-18", [lights(NGC7000, { mixedDark: true, dark: OLDER_DARK_PIN })]),
      night("NIGHT_2026-09-20", "2026-09-20", [lights(NGC7000_OIII, { mixedDark: true })]),
      night("NIGHT_2026-09-20-2", "2026-09-20", [lights({ ...M31, id: "ses_ngc7000_0920b", night: "2026-09-20", filter: "Ha" }, { mixedDark: true })]),
    ],
    mixed: ["dark"],
  },
]

/** IC 5070 mosaic: each panel is a group in its PANEL_ folder. */
export const DIAGRAM_PANELS: DiagramGroup[] = [1, 2].map((n) => ({
  id: `grp_ic5070_p${n}`,
  name: `Panel ${n}`,
  panel: true,
  folder: `PANEL_Panel-${n}`,
  nights: [night("NIGHT_2026-09-20", "2026-09-20", [lights({ ...IC5070, id: `ses_ic5070_p${n}` })])],
  mixed: [],
}))
