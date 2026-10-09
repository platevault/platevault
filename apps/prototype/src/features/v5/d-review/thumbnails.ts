/**
 * Thumbnails for the filmstrip and the grid (D-W40, PIX-FR-12): decoded by
 * the same synthetic decoder as the preview (`starField` + `renderWindow`)
 * with the Auto display stretch, and cached by the SHA-256 of the bytes they
 * were decoded from. A frame whose bytes change gets a new key, so it is
 * decoded again; a frame not yet decoded reads Pending. Decoding is
 * display-only and never starts built-in measurement (PIX-FR-04).
 */
import { useEffect, useSyncExternalStore } from "react"
import type { AssetId, DiskFile } from "@/domain/types"
import { frameField, renderWindow } from "@/features/t3/raster"
import { m } from "@/lib/i18n"

export const THUMB_W = 160

const ready = new Map<string, string>()
const queued = new Map<string, { assetId: AssetId; file: DiskFile }>()
const listeners = new Set<() => void>()
let version = 0
let scheduled = false

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

function decode(assetId: AssetId, file: DiskFile): string {
  const field = frameField(assetId, file)!
  const scale = field.width / THUMB_W
  const height = Math.round(field.height / scale)
  const canvas = document.createElement("canvas")
  canvas.width = THUMB_W
  canvas.height = height
  canvas.getContext("2d")?.putImageData(renderWindow(field, { x0: 0, y0: 0, scale, width: THUMB_W, height }, "auto"), 0, 0)
  return canvas.toDataURL("image/png")
}

function pump() {
  scheduled = false
  const started = performance.now()
  for (const [key, item] of queued) {
    queued.delete(key)
    ready.set(key, decode(item.assetId, item.file))
    if (performance.now() - started > 12) break
  }
  notify()
  if (queued.size > 0) schedule()
}

function schedule() {
  if (scheduled) return
  scheduled = true
  if ("requestIdleCallback" in window) window.requestIdleCallback(pump, { timeout: 200 })
  else setTimeout(pump, 16)
}

export type Thumb = { state: "pending" } | { state: "ready"; url: string } | { state: "unreadable"; reason: string }

/** A decodable file's cache key is its bytes; null when there is nothing to decode. */
export function thumbKey(file: DiskFile | undefined): string | null {
  return file?.header && file.pixelTruth ? file.sha256 : null
}

export function useThumbnail(assetId: AssetId, file: DiskFile | undefined, unreadableReason: string | null): Thumb {
  const key = unreadableReason ? null : thumbKey(file)
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => version,
  )
  useEffect(() => {
    if (key && file && !ready.has(key) && !queued.has(key)) {
      queued.set(key, { assetId, file })
      schedule()
    }
  }, [key, file, assetId])
  if (unreadableReason) return { state: "unreadable", reason: unreadableReason }
  if (!key) return { state: "unreadable", reason: m.review_no_pixel_data() }
  const url = ready.get(key)
  return url ? { state: "ready", url } : { state: "pending" }
}
