/**
 * site-gate.ts — observing-site existence gate for the planner (spec 047, D7).
 *
 * The planner renders no astronomy (Moon summary, lunar distance, filter
 * guidance, opposition) until a default `ObserverSite` exists — prompt for the
 * site first, with no location-independent fallback rendering.
 *
 * Spec 047 only *consumes* a site-existence signal; the ObserverSite model,
 * wizard step, and site CRUD are Track B (spec 044 / 048) scope. Until Track
 * B lands its ObserverSite settings key there is nothing to read, so the
 * binding returns `false` and the planner shows the "set up your observing
 * site" prompt.
 *
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ FLIP POINT (single swap) — TODO(spec-044 / Track B ObserverSite):        │
 * │ when the ObserverSite settings key lands, replace the body of            │
 * │ `readSiteExists()` to read it (e.g. via `settings.get('site')`) and,     │
 * │ if the value should react at runtime, back `useObserverSiteExists` with  │
 * │ a real subscription. Nothing else in spec 047 needs to change.           │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

/** Test-only override; `null` = use the real binding. */
let testOverride: boolean | null = null;

/**
 * Whether a default observing site exists.
 *
 * FLIP POINT: Track B's ObserverSite settings key does not exist yet, so a
 * default site can never be present — always `false` for now.
 */
export function readSiteExists(): boolean {
  // TODO(spec-044): read the real ObserverSite settings key here.
  return false;
}

/** Non-hook read (comparators, tests). Honours the test override. */
export function siteExists(): boolean {
  return testOverride ?? readSiteExists();
}

/**
 * Test seam: force the gate to a fixed value (or `null` to restore the real
 * binding). Lets US1/US2 component tests exercise both the gated-off prompt
 * and the real astronomy rendering before Track B's site key exists.
 */
export function __setSiteExistsForTest(value: boolean | null): void {
  testOverride = value;
}

/**
 * React hook: whether a default observing site exists. Currently static within
 * a session; becomes reactive at the flip point above when Track B's key lands.
 */
export function useObserverSiteExists(): boolean {
  return siteExists();
}
