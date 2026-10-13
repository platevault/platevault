/**
 * Appearance pickers (foundation-owned). Settings › Appearance mounts the
 * theme picker (`ThemePicker`, `@/components/app/theme-picker`) and this
 * language picker. Choices apply at once and persist in this browser
 * (`src/app/preferences.ts`).
 */
import { SegmentedField } from "@/components/app/fields"
import { LOCALE_META, LOCALES, type Locale, needsReviewNotice } from "@/lib/i18n"
import { setLocale, useMessages, usePreferences } from "./preferences"

/** @deprecated Import `ThemePicker` from `@/components/app/theme-picker`; this re-export keeps Settings › Appearance compiling until P9 repoints it, and goes in W4. */
export { ThemePicker } from "@/components/app/theme-picker"

/**
 * One choice per shipped locale, each named in its own language. A
 * machine-generated catalogue says so under the choices.
 */
export function LanguagePicker() {
  const m = useMessages()
  const { locale } = usePreferences()
  const machine = LOCALES.filter((id) => needsReviewNotice(id))
  return (
    <SegmentedField<Locale>
      label={m.shell_language()}
      value={locale}
      options={LOCALES.map((id) => ({ value: id, label: LOCALE_META[id].nativeName }))}
      onChange={(id) => setLocale(id)}
      description={machine.length > 0 ? machine.map((id) => `${LOCALE_META[id].nativeName}: ${m.locale_machine_generated()}`).join(" · ") : undefined}
    />
  )
}
