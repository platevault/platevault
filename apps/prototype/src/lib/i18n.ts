/**
 * Locale registry and the tiny string-table helper (foundation-owned).
 *
 * en-GB is the source language: a message key is its en-GB string, so code
 * reads naturally and a string with no translation falls back to it. Other
 * locales carry a table keyed by those source strings. pt-BR is
 * machine-generated and covers the shell, navigation, toolbar, Issues hub and
 * status words; screens route only shell-shared words through `t()`.
 *
 * Placeholders are `{name}`; `translate("pt-BR", "{n} offline", { n: 2 })`.
 * Components use `useT()` from `src/app/preferences.ts`, which re-renders on
 * a language change.
 */
import { PT_BR } from "./messages/pt-BR"

export const LOCALES = [
  { id: "en-GB", label: "English (UK)", machineGenerated: false },
  { id: "pt-BR", label: "Português (Brasil)", machineGenerated: true },
] as const

export type Locale = (typeof LOCALES)[number]["id"]

export const DEFAULT_LOCALE: Locale = "en-GB"

export function isLocale(value: string): value is Locale {
  return LOCALES.some((locale) => locale.id === value)
}

const TABLES: Record<Locale, Readonly<Record<string, string>> | null> = {
  "en-GB": null,
  "pt-BR": PT_BR,
}

/** The string in `locale`, or the en-GB source when the table has none; `{name}` placeholders filled from `vars`. */
export function translate(locale: Locale, source: string, vars?: Record<string, string | number>): string {
  const text = TABLES[locale]?.[source] ?? source
  if (!vars) return text
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
}
