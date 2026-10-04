/**
 * Location registration rules (T1 is the Location writer, HLD §12). Registering
 * records access and indexing intent only (LIB-FR-02); scan state
 * (`access`, `scanScope`, `unreadablePaths`, `lastIndexedAt`) is written by the
 * foundation `index` operation.
 */
import { fileAt, volumeForPath } from "@/domain/disk"
import { isUnder, stableHash } from "@/domain/indexing"
import type { Catalog, Disk, Location, LocationId, LocationRole, Volume } from "@/domain/types"
import { type CommitResult, nowIso, store, withCatalog } from "@/store/core"
import { save } from "./writes"

export const ROLE_ORDER: LocationRole[] = ["captures", "calibration", "results", "archive"]

export const ROLE_COPY: Record<LocationRole, { title: string; noun: string; description: string; add: string; picker: string }> = {
  captures: {
    title: "Captures",
    noun: "capture",
    description: "Light frames to index. Add as many folders as you like.",
    add: "Add capture location",
    picker: "Choose a capture folder",
  },
  calibration: {
    title: "Calibration",
    noun: "calibration",
    description: "Darks, flats, bias frames and calibration masters.",
    add: "Add calibration location",
    picker: "Choose a calibration folder",
  },
  results: {
    title: "Results",
    noun: "results",
    description: "Finished images and processing products PlateVault should find. Output folders can also be chosen per View.",
    add: "Add results location",
    picker: "Choose a results folder",
  },
  archive: {
    title: "Archive",
    noun: "archive",
    description: "Destinations for verified archive transfers.",
    add: "Add archive location",
    picker: "Choose an archive folder",
  },
}

export interface LocationDraft {
  path: string
  displayName: string
  role: LocationRole
}

export type LocationErrors = Partial<Record<"path" | "displayName", string>>

/** "Astro-T7 captures" for /Volumes/Astro-T7/Captures (J19 S2). */
export function suggestDisplayName(disk: Disk, path: string): string {
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  const folder = path.slice(path.lastIndexOf("/") + 1)
  if (!volume) return folder
  if (path === volume.mountPath) return volume.name
  return `${volume.name} ${folder.toLowerCase()}`
}

/** Errors name the field and the problem (HLD §10). `exceptId` skips the location being edited. */
export function validateLocation(catalog: Catalog, draft: LocationDraft, exceptId?: LocationId): LocationErrors {
  const errors: LocationErrors = {}
  const others = Object.values(catalog.locations).filter((l) => l.id !== exceptId)
  const name = draft.displayName.trim()
  if (!name) errors.displayName = "Display name: enter a name, for example Astro-T7 captures."
  else if (others.some((l) => l.displayName.toLowerCase() === name.toLowerCase())) errors.displayName = `Display name: ${name} is already used by another location.`

  const same = others.find((l) => l.path === draft.path)
  const container = others.find((l) => l.path !== draft.path && isUnder(draft.path, l.path))
  const inside = others.find((l) => l.path !== draft.path && isUnder(l.path, draft.path))
  if (same) errors.path = `Path: ${draft.path} is already registered as ${same.displayName}.`
  else if (container) errors.path = `Path: inside ${container.displayName}, which already indexes this folder. Choose a folder outside registered locations.`
  else if (inside) errors.path = `Path: contains ${inside.displayName}. Choose a folder that does not hold a registered location.`
  return errors
}

export function registerLocation(draft: LocationDraft, href: string): { result: CommitResult; id: LocationId | null } {
  const state = store.getState()
  const volumeId = volumeForPath(state.disk, draft.path)
  if (!volumeId) return { result: { ok: false, reason: "write-failed", message: `Path: ${draft.path} is not on a known volume.` }, id: null }
  const id: LocationId = `loc_${stableHash(`${volumeId}|${draft.path}`)}`
  const displayName = draft.displayName.trim()
  const location: Location = {
    id,
    displayName,
    path: draft.path,
    volumeId,
    role: draft.role,
    managed: false,
    registeredAt: nowIso(),
    access: "unknown",
    lastIndexedAt: null,
    scanScope: "never",
    unreadablePaths: [],
    lastScanOperationId: null,
  }
  const result = save(
    {
      label: `New location ${displayName}`,
      saved: `Registered ${displayName}`,
      detail: `${ROLE_COPY[draft.role].title} location at ${draft.path}. Nothing in the folder was changed.`,
      href,
    },
    (s) => {
      const next = withCatalog(s, (c) => ({ ...c, locations: { ...c.locations, [id]: location } }))
      const deferred = next.settings.onboarding.deferredRoles.filter((r) => r !== draft.role)
      return { ...next, settings: { ...next.settings, onboarding: { ...next.settings.onboarding, deferredRoles: deferred } } }
    },
  )
  return { result, id: result.ok ? id : null }
}

export interface LocationEdit {
  displayName: string
  role: LocationRole
  managed: boolean
}

export function updateLocation(id: LocationId, edit: LocationEdit, href: string): CommitResult {
  const name = edit.displayName.trim()
  return save({ label: `Changes to ${name}`, saved: `Updated ${name}`, detail: null, href }, (s) =>
    withCatalog(s, (c) => {
      const current = c.locations[id]
      if (!current) return c
      return { ...c, locations: { ...c.locations, [id]: { ...current, displayName: name, role: edit.role, managed: edit.managed } } }
    }),
  )
}

/** Points a never-indexed or same-folder registration at another folder (Choose folder again). */
export function repointLocation(id: LocationId, path: string, href: string): CommitResult {
  const state = store.getState()
  const location = state.catalog.locations[id]
  const volumeId = volumeForPath(state.disk, path)
  if (!location || !volumeId) return { ok: false, reason: "write-failed", message: `Path: ${path} is not on a known volume.` }
  return save(
    { label: `Folder change for ${location.displayName}`, saved: `${location.displayName} now points to ${path}`, detail: "No indexed frame referenced the previous folder.", href },
    (s) =>
      withCatalog(s, (c) => {
        const current = c.locations[id]
        if (!current) return c
        return { ...c, locations: { ...c.locations, [id]: { ...current, path, volumeId, access: "unknown", scanScope: "never", unreadablePaths: [] } } }
      }),
  )
}

/** Indexed frames (logical assets) with at least one copy in the location. */
export function framesInLocation(catalog: Catalog, id: LocationId): number {
  let count = 0
  for (const asset of Object.values(catalog.assets)) if (asset.copies.some((c) => c.locationId === id)) count += 1
  return count
}

export function sessionsInLocation(catalog: Catalog, id: LocationId): number {
  let count = 0
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy) continue
    if (session.assetIds.some((assetId) => catalog.assets[assetId]?.copies.some((c) => c.locationId === id))) count += 1
  }
  return count
}

export function removeLocation(id: LocationId, href: string): CommitResult {
  const location = store.getState().catalog.locations[id]
  if (!location) return { ok: true }
  return save(
    { label: `Removal of ${location.displayName}`, saved: `Removed ${location.displayName}`, detail: `Registration only. ${location.path} and its files are unchanged.`, href },
    (s) =>
      withCatalog(s, (c) => {
        const { [id]: _removed, ...locations } = c.locations
        return { ...c, locations }
      }),
  )
}

// ---------------------------------------------------------------------------
// Locate or remap with same-asset proof (D11, LIB-AC-11, LIB-FR-07)
// ---------------------------------------------------------------------------

export interface RemapEntry {
  assetId: string
  fileName: string
  fromPath: string
  toPath: string
  /** Bytes found at the new path; null when nothing is there. */
  foundSha256: string | null
}

export interface RemapProof {
  locationId: LocationId
  fromPath: string
  toPath: string
  fromVolume: Volume | null
  toVolume: Volume | null
  verified: RemapEntry[]
  differs: RemapEntry[]
  notFound: RemapEntry[]
  /** Set when the remap cannot proceed at all; nothing changes. */
  refusal: string | null
}

export function computeRemap(catalog: Catalog, disk: Disk, locationId: LocationId, toPath: string): RemapProof {
  const location = catalog.locations[locationId]!
  const toVolumeId = volumeForPath(disk, toPath)
  const proof: RemapProof = {
    locationId,
    fromPath: location.path,
    toPath,
    fromVolume: disk.volumes[location.volumeId] ?? null,
    toVolume: toVolumeId ? (disk.volumes[toVolumeId] ?? null) : null,
    verified: [],
    differs: [],
    notFound: [],
    refusal: null,
  }
  const other = Object.values(catalog.locations).find((l) => l.id !== locationId && (isUnder(toPath, l.path) || isUnder(l.path, toPath)))
  if (toPath === location.path && toVolumeId === location.volumeId) {
    proof.refusal = `${toPath} is the folder ${location.displayName} already uses. Choose a different folder, or use Rescan to read it again.`
    return proof
  }
  if (other) {
    proof.refusal = `${toPath} overlaps ${other.displayName}. Choose a folder outside other registered locations.`
    return proof
  }
  for (const asset of Object.values(catalog.assets)) {
    const copy = asset.copies.find((c) => c.locationId === locationId)
    if (!copy) continue
    const relative = copy.path.startsWith(`${location.path}/`) ? copy.path.slice(location.path.length) : `/${asset.fileName}`
    const target = `${toPath}${relative}`
    const file = fileAt(disk, target)
    const entry: RemapEntry = { assetId: asset.id, fileName: asset.fileName, fromPath: copy.path, toPath: target, foundSha256: file?.sha256 ?? null }
    if (!file) proof.notFound.push(entry)
    else if (file.sha256 === copy.sha256) proof.verified.push(entry)
    else proof.differs.push(entry)
  }
  const total = proof.verified.length + proof.differs.length + proof.notFound.length
  if (total === 0) proof.refusal = `${location.displayName} holds no indexed frames, so there is nothing to remap. Use Choose folder again to point it at another folder.`
  else if (proof.verified.length === 0)
    proof.refusal = `Remap refused: no indexed frame in ${location.displayName} has the same bytes in ${toPath}. Matching names are not enough. Nothing changed.`
  return proof
}

/**
 * Apply a reviewed remap. Verified copies move to the new folder with their
 * asset identity, decisions and View membership intact; copies whose bytes
 * differ or are missing are refused and read Not found in this location.
 */
export function applyRemap(proof: RemapProof, href: string): CommitResult {
  const state = store.getState()
  const location = state.catalog.locations[proof.locationId]
  if (!location || !proof.toVolume) return { ok: false, reason: "write-failed", message: "Remap not saved: the location or volume is no longer available." }
  if (state.faults.failNextHashVerification) {
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextHashVerification: false } }))
    return {
      ok: false,
      reason: "write-failed",
      message: `Remap not saved: hash verification of ${proof.verified.length} files on ${proof.toVolume.name} failed. Nothing changed; choose Retry.`,
    }
  }
  const now = nowIso()
  const verified = new Map(proof.verified.map((e) => [e.assetId, e]))
  const refused = new Map([...proof.differs, ...proof.notFound].map((e) => [e.assetId, e]))
  const toVolume = proof.toVolume
  const volumeNote =
    proof.fromVolume && proof.fromVolume.name === toVolume.name && proof.fromVolume.volumeUuid !== toVolume.volumeUuid
      ? ` Same volume name, different identity (${proof.fromVolume.volumeUuid} → ${toVolume.volumeUuid}).`
      : ""
  return save(
    {
      label: `Remap of ${location.displayName}`,
      saved: `Remapped ${location.displayName} to ${proof.toPath}`,
      detail: `${proof.verified.length} frames verified by content hash${refused.size ? `; ${refused.size} refused (bytes differ or not found)` : ""}.${volumeNote}`,
      href,
    },
    (s) =>
      withCatalog(s, (c) => {
        const assets = { ...c.assets }
        for (const [assetId, entry] of verified) {
          const asset = assets[assetId]
          if (!asset) continue
          assets[assetId] = {
            ...asset,
            copies: asset.copies.map((copy) =>
              copy.locationId === proof.locationId
                ? { ...copy, volumeId: toVolume.id, path: entry.toPath, sha256: entry.foundSha256 ?? copy.sha256, presence: "observed", lastObservedAt: now }
                : copy,
            ),
          }
        }
        for (const [assetId, entry] of refused) {
          const asset = assets[assetId]
          if (!asset) continue
          assets[assetId] = {
            ...asset,
            copies: asset.copies.map((copy) => (copy.locationId === proof.locationId ? { ...copy, volumeId: toVolume.id, path: entry.toPath, presence: "absent" } : copy)),
          }
        }
        const current = c.locations[proof.locationId]!
        return { ...c, assets, locations: { ...c.locations, [proof.locationId]: { ...current, path: proof.toPath, volumeId: toVolume.id } } }
      }),
  )
}
