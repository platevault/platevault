import { DEFAULT_LOCALE, LOCALES, type Locale } from "../lib/i18n"
import { defineCustomClientStrategy } from "../paraglide/runtime"

const LOCALE_KEY = "platevault.locale"

function isLocale(value: string | null): value is Locale {
  return value !== null && (LOCALES as readonly string[]).includes(value)
}

function readLocale(): Locale {
  try {
    const value = localStorage.getItem(LOCALE_KEY)
    if (isLocale(value)) return value
  } catch {
    // Storage may be unavailable in test or restricted webview contexts.
  }
  return DEFAULT_LOCALE
}

let activeLocale = readLocale()

defineCustomClientStrategy("custom-preferences", {
  getLocale: () => activeLocale,
  setLocale: (locale) => {
    if (isLocale(locale)) activeLocale = locale
  },
})

export function setLocale(locale: Locale): void {
  activeLocale = locale
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    // The selected locale still applies for this session.
  }
}
