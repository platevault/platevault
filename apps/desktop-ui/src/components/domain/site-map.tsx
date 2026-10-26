/**
 * SiteMap (L2-domain, decision C5): an OpenStreetMap map with one marker,
 * for SiteLocationField. Leaflet loads in its own chunk: SiteLocationField
 * imports this module lazily, so the map costs nothing until it shows.
 *
 * The latitude and longitude fields stay the source of truth. The marker
 * follows them; clicking the map or dragging the marker reports a position
 * through `onPick`, and the host writes it into the fields. The map is a
 * convenience, never the only way in: the keyboard path is the fields, so
 * the marker takes no Tab stop. When Leaflet cannot start, or tiles keep
 * failing (offline, provider outage), `onUnavailable` fires and the host
 * shows its "map unavailable" state; the fields keep working.
 */
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { roundCoordinate as round, validLatLon } from "./coordinates"

/** OpenStreetMap's standard tiles; their usage policy asks for the attribution below. */
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
const COPYRIGHT_URL = "https://www.openstreetmap.org/copyright"
/** World view before any coordinates are set; the zoom a chosen position opens at. */
const WORLD: L.LatLngTuple = [20, 10]
const WORLD_ZOOM = 1
const SITE_ZOOM = 9
/** One edge tile can miss (ocean at low zoom); this many failures in a row means the tiles are unreachable. */
const TILE_ERROR_LIMIT = 3
/** Leaflet wraps longitudes past ±180 when the world repeats; the fields take −180…180. */
const wrapLongitude = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** A pin drawn in the theme's primary colour, so it needs no image assets. */
const PIN = L.divIcon({
  className: "text-primary",
  html: '<svg viewBox="0 0 24 32" width="24" height="32" aria-hidden="true"><path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill="currentColor" stroke="white" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="white"/></svg>',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
})

export interface SiteMapProps {
  latitude: number | null
  longitude: number | null
  /** A click on the map or the end of a marker drag, rounded to five decimals. */
  onPick: (latitude: number, longitude: number) => void
  onUnavailable: () => void
  disabled?: boolean
}

export function SiteMap({ latitude, longitude, onPick, onUnavailable, disabled = false }: SiteMapProps) {
  const m = useMessages()
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.Marker | null>(null)
  const latest = useRef({ onPick, onUnavailable, disabled })
  latest.current = { onPick, onUnavailable, disabled }
  // The view the map opens at; later field changes move the marker instead.
  const [initial] = useState(() => validLatLon(latitude, longitude))

  useEffect(() => {
    const element = container.current
    if (!element) return
    let instance: L.Map
    try {
      instance = L.map(element, { center: initial ?? WORLD, zoom: initial ? SITE_ZOOM : WORLD_ZOOM, zoomControl: false, attributionControl: false, worldCopyJump: true })
    } catch {
      latest.current.onUnavailable()
      return
    }
    let failures = 0
    const tiles = L.tileLayer(TILE_URL, { maxZoom: 19 })
    tiles.on("tileerror", () => {
      failures += 1
      if (failures === TILE_ERROR_LIMIT) latest.current.onUnavailable()
    })
    tiles.on("tileload", () => {
      failures = 0
    })
    tiles.addTo(instance)
    instance.on("click", (event: L.LeafletMouseEvent) => {
      if (!latest.current.disabled) latest.current.onPick(round(event.latlng.lat), round(wrapLongitude(event.latlng.lng)))
    })
    map.current = instance
    return () => {
      instance.remove()
      map.current = null
      marker.current = null
    }
  }, [initial])

  // The controls name themselves in the reader's language.
  const zoomIn = m.picker_map_zoom_in()
  const zoomOut = m.picker_map_zoom_out()
  const attribution = `<a href="${COPYRIGHT_URL}" target="_blank" rel="noreferrer">${escapeHtml(m.picker_map_attribution())}</a>`
  useEffect(() => {
    const instance = map.current
    if (!instance) return
    const zoom = L.control.zoom({ position: "topright", zoomInTitle: zoomIn, zoomOutTitle: zoomOut }).addTo(instance)
    const credit = L.control.attribution({ prefix: false }).addAttribution(attribution).addTo(instance)
    return () => {
      zoom.remove()
      credit.remove()
    }
  }, [zoomIn, zoomOut, attribution])

  // The marker follows the fields; an out-of-range value mid-typing leaves it where it was.
  useEffect(() => {
    const instance = map.current
    const position = validLatLon(latitude, longitude)
    if (!instance || !position) return
    if (marker.current) {
      marker.current.setLatLng(position)
    } else {
      const pin = L.marker(position, { icon: PIN, draggable: !latest.current.disabled, keyboard: false, autoPan: true })
      pin.on("dragend", () => {
        const at = pin.getLatLng()
        latest.current.onPick(round(at.lat), round(wrapLongitude(at.lng)))
      })
      marker.current = pin.addTo(instance)
    }
    if (instance.getZoom() < SITE_ZOOM - 3) instance.setView(position, SITE_ZOOM)
    else instance.panTo(position)
  }, [latitude, longitude])

  useEffect(() => {
    const dragging = marker.current?.dragging
    if (!dragging) return
    if (disabled) dragging.disable()
    else dragging.enable()
  }, [disabled, latitude, longitude])

  return <div ref={container} role="group" aria-label={m.picker_map_label()} aria-disabled={disabled || undefined} className="isolate h-56 w-full overflow-hidden rounded-md border border-border bg-muted" data-site-map />
}
