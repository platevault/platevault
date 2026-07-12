/**
 * Single import surface for the message catalog (spec 046, US1).
 *
 * Every user-facing string in the app comes from the Paraglide message catalog
 * (`apps/desktop/messages/en.json`), compiled to type-safe functions under
 * `src/paraglide/`. Import `m` from here rather than reaching into the generated
 * `@/paraglide/messages` directly, so the catalog access point is consistent and
 * the generated path can move without touching call sites.
 *
 * Usage:
 *   import { m } from '@/lib/i18n';
 *   <button>{m.common_save()}</button>
 *   <p>{m.sessions_count({ count })}</p>   // interpolation is type-checked
 *
 * English is hard-pinned (baseLocale strategy); there is no language switcher in
 * this release (FR-004). Adding a locale later requires only a new
 * `messages/<locale>.json` — no call-site changes (FR-005).
 */
export { m } from '@/paraglide/messages';
