/**
 * StarCutouts (L2-domain): one detected star at 1:1 as three small
 * cutouts, the observed pixels, the fitted PSF model and their residual
 * (PIX-FR-05), so a fit reads at a glance. A failed fit has no model or
 * residual; those two say so in place.
 */
import { useEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import type { Messages } from "@/lib/i18n"
import { type CutoutKind, renderCutout, type StarField, type StarRecord } from "./raster"

const KINDS: readonly CutoutKind[] = ["observed", "fitted", "residual"]

function kindName(m: Messages, kind: CutoutKind): string {
  return kind === "observed" ? m.frame_cutout_observed() : kind === "fitted" ? m.frame_fitted() : m.frame_cutout_residual()
}

function Cutout({ field, star, kind }: { field: StarField; star: StarRecord; kind: CutoutKind }) {
  const m = useMessages()
  const canvas = useRef<HTMLCanvasElement>(null)
  const unavailable = star.state === "failed" && kind !== "observed"
  useEffect(() => {
    if (unavailable) return
    canvas.current?.getContext("2d")?.putImageData(renderCutout(field, star, kind), 0, 0)
  }, [field, star, kind, unavailable])
  const name = kindName(m, kind)
  return (
    <figure className="space-y-1">
      {unavailable ? (
        <span className="flex size-20 items-center justify-center rounded-sm border border-dashed p-1 text-center text-xs text-muted-foreground">{m.frame_no_fit()}</span>
      ) : (
        <canvas ref={canvas} width={25} height={25} className="size-20 rounded-sm border [image-rendering:pixelated]" role="img" aria-label={m.frame_cutout_label({ kind: name, id: star.id })} />
      )}
      <figcaption className="text-xs text-muted-foreground">{name}</figcaption>
    </figure>
  )
}

/** The observed, fitted and residual cutouts of one star, side by side. */
export function StarCutouts({ field, star }: { field: StarField; star: StarRecord }) {
  return (
    <div className="flex flex-wrap gap-3" data-star-cutouts>
      {KINDS.map((kind) => (
        <Cutout key={kind} field={field} star={star} kind={kind} />
      ))}
    </div>
  )
}
