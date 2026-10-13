/**
 * Pickers (L2, plan §3.3 P12): the night, the planning site, a site's
 * location and a Target.
 *
 * - NightPicker: ‹ · the night (a calendar popover) · › · Today. The arrows
 *   step a night, or a week with `weekStep`. One planning context, shared by
 *   Home and Targets.
 * - SitePicker: a Select of the saved sites with the default marked, plus
 *   "Manage sites…".
 * - SiteLocationField: latitude, longitude and elevation fields, which stay
 *   the source of truth, plus an OpenStreetMap map (decision C5), a place
 *   search (Nominatim) and "Use my location". Offline, or when tiles or the
 *   search fail, the map and the search give way to "Map unavailable"; the
 *   fields keep working.
 * - TargetPicker: a combobox over My targets, the catalogues and SIMBAD.
 *   Picking a result performs its primary action at once (`onPick`); the
 *   host searches, so the picker shows whatever results and lookup state the
 *   host hands it.
 */
import { CalendarDays, ChevronLeft, ChevronRight, LocateFixed } from "lucide-react"
import { type KeyboardEvent, lazy, Suspense, useEffect, useId, useMemo, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { roundCoordinate, validLatLon } from "@/components/domain/coordinates"
import { Button } from "@/components/ui/button"
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { shiftNight } from "@/domain/planning"
import { formatNight } from "@/lib/format"
import { getLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { dayInWeek, startOfWeek, WEEK_START, type WeekStart } from "@/lib/week"
import { IconButton } from "./actions"
import { ActionError, Notice } from "./feedback"
import { Field, type FieldProps, NumberField } from "./fields"

// ---------------------------------------------------------------------------
// NightPicker
// ---------------------------------------------------------------------------

const monthOf = (night: string) => night.slice(0, 7)

function shiftMonth(night: string, months: number): string {
  const date = new Date(`${night.slice(0, 7)}-01T00:00:00Z`)
  date.setUTCMonth(date.getUTCMonth() + months)
  const day = Math.min(Number(night.slice(8, 10)), new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate())
  date.setUTCDate(day)
  return date.toISOString().slice(0, 10)
}

/** The weeks of a month as nights, padded with the neighbouring months' days to whole weeks. */
function monthWeeks(month: string, weekStart: WeekStart): string[][] {
  let night = startOfWeek(`${month}-01`, weekStart)
  const weeks: string[][] = []
  do {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(night)
      night = shiftNight(night, 1)
    }
    weeks.push(week)
  } while (monthOf(night) === month)
  return weeks
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" })
}

const atNoon = (night: string) => new Date(`${night}T12:00:00Z`)

export interface NightPickerProps {
  /** The chosen night, `YYYY-MM-DD`. */
  value: string
  onChange: (night: string) => void
  /** Tonight at the planning site: where Today returns to. */
  today: string
  /** The earliest night to choose; defaults to `today`. */
  min?: string
  /** ‹ › step a week instead of a night. */
  weekStep?: boolean
  disabled?: boolean
}

/** ‹ · night · › · Today, as one labelled group. Today stays in place (disabled) on tonight, so nothing moves. */
export function NightPicker({ value, onChange, today, min = today, weekStep = false, disabled = false }: NightPickerProps) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const step = weekStep ? 7 : 1
  const choose = (night: string) => onChange(night < min ? min : night)
  return (
    <span role="group" aria-label={m.tonight_night()} className="inline-flex items-center gap-0.5" data-night-picker>
      <IconButton label={weekStep ? m.picker_week_previous() : m.targets_night_previous()} icon={ChevronLeft} disabled={disabled || value <= min} onClick={() => choose(shiftNight(value, -step))} />
      <Popover open={open} onOpenChange={setOpen}>
        {/* A fixed minimum width, so a shorter date never moves the › and Today buttons. */}
        <PopoverTrigger render={<Button variant="outline" size="sm" disabled={disabled} className="min-w-32 tabular-nums" />}>
          <CalendarDays aria-hidden="true" data-icon="inline-start" />
          {formatNight(value, true)}
        </PopoverTrigger>
        <PopoverContent align="center" className="w-auto" initialFocus={(): HTMLElement | true => document.querySelector<HTMLElement>("[data-calendar-grid] [tabindex='0']") ?? true}>
          <Calendar
            value={value}
            min={min}
            today={today}
            onChoose={(night) => {
              choose(night)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <IconButton label={weekStep ? m.picker_week_next() : m.targets_night_next()} icon={ChevronRight} disabled={disabled} onClick={() => choose(shiftNight(value, step))} />
      <Button variant="ghost" size="sm" disabled={disabled || value === today} onClick={() => onChange(today)}>
        {m.picker_today()}
      </Button>
    </span>
  )
}

const GRID_KEYS: Record<string, (night: string, weekStart: WeekStart) => string> = {
  ArrowLeft: (n) => shiftNight(n, -1),
  ArrowRight: (n) => shiftNight(n, 1),
  ArrowUp: (n) => shiftNight(n, -7),
  ArrowDown: (n) => shiftNight(n, 7),
  Home: (n, s) => startOfWeek(n, s),
  End: (n, s) => shiftNight(n, 6 - dayInWeek(n, s)),
  PageUp: (n) => shiftMonth(n, -1),
  PageDown: (n) => shiftMonth(n, 1),
}

/**
 * One month as a date grid (WAI-ARIA date picker pattern): one Tab stop, the
 * arrow keys move a day or a week, Home and End to the week's ends, Page Up
 * and Page Down a month; Enter or Space chooses. Nights before `min` are
 * disabled; tonight is marked.
 */
function Calendar({ value, min, today, onChoose }: { value: string; min: string; today: string; onChoose: (night: string) => void }) {
  const m = useMessages()
  const weekStart = WEEK_START[getLocale()]
  const [focus, setFocus] = useState(value < min ? min : value)
  const month = monthOf(focus)
  const grid = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const weeks = useMemo(() => monthWeeks(month, weekStart), [month, weekStart])
  const title = dateFormat({ month: "long", year: "numeric" }).format(atNoon(`${month}-01`))
  const weekday = dateFormat({ weekday: "short" })
  const weekdayLong = dateFormat({ weekday: "long" })
  const full = dateFormat({ weekday: "long", day: "numeric", month: "long", year: "numeric" })

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLElement>(`[data-night="${focus}"]`)?.focus()
  }, [focus])

  function move(night: string) {
    moved.current = true
    setFocus(night < min ? min : night)
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = GRID_KEYS[event.key]
    if (!next) return
    event.preventDefault()
    move(next(focus, weekStart))
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <IconButton label={m.picker_month_previous()} icon={ChevronLeft} disabled={month <= monthOf(min)} onClick={() => move(shiftMonth(focus, -1))} />
        <span className="text-sm font-medium" aria-live="polite">
          {title}
        </span>
        <IconButton label={m.picker_month_next()} icon={ChevronRight} onClick={() => move(shiftMonth(focus, 1))} />
      </div>
      <div ref={grid} role="grid" aria-label={title} onKeyDown={onKeyDown} className="grid gap-0.5" data-calendar-grid>
        <div role="row" className="grid grid-cols-7 gap-0.5">
          {weeks[0]!.map((night) => (
            <span key={night} role="columnheader" aria-label={weekdayLong.format(atNoon(night))} className="flex h-6 items-center justify-center text-xs text-muted-foreground">
              {weekday.format(atNoon(night))}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-0.5">
            {week.map((night) => {
              const selected = night === value
              const outside = monthOf(night) !== month
              return (
                <span key={night} role="gridcell" aria-selected={selected}>
                  <Button
                    variant={selected ? "default" : night === today ? "outline" : "ghost"}
                    size="icon-sm"
                    tabIndex={night === focus ? 0 : -1}
                    disabled={night < min}
                    aria-label={full.format(atNoon(night))}
                    aria-current={night === today ? "date" : undefined}
                    data-night={night}
                    className={cn("tabular-nums", outside && !selected && "text-muted-foreground")}
                    onClick={() => onChoose(night)}
                    onFocus={() => setFocus(night)}
                  >
                    {Number(night.slice(8, 10))}
                  </Button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SitePicker
// ---------------------------------------------------------------------------

/** The Select value of the "Manage sites…" entry; site ids never take it. */
const MANAGE = "__manage__"

export interface SitePickerProps {
  /** The chosen site's id; null, or an id no longer saved, reads "Choose a site". */
  value: string | null
  onChange: (siteId: string) => void
  sites: readonly { id: string; name: string }[]
  /** Marked "Default" in the list. */
  defaultSiteId: string | null
  /** Opens Settings › Observing sites. Without any site the picker is this one button. */
  onManage: () => void
  disabled?: boolean
}

export function SitePicker({ value, onChange, sites, defaultSiteId, onManage, disabled = false }: SitePickerProps) {
  const m = useMessages()
  if (sites.length === 0) {
    return (
      <Button variant="outline" size="sm" disabled={disabled} onClick={onManage}>
        {m.tonight_add_site()}
      </Button>
    )
  }
  const items = [...sites.map((site) => ({ value: site.id, label: site.name })), { value: MANAGE, label: m.picker_site_manage_ellipsis() }]
  const chosen = sites.some((site) => site.id === value) ? value : null
  return (
    <Select
      items={items}
      value={chosen}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === MANAGE) onManage()
        else if (typeof next === "string") onChange(next)
      }}
    >
      <SelectTrigger size="sm" aria-label={m.plan_site()} className="w-44" data-site-picker>
        <SelectValue placeholder={m.picker_site_choose()} />
      </SelectTrigger>
      <SelectContent>
        {sites.map((site) => (
          <SelectItem key={site.id} value={site.id}>
            <span className="truncate">{site.name}</span>
            {site.id === defaultSiteId ? <span className="text-xs text-muted-foreground">{m.settings_default()}</span> : null}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={MANAGE}>{m.picker_site_manage_ellipsis()}</SelectItem>
      </SelectContent>
    </Select>
  )
}

// ---------------------------------------------------------------------------
// SiteLocationField
// ---------------------------------------------------------------------------

export interface SiteLocation {
  latitude: number | null
  longitude: number | null
  /** Metres; optional for a site. */
  elevation: number | null
}

export interface SiteLocationFieldProps {
  value: SiteLocation
  onChange: (next: SiteLocation) => void
  /** The host's check per field, shown under it. */
  errors?: Partial<Record<keyof SiteLocation, string>>
  disabled?: boolean
  /** The map, the place search and "Use my location"; false keeps the fields only. */
  map?: boolean
  /** Whether the network is reachable; false shows "Map unavailable" without a request. Defaults to the browser's own state. */
  online?: boolean
  className?: string
}

/** Nominatim's usage policy: at most one request per second per application, so the limit is shared by every field. */
const PLACE_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
const PLACE_DEBOUNCE_MS = 1000
const PLACE_INTERVAL_MS = 1000
const PLACE_MIN_QUERY = 3
let lastPlaceSearchAt = 0

const LazySiteMap = lazy(() => import("@/components/domain/site-map").then((module) => ({ default: module.SiteMap })))

function useOnline(override: boolean | undefined): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine))
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => {
      window.removeEventListener("online", update)
      window.removeEventListener("offline", update)
    }
  }, [])
  return override ?? online
}

/** Latitude, longitude and elevation, then the map and its helpers. The fields are the record; everything else writes into them. */
export function SiteLocationField({ value, onChange, errors = {}, disabled = false, map = true, online, className }: SiteLocationFieldProps) {
  const m = useMessages()
  const reachable = useOnline(online)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const available = reachable && !failed
  const set = (key: keyof SiteLocation) => (next: number | null) => onChange({ ...value, [key]: next })
  const place = (latitude: number, longitude: number) => onChange({ ...value, latitude, longitude })
  const location = useLocate((latitude, longitude, elevation) => onChange({ latitude, longitude, elevation: elevation ?? value.elevation }))
  const locating = location.state.status === "locating"
  const locateErrorId = useId()
  return (
    <div className={cn("grid gap-3", className)} data-site-location>
      <div className="grid grid-cols-3 gap-3">
        <NumberField label={m.site_latitude_field()} value={value.latitude} onChange={set("latitude")} min={-90} max={90} step={0.00001} error={errors.latitude} disabled={disabled} />
        <NumberField label={m.site_longitude_field()} value={value.longitude} onChange={set("longitude")} min={-180} max={180} step={0.00001} error={errors.longitude} disabled={disabled} />
        <NumberField label={m.site_elevation_field()} value={value.elevation} onChange={set("elevation")} step={1} error={errors.elevation} disabled={disabled} />
      </div>
      {map ? (
        <div className="grid gap-2">
          <div className="flex items-end gap-2">
            {available ? <PlaceSearch disabled={disabled} onPlace={place} onUnavailable={() => setFailed(true)} /> : null}
            <Button variant="outline" disabled={disabled || locating} aria-busy={locating || undefined} aria-describedby={location.state.status === "error" ? locateErrorId : undefined} onClick={location.locate}>
              {locating ? <Spinner data-icon="inline-start" /> : <LocateFixed aria-hidden="true" data-icon="inline-start" />}
              {m.picker_locate()}
            </Button>
          </div>
          {location.state.status === "error" ? <ActionError id={locateErrorId} message={location.state.message} /> : null}
          {available ? (
            <Suspense fallback={<MapLoading />}>
              <LazySiteMap key={attempt} latitude={value.latitude} longitude={value.longitude} onPick={place} onUnavailable={() => setFailed(true)} disabled={disabled} />
            </Suspense>
          ) : (
            <Notice
              tone="offline"
              title={m.picker_map_unavailable()}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!reachable}
                  onClick={() => {
                    setFailed(false)
                    setAttempt((n) => n + 1)
                  }}
                >
                  {m.verb_retry()}
                </Button>
              }
            />
          )}
        </div>
      ) : null}
    </div>
  )
}

function MapLoading() {
  return (
    <div className="flex h-56 w-full items-center justify-center rounded-md border border-border bg-muted">
      <Spinner />
    </div>
  )
}

interface Place {
  value: string
  label: string
  latitude: number
  longitude: number
}

type PlaceState = { status: "idle" } | { status: "searching" } | { status: "done"; places: Place[] }

/** Nominatim's search result, the fields this picker reads. */
interface NominatimPlace {
  place_id: number
  display_name: string
  lat: string
  lon: string
}

/** Typed input only: Base UI also writes the input when an item is chosen or the popup closes. */
const TYPED = new Set(["input-change", "input-clear", "input-paste"])

/**
 * Find a place by name. Requests wait for a 1 s pause in typing and never
 * run closer than 1 s apart; a newer query cancels the one in flight. A
 * failed request makes the map unavailable, so the host stops offering it.
 */
function PlaceSearch({ disabled, onPlace, onUnavailable }: { disabled: boolean; onPlace: (latitude: number, longitude: number) => void; onUnavailable: () => void }) {
  const m = useMessages()
  const [query, setQuery] = useState("")
  const [state, setState] = useState<PlaceState>({ status: "idle" })
  const unavailable = useRef(onUnavailable)
  unavailable.current = onUnavailable

  useEffect(() => {
    const text = query.trim()
    if (text.length < PLACE_MIN_QUERY) {
      setState({ status: "idle" })
      return
    }
    setState({ status: "searching" })
    const controller = new AbortController()
    const wait = Math.max(PLACE_DEBOUNCE_MS, lastPlaceSearchAt + PLACE_INTERVAL_MS - Date.now())
    const timer = window.setTimeout(() => {
      lastPlaceSearchAt = Date.now()
      const url = `${PLACE_SEARCH_URL}?${new URLSearchParams({ q: text, format: "jsonv2", limit: "6", "accept-language": getLocale() })}`
      fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } })
        .then((response) => {
          if (!response.ok) throw new Error(String(response.status))
          return response.json() as Promise<NominatimPlace[]>
        })
        .then((results) => {
          const places = results.map((r) => ({ value: String(r.place_id), label: r.display_name, latitude: roundCoordinate(Number(r.lat)), longitude: roundCoordinate(Number(r.lon)) }))
          setState({ status: "done", places: places.filter((p) => validLatLon(p.latitude, p.longitude)) })
        })
        .catch(() => {
          if (!controller.signal.aborted) unavailable.current()
        })
    }, wait)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  const places = state.status === "done" ? state.places : []
  return (
    <Field label={m.picker_place_search()} className="min-w-0 flex-1">
      {(control) => (
        <Combobox
          items={places}
          filter={null}
          value={null}
          inputValue={query}
          onInputValueChange={(next, details) => {
            if (TYPED.has(details.reason)) setQuery(next)
          }}
          onValueChange={(place: Place | null) => {
            if (!place) return
            onPlace(place.latitude, place.longitude)
            setQuery("")
          }}
          disabled={disabled}
        >
          <ComboboxInput {...control} placeholder={m.picker_place_placeholder()} disabled={disabled} showTrigger={false} className="w-full" aria-busy={state.status === "searching" || undefined} />
          <ComboboxContent>
            <ComboboxEmpty>{state.status === "searching" ? m.picker_place_searching() : state.status === "done" ? m.picker_place_none() : m.picker_place_hint()}</ComboboxEmpty>
            <ComboboxList>
              {(place: Place) => (
                <ComboboxItem key={place.value} value={place}>
                  <span className="line-clamp-2">{place.label}</span>
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  )
}

type LocateState = { status: "idle" } | { status: "locating" } | { status: "error"; message: string }

/** The browser's position, for "Use my location"; refused or unavailable becomes the message to show beside the button. */
function useLocate(onLocate: (latitude: number, longitude: number, elevation: number | null) => void) {
  const m = useMessages()
  const [state, setState] = useState<LocateState>({ status: "idle" })
  function locate() {
    if (!("geolocation" in navigator)) {
      setState({ status: "error", message: m.picker_locate_unavailable() })
      return
    }
    setState({ status: "locating" })
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({ status: "idle" })
        const { latitude, longitude, altitude } = position.coords
        onLocate(roundCoordinate(latitude), roundCoordinate(longitude), altitude === null ? null : Math.round(altitude))
      },
      (error) => setState({ status: "error", message: error.code === error.PERMISSION_DENIED ? m.picker_locate_denied() : m.picker_locate_unavailable() }),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
    )
  }
  return { state, locate }
}

// ---------------------------------------------------------------------------
// TargetPicker
// ---------------------------------------------------------------------------

export type TargetSource = "mine" | "catalogue" | "simbad"

const SOURCE_ORDER: readonly TargetSource[] = ["mine", "catalogue", "simbad"]
/** The resolver's name: a proper noun, the same in every language. */
const SIMBAD = "SIMBAD"

export interface TargetOption {
  id: string
  /** The designation: "NGC 7000". */
  name: string
  /** One line under the name: an alias, the type, the coordinates. */
  detail?: string
  /** Already chosen: shown as "Added" and not pickable. */
  added?: boolean
}

export interface TargetResultGroup {
  source: TargetSource
  items: readonly TargetOption[]
  /** A remote lookup's state: running, unreachable or turned off. Shown under the field, so it reads without opening the list. */
  status?: "loading" | "error" | "off"
}

export interface TargetPickerProps extends Pick<FieldProps, "label" | "description" | "error" | "required" | "id" | "className"> {
  query: string
  onQueryChange: (query: string) => void
  /** The host's results for `query`, by source. */
  groups: readonly TargetResultGroup[]
  /** The result's primary action: open it, add it, choose it. The input clears afterwards. */
  onPick: (option: TargetOption, source: TargetSource) => void
  placeholder?: string
  disabled?: boolean
}

interface PickerItem extends TargetOption {
  source: TargetSource
}

function sourceLabel(m: ReturnType<typeof useMessages>, source: TargetSource): string {
  return source === "mine" ? m.project_search_my_targets() : source === "catalogue" ? m.project_search_catalogues() : SIMBAD
}

function lookupLine(m: ReturnType<typeof useMessages>, status: NonNullable<TargetResultGroup["status"]>): string {
  return status === "loading" ? m.targets_simbad_searching() : status === "error" ? m.targets_simbad_unreachable() : m.targets_simbad_off()
}

/** Search across My targets, the catalogues and SIMBAD; a result acts when chosen (click or Enter). */
export function TargetPicker({ query, onQueryChange, groups, onPick, placeholder, disabled = false, label, description, ...chrome }: TargetPickerProps) {
  const m = useMessages()
  const ordered = SOURCE_ORDER.flatMap((source) => groups.filter((g) => g.source === source))
  const items = ordered.filter((g) => g.items.length > 0).map((g) => ({ value: g.source, items: g.items.map((item): PickerItem => ({ ...item, source: g.source })) }))
  const lookups = ordered.filter((g): g is TargetResultGroup & { status: NonNullable<TargetResultGroup["status"]> } => g.status !== undefined)
  const searching = lookups.some((g) => g.status === "loading")
  const noMatch = query.trim() !== "" && items.length === 0 && !searching
  const status = [...lookups.map((g) => lookupLine(m, g.status)), ...(noMatch ? [m.targets_no_match({ query: query.trim() })] : [])]
  return (
    <Field
      {...chrome}
      label={label}
      description={
        status.length > 0 || description ? (
          <span role="status" className="inline-flex flex-wrap items-center gap-x-2" data-target-picker-status>
            {searching ? <Spinner className="size-3" /> : null}
            {[...status, ...(description ? [description] : [])].map((line, index) => (
              <span key={index}>{line}</span>
            ))}
          </span>
        ) : undefined
      }
    >
      {(control) => (
        <Combobox
          items={items}
          filter={null}
          value={null}
          inputValue={query}
          onInputValueChange={(next, details) => {
            if (TYPED.has(details.reason)) onQueryChange(next)
          }}
          onValueChange={(item: PickerItem | null) => {
            if (!item || item.added) return
            const { source, ...option } = item
            onPick(option, source)
            onQueryChange("")
          }}
          itemToStringLabel={(item: PickerItem) => item.name}
          disabled={disabled}
        >
          <ComboboxInput {...control} placeholder={placeholder ?? m.project_search_placeholder()} disabled={disabled} showTrigger={false} className="w-full" />
          <ComboboxContent>
            <ComboboxEmpty>{searching ? lookupLine(m, "loading") : m.fields_no_match()}</ComboboxEmpty>
            <ComboboxList>
              {(group: (typeof items)[number]) => (
                <ComboboxGroup key={group.value} items={group.items}>
                  <ComboboxLabel>{sourceLabel(m, group.value)}</ComboboxLabel>
                  <ComboboxCollection>
                    {(item: PickerItem) => (
                      <ComboboxItem key={`${item.source}:${item.id}`} value={item} disabled={item.added}>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-medium">{item.name}</span>
                          {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
                        </span>
                        {item.added ? <span className="shrink-0 text-xs text-muted-foreground">{m.project_search_added()}</span> : null}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  )
}
