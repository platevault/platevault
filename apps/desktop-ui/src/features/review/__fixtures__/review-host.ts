/**
 * Review's tests stand in for the library host behind the IPC boundary
 * (`mockIPC`): one session's frames in the wire shapes the generated client
 * declares, with the host's rules the workspace depends on. A mark names the
 * asset's decision revision and is refused with `conflict` when it is stale;
 * Finish review is refused while a frame is Unreviewed or at a stale grouping
 * revision. Test only.
 */
import type {
  Asset_Serialize,
  ErrorResponse,
  FramePreview_Serialize,
  FrameStars_Serialize,
  LibraryErrorCode,
  PreviewTile,
  Quality,
  ReviewFrame_Serialize,
  ReviewMark_Deserialize,
  SessionReviewList_Serialize,
  StarRecord,
  ThumbnailEntry_Serialize,
} from "@/api/ipc"

export const SESSION_ID = "8f0c5e2a-3d1b-4c7e-9a6f-1b2c3d4e5f60"
export const FRAME_WIDTH = 1200
export const FRAME_HEIGHT = 900

const fingerprint = (n: number) => ({
  identity: { volume: { filesystem: "apfs", stableId: "vol-1", fileIdsStable: true, case: "insensitive" as const, normalization: "insensitive" as const }, fileId: `file-${n}` },
  sizeBytes: 18_662_400,
  modifiedNs: `17600000000000000${n}`,
  contentSha256: `${n}`.padStart(64, "a"),
})

function asset(n: number, quality: Quality): Asset_Serialize {
  const name = `M42_Ha_300s_${String(n).padStart(4, "0")}.fits`
  const metadata = {
    raw: {},
    imageType: "LIGHT",
    filter: "Ha",
    object: "M 42",
    camera: "ASI2600MM",
    cameraId: null,
    telescope: null,
    exposureSeconds: 300,
    gain: 100,
    offset: 50,
    binningX: 1,
    binningY: 1,
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    readoutMode: null,
    setTemperatureC: -10,
    measuredTemperatureC: -10,
    dateObs: `2026-10-12T21:${String(n * 5).padStart(2, "0")}:00Z`,
    dateLocal: null,
    siteLongitudeDeg: null,
    siteLatitudeDeg: null,
    raDeg: 83.82,
    decDeg: -5.39,
    wcsRaDeg: null,
    wcsDecDeg: null,
    skyRotationDeg: null,
    mechanicalRotationDeg: null,
    focalLengthMm: 530,
    pixelSizeUm: 3.76,
  }
  return {
    id: `asset-${n}`,
    locationId: "location-1",
    relativePath: { encoding: "unix-bytes", payload: [...new TextEncoder().encode(name)], display: name },
    fingerprint: fingerprint(n),
    observationRevision: 1,
    decisionRevision: 1,
    format: "fits",
    availability: "available",
    observed: metadata,
    effective: metadata,
    quality,
    qualityBasis: quality === "unreviewed" ? null : fingerprint(n),
    verificationPending: false,
    lastObservedAt: "2026-10-13T08:00:00Z",
    lastVerifiedAt: "2026-10-13T08:00:00Z",
  }
}

const LABEL: Record<Quality, ReviewFrame_Serialize["label"]> = { usable: "picked", unusable: "rejected", unreviewed: "unreviewed" }

function frame(a: Asset_Serialize, fwhm: number | null): ReviewFrame_Serialize {
  const name = a.relativePath.display
  return {
    asset: a,
    sessionId: SESSION_ID,
    display: { assetId: a.id, name, path: { encoding: "unix-bytes", payload: [], display: `/Volumes/Captures/2026-10-12/${name}` }, fallbacks: [] },
    label: LABEL[a.quality],
    quality: a.quality,
    otherCopies: [],
    state: {
      assetId: a.id,
      state: fwhm === null ? "not_measured" : "cached",
      reason: null,
      availability: a.availability,
      measurementId: fwhm === null ? null : `measurement-${a.id}`,
      measuredAt: fwhm === null ? null : "2026-10-13T08:10:00Z",
      verification: fwhm === null ? null : "current",
      basis: null,
      values:
        fwhm === null
          ? []
          : [{ metric: "fwhm_median", label: "FWHM", value: fwhm, units: "px", state: "measured", reason: null, source: { kind: "built_in", method: "psf", version: 1 } }],
      imported: [],
    },
  }
}

function tile(level: number, x: number, y: number, width: number, height: number): PreviewTile {
  const gray = btoa("\u0060".repeat(width * height))
  return {
    plane: 0,
    level,
    x,
    y,
    width,
    height,
    appliedStretch: { kind: "auto", black: 0, white: 65535, shadows: 0.02, midtones: 0.2, highlights: 1 },
    gray,
    mask: null,
  }
}

function refusal(code: LibraryErrorCode, retry: ErrorResponse["retry"], currentRevision: number | null = null): ErrorResponse {
  return { code, identity: null, scope: null, retry, currentRevision, successors: [], window: null, correction: null, field: null }
}

const STARS: StarRecord[] = [
  [40, 40],
  [60, 70],
  [90, 50],
  [600, 450],
  [620, 430],
  [580, 470],
].map(([x, y], index) => ({
  index,
  x: x!,
  y: y!,
  state: "fitted",
  reasons: [],
  warnings: [],
  peak: 1200,
  flux: 9000,
  localBackground: 410,
  boxRadius: 8,
  model: "elliptical_gaussian",
  fwhmMajorPx: 3.4,
  fwhmMinorPx: 3.0,
  fwhmPx: index < 3 ? 4.2 : 3.1,
  eccentricity: 0.4,
  positionAngleDeg: 30,
  hfrPx: 1.8,
}))

export interface ReviewHost {
  frames: ReviewFrame_Serialize[]
  groupingRevision: number
  /** Every command the workspace sent, with its arguments, in order. */
  calls: { command: string; args: Record<string, unknown> }[]
  /** While set, marks wait for it before they answer. */
  hold: Promise<void> | null
  /** Each mark answers this many ms later, after a timer, as a catalog write over IPC does. */
  markDelayMs: number
  /** Commands that answer with a refusal instead. */
  refuse: Partial<Record<string, ErrorResponse>>
  /** Answers one IPC call; the test hands it to `mockIPC`. */
  handle: (command: string, payload?: unknown) => unknown
}

/** The commands review sends, by name. */
export function commandsSent(host: ReviewHost, command: string) {
  return host.calls.filter((c) => c.command === command)
}

/**
 * The stand-in host with `count` Unreviewed frames (the first
 * `marked` already Picked); FWHM is measured on every frame but the last.
 */
export function reviewHost({ count = 6, marked = 0 }: { count?: number; marked?: number } = {}): ReviewHost {
  const host: ReviewHost = {
    frames: Array.from({ length: count }, (_, i) => frame(asset(i + 1, i < marked ? "usable" : "unreviewed"), i === count - 1 ? null : 2.8 + i / 10)),
    groupingRevision: 4,
    calls: [],
    hold: null,
    markDelayMs: 0,
    refuse: {},
    handle: (command, payload) => answer(command, payload),
  }
  function answer(command: string, payload: unknown): unknown {
    const args = (payload ?? {}) as Record<string, unknown>
    host.calls.push({ command, args })
    const refused = host.refuse[command]
    if (refused) return Promise.reject(refused)
    switch (command) {
      case "pix_session_review_list": {
        const counts = { all: host.frames.length, picked: 0, rejected: 0, unreviewed: 0 }
        for (const f of host.frames) counts[f.label] += 1
        const list: SessionReviewList_Serialize = { sessionId: SESSION_ID, groupingRevision: host.groupingRevision, filter: "all", counts, frames: structuredClone(host.frames) }
        return list
      }
      case "pix_session_review_mark": {
        const { mark } = args as { mark: ReviewMark_Deserialize }
        // A held host answers once the test lets it go, as a slow catalog write would.
        const answered = host.markDelayMs > 0 ? new Promise<void>((resolve) => setTimeout(resolve, host.markDelayMs)) : Promise.resolve()
        return Promise.all([host.hold, answered]).then(() => {
          const at = host.frames.findIndex((f) => f.asset.id === mark.asset.assetId)
          const current = host.frames[at]
          if (!current) return Promise.reject(refusal("not_found", "none"))
          if (current.asset.decisionRevision !== mark.asset.decisionRevision) return Promise.reject(refusal("conflict", "review", current.asset.decisionRevision))
          const next = { ...current.asset, quality: mark.quality, decisionRevision: current.asset.decisionRevision + 1 }
          host.frames[at] = { ...current, asset: next, label: LABEL[mark.quality], quality: mark.quality }
          return { asset: structuredClone(next) }
        })
      }
      case "pix_finish_review": {
        const { expectedGroupingRevision } = args as { expectedGroupingRevision: number }
        if (expectedGroupingRevision !== host.groupingRevision) return Promise.reject(refusal("conflict", "review", host.groupingRevision))
        if (host.frames.some((f) => f.label === "unreviewed")) return Promise.reject(refusal("invalid_input", "none"))
        return host.groupingRevision
      }
      case "pix_thumbnails": {
        const { assets } = args as { assets: string[] }
        return assets.map((assetId): ThumbnailEntry_Serialize => {
          const f = host.frames.find((x) => x.asset.id === assetId)!
          if (f.asset.availability !== "available") return { assetId, state: "unavailable", reason: f.asset.availability }
          return { assetId, state: "ready", thumbnail: { assetId, sha256: f.asset.fingerprint.contentSha256!, fingerprint: f.asset.fingerprint, image: tile(3, 0, 0, 4, 3), decodedAt: "2026-10-13T08:00:00Z" } }
        })
      }
      case "pix_open_frame": {
        const { assetId } = args as { assetId: string }
        const preview: FramePreview_Serialize = {
          assetId,
          sha256: `${assetId}`.padStart(64, "b"),
          fingerprint: fingerprint(1),
          container: "fits",
          width: FRAME_WIDTH,
          height: FRAME_HEIGHT,
          sampleFormat: "uint16",
          scaling: { zero: 32768, scale: 1 },
          blank: null,
          saturation: { level: 65535, source: "type_maximum" },
          planes: [],
          matchesRecord: true,
        }
        return preview
      }
      case "pix_preview_tile": {
        const { level, x, y, width, height } = args as { level: number; x: number; y: number; width: number; height: number }
        return tile(level, x, y, width, height)
      }
      case "pix_frame_stars": {
        const { assetId } = args as { assetId: string }
        const stars: FrameStars_Serialize = { assetId, state: host.frames.find((f) => f.asset.id === assetId)!.state, measurementId: `measurement-${assetId}`, stars: STARS }
        return stars
      }
      default:
        return Promise.reject(`unknown command ${command}`)
    }
  }
  return host
}
