/**
 * Catalogue entry (R9-COMPOSITION-PLAN §3.3 P12, P13): NightPicker,
 * SitePicker, SiteLocationField, TargetPicker and DisplayMenu, each in its
 * default, empty, loading, error and disabled states where the state
 * exists, plus the map-unavailable state. Captions are reviewer labels; the
 * site and Target names are sample data. The live TargetPicker searches the
 * bundled catalogue and the SIMBAD fixture, with SIMBAD answering after a
 * short wait.
 */
import { type ReactNode, useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { DisplayMenu, type DisplayGroup } from "@/components/app/display-menu"
import { NightPicker, type SiteLocation, SiteLocationField, SitePicker, type TargetOption, TargetPicker, type TargetResultGroup } from "@/components/app/pickers"
import { Section } from "@/components/app/page"
import { STRETCH_LABEL, STRETCHES, type Stretch, ZOOM_LABEL, ZOOMS, type Zoom } from "@/components/domain/plate"
import { objectTypeRef } from "@/domain/labels"
import { shiftNight } from "@/domain/planning"
import { BUNDLED_CATALOGUE, type CatalogueEntry, matchesQuery, SIMBAD_FIXTURE } from "@/domain/sky"
import { formatDec, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { ComponentSection, Specimen } from "./specimen"

const SITES = [{ id: "site_utrecht", name: "Utrecht" }, { id: "site_ardennes", name: "Ardennes" }, { id: "site_la_palma", name: "La Palma" }]
const SIMBAD_MS = 700
/** "My targets" in the samples: the first bundled entries. */
const MINE = BUNDLED_CATALOGUE.slice(0, 3)

function Last({ action }: { action: string | null }) {
  const m = useMessages()
  return action ? <span className="text-xs text-muted-foreground">{m.catalogue_pickers_last({ action })}</span> : null
}

function Wide({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-2xl">{children}</div>
}

function NightPickers() {
  const m = useMessages()
  const today = new Date().toISOString().slice(0, 10)
  const [night, setNight] = useState(today)
  const [other, setOther] = useState(shiftNight(today, 3))
  const [week, setWeek] = useState(today)
  return (
    <ComponentSection components={["NightPicker"]} description={m.catalogue_pickers_night_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <NightPicker value={night} onChange={setNight} today={today} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_night_other()}>
          <NightPicker value={other} onChange={setOther} today={today} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_night_week()}>
          <NightPicker value={week} onChange={setWeek} today={today} weekStep />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_disabled()}>
          <NightPicker value={other} onChange={setOther} today={today} disabled />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function SitePickers() {
  const m = useMessages()
  const [site, setSite] = useState<string | null>(SITES[0]!.id)
  const [last, setLast] = useState<string | null>(null)
  const manage = () => setLast(m.picker_site_manage_ellipsis())
  return (
    <ComponentSection components={["SitePicker"]} description={m.catalogue_pickers_site_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <SitePicker value={site} onChange={setSite} sites={SITES} defaultSiteId={SITES[0]!.id} onManage={manage} />
          <Last action={last} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_empty()}>
          <SitePicker value={null} onChange={setSite} sites={[]} defaultSiteId={null} onManage={manage} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_site_missing()}>
          <SitePicker value="site_removed" onChange={setSite} sites={SITES} defaultSiteId={SITES[0]!.id} onManage={manage} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_disabled()}>
          <SitePicker value={site} onChange={setSite} sites={SITES} defaultSiteId={SITES[0]!.id} onManage={manage} disabled />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function SiteLocations() {
  const m = useMessages()
  const [filled, setFilled] = useState<SiteLocation>({ latitude: 52.09083, longitude: 5.12222, elevation: 5 })
  const [empty, setEmpty] = useState<SiteLocation>({ latitude: null, longitude: null, elevation: null })
  const [wrong, setWrong] = useState<SiteLocation>({ latitude: 95, longitude: 5.12222, elevation: null })
  const [offline, setOffline] = useState<SiteLocation>({ latitude: 28.75694, longitude: -17.885, elevation: 2396 })
  const wrongErrors = wrong.latitude === null || wrong.latitude < -90 || wrong.latitude > 90 ? { latitude: m.site_error_latitude() } : {}
  return (
    <ComponentSection components={["SiteLocationField"]} description={m.catalogue_pickers_location_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <Wide>
            <SiteLocationField value={filled} onChange={setFilled} />
          </Wide>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_empty()}>
          <Wide>
            <SiteLocationField value={empty} onChange={setEmpty} />
          </Wide>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_error()}>
          <Wide>
            <SiteLocationField value={wrong} onChange={setWrong} errors={wrongErrors} map={false} />
          </Wide>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_map_unavailable()}>
          <Wide>
            <SiteLocationField value={offline} onChange={setOffline} online={false} />
          </Wide>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_fields_only()}>
          <Wide>
            <SiteLocationField value={offline} onChange={setOffline} map={false} />
          </Wide>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_disabled()}>
          <Wide>
            <SiteLocationField value={filled} onChange={setFilled} disabled />
          </Wide>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function option(m: Messages, entry: CatalogueEntry): TargetOption {
  return { id: entry.designation, name: entry.designation, detail: [entry.aliases[0], say(m, objectTypeRef(entry.objectType)), `${formatRa(entry.ra)} ${formatDec(entry.dec)}`].filter(Boolean).join(" · ") }
}

function search(m: Messages, entries: readonly CatalogueEntry[], query: string): TargetOption[] {
  return entries.filter((entry) => matchesQuery([entry.designation, ...entry.aliases], query)).map((entry) => option(m, entry))
}

/** The host side of a TargetPicker: local results at once, SIMBAD after a wait. */
function useSampleSearch(query: string, added: readonly string[]): TargetResultGroup[] {
  const m = useMessages()
  const [simbad, setSimbad] = useState<{ query: string; items: TargetOption[] } | null>(null)
  const text = query.trim()
  useEffect(() => {
    if (text.length < 3) return
    const timer = window.setTimeout(() => setSimbad({ query: text, items: search(m, SIMBAD_FIXTURE, text) }), SIMBAD_MS)
    return () => window.clearTimeout(timer)
  }, [m, text])
  if (!text) return []
  const mark = (items: TargetOption[]) => items.map((item) => ({ ...item, added: added.includes(item.id) }))
  const mine = search(m, MINE, text)
  const catalogue = search(m, BUNDLED_CATALOGUE.slice(MINE.length), text).slice(0, 8)
  const lookup: TargetResultGroup = text.length < 3 ? { source: "simbad", items: [] } : simbad?.query === text ? { source: "simbad", items: mark(simbad.items) } : { source: "simbad", items: [], status: "loading" }
  return [{ source: "mine", items: mark(mine) }, { source: "catalogue", items: mark(catalogue) }, lookup]
}

/** A TargetPicker whose SIMBAD lookup stays in one state; the local results follow the typing. */
function StaticTargetPicker({ query, simbad, disabled }: { query: string; simbad?: TargetResultGroup["status"]; disabled?: boolean }) {
  const m = useMessages()
  const [text, setText] = useState(query)
  const groups: TargetResultGroup[] = text.trim()
    ? [
        { source: "mine", items: search(m, MINE, text) },
        { source: "catalogue", items: search(m, BUNDLED_CATALOGUE.slice(MINE.length), text).slice(0, 8) },
        { source: "simbad", items: [], status: simbad },
      ]
    : []
  return <TargetPicker label={m.project_target_label()} query={text} onQueryChange={setText} groups={groups} onPick={() => setText("")} disabled={disabled} className="w-full max-w-md" />
}

function TargetPickers() {
  const m = useMessages()
  const [query, setQuery] = useState("")
  const [added, setAdded] = useState<string[]>([MINE[0]!.designation])
  const groups = useSampleSearch(query, added)
  const samples = { lookup: "NGC 7", empty: "Xyzzy" }
  return (
    <ComponentSection components={["TargetPicker"]} description={m.catalogue_pickers_target_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_state_default()}>
          <TargetPicker
            label={m.project_target_label()}
            query={query}
            onQueryChange={setQuery}
            groups={groups}
            onPick={(picked) => setAdded((list) => [...list, picked.id])}
            className="w-full max-w-md"
          />
          <Last action={added.length > 1 ? added[added.length - 1]! : null} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_loading()}>
          <StaticTargetPicker query={samples.lookup} simbad="loading" />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_error()}>
          <StaticTargetPicker query={samples.lookup} simbad="error" />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_lookup_off()}>
          <StaticTargetPicker query={samples.lookup} simbad="off" />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_empty()}>
          <StaticTargetPicker query={samples.empty} />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_disabled()}>
          <StaticTargetPicker query="" disabled />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function DisplayMenus() {
  const m = useMessages()
  const [stretch, setStretch] = useState<Stretch>("auto")
  const [zoom, setZoom] = useState<Zoom>("fit")
  const [overlays, setOverlays] = useState<Record<string, boolean>>({ stars: true, fwhm: false, eccentricity: false, inspector: true })
  const [columns, setColumns] = useState<Record<string, boolean>>({ altitude: true, lunar: true, img: true, filters: true, opposition: false })
  const toggle = (set: typeof setOverlays) => (id: string, checked: boolean) => set((current) => ({ ...current, [id]: checked }))
  const review: DisplayGroup[] = [
    { kind: "radio", id: "zoom", label: m.review_zoom(), value: zoom, options: ZOOMS.map((z) => ({ value: z, label: ZOOM_LABEL[z] })), onChange: (value) => setZoom(value as Zoom) },
    { kind: "radio", id: "stretch", label: m.review_display_stretch(), value: stretch, options: STRETCHES.map((s) => ({ value: s, label: STRETCH_LABEL[s] })), onChange: (value) => setStretch(value as Stretch) },
    {
      kind: "check",
      id: "overlays",
      label: m.display_menu_overlays(),
      items: [
        { id: "stars", label: m.review_tab_stars(), checked: overlays.stars ?? false },
        { id: "fwhm", label: m.review_fwhm_overlay(), checked: overlays.fwhm ?? false },
        { id: "eccentricity", label: m.review_ecc_overlay(), checked: overlays.eccentricity ?? false },
      ],
      onChange: toggle(setOverlays),
    },
    { kind: "check", id: "inspector", items: [{ id: "inspector", label: m.review_show_inspector(), checked: overlays.inspector ?? false, shortcut: "I" }], onChange: toggle(setOverlays) },
  ]
  const targets: DisplayGroup[] = [
    {
      kind: "columns",
      id: "columns",
      columns: [
        { id: "designation", label: m.targets_designation(), checked: true, required: true },
        { id: "altitude", label: m.tonight_altitude(), checked: columns.altitude ?? false },
        { id: "lunar", label: m.tonight_lunar(), checked: columns.lunar ?? false },
        { id: "img", label: m.tonight_img_time(), checked: columns.img ?? false },
        { id: "filters", label: m.domain_suitable_filters(), checked: columns.filters ?? false },
        { id: "opposition", label: m.tonight_opposition(), checked: columns.opposition ?? false },
      ],
      onChange: toggle(setColumns),
    },
  ]
  return (
    <ComponentSection components={["DisplayMenu"]} description={m.catalogue_pickers_display_desc()} level={3}>
      <div className="space-y-3">
        <Specimen caption={m.catalogue_pickers_review_display()}>
          <DisplayMenu groups={review} align="start" />
          <span className="text-xs text-muted-foreground">
            {ZOOM_LABEL[zoom]} · {STRETCH_LABEL[stretch]}
          </span>
        </Specimen>
        <Specimen caption={m.catalogue_pickers_targets_columns()}>
          <DisplayMenu groups={targets} align="start" />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_disabled()}>
          <DisplayMenu groups={targets} align="start" disabled />
        </Specimen>
        <Specimen caption={m.catalogue_pickers_state_empty()}>
          <DisplayMenu groups={[]} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}

export function PickersCatalogue() {
  const m = useMessages()
  return (
    // eslint-disable-next-line alm/no-user-string -- the description names the source files
    <Section title={m.catalogue_pickers_title()} description="components/app/pickers.tsx · display-menu.tsx">
      <NightPickers />
      <SitePickers />
      <SiteLocations />
      <TargetPickers />
      <DisplayMenus />
    </Section>
  )
}
