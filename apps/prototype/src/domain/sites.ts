/**
 * Observing-site rules shared by Settings (T1) and planning (T5).
 */
import type { AppSettings, Catalog, SiteId } from "./types"

/**
 * Remove a saved site (J15 S8). Deleting the default or planning site clears
 * that choice instead of picking another one, and reminders bound to the site
 * turn off, because they always follow the default site at the time they were
 * enabled. Recorded capture sites are derived from headers, so sessions only
 * lose the site name. Call inside `commit()`.
 */
export function removeSite(catalog: Catalog, settings: AppSettings, siteId: SiteId): { catalog: Catalog; settings: AppSettings } {
  const { [siteId]: _removed, ...sites } = catalog.sites
  const reminders = catalog.reminders.siteId === siteId ? { ...catalog.reminders, enabled: false, siteId: null, enabledAt: null } : catalog.reminders
  return {
    catalog: { ...catalog, sites, reminders },
    settings: {
      ...settings,
      defaultSiteId: settings.defaultSiteId === siteId ? null : settings.defaultSiteId,
      planningSiteId: settings.planningSiteId === siteId ? null : settings.planningSiteId,
    },
  }
}
