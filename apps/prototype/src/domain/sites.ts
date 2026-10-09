/**
 * Observing-site rules shared by Settings (T1) and planning (T5).
 */
import type { AppSettings, Catalog, SiteId } from "./types"

/**
 * Remove a saved site (J15 S8). There is one default site while any site is
 * saved: deleting the default makes the first remaining site (by name) the
 * default; deleting the planning site clears that pick. Reminders bound to
 * the site turn off, because they always follow the default site at the
 * time they were enabled. Recorded capture sites are derived from headers,
 * so sessions only lose the site name. Call inside `commit()`.
 */
export function removeSite(catalog: Catalog, settings: AppSettings, siteId: SiteId): { catalog: Catalog; settings: AppSettings } {
  const { [siteId]: _removed, ...sites } = catalog.sites
  const reminders = catalog.reminders.siteId === siteId ? { ...catalog.reminders, enabled: false, siteId: null, enabledAt: null } : catalog.reminders
  const nextDefault = Object.values(sites).sort((a, b) => a.name.localeCompare(b.name))[0]?.id ?? null
  return {
    catalog: { ...catalog, sites, reminders },
    settings: {
      ...settings,
      defaultSiteId: settings.defaultSiteId === siteId ? nextDefault : settings.defaultSiteId,
      planningSiteId: settings.planningSiteId === siteId ? null : settings.planningSiteId,
    },
  }
}
