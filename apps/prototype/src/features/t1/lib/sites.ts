/**
 * Observing sites (J15 S6-S8). The default site is always an explicit choice
 * (HLD §14): adding the first site does not make it the default, and removing
 * the default clears it through `removeSite` instead of picking another.
 */
import { stableHash } from "@/domain/indexing"
import { removeSite } from "@/domain/sites"
import type { Catalog, ObservingSite, SiteId } from "@/domain/types"
import { type CommitResult, nowIso, withCatalog } from "@/store/core"
import { parseNumber } from "../components/form-field"
import { save } from "./writes"

const HREF = "/settings/sites"

export interface SiteValues {
  name: string
  latitude: string
  longitude: string
  elevation: string
  timeZone: string
  twilight: ObservingSite["twilight"]
  minAltitude: string
}

export type SiteErrors = Partial<Record<keyof SiteValues, string>>

export function siteValues(site: ObservingSite | null): SiteValues {
  return {
    name: site?.name ?? "",
    latitude: site ? String(site.latitude) : "",
    longitude: site ? String(site.longitude) : "",
    elevation: site?.elevationM !== null && site?.elevationM !== undefined ? String(site.elevationM) : "",
    timeZone: site?.timeZone ?? "",
    twilight: site?.twilight ?? "astronomical",
    minAltitude: site ? String(site.minAltitudeDeg) : "30",
  }
}

export const TIME_ZONES: string[] = (() => {
  try {
    return Intl.supportedValuesOf("timeZone")
  } catch {
    return ["UTC", "Europe/Amsterdam", "Atlantic/Canary", "America/New_York", "America/Los_Angeles", "Australia/Sydney"]
  }
})()

function inRange(value: string, min: number, max: number, message: string, optional = false): string | undefined {
  const parsed = parseNumber(value)
  if (parsed === null) return optional ? undefined : message
  return Number.isNaN(parsed) || parsed < min || parsed > max ? message : undefined
}

/** Each out-of-range value is refused inline and names its field (J15 S6). */
export function validateSite(catalog: Catalog, values: SiteValues, exceptId: SiteId | null): SiteErrors {
  const errors: SiteErrors = {}
  const name = values.name.trim()
  if (!name) errors.name = "Name: enter a name, for example Backyard."
  else if (Object.values(catalog.sites).some((s) => s.id !== exceptId && s.name.toLowerCase() === name.toLowerCase())) errors.name = `Name: ${name} is already a saved site.`
  errors.latitude = inRange(values.latitude, -90, 90, "Latitude: enter degrees from −90 to 90; north is positive.")
  errors.longitude = inRange(values.longitude, -180, 180, "Longitude: enter degrees from −180 to 180; east is positive.")
  errors.elevation = inRange(values.elevation, -500, 9000, "Elevation: enter metres as a number, or leave it empty.", true)
  errors.minAltitude = inRange(values.minAltitude, 0, 90, "Minimum altitude: enter degrees from 0 to 90.")
  if (!TIME_ZONES.includes(values.timeZone)) errors.timeZone = values.timeZone ? `Time zone: ${values.timeZone} is not an IANA time zone. Choose one from the list.` : "Time zone: choose the site's IANA time zone, for example Europe/Amsterdam."
  return errors
}

export function saveSite(values: SiteValues, id: SiteId | null, makeDefault: boolean): CommitResult {
  const name = values.name.trim()
  const siteId = id ?? `site_${stableHash(`${name}|${nowIso()}`)}`
  const site: ObservingSite = {
    id: siteId,
    name,
    latitude: parseNumber(values.latitude)!,
    longitude: parseNumber(values.longitude)!,
    elevationM: parseNumber(values.elevation),
    timeZone: values.timeZone,
    twilight: values.twilight,
    minAltitudeDeg: parseNumber(values.minAltitude)!,
  }
  return save(
    {
      label: `${id ? "Changes to" : "New"} site ${name}`,
      saved: `${id ? "Updated" : "Added"} observing site ${name}`,
      detail: makeDefault ? `${name} is the default site.` : null,
      href: HREF,
    },
    (s) => {
      const next = withCatalog(s, (c) => ({ ...c, sites: { ...c.sites, [siteId]: site } }))
      return makeDefault ? { ...next, settings: { ...next.settings, defaultSiteId: siteId } } : next
    },
  )
}

export function setDefaultSite(site: ObservingSite): CommitResult {
  return save({ label: `Default site ${site.name}`, saved: `${site.name} is the default site`, detail: "Only the default pointer moved; no site's fields changed.", href: HREF }, (s) => ({
    ...s,
    settings: { ...s.settings, defaultSiteId: site.id },
  }))
}

export function deleteSite(site: ObservingSite): CommitResult {
  return save({ label: `Removal of site ${site.name}`, saved: `Removed observing site ${site.name}`, detail: null, href: HREF }, (s) => {
    const next = removeSite(s.catalog, s.settings, site.id)
    return { ...s, catalog: next.catalog, settings: next.settings }
  })
}

/** "52.09° N, 5.12° E". */
export function formatCoordinates(latitude: number, longitude: number): string {
  return `${Math.abs(latitude).toFixed(2)}° ${latitude >= 0 ? "N" : "S"}, ${Math.abs(longitude).toFixed(2)}° ${longitude >= 0 ? "E" : "W"}`
}

/**
 * Header capture coordinates (SITELAT/SITELONG) that no saved site covers,
 * so the user can add the place they actually observed from.
 */
export function unmatchedCaptureSites(catalog: Catalog): Array<{ latitude: number; longitude: number; sessions: number }> {
  const sites = Object.values(catalog.sites)
  const found = new Map<string, { latitude: number; longitude: number; sessions: Set<string> }>()
  for (const asset of Object.values(catalog.assets)) {
    const { siteLat, siteLon } = asset.observed
    if (siteLat === null || siteLon === null || !asset.sessionId) continue
    if (sites.some((s) => Math.abs(s.latitude - siteLat) < 0.05 && Math.abs(s.longitude - siteLon) < 0.05)) continue
    const key = `${siteLat.toFixed(2)},${siteLon.toFixed(2)}`
    const entry = found.get(key) ?? { latitude: Number(siteLat.toFixed(2)), longitude: Number(siteLon.toFixed(2)), sessions: new Set<string>() }
    entry.sessions.add(asset.sessionId)
    found.set(key, entry)
  }
  return [...found.values()].map((e) => ({ latitude: e.latitude, longitude: e.longitude, sessions: e.sessions.size })).sort((a, b) => b.sessions - a.sessions)
}
