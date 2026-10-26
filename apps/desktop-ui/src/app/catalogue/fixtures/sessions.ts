/**
 * A small sample library for the catalogue's DataTable and page-template
 * specimens: light and calibration sessions with their frames, Targets,
 * three Projects with groups and subjects, and the locations that hold the
 * frames, as the library's reads would return them. Names, nights and paths
 * are sample data. Catalogue only.
 */
import type { StatusValue } from "@/components/app/status"
import { formatNight } from "@/lib/format"

export interface SampleFrame {
  id: string
  fileName: string
  path: string
  sizeBytes: number
  quality: StatusValue<"quality">
}

export interface SampleSession {
  id: string
  /** `YYYY-MM-DD`. */
  night: string
  imageType: "light" | "flat" | "dark" | "bias"
  channel: string | null
  exposureS: number
  /** The OBJECT header, as captured. */
  objectLabel: string | null
  /** The associated Target and how sure the association is. */
  target: { value: string | null; status: StatusValue<"association"> }
  cameraName: string | null
  telescopeName: string | null
  gain: number | null
  binning: number
  frames: SampleFrame[]
}

export interface SampleGroup {
  id: string
  name: string
}

export interface SampleSubject {
  id: string
  targetId: string
  /** Goals on this subject. */
  goals: number
}

export interface SampleProject {
  id: string
  name: string
  state: StatusValue<"project">
  groups: SampleGroup[]
  subjects: SampleSubject[]
  inputs: Array<{ sessionId: string; groupId: string }>
  rigs: number
  notes: string
}

export interface SampleLocationRecord {
  id: string
  displayName: string
  path: string
  role: StatusValue<"role">
  access: StatusValue<"access">
}

export interface SampleLibrary {
  sessions: Record<string, SampleSession>
  targets: Record<string, { id: string; name: string }>
  projects: Record<string, SampleProject>
  locations: Record<string, SampleLocationRecord>
}

const CAPTURES = "/Volumes/Astro-T7/Captures"
const FRAME_BYTES = 62_000_000

const QUALITY: readonly StatusValue<"quality">[] = ["usable", "usable", "usable", "unreviewed", "unusable"]

function frames(sessionId: string, folder: string, prefix: string, count: number): SampleFrame[] {
  return Array.from({ length: count }, (_, i) => {
    const fileName = `${prefix}_${String(i + 1).padStart(4, "0")}.fits`
    return { id: `${sessionId}_f${i + 1}`, fileName, path: `${folder}/${fileName}`, sizeBytes: FRAME_BYTES + i * 1024, quality: QUALITY[i % QUALITY.length]! }
  })
}

interface SessionSeed {
  id: string
  night: string
  imageType?: SampleSession["imageType"]
  channel: string | null
  exposureS: number
  object: string | null
  target: string | null
  status: StatusValue<"association">
  camera: string
  telescope: string
  gain: number
  count: number
}

function session(seed: SessionSeed): SampleSession {
  const kind = seed.imageType ?? "light"
  const folder = `${CAPTURES}/${seed.object ?? kind}/${seed.night}`
  const prefix = `${kind === "light" ? "Light" : kind[0]!.toUpperCase() + kind.slice(1)}_${(seed.object ?? "").replace(/\s/g, "")}_${seed.channel ?? "x"}_${seed.exposureS}s`
  return {
    id: seed.id,
    night: seed.night,
    imageType: kind,
    channel: seed.channel,
    exposureS: seed.exposureS,
    objectLabel: seed.object,
    target: { value: seed.target, status: seed.status },
    cameraName: seed.camera,
    telescopeName: seed.telescope,
    gain: seed.gain,
    binning: 1,
    frames: frames(seed.id, folder, prefix, seed.count),
  }
}

const REDCAT = { camera: "ZWO ASI2600MM Pro", telescope: "RedCat 51", gain: 100 }
const ESPRIT = { camera: "ZWO ASI533MC Pro", telescope: "Esprit 100", gain: 101 }

const SESSIONS: SampleSession[] = [
  session({ id: "ses_ngc7000_0918", night: "2026-09-18", channel: "Ha", exposureS: 300, object: "NGC 7000", target: "tgt_ngc7000", status: "confirmed", ...REDCAT, count: 12 }),
  session({ id: "ses_ngc7000_0920", night: "2026-09-20", channel: "OIII", exposureS: 300, object: "NGC 7000", target: "tgt_ngc7000", status: "associated", ...REDCAT, count: 10 }),
  session({ id: "ses_ic5070_0920", night: "2026-09-20", channel: "OIII", exposureS: 600, object: "IC 5070", target: "tgt_ic5070", status: "confirmed", ...ESPRIT, count: 8 }),
  session({ id: "ses_m31_0902", night: "2026-09-02", channel: "L", exposureS: 300, object: "M31", target: "tgt_m31", status: "needs-review", ...REDCAT, count: 14 }),
  session({ id: "ses_m31_0918", night: "2026-09-18", channel: "R", exposureS: 120, object: "M31", target: "tgt_m31", status: "confirmed", ...REDCAT, count: 9 }),
  session({ id: "ses_unknown_0911", night: "2026-09-11", channel: "Ha", exposureS: 180, object: "Field 3", target: null, status: "needs-review", ...ESPRIT, count: 6 }),
  session({ id: "ses_flat_ha_0918", night: "2026-09-18", imageType: "flat", channel: "Ha", exposureS: 2.5, object: null, target: null, status: "confirmed", ...REDCAT, count: 25 }),
  session({ id: "ses_dark_300", night: "2026-09-14", imageType: "dark", channel: null, exposureS: 300, object: null, target: null, status: "confirmed", ...REDCAT, count: 30 }),
  session({ id: "ses_bias_0711", night: "2026-07-11", imageType: "bias", channel: null, exposureS: 0.00003, object: null, target: null, status: "confirmed", ...REDCAT, count: 50 }),
]

export const SAMPLE_LIBRARY: SampleLibrary = {
  sessions: Object.fromEntries(SESSIONS.map((s) => [s.id, s])),
  targets: {
    tgt_ngc7000: { id: "tgt_ngc7000", name: "NGC 7000" },
    tgt_ic5070: { id: "tgt_ic5070", name: "IC 5070" },
    tgt_m31: { id: "tgt_m31", name: "M 31" },
  },
  projects: {
    prj_cygnus: {
      id: "prj_cygnus",
      name: "Cygnus HOO 2026",
      state: "open",
      groups: [
        { id: "grp_cyg_redcat", name: "RedCat 51 / ASI2600MM" },
        { id: "grp_cyg_esprit", name: "Esprit 100 / ASI533MC" },
      ],
      subjects: [
        { id: "sub_ngc7000", targetId: "tgt_ngc7000", goals: 2 },
        { id: "sub_ic5070", targetId: "tgt_ic5070", goals: 1 },
      ],
      inputs: [
        { sessionId: "ses_ngc7000_0918", groupId: "grp_cyg_redcat" },
        { sessionId: "ses_ngc7000_0920", groupId: "grp_cyg_redcat" },
        { sessionId: "ses_ic5070_0920", groupId: "grp_cyg_esprit" },
      ],
      rigs: 2,
      notes: "",
    },
    prj_m31: {
      id: "prj_m31",
      name: "M 31 LRGB",
      state: "open",
      groups: [{ id: "grp_m31", name: "RedCat 51 / ASI2600MM" }],
      subjects: [{ id: "sub_m31", targetId: "tgt_m31", goals: 4 }],
      inputs: [
        { sessionId: "ses_m31_0902", groupId: "grp_m31" },
        { sessionId: "ses_m31_0918", groupId: "grp_m31" },
      ],
      rigs: 1,
      notes: "",
    },
  },
  locations: {
    loc_t7: { id: "loc_t7", displayName: "Astro-T7 Captures", path: CAPTURES, role: "captures", access: "ok" },
    loc_cal: { id: "loc_cal", displayName: "Calibration", path: "/Volumes/Astro-T7/Calibration", role: "calibration", access: "ok" },
    loc_nas: { id: "loc_nas", displayName: "Archive NAS", path: "/Volumes/Archive", role: "archive", access: "unknown" },
    loc_locked: { id: "loc_locked", displayName: "Locked", path: "/Volumes/Astro-T7/Locked", role: "captures", access: "denied" },
  },
}

/** The Target's name, else the OBJECT header, else a dash. */
export function targetName(library: SampleLibrary, s: SampleSession): string {
  return (s.target.value ? library.targets[s.target.value]?.name : undefined) ?? s.objectLabel ?? "–"
}

/** "NGC 7000 · 18 Sep · Ha". */
export function sessionLabel(library: SampleLibrary, s: SampleSession): string {
  return `${targetName(library, s)} · ${formatNight(s.night)} · ${s.channel ?? "–"}`
}

/** The sessions a Project holds, in its input order. */
export function heldSessions(library: SampleLibrary, project: SampleProject): SampleSession[] {
  return project.inputs.flatMap((input) => library.sessions[input.sessionId] ?? [])
}
