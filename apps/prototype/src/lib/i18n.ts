/**
 * The message catalogue and the shipped locales (foundation-owned).
 *
 * Every user-visible string comes from messages/en-GB.json, compiled by
 * Paraglide into type-safe functions under src/paraglide/ (generated and
 * git-ignored: `pnpm i18n:compile`, or the Vite plugin in dev and build).
 * Import `m` from here, never from the generated path:
 *
 *   m.nav_home()                       // plain message
 *   m.issues_count({ count })          // interpolation and plural, type-checked
 *
 * A React component takes the catalogue from `useMessages()`
 * (src/app/preferences.ts) instead, so it re-renders when the language
 * changes. The active locale is the saved preference, which Paraglide reads
 * through the "custom-preferences" strategy registered there. Conventions:
 * design/I18N.md.
 */
import { m } from "@/paraglide/messages"
import type { Locale } from "@/paraglide/runtime"

export { m }
export { baseLocale as DEFAULT_LOCALE, isLocale, locales as LOCALES, type Locale } from "@/paraglide/runtime"

/** The catalogue's type, for helpers that take `m` from a component's `useMessages()`. */
export type Messages = typeof m

/**
 * How much human scrutiny a catalogue has had. `source` is the catalogue the
 * others are translated from, so "reviewed" does not apply to it.
 */
export type LocaleReviewStatus = "source" | "reviewed" | "machine-generated"

export interface LocaleMeta {
  id: Locale
  /** The language's own name for itself, in its own script: the accessible name of the choice. */
  nativeName: string
  /**
   * Decorative only, never the accessible name: a flag denotes a country,
   * not a language, and a screen reader announcing "flag of Brazil" is noise.
   */
  flag: string
  /** An unreviewed translation must be identifiable as such in the chooser. */
  reviewStatus: LocaleReviewStatus
}

/** Keyed by `Locale`, so a locale added to project.inlang/settings.json without an entry here fails typecheck. */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  "en-GB": { id: "en-GB", nativeName: "English (UK)", flag: "🇬🇧", reviewStatus: "source" },
  "pt-BR": { id: "pt-BR", nativeName: "Português (Brasil)", flag: "🇧🇷", reviewStatus: "machine-generated" },
}

/** Whether the chooser marks the locale "Machine-generated": `source` and `reviewed` are both trustworthy. */
export function needsReviewNotice(id: Locale): boolean {
  return LOCALE_META[id].reviewStatus === "machine-generated"
}
