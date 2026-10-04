/**
 * Equipment records (J15 S2-S5, D11). T1 writes Manual records; indexing
 * writes Detected ones. Saving a Detected record through Settings makes it
 * Manual, because the user has now entered it. Removal is refused while
 * another record, a session or a Project uses the record.
 */
import { stableHash } from "@/domain/indexing"
import type { Camera, Catalog, FilterDef, OpticalTrain, Telescope } from "@/domain/types"
import { type CommitResult, nowIso, withCatalog } from "@/store/core"
import { save } from "./writes"

export type EquipmentKind = "train" | "camera" | "telescope" | "filter"

export const KIND_COPY: Record<EquipmentKind, { noun: string; plural: string; prefix: string; collection: "opticalTrains" | "cameras" | "telescopes" | "filters" }> = {
  train: { noun: "optical train", plural: "optical trains", prefix: "otr", collection: "opticalTrains" },
  camera: { noun: "camera", plural: "cameras", prefix: "cam", collection: "cameras" },
  telescope: { noun: "telescope", plural: "telescopes", prefix: "tel", collection: "telescopes" },
  filter: { noun: "filter", plural: "filters", prefix: "flt", collection: "filters" },
}

interface RecordByKind {
  train: OpticalTrain
  camera: Camera
  telescope: Telescope
  filter: FilterDef
}

/** Form output: every field but the source, which Settings always writes as Manual; `id` is null for a new record. */
export type EquipmentDraft<K extends EquipmentKind> = Omit<RecordByKind[K], "id" | "source"> & { id: string | null }

export const FILTER_CATEGORIES: Array<{ value: FilterDef["category"]; label: string }> = [
  { value: "narrowband", label: "Narrowband" },
  { value: "broadband", label: "Broadband" },
  { value: "dual-band", label: "Dual-band" },
  { value: "other", label: "Other" },
]

const HREF = "/settings/equipment"

/** "Name: … already exists." when another record of the kind has the same name. */
export function duplicateName(catalog: Catalog, kind: EquipmentKind, name: string, exceptId: string | null): string | undefined {
  const records = Object.values(catalog[KIND_COPY[kind].collection]) as Array<{ id: string; name: string }>
  const clash = records.find((r) => r.id !== exceptId && r.name.trim().toLowerCase() === name.trim().toLowerCase())
  return clash ? `Name: ${clash.name} already exists. Use a different name or edit the existing ${KIND_COPY[kind].noun}.` : undefined
}

function activeSessions(catalog: Catalog) {
  return Object.values(catalog.sessions).filter((s) => !s.supersededBy)
}

/** Why a record cannot be removed, or null. Checked before anything is written (J15 S5). */
export function removalRefusal(catalog: Catalog, kind: EquipmentKind, id: string): { message: string; trainIds: string[] } | null {
  if (kind === "camera" || kind === "telescope") {
    const trains = Object.values(catalog.opticalTrains).filter((t) => (kind === "camera" ? t.cameraId : t.telescopeId) === id)
    if (trains.length === 0) return null
    const name = kind === "camera" ? catalog.cameras[id]?.name : catalog.telescopes[id]?.name
    return {
      message: `${name} is used by ${trains.length === 1 ? "1 optical train" : `${trains.length} optical trains`}: ${trains.map((t) => t.name).join(", ")}. Edit or remove ${trains.length === 1 ? "that train" : "those trains"} first.`,
      trainIds: trains.map((t) => t.id),
    }
  }
  if (kind === "train") {
    const sessions = activeSessions(catalog).filter((s) => s.equipment.value === id).length
    const projects = Object.values(catalog.projects).filter(
      (p) => p.equipmentId === id || p.checklist.some((item) => item.kind === "equipment" && item.opticalTrainId === id),
    ).length
    if (sessions === 0 && projects === 0) return null
    const parts = [sessions ? `${sessions} ${sessions === 1 ? "session" : "sessions"}` : null, projects ? `${projects} ${projects === 1 ? "Project" : "Projects"}` : null].filter(Boolean)
    return {
      message: `${catalog.opticalTrains[id]?.name} is associated with ${parts.join(" and ")}. Removing it would leave them without equipment evidence; edit the train instead.`,
      trainIds: [],
    }
  }
  return null
}

/** Sessions and Projects that use a train, for the "Used by" column. */
export function trainUsage(catalog: Catalog, id: string): { sessions: number; projects: number } {
  return {
    sessions: activeSessions(catalog).filter((s) => s.equipment.value === id).length,
    projects: Object.values(catalog.projects).filter((p) => p.equipmentId === id).length,
  }
}

/** Create or update a record from a Settings form; the record becomes Manual. */
export function saveEquipment<K extends EquipmentKind>(kind: K, draft: EquipmentDraft<K>): CommitResult {
  const { collection, noun, prefix } = KIND_COPY[kind]
  const id = draft.id ?? `${prefix}_${stableHash(`${draft.name}|${nowIso()}`)}`
  const record = { ...draft, id, source: "manual" }
  const verb = draft.id ? "Updated" : "Added"
  return save(
    { label: `${draft.id ? "Changes to" : "New"} ${noun} ${draft.name}`, saved: `${verb} ${noun} ${draft.name}`, detail: draft.id ? "Saved as a Manual record." : null, href: HREF },
    (s) => withCatalog(s, (c) => ({ ...c, [collection]: { ...c[collection], [id]: record } })),
  )
}

export function removeEquipment(catalog: Catalog, kind: EquipmentKind, id: string): CommitResult {
  const { collection, noun } = KIND_COPY[kind]
  const name = (catalog[collection] as Record<string, { name: string }>)[id]?.name ?? noun
  return save({ label: `Removal of ${noun} ${name}`, saved: `Removed ${noun} ${name}`, detail: "Sessions keep their observed header evidence.", href: HREF }, (s) =>
    withCatalog(s, (c) => {
      const { [id]: _removed, ...rest } = c[collection] as Record<string, unknown>
      return { ...c, [collection]: rest }
    }),
  )
}
