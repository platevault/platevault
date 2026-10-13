/**
 * The save state of a section whose controls write browser preferences
 * themselves (ThemePicker, LanguagePicker, SingleKeyShortcutsField): each
 * preference write is synchronous and cannot fail, so a changed value is a
 * committed save.
 */
import { type ReactNode, useEffect, useRef } from "react"
import { useSaveState } from "@/components/app/feedback"

/** The section's SaveState indicator; it reads Saved once `value` (a key of the preferences the section shows) changes. */
export function usePreferenceSaveState(value: string): ReactNode {
  const { save, indicator } = useSaveState()
  const shown = useRef(value)
  useEffect(() => {
    if (shown.current === value) return
    shown.current = value
    save(() => undefined)
  }, [value, save])
  return indicator
}
