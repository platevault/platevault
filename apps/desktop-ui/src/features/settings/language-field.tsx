/**
 * The language select (LIB-FR-21): Settings › Appearance and setup's
 * Welcome step offer it. Each shipped locale is named in its own language
 * by the platform (`Intl.DisplayNames`), as a proper noun is: the name does
 * not change with the chosen language. A machine-generated catalogue says
 * so under the select. The choice applies at once and persists through
 * `app/preferences.ts`.
 */
import { setLocale, useMessages, usePreferences } from "@/app/preferences"
import { SelectField } from "@/components/app/fields"
import { formatList } from "@/lib/format"
import { type Locale, LOCALES } from "@/lib/i18n"

/** The locales whose catalogue is machine-generated (project.inlang: pt-BR is translated by machine, en-GB is the source). */
const MACHINE_GENERATED: readonly Locale[] = ["pt-BR"]

/** The locale's name in its own language: "British English", "português (Brasil)". */
export function localeName(locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
}

export function LanguageField() {
  const m = useMessages()
  const { locale } = usePreferences()
  return (
    <SelectField<Locale>
      label={m.shell_language()}
      value={locale}
      options={LOCALES.map((id) => ({ value: id, label: localeName(id) }))}
      onChange={setLocale}
      description={formatList(MACHINE_GENERATED.map((id) => m.settings_locale_status({ name: localeName(id), status: m.locale_machine_generated() })))}
    />
  )
}
