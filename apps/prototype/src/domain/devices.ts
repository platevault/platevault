/**
 * Removable devices (foundation-owned; replaces the named "ASIAIR card").
 * A USB or SD volume is detected when connected; its capture layout is
 * recognised by folder structure so Import can name the device type. The
 * rules are prototype heuristics over the default layouts each capture
 * application writes. Nothing here writes state.
 */
import { volumeForPath } from "./disk"
import type { Disk, DiskFile, Volume, VolumeId } from "./types"

export type DeviceLayout = "asiair" | "nina" | "sharpcap" | "ekos" | "sgp" | "voyager"

export const DEVICE_LAYOUT_LABEL: Record<DeviceLayout, string> = {
  asiair: "ASIAIR",
  nina: "N.I.N.A.",
  sharpcap: "SharpCap",
  ekos: "Ekos (KStars)",
  sgp: "Sequence Generator Pro",
  voyager: "Voyager",
}

/**
 * Layout rules, most specific first. Each reads paths relative to the
 * volume root and names the evidence it matched.
 */
const RULES: Array<{ layout: DeviceLayout; evidence: string; test: (relative: string) => boolean }> = [
  { layout: "sharpcap", evidence: "SharpCap Captures folder", test: (p) => p.startsWith("SharpCap Captures/") || p.endsWith(".CameraSettings.txt") },
  { layout: "sgp", evidence: ".sgf sequence file", test: (p) => p.endsWith(".sgf") },
  { layout: "asiair", evidence: "Autorun and Plan folders", test: (p) => /^(Autorun|Plan|Live)\//.test(p) },
  { layout: "voyager", evidence: "Voyager file names", test: (p) => /_LIGHT_[^_/]+_\d+s_BIN\d/i.test(p) },
  { layout: "ekos", evidence: "Ekos Light/<filter> folders", test: (p) => /_Light_[^/]*_secs_/.test(p) || /(^|\/)Light\/[^/]+\/[^/]+\.fits?$/.test(p) },
  { layout: "nina", evidence: "N.I.N.A. LIGHT folders", test: (p) => /(^|\/)(LIGHT|FLAT|DARK|BIAS)\//.test(p) },
]

export interface LayoutMatch {
  layout: DeviceLayout
  label: string
  evidence: string
}

function relativeFiles(disk: Disk, volume: Volume): string[] {
  const root = `${volume.mountPath}/`
  return Object.values(disk.files)
    .filter((f) => f.volumeId === volume.id && f.path.startsWith(root))
    .map((f) => f.path.slice(root.length))
}

/** The capture layout a volume holds, or null for a generic device (or one not connected). */
export function recognizeLayout(disk: Disk, volumeId: VolumeId): LayoutMatch | null {
  const volume = disk.volumes[volumeId]
  if (!volume?.mounted) return null
  const paths = relativeFiles(disk, volume)
  for (const rule of RULES) {
    if (paths.some(rule.test)) return { layout: rule.layout, label: DEVICE_LAYOUT_LABEL[rule.layout], evidence: rule.evidence }
  }
  return null
}

export interface RemovableDevice {
  volume: Volume
  connected: boolean
  layout: LayoutMatch | null
  /** "ASIAIR", or "USB device" when no layout is recognised. */
  label: string
  /** Image files on the device (FITS, XISF, TIFF), when connected. */
  imageFiles: number
  bytes: number
}

const IMAGE_KINDS = new Set<DiskFile["kind"]>(["fits", "xisf", "tiff"])

/** Removable volumes, connected first: what Import's Removable devices section lists. */
export function removableDevices(disk: Disk): RemovableDevice[] {
  return Object.values(disk.volumes)
    .filter((v) => v.removable)
    .map((volume): RemovableDevice => {
      const files = volume.mounted ? Object.values(disk.files).filter((f) => f.volumeId === volume.id && IMAGE_KINDS.has(f.kind)) : []
      const layout = recognizeLayout(disk, volume.id)
      return { volume, connected: volume.mounted, layout, label: layout?.label ?? "USB device", imageFiles: files.length, bytes: files.reduce((n, f) => n + f.sizeBytes, 0) }
    })
    .sort((a, b) => Number(b.connected) - Number(a.connected) || a.volume.name.localeCompare(b.volume.name))
}

/** The path is on a removable device (connected or not). */
export function isRemovablePath(disk: Disk, path: string): boolean {
  const volumeId = volumeForPath(disk, path)
  return Boolean(volumeId && disk.volumes[volumeId]?.removable)
}
