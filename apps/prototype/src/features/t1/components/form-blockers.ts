/**
 * The dialog footer's action while the fields fail their checks (FormDialog
 * `confirm.unavailable`): it stays focusable, and its blockers preview names
 * every field still to fix. A field shows its own message once the user has
 * changed it (`shownErrors`), so a fresh form opens without errors.
 */
import type { Action } from "@/components/app/contracts"
import { m } from "@/lib/i18n"

/** The unavailable state for `label` while any of `errors` is set; undefined when the fields pass. */
export function blockedByErrors(label: string, errors: Record<string, string | undefined>): Action["unavailable"] {
  const messages = Object.values(errors).filter((message): message is string => Boolean(message))
  if (messages.length === 0) return undefined
  return { action: m.actions_blocked({ action: label }), reason: m.refusal_blockers({ count: messages.length }), blockers: messages.map((message) => ({ label: message })) }
}

/** The errors of the fields the user has changed. */
export function shownErrors<K extends string>(errors: Partial<Record<K, string>>, touched: ReadonlySet<K>): Partial<Record<K, string>> {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => touched.has(key as K))) as Partial<Record<K, string>>
}
