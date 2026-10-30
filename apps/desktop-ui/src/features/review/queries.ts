/**
 * Review's library reads and writes (spec 067, LIB-FR-20), all through the
 * IPC boundary (`@/api`): the session's review list, thumbnails, the frame
 * preview's tiles and recorded stars, P/X/U marks and Finish review.
 *
 * - The list is read once with filter All in capture order; the workspace
 *   filters and sorts it, so the three views share one order and a selection
 *   the filter hides can still be marked from its last read.
 * - Thumbnails come from the catalog; a frame still decoding reads `pending`,
 *   so the read repeats while any is pending (PIX-FR-12).
 * - Tiles are bound to the bytes' SHA-256, so they never go stale; a frame
 *   is reopened when its observation changes.
 * - A mark names the asset revision and fingerprint of the latest read; the
 *   library refuses a stale one with `conflict`. Each mark's answer goes
 *   into the list at once, and the list and Sessions' totals are re-read
 *   after it, since quality is library-wide.
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"
import { type ActionResult, type Asset_Serialize, data, type ExpectedAsset_Deserialize, library, type Quality, type ReviewFrame_Serialize, type SessionReviewList_Serialize } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import type { PlateImage, Stretch, ViewWindow } from "@/components/domain/plate"
import { labelAfterMark } from "./model"
import { cornerRegions, detailBlocks, type GrayTile, grayTile, levelExtent, overviewLevel, type TileRect, tiledImage, wireStretch } from "./pixels"

/** How often a list with pending thumbnails asks again. */
const THUMBNAIL_POLL_MS = 1500

export function sessionReviewQuery(sessionId: string) {
  return libraryQuery("pixSessionReviewList", sessionId, "all", null, null)
}

export function useSessionReview(sessionId: string) {
  return useQuery(sessionReviewQuery(sessionId))
}

/** One thumbnail state per frame; read only while a thumbnail view shows. */
export function useThumbnails(assetIds: readonly string[], enabled: boolean) {
  return useQuery({
    ...libraryQuery("pixThumbnails", [...assetIds]),
    enabled: enabled && assetIds.length > 0,
    refetchInterval: (query) => (query.state.data?.some((entry) => entry.state === "pending") ? THUMBNAIL_POLL_MS : false),
  })
}

function expected(asset: Asset_Serialize): ExpectedAsset_Deserialize {
  return { assetId: asset.id, decisionRevision: asset.decisionRevision, fingerprint: asset.fingerprint }
}

/** The list with one frame's marked asset in place: its label, its quality and the counts follow it. */
export function withMarked(list: SessionReviewList_Serialize, asset: Asset_Serialize): SessionReviewList_Serialize {
  const frames = list.frames.map((f) => (f.asset.id === asset.id ? { ...f, asset, label: labelAfterMark(asset.quality), quality: asset.quality } : f))
  const counts = { all: frames.length, picked: 0, rejected: 0, unreviewed: 0 }
  for (const f of frames) counts[f.label] += 1
  return { ...list, frames, counts }
}

/** What a mark did: how many frames it marked before it finished or was refused. */
export interface MarkOutcome {
  marked: number
  result: ActionResult<number>
}

/**
 * Marks and Finish review for one session; each resolves the library's
 * result unchanged. Marks run one at a time, in the order they were made,
 * and each names the frame as the list holds it then. A mark's answer goes
 * into the list before the next one runs, so a quick second key on a frame
 * names the revision the first mark recorded.
 */
export function useReviewWrites(sessionId: string) {
  const client = useQueryClient()
  return useMemo(() => {
    const listKey = sessionReviewQuery(sessionId).queryKey
    const refresh = () =>
      Promise.all([
        client.invalidateQueries({ queryKey: libraryKey("pixSessionReviewList", sessionId) }),
        client.invalidateQueries({ queryKey: libraryKey("librarySession", sessionId) }),
        client.invalidateQueries({ queryKey: libraryKey("libraryListSessions") }),
        client.invalidateQueries({ queryKey: libraryKey("homeDashboard") }),
        // A mark moves a Project's "Review N new frames" on the Projects list as on Home.
        client.invalidateQueries({ queryKey: libraryKey("projectRows") }),
      ])
    const latest = (frame: ReviewFrame_Serialize) => client.getQueryData(listKey)?.frames.find((f) => f.asset.id === frame.asset.id)?.asset ?? frame.asset
    let queue: Promise<unknown> = Promise.resolve()
    async function markNow(frames: readonly ReviewFrame_Serialize[], quality: Quality): Promise<MarkOutcome> {
      let marked = 0
      for (const frame of frames) {
        const result = await library.pixSessionReviewMark(sessionId, { asset: expected(latest(frame)), quality })
        if (!result.ok) {
          // A refusal (often a stale revision) waits for the re-read, so the next mark names what the library holds now.
          await refresh()
          return { marked, result }
        }
        // A re-read still in flight began before this mark: drop it, so it cannot put back the revision this mark replaced.
        await client.cancelQueries({ queryKey: listKey })
        client.setQueryData(listKey, (list) => (list ? withMarked(list, result.data.asset) : list))
        marked += 1
      }
      void refresh()
      return { marked, result: { ok: true, data: marked } }
    }
    return {
      /** One mark per frame, in order; stops at the first refusal. */
      mark(frames: readonly ReviewFrame_Serialize[], quality: Quality): Promise<MarkOutcome> {
        const run = queue.then(() => markNow(frames, quality))
        queue = run.catch(() => undefined)
        return run
      },
      async finish(groupingRevision: number): Promise<ActionResult<number>> {
        await queue
        const result = await library.pixFinishReview(sessionId, groupingRevision)
        if (result.ok) await refresh()
        return result
      },
    }
  }, [client, sessionId])
}

/** The frame's recorded stars; read only for the corner inspector's overlays. */
export function useFrameStars(assetId: string | null, enabled: boolean) {
  return useQuery({ ...libraryQuery("pixFrameStars", assetId ?? ""), enabled: enabled && assetId !== null })
}

function tileQuery(assetId: string, sha256: string, level: number, rect: TileRect, stretch: ReturnType<typeof wireStretch>) {
  return { ...libraryQuery("pixPreviewTile", assetId, sha256, 0, level, rect.x, rect.y, rect.width, rect.height, stretch), staleTime: Number.POSITIVE_INFINITY, select: grayTile }
}

export interface FramePixels {
  /** Null until the frame is open and its overview tile has loaded. */
  image: PlateImage | null
  loading: boolean
  /** Why the frame shows no pixels: its open or overview read failed. */
  error: unknown
}

/**
 * The frame's pixels as a PlateImage: the whole-frame overview, plus level-0
 * detail where `window` (a zoomed plate) or the corner inspector needs it.
 */
export function useFramePixels(asset: Asset_Serialize | null, stretch: Stretch, detail: { window: ViewWindow | null; corners: boolean }): FramePixels {
  const assetId = asset?.id ?? ""
  const open = useQuery({
    queryKey: [...libraryKey("pixOpenFrame", assetId), asset?.observationRevision ?? 0, asset?.fingerprint.contentSha256 ?? null],
    queryFn: () => data(library.pixOpenFrame(assetId)),
    enabled: asset !== null,
    staleTime: Number.POSITIVE_INFINITY,
  })
  const preview = open.data ?? null
  const sha256 = preview?.sha256 ?? ""
  const level = preview ? overviewLevel(preview.width, preview.height) : 0
  const whole: TileRect = preview ? { x: 0, y: 0, width: levelExtent(preview.width, level), height: levelExtent(preview.height, level) } : { x: 0, y: 0, width: 1, height: 1 }
  // Strong deepens the frame's Auto result, so Auto's overview is read first whenever Strong shows.
  const auto = useQuery({ ...tileQuery(assetId, sha256, level, whole, { kind: "auto" }), enabled: preview !== null && stretch === "strong" })
  const applied = auto.data?.applied ?? null
  const wire = wireStretch(stretch, applied)
  const overview = useQuery({ ...tileQuery(assetId, sha256, level, whole, wire), enabled: preview !== null && (stretch !== "strong" || applied !== null) })
  const rects = preview ? [...(detail.window && detail.window.scale <= 1 ? detailBlocks(preview, detail.window) : []), ...(detail.corners ? cornerRegions(preview) : [])] : []
  const details = useQueries({ queries: rects.map((rect) => ({ ...tileQuery(assetId, sha256, 0, rect, wire), enabled: overview.data !== undefined })) })
  const loaded = details.map((q) => q.data).filter((t): t is GrayTile => t !== undefined)
  // The loaded tiles are named by their rectangles: a tile's pixels never change for one SHA-256 and stretch.
  const loadedKey = loaded.map((t) => `${t.x},${t.y},${t.width},${t.height}`).join(";")
  const overviewTile = overview.data
  const image = useMemo(
    () => (preview && overviewTile ? tiledImage(preview.width, preview.height, [overviewTile, ...loaded]) : null),
    [preview, overviewTile, loadedKey],
  )
  const failed = open.error ?? auto.error ?? overview.error ?? null
  return { image, loading: asset !== null && failed === null && image === null, error: failed }
}
