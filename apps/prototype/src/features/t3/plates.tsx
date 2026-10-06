/**
 * Frame plates (HARNESS V1, Direction B's light table): a contact sheet of
 * mounted plate thumbnails beside the frames table. Thumbnails are drawn
 * from the same synthetic star field as the preview (raster.ts), only when
 * they scroll into view, and never feed a measurement.
 */
import { type ReactNode, useEffect, useRef, useState } from "react"
import { PlateMount, type PlateSource } from "@/components/app/plate"
import type { Asset, DiskFile } from "@/domain/types"
import { cn } from "@/lib/utils"
import { renderWindow, type StarField, starField, type Stretch } from "./raster"

/** The preview's star field for a frame's current bytes, or null without pixel facts. */
export function frameField(asset: Asset, file: DiskFile | undefined): StarField | null {
  if (!file?.pixelTruth) return null
  const header = asset.observed
  return starField(`${asset.id}|${file.sha256}`, file.pixelTruth, header.widthPx, header.heightPx, header.bayerPattern)
}

/** Whole-frame thumbnail of a star field, rendered once it is near the viewport. */
export function PlateThumb({ field, width = 176, stretch = "auto" }: { field: StarField; width?: number; stretch?: Stretch }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)
  const height = Math.max(1, Math.round((width * field.height) / field.width))
  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: "240px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const context = canvas.current?.getContext("2d")
    if (!visible || !context) return
    context.putImageData(renderWindow(field, { x0: 0, y0: 0, scale: field.width / width, width, height }, stretch), 0, 0)
  }, [visible, field, width, height, stretch])
  // Display only: a deeper black point so a small plate reads as night sky, as a print on a mount does.
  return <canvas ref={canvas} width={width} height={height} aria-hidden="true" className="block h-auto w-full [filter:brightness(0.8)_contrast(1.5)]" />
}

export interface SheetItem {
  id: string
  field: StarField | null
  /** Accessible name of the plate button: file, session and state. */
  label: string
  caption: string
  sources: PlateSource[]
  status?: ReactNode
  dimmed: boolean
  /** Text shown on the plate when there is no pixel data. */
  unavailable?: string
}

/**
 * Contact sheet: one mounted plate per frame in table order. A plate is a
 * button; choosing it makes that frame current, as a table row does (J/K
 * and Previous/Next follow the same order).
 */
export function ContactSheet({ items, activeId, onSelect, label }: { items: SheetItem[]; activeId: string | null; onSelect: (id: string) => void; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2.5">
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <button
            type="button"
            id={`frame-${item.id}`}
            data-frame-id={item.id}
            aria-current={item.id === activeId ? "true" : undefined}
            aria-label={item.label}
            onClick={() => onSelect(item.id)}
            className={cn(
              "block w-full rounded-[4px] text-left outline-offset-2",
              "aria-[current=true]:shadow-[0_0_0_3px_var(--primary)]",
            )}
          >
            <PlateMount inline size="thumb" caption={item.caption} sources={item.sources} status={item.status} dimmed={item.dimmed}>
              {item.field ? (
                <PlateThumb field={item.field} />
              ) : (
                <span className="flex aspect-[3/2] items-center justify-center px-2 text-center text-[0.6875rem] text-white/80">{item.unavailable ?? "No pixel data"}</span>
              )}
            </PlateMount>
          </button>
        </li>
      ))}
    </ul>
  )
}
