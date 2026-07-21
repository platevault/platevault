// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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
 * The active locale is a persisted user preference (spec 061), resolved via
 * the `["custom-almSettings", "preferredLanguage", "baseLocale"]` strategy
 * chain (`vite.config.ts`) — see `src/data/locale.ts`. This supersedes the
 * earlier hard-pinned English of spec 046 FR-004. Adding a shipped locale
 * requires a new `messages/<locale>.json`, a `project.inlang/settings.json`
 * entry, and a `src/data/locale-meta.ts` entry — no call-site changes here.
 */
export { m } from '@/paraglide/messages';
