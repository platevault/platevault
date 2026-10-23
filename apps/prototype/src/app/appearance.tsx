/**
 * The language picker (foundation-owned), mounted by Settings › Appearance
 * and setup beside `ThemePicker` (`@/components/app/theme-picker`): a select,
 * as the owner asked in round 11. The choice applies at once and persists in
 * this browser (`src/app/preferences.ts`).
 */
import { SelectField } from "@/components/app/fields"
import { LOCALE_META, LOCALES, type Locale, needsReviewNotice } from "@/lib/i18n"
import { setLocale, useMessages, usePreferences } from "./preferences"

/**
 * One select of the shipped locales, each named in its own language. A
 * machine-generated catalogue says so under the select.
 */
export function LanguagePicker() {
  const m = useMessages()
  const { locale } = usePreferences()
  const machine = LOCALES.filter((id) => needsReviewNotice(id))
  return (
    <SelectField<Locale>
      label={m.shell_language()}
      value={locale}
      options={LOCALES.map((id) => ({ value: id, label: LOCALE_META[id].nativeName }))}
      onChange={(id) => setLocale(id)}
      description={machine.length > 0 ? machine.map((id) => `${LOCALE_META[id].nativeName}: ${m.locale_machine_generated()}`).join(" · ") : undefined}
    />
  )
}
