/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.3 L2-domain): Plate, Histogram,
 * CornerGrid, FrameThumbnails, SessionPlots, StarCutouts, MoonLine, DarkLine,
 * AltitudeSpark, NightCalendar, MoonPhase, MosaicField and SiteMap. The
 * plates render a synthetic star field (fixtures/raster.ts); the night
 * visuals use a smooth model of the Moon and darkness at two sample sites
 * (fixtures/night.ts); the mosaics are a three-panel IC 5070 layout and a
 * 2 × 2 layout around M 31 with a session outside its panel and a panel with
 * no pointing. Captions are reviewer labels; site and frame names are sample
 * data.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { DisplayMenu } from "@/components/app/display-menu"
import { Section } from "@/components/app/page"
import { CornerGrid, type RegionRect } from "@/components/domain/corner-grid"
import { type FrameThumbnail, FrameThumbnails, type Thumbnail, THUMB_W } from "@/components/domain/frame-thumbnails"
import { Histogram } from "@/components/domain/histogram"
import { MosaicField, type MosaicFieldPanel, type MosaicPointing } from "@/components/domain/mosaic-field"
import { Plate, type PlateImage, type PlateView, STRETCH_LABEL, STRETCHES, type Stretch, type ViewWindow, ZOOM_LABEL, ZOOMS, type Zoom } from "@/components/domain/plate"
import { type PlotSeries, SessionPlots } from "@/components/domain/session-plots"
import { AltitudeSpark, DarkLine, MoonLine } from "@/components/domain/sky-lines"
import { NightCalendar } from "@/components/domain/night-calendar"
import { StarCutouts } from "@/components/domain/star-cutouts"
import { StatusBadge } from "@/components/app/status"
import { Spinner } from "@/components/ui/spinner"
import { formatCount, formatDecimal } from "@/lib/format"
import { calendarNights, darknessOn, moonOn, type SampleSite, skyOf, sparkNight, TROMSO, UTRECHT } from "./fixtures/night"
import { detectedStars, linearHistogram, type PixelTruth, regionStats, renderCutout, renderWindow, type StarField, starField } from "./fixtures/raster"
import { ComponentSection, Specimen } from "./specimen"

const SiteMap = lazy(() => import("@/components/domain/site-map").then((module) => ({ default: module.SiteMap })))

const FIELD_TRUTH: PixelTruth = { fwhmPx: 3.2, eccentricity: 0.32, starCount: 260, background: 820, saturatedStars: 3, invalidSamples: 0, trailed: false }
const FLAGGED_TRUTH: PixelTruth = { ...FIELD_TRUTH, saturatedStars: 8, invalidSamples: 400 }

function plateImage(field: StarField): PlateImage {
  return { width: field.width, height: field.height, render: (window, stretch) => renderWindow(field, window, stretch) }
}

/** The fields' thumbnails as a host decodes them: null while pending, then each field drawn at `THUMB_W`; without a 2D canvas they stay pending. */
function useThumbnailUrls(fields: readonly StarField[]): readonly (string | null)[] {
  const [urls, setUrls] = useState<readonly (string | null)[]>(() => fields.map(() => null))
  useEffect(() => {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")
    if (!context) return
    setUrls(
      fields.map((field) => {
        const scale = field.width / THUMB_W
        canvas.width = THUMB_W
        canvas.height = Math.round(field.height / scale)
        context.putImageData(renderWindow(field, { x0: 0, y0: 0, scale, width: canvas.width, height: canvas.height }, "auto"), 0, 0)
        return canvas.toDataURL()
      }),
    )
  }, [fields])
  return urls
}

function Plates() {
  const m = useMessages()
  const field = useMemo(() => starField("catalogue-plate", FIELD_TRUTH, 1600, 1100, null), [])
  const image = useMemo(() => plateImage(field), [field])
  const stars = useMemo(() => detectedStars(field), [field])
  const [view, setView] = useState<PlateView>({ zoom: "fit", centre: null, stretch: "auto" })
  const [starsOn, setStarsOn] = useState(true)
  const [starId, setStarId] = useState<number | null>(null)
  const names = { light: "Light_0001.fits", compare: "Light_0002.fits" }
  return (
    <ComponentSection components={["Plate"]} description={m.catalogue_domain_plate_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <DisplayMenu
            align="start"
            groups={[
              { kind: "radio", id: "zoom", label: m.review_zoom(), value: view.zoom, options: ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] })), onChange: (z) => setView((v) => ({ ...v, zoom: z as Zoom, centre: null })) },
              { kind: "radio", id: "stretch", label: m.review_display_stretch(), value: view.stretch, options: STRETCHES.map((s) => ({ value: s, label: STRETCH_LABEL[s] })), onChange: (s) => setView((v) => ({ ...v, stretch: s as Stretch })) },
              { kind: "check", id: "overlays", label: m.display_menu_overlays(), items: [{ id: "stars", label: m.review_tab_stars(), checked: starsOn }], onChange: (_, on) => setStarsOn(on) },
            ]}
          />
        </Specimen>
        <Specimen caption={m.catalogue_domain_plate_compare()}>
          <div className="grid h-72 w-full grid-cols-2 gap-2">
            <Plate image={image} view={view} onView={setView} label={names.light} stars={starsOn ? stars : undefined} starId={starId} onStar={(s) => setStarId(s.id)} className="flex h-full" />
            <Plate image={image} view={view} onView={setView} label={names.compare} className="flex h-full" />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function Histograms() {
  const m = useMessages()
  const data = useMemo(() => {
    const window = (f: StarField): ViewWindow => ({ x0: 0, y0: 0, scale: 1, width: f.width, height: f.height })
    const clean = starField("catalogue-histogram", FIELD_TRUTH, 800, 600, null)
    const flagged = starField("catalogue-histogram-flagged", FLAGGED_TRUTH, 800, 600, null)
    return { clean: linearHistogram(clean, window(clean)), flagged: linearHistogram(flagged, window(flagged)) }
  }, [])
  return (
    <ComponentSection components={["Histogram"]} description={m.catalogue_domain_histogram_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <div className="w-64">
            <Histogram data={data.clean} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_histogram_flagged()}>
          <div className="w-64">
            <Histogram data={data.flagged} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_histogram_readout()}>
          <div className="w-64">
            <Histogram data={data.clean} readout={data.clean.median * 1.6} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

/** A tile's thumbnail: the host's reason when no copy is readable, else decoded or pending. */
function thumbnail(url: string | null, offline: string | null): Thumbnail {
  if (offline) return { state: "unreadable", reason: offline }
  return url ? { state: "ready", url } : { state: "pending" }
}

function ReviewVisuals() {
  const m = useMessages()
  const field = useMemo(() => starField("catalogue-corners", FIELD_TRUTH, 1600, 1100, null), [])
  const image = useMemo(() => plateImage(field), [field])
  const measure = useMemo(() => (zone: RegionRect) => regionStats(field, zone), [field])
  const stars = useMemo(() => detectedStars(field), [field])
  const failed = stars.find((s) => s.state === "failed") ?? stars[0]!
  const cutouts = useMemo(() => ({ fitted: (kind: Parameters<typeof renderCutout>[2]) => renderCutout(field, stars[0]!, kind), failed: (kind: Parameters<typeof renderCutout>[2]) => renderCutout(field, failed, kind) }), [field, stars, failed])
  const [active, setActive] = useState("t2")
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(["t4"]))
  const fields = useMemo(() => Array.from({ length: 8 }, (_, i) => starField(`catalogue-thumb-${i}`, { ...FIELD_TRUTH, fwhmPx: 2.6 + i * 0.3 }, 1600, 1100, null)), [])
  const urls = useThumbnailUrls(fields)
  // Eight tiles; the seventh has no readable copy.
  const thumbs: FrameThumbnail[] = fields.map((_, i) => ({
    id: `t${i + 1}`,
    name: `Light_${String(i + 1).padStart(4, "0")}.fits`,
    thumb: thumbnail(urls[i] ?? null, i === 6 ? m.status_offline() : null),
    status: <StatusBadge kind="quality" value={i === 3 ? "unusable" : i < 3 ? "usable" : "unreviewed"} />,
    statusText: "",
    dimmed: i === 3,
  }))
  const series: PlotSeries[] = (["fwhm", "eccentricity"] as const).map((id) => ({
    id,
    label: id === "fwhm" ? "FWHM" : m.review_ecc_short(),
    points: thumbs.map((t, index) => ({ id: t.id, index, value: id === "fwhm" ? 2.6 + index * 0.3 : 0.3 + (index % 3) * 0.05, name: t.name, rejected: t.dimmed })),
    format: (value) => formatDecimal(value, 2),
    tick: (value) => formatDecimal(value, 2),
  }))
  const activate = (id: string, mode: "set" | "toggle" | "range") => {
    setActive(id)
    if (mode === "toggle") setSelected((prev) => (prev.has(id) ? new Set([...prev].filter((x) => x !== id)) : new Set([...prev, id])))
    else if (mode === "set") setSelected(new Set())
  }
  return (
    <ComponentSection components={["CornerGrid", "FrameThumbnails", "SessionPlots", "StarCutouts"]} description={m.catalogue_domain_review_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_domain_corners()}>
          <div className="flex h-96 w-full">
            {/* eslint-disable-next-line pv/no-user-string -- a sample file name */}
            <CornerGrid image={image} measure={measure} stretch="auto" overlay={{ fwhm: true, eccentricity: true }} label="Light_0001.fits" />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_filmstrip()}>
          <div className="w-full min-w-0">
            <FrameThumbnails layout="strip" label={m.review_view_filmstrip()} items={thumbs} activeId={active} selected={selected} onActivate={activate} empty={null} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_grid()}>
          <div className="flex h-80 w-full min-w-0">
            <FrameThumbnails layout="grid" label={m.review_frame_grid()} items={thumbs} activeId={active} selected={selected} onActivate={activate} empty={null} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_plots()}>
          <div className="h-28 w-full">
            <SessionPlots series={series} count={thumbs.length} activeId={active} selected={selected} threshold={{ seriesId: "fwhm", direction: "above", value: 4 }} onSelect={(id) => setActive(id)} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_cutouts({ count: formatCount(2) })}>
          <StarCutouts star={stars[0]!} render={cutouts.fitted} />
          <StarCutouts star={failed} render={cutouts.failed} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function NightVisuals() {
  const m = useMessages()
  const nights = useMemo(() => {
    const autumn = "2026-10-14"
    const midsummer = "2026-06-21"
    const at = (site: SampleSite, night: string) => ({ site, night, grid: sparkNight(site, night), moon: moonOn(site, night), darkness: darknessOn(site, night) })
    const here = at(UTRECHT, autumn)
    const north = at(TROMSO, midsummer)
    // M 31 high at midnight; M 8 low in the south, never above the limit; M 31 from the far north in June, with no darkness.
    return { here, north, high: skyOf(UTRECHT, autumn, 11.5, 82), low: skyOf(UTRECHT, autumn, 5, 14), polar: skyOf(TROMSO, midsummer, 16, 70) }
  }, [])
  type Night = typeof nights.here
  const spark = (at: Night, sky: typeof nights.high) => <AltitudeSpark night={at.grid} sky={sky} darkness={at.darkness} minAltitudeDeg={at.site.minAltitudeDeg} timeZone={at.site.timeZone} />
  return (
    <ComponentSection components={["MoonLine", "DarkLine", "AltitudeSpark"]} description={m.catalogue_domain_night_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_domain_night_window()}>
          <MoonLine moon={nights.here.moon} timeZone={UTRECHT.timeZone} />
          <DarkLine darkness={nights.here.darkness} timeZone={UTRECHT.timeZone} />
          {spark(nights.here, nights.high)}
        </Specimen>
        <Specimen caption={m.catalogue_domain_night_low()}>{spark(nights.here, nights.low)}</Specimen>
        <Specimen caption={m.catalogue_domain_night_no_dark()}>
          <MoonLine moon={nights.north.moon} timeZone={TROMSO.timeZone} />
          <DarkLine darkness={nights.north.darkness} timeZone={TROMSO.timeZone} />
          {spark(nights.north, nights.polar)}
        </Specimen>
      </div>
    </ComponentSection>
  )
}

/**
 * `count` nights at a sample site from `today`. The grid starts on this
 * week's first day; its earlier nights, and any after the last one, show
 * their date only. The counts are sample figures, zero on some nights; each
 * card shows the night's darkness and Moon, as Home's does.
 */
function sampleNights(site: SampleSite, today: string, count: number) {
  return calendarNights(site, today, count, (night) => (
    <>
      <DarkLine darkness={darknessOn(site, night)} timeZone={site.timeZone} />
      <MoonLine moon={moonOn(site, night)} timeZone={site.timeZone} />
    </>
  ))
}

function NightCalendars() {
  const m = useMessages()
  const autumn = "2026-10-14"
  const midsummer = "2026-06-21"
  const nights = useMemo(() => ({ here: sampleNights(UTRECHT, autumn, 30), north: sampleNights(TROMSO, midsummer, 12) }), [])
  return (
    <ComponentSection components={["NightCalendar", "MoonPhase"]} description={m.catalogue_domain_calendar_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_domain_calendar_filled()}>
          <div className="w-full max-w-xl">
            <NightCalendar label={m.catalogue_domain_calendar_filled()} today={autumn} nights={nights.here} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_night_no_dark()}>
          <div className="w-full max-w-xl">
            <NightCalendar label={m.catalogue_domain_night_no_dark()} today={midsummer} nights={nights.north} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

const FOV = { widthDeg: 1.2, heightDeg: 0.8 }

/** IC 5070 in three panels, each at its sessions' median pointing, with the rig's field. */
const IC5070_FOV = { widthDeg: 5.38, heightDeg: 3.6 }
const IC5070_PANELS: Array<Omit<MosaicFieldPanel, "name"> & { n: number }> = [
  { id: "grp_ic5070_p1", n: 1, centre: { ra: 312.2, dec: 44.4 }, rotationDeg: 0, sessions: 2 },
  { id: "grp_ic5070_p2", n: 2, centre: { ra: 316.9, dec: 44.4 }, rotationDeg: 0, sessions: 2 },
  { id: "grp_ic5070_p3", n: 3, centre: { ra: 314.6, dec: 41.3 }, rotationDeg: 1, sessions: 1 },
]
const IC5070_POINTINGS: MosaicPointing[] = [
  { id: "ses_ic5070_p1a", ra: 312.18, dec: 44.41, panelId: "grp_ic5070_p1", inside: true },
  { id: "ses_ic5070_p1b", ra: 312.24, dec: 44.38, panelId: "grp_ic5070_p1", inside: true },
  { id: "ses_ic5070_p2a", ra: 316.88, dec: 44.42, panelId: "grp_ic5070_p2", inside: true },
  { id: "ses_ic5070_p2b", ra: 316.93, dec: 44.37, panelId: "grp_ic5070_p2", inside: true },
  { id: "ses_ic5070_p3a", ra: 314.6, dec: 41.32, panelId: "grp_ic5070_p3", inside: true },
]

/** A 2 × 2 layout around M 31: Panel 4 has no session with a pointing yet. */
const M31_PANELS: Array<Omit<MosaicFieldPanel, "name"> & { n: number }> = [
  { id: "p1", n: 1, centre: { ra: 11.4, dec: 41.6 }, rotationDeg: 0, sessions: 2 },
  { id: "p2", n: 2, centre: { ra: 10.0, dec: 41.6 }, rotationDeg: 0, sessions: 2 },
  { id: "p3", n: 3, centre: { ra: 11.4, dec: 40.88 }, rotationDeg: 2, sessions: 1 },
  { id: "p4", n: 4, centre: null, rotationDeg: null, sessions: 1 },
]

/** Each session's pointing; the second Panel 2 session points outside its panel's field. */
const M31_POINTINGS: MosaicPointing[] = [
  { id: "s1", ra: 11.38, dec: 41.58, panelId: "p1", inside: true },
  { id: "s2", ra: 11.43, dec: 41.62, panelId: "p1", inside: true },
  { id: "s3", ra: 10.02, dec: 41.59, panelId: "p2", inside: true },
  { id: "s4", ra: 11.0, dec: 41.0, panelId: "p2", inside: false },
  { id: "s5", ra: 11.4, dec: 40.9, panelId: "p3", inside: true },
]

function MosaicFields() {
  const m = useMessages()
  const named = (panels: typeof M31_PANELS) => panels.map(({ n, ...panel }) => ({ ...panel, name: m.common_panel_n({ n }) }))
  const panels = named(M31_PANELS)
  return (
    <ComponentSection components={["MosaicField"]} description={m.catalogue_domain_mosaic_map_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_domain_mosaic_live()}>
          <div className="w-full max-w-xl">
            <MosaicField panels={named(IC5070_PANELS)} pointings={IC5070_POINTINGS} field={IC5070_FOV} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_mosaic_outside()}>
          <div className="w-full max-w-xl">
            <MosaicField panels={panels} pointings={M31_POINTINGS} field={FOV} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_domain_mosaic_fov_unknown()}>
          <div className="w-full max-w-xl">
            <MosaicField panels={panels} pointings={M31_POINTINGS} field={null} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_empty()}>
          <div className="w-full max-w-xl">
            <MosaicField panels={[]} field={FOV} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function SiteMaps() {
  const m = useMessages()
  const [at, setAt] = useState<{ latitude: number | null; longitude: number | null }>({ latitude: 52.09083, longitude: 5.12222 })
  return (
    <ComponentSection components={["SiteMap"]} description={m.catalogue_domain_map_desc()} level={3}>
      <Specimen caption={m.catalogue_pickers_state_default()}>
        <div className="w-full max-w-xl space-y-1">
          <Suspense fallback={<Spinner data-pending />}>
            <SiteMap latitude={at.latitude} longitude={at.longitude} onPick={(latitude, longitude) => setAt({ latitude, longitude })} onUnavailable={() => setAt({ latitude: null, longitude: null })} />
          </Suspense>
          <span className="text-xs text-muted-foreground tabular-nums">
            {at.latitude === null ? "–" : formatDecimal(at.latitude, 5)} · {at.longitude === null ? "–" : formatDecimal(at.longitude, 5)}
          </span>
        </div>
      </Specimen>
    </ComponentSection>
  )
}

export function DomainCatalogue() {
  const m = useMessages()
  return (
    // eslint-disable-next-line pv/no-user-string -- the description names the source folder
    <Section title={m.catalogue_domain_title()} description="components/domain/*">
      <Plates />
      <Histograms />
      <ReviewVisuals />
      <NightVisuals />
      <NightCalendars />
      <MosaicFields />
      <SiteMaps />
    </Section>
  )
}
