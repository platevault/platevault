/**
 * First-run setup, step 1: Language (`/setup/language`). It comes before
 * Welcome, as in the desktop wizard, so someone who cannot read the base
 * locale chooses a language before any of the prose. The step body is the
 * LanguagePicker Settings › Appearance mounts: the same locales, each named in
 * its own language, and the same notice under a machine-generated catalogue.
 * A choice switches the interface at once and is saved as the preference
 * Appearance reads (`src/app/preferences.ts`).
 */
import { LanguagePicker } from "@/app/appearance"
import { useMessages, usePreferences } from "@/app/preferences"
import { StepPage } from "@/components/templates/step-page"
import { LOCALE_META } from "@/lib/i18n"
import { setupFlow } from "./setup-flow"

export function SetupLanguagePage() {
  const m = useMessages()
  const { locale } = usePreferences()
  // The choice is already saved; Continue only opens the next step.
  const flow = setupFlow(m, "language", {
    proceed: { id: "setup-language-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: "/welcome" },
    summary: LOCALE_META[locale].nativeName,
  })
  return <StepPage title={m.setup_language_title()} flow={flow} stepsLabel={m.setup_progress()} step={<LanguagePicker />} />
}
