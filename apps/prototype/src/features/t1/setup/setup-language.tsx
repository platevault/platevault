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
import type { FlowStep, StepFlow } from "@/components/app/contracts"
import { StepPage } from "@/components/templates/step-page"
import { LOCALE_META, type Messages } from "@/lib/i18n"

/** The first-run setup steps, in order; each setup screen marks the ones before it finished. */
export const SETUP_STEP_IDS = ["language", "welcome", "locations", "indexing"] as const

export type SetupStepId = (typeof SETUP_STEP_IDS)[number]

/** Each setup step's name in the setup progress. */
export function setupSteps(m: Messages): { id: SetupStepId; label: string }[] {
  const label: Record<SetupStepId, string> = {
    language: m.shell_language(),
    welcome: m.setup_step_welcome(),
    locations: m.common_locations(),
    indexing: m.setup_step_index(),
  }
  return SETUP_STEP_IDS.map((id) => ({ id, label: label[id] }))
}

function languageFlow(m: Messages, chosen: string): StepFlow {
  const steps: FlowStep[] = setupSteps(m).map((step) =>
    step.id === "language" ? { ...step, state: "current", summary: chosen } : { ...step, state: "todo" },
  )
  return {
    steps,
    current: "language",
    ordered: true,
    // The choice is already saved; Continue only opens the next step.
    proceed: { id: "setup-language-continue", label: m.setup_continue_short(), run: () => undefined },
    next: { to: "/welcome" },
  }
}

export function SetupLanguagePage() {
  const m = useMessages()
  const { locale } = usePreferences()
  const flow = languageFlow(m, LOCALE_META[locale].nativeName)
  return <StepPage title={m.setup_language_title()} flow={flow} stepsLabel={m.setup_progress()} step={<LanguagePicker />} />
}
