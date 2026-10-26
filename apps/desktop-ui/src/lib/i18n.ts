/** Shared localization boundary: product code imports messages and locale types from here. */
import { m as generated } from "../paraglide/messages"
import { baseLocale, getLocale, isLocale, locales, type Locale } from "../paraglide/runtime"

export { getLocale, isLocale, type Locale }
export const DEFAULT_LOCALE = baseLocale
export const LOCALES = locales
export const m = generated
