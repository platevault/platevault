/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.3 L2-domain): Plate, Histogram,
 * CornerGrid, FrameThumbnails, SessionPlots, StarCutouts, MoonLine, DarkLine,
 * AltitudeSpark, MosaicField and SiteMap. The plates render the prototype's
 * synthetic star field; the night visuals compute a real night at sample
 * sites; the mosaic is a 2 × 2 layout around M 31. Captions are reviewer
 * labels; site and frame names are sample data.
 */
import { lazy, Suspense, useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { DisplayMenu } from "@/components/app/display-menu"
import { Section } from "@/components/app/page"
import { CornerGrid } from "@/components/domain/corner-grid"
import { FrameThumbnails } from "@/components/domain/frame-thumbnails"
import { Histogram } from "@/components/domain/histogram"
import { type MosaicFieldPanel, MosaicField, mosaicFreeSlots } from "@/components/domain/mosaic-field"
import { Plate, type PlateImage, type PlateView, STRETCH_LABEL, STRETCHES, type Stretch, type ViewWindow, ZOOM_LABEL, ZOOMS, type Zoom } from "@/components/domain/plate"
import { type PlotSeries, SessionPlots } from "@/components/domain/session-plots"
import { AltitudeSpark, DarkLine, MoonLine } from "@/components/domain/sky-lines"
import { StarCutouts } from "@/components/domain/star-cutouts"
import { StatusBadge } from "@/components/app/status"
import { Spinner } from "@/components/ui/spinner"
import { defaultCriteria, nightSummary, upcomingNight } from "@/domain/planning"
import type { DiskFile, ObservingSite } from "@/domain/types"
import { formatCount, formatDecimal } from "@/lib/format"
import { detectedStars, linearHistogram, renderWindow, type StarField, starField } from "@/components/domain/raster"
import { nightGrid } from "@/features/v5/e-targets-plan-settings/sky-tonight"
import { positionSky, type SkyContext } from "@/features/v5/e-targets-plan-settings/targets-model"
import { ComponentSection, Specimen } from "./specimen"

const SiteMap = lazy(() => import("@/components/domain/site-map").then((module) => ({ default: module.SiteMap })))

const FIELD_TRUTH = { fwhmPx: 3.2, eccentricity: 0.32, starCount: 260, background: 820, saturatedStars: 3, invalidSamples: 0, trailed: false }
const FLAGGED_TRUTH = { ...FIELD_TRUTH, saturatedStars: 8, invalidSamples: 400 }

function plateImage(field: StarField): PlateImage {
  return { width: field.width, height: field.height, render: (window, stretch) => renderWindow(field, window, stretch) }
}

const UTRECHT: ObservingSite = { id: "site_utrecht", name: "Utrecht", latitude: 52.09, longitude: 5.12, elevationM: 5, timeZone: "Europe/Amsterdam", twilight: "astronomical", minAltitudeDeg: 30 }
const FAR_NORTH: ObservingSite = { id: "site_tromso", name: "Tromsø", latitude: 69.65, longitude: 18.96, elevationM: 10, timeZone: "Europe/Oslo", twilight: "astronomical", minAltitudeDeg: 30 }

function skyContext(site: ObservingSite, night: string, nowMs: number): SkyContext {
  return { site, grid: nightGrid(site, night), summary: nightSummary(site, night), criteria: defaultCriteria(site), nowMs, tonight: night }
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

function ReviewVisuals() {
  const m = useMessages()
  const field = useMemo(() => starField("catalogue-corners", FIELD_TRUTH, 1600, 1100, null), [])
  const stars = useMemo(() => detectedStars(field), [field])
  const failed = stars.find((s) => s.state === "failed") ?? stars[0]!
  const [active, setActive] = useState("t2")
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(["t4"]))
  const thumbs = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const id = `t${i + 1}`
        // A disk file as indexing records it: enough header and pixel facts to decode a thumbnail.
        const file = { path: `/catalogue/Light_${i + 1}.fits`, sha256: `catalogue-thumb-${i}`, header: { widthPx: 1600, heightPx: 1100, bayerPattern: null }, pixelTruth: { ...FIELD_TRUTH, fwhmPx: 2.6 + i * 0.3 } } as unknown as DiskFile
        return { id, name: `Light_${String(i + 1).padStart(4, "0")}.fits`, file: i === 6 ? undefined : file, unreadable: i === 6 ? m.status_offline() : null, status: <StatusBadge kind="quality" value={i === 3 ? "unusable" : i < 3 ? "usable" : "unreviewed"} />, statusText: "", dimmed: i === 3 }
      }),
    [m],
  )
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
            {/* eslint-disable-next-line alm/no-user-string -- a sample file name */}
            <CornerGrid field={field} stretch="auto" overlay={{ fwhm: true, eccentricity: true }} label="Light_0001.fits" />
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
          <StarCutouts field={field} star={stars[0]!} />
          <StarCutouts field={field} star={failed} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function NightVisuals() {
  const m = useMessages()
  const nights = useMemo(() => {
    const now = Date.now()
    const here = skyContext(UTRECHT, upcomingNight(UTRECHT, now), now)
    const midsummer = "2026-06-21"
    const north = skyContext(FAR_NORTH, midsummer, Date.parse(`${midsummer}T08:00:00Z`))
    const sky = (ctx: SkyContext, ra: number, dec: number) => {
      const s = positionSky(ctx, `${ra}|${dec}`, ra, dec)
      return s.status === "ok" ? s : null
    }
    return { here, north, high: sky(here, 10.68, 41.27), low: sky(here, 270.9, -24.38), polar: sky(north, 10.68, 41.27) }
  }, [])
  const spark = (ctx: SkyContext, sky: typeof nights.high) =>
    sky ? <AltitudeSpark night={ctx.grid} sky={sky} darkness={ctx.summary.darkness} minAltitudeDeg={ctx.criteria.minAltitudeDeg} timeZone={ctx.site.timeZone} /> : null
  return (
    <ComponentSection components={["MoonLine", "DarkLine", "AltitudeSpark"]} description={m.catalogue_domain_night_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_domain_night_window()}>
          <MoonLine moon={nights.here.summary.moon} timeZone={UTRECHT.timeZone} />
          <DarkLine darkness={nights.here.summary.darkness} timeZone={UTRECHT.timeZone} />
          {spark(nights.here, nights.high)}
        </Specimen>
        <Specimen caption={m.catalogue_domain_night_low()}>{spark(nights.here, nights.low)}</Specimen>
        <Specimen caption={m.catalogue_domain_night_no_dark()}>
          <MoonLine moon={nights.north.summary.moon} timeZone={FAR_NORTH.timeZone} />
          <DarkLine darkness={nights.north.summary.darkness} timeZone={FAR_NORTH.timeZone} />
          {spark(nights.north, nights.polar)}
        </Specimen>
      </div>
    </ComponentSection>
  )
}

const FOV = { widthDeg: 1.2, heightDeg: 0.8 }

function MosaicFields() {
  const m = useMessages()
  const [panels, setPanels] = useState<MosaicFieldPanel[]>(() => [
    { id: "p1", n: 1, ra: 11.4, dec: 41.6, rotationDeg: 0, include: true },
    { id: "p2", n: 2, ra: 10.0, dec: 41.6, rotationDeg: 0, include: true },
    { id: "p3", n: 3, ra: 11.4, dec: 40.88, rotationDeg: 0, include: true },
    { id: "p4", n: 4, ra: 10.0, dec: 40.88, rotationDeg: 0, include: false },
  ])
  const [dropOn, setDropOn] = useState<string | null>(null)
  const slots = mosaicFreeSlots(panels, FOV)
  return (
    <ComponentSection components={["MosaicField"]} description={m.catalogue_domain_mosaic_desc()} level={3}>
      <Specimen caption={m.catalogue_domain_mosaic_layout()}>
        <div className="w-full max-w-xl">
          <MosaicField
            panels={panels}
            slots={slots}
            field={FOV}
            pointings={[
              { id: "s1", ra: 11.38, dec: 41.58, state: "placed" },
              { id: "s2", ra: 10.7, dec: 41.25, state: "flagged" },
              { id: "s3", ra: 12.3, dec: 40.4, state: "unplaced" },
            ]}
            dropOn={dropOn}
            onDropOnChange={setDropOn}
            onToggle={(id) => setPanels((list) => list.map((p) => (p.id === id ? { ...p, include: !p.include } : p)))}
            onAdd={(ra, dec) => setPanels((list) => [...list, { id: `p${list.length + 1}`, n: list.length + 1, ra, dec, rotationDeg: 0, include: true }])}
          />
        </div>
      </Specimen>
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
          <Suspense fallback={<Spinner />}>
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
    // eslint-disable-next-line alm/no-user-string -- the description names the source folder
    <Section title={m.catalogue_domain_title()} description="components/domain/*">
      <Plates />
      <Histograms />
      <ReviewVisuals />
      <NightVisuals />
      <MosaicFields />
      <SiteMaps />
    </Section>
  )
}
