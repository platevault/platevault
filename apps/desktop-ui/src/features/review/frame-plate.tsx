/**
 * One frame on a stage pane (PIX-FR-03): its plate at the shared zoom, pan
 * and stretch, or the corner inspector's nine 1:1 tiles. The pixels come
 * from the library's display tiles (queries.ts); the corner overlays from
 * the frame's recorded stars. A frame with no readable copy, or whose decode
 * the library refused, says why instead.
 */
import { useCallback, useState } from "react"
import { failureOf, type ReviewFrame_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { UnknownValue } from "@/components/app/feedback"
import { failureMessage } from "@/components/app/run-result"
import { CornerGrid, type CornerOverlay, type RegionRect } from "@/components/domain/corner-grid"
import { Plate, type PlateView, type ViewWindow } from "@/components/domain/plate"
import { availabilityWord } from "./columns"
import { zoneStats } from "./pixels"
import { useFramePixels, useFrameStars } from "./queries"

export interface FramePlateProps {
  frame: ReviewFrame_Serialize
  view: PlateView
  onView: (view: PlateView) => void
  /** The corner inspector instead of the plate. */
  corners: boolean
  overlay: CornerOverlay
  /** Names the frame: its display name. */
  label: string
}

export function FramePlate({ frame, view, onView, corners, overlay, label }: FramePlateProps) {
  const m = useMessages()
  const [shown, setShown] = useState<ViewWindow | null>(null)
  const readable = frame.state.availability === "available"
  const pixels = useFramePixels(readable ? frame.asset : null, view.stretch, { window: view.zoom === "fit" ? null : shown, corners })
  const stars = useFrameStars(frame.asset.id, readable && corners && (overlay.fwhm || overlay.eccentricity))
  const recorded = stars.data?.stars
  const measure = useCallback((zone: RegionRect) => zoneStats(recorded ?? [], zone), [recorded])

  if (!readable) return <UnknownValue label={m.review_no_pixels()} reason={availabilityWord(m, frame.state.availability)} />
  if (pixels.error) {
    const failure = failureOf(pixels.error)
    return <UnknownValue label={m.review_no_pixels()} reason={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} />
  }
  if (!pixels.image) return <UnknownValue label={m.status_pending()} />
  if (corners) return <CornerGrid image={pixels.image} measure={measure} stretch={view.stretch} overlay={overlay} label={label} />
  return <Plate image={pixels.image} view={view} onView={onView} label={label} onWindow={setShown} />
}
