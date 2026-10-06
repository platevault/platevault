/**
 * Session thumbnail (harness v2): the first readable light frame of a session,
 * drawn from its pixel facts with the same synthetic raster and Auto stretch
 * the frame preview uses (display only, never a measurement). Offline or
 * unreadable sessions show what is missing instead of an image.
 */
import { Hourglass, ImageOff, Unplug } from "lucide-react"
import { useEffect, useMemo, useRef } from "react"
import type { Session } from "@/domain/types"
import { renderWindow, starField } from "@/features/t3/raster"
import { currentFile } from "@/features/t3/model"
import { useStore } from "@/store/core"

const THUMB_W = 288

export function SessionThumb({ session, label }: { session: Session; label: string }) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const canvas = useRef<HTMLCanvasElement>(null)
  const source = useMemo(() => {
    for (const id of session.assetIds) {
      const asset = catalog.assets[id]
      const file = asset ? currentFile(disk, catalog, asset) : undefined
      if (asset && file?.pixelTruth) return { asset, file, truth: file.pixelTruth }
    }
    return null
  }, [session, catalog, disk])
  const height = source ? Math.round((THUMB_W * source.asset.observed.heightPx) / source.asset.observed.widthPx) : 0

  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!context || !source) return
    const header = source.asset.observed
    const field = starField(`${source.asset.id}|${source.file.sha256}`, source.truth, header.widthPx, header.heightPx, header.bayerPattern)
    const scale = header.widthPx / THUMB_W
    context.putImageData(renderWindow(field, { x0: 0, y0: 0, scale, width: THUMB_W, height }, "auto"), 0, 0)
  }, [source, height])

  if (!source) {
    const offline = session.assetIds.some((id) => {
      const asset = catalog.assets[id]
      return asset?.copies.some((copy) => !disk.volumes[copy.volumeId]?.mounted)
    })
    const Icon = session.scope === "provisional" ? Hourglass : offline ? Unplug : ImageOff
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 text-2xs text-muted-foreground" role="img" aria-label={`${label}: no preview`}>
        <Icon aria-hidden="true" className="size-4" />
        {session.scope === "provisional" ? "Indexing…" : offline ? "Offline · last observed" : "No readable frame"}
      </div>
    )
  }
  return <canvas ref={canvas} width={THUMB_W} height={Math.max(1, height)} role="img" aria-label={`${label}: first frame, Auto stretch`} className="size-full object-cover" />
}
