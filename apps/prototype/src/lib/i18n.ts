/**
 * The message catalogue and the shipped locales (foundation-owned).
 *
 * Every user-visible string comes from messages/en-GB.json, compiled by
 * Paraglide into type-safe functions under src/paraglide/ (generated and
 * git-ignored: `pnpm i18n:compile`, or the Vite plugin in dev and build).
 * Import `m` from here, never from the generated path:
 *
 *   m.nav_home()                       // plain message
 *   m.issues_count({ count })          // interpolation and plural, type-checked
 *
 * A React component takes the catalogue from `useMessages()`
 * (src/app/preferences.ts) instead, so it re-renders when the language
 * changes. The active locale is the saved preference, which Paraglide reads
 * through the "custom-preferences" strategy registered there. Conventions:
 * design/I18N.md.
 */
import { m } from "@/paraglide/messages"
import type { Locale } from "@/paraglide/runtime"

export { m }
export { baseLocale as DEFAULT_LOCALE, isLocale, locales as LOCALES, type Locale } from "@/paraglide/runtime"

/** The catalogue's type, for helpers that take `m` from a component's `useMessages()`. */
export type Messages = typeof m

type MessageKey = keyof Messages
type MessageInputs<K extends MessageKey> = NonNullable<Parameters<Messages[K]>[0]>

/** One catalogue message: the key is the kind, `params` its typed inputs. */
type KeyedRef = { [K in MessageKey]: { key: K; params: MessageInputs<K> } }[MessageKey]

/**
 * Copy that is worded later, in the reader's language: what persisted state
 * (Activity, operations) and derived domain objects (gates, warnings, Fit)
 * carry instead of a finished string, so a language switch re-words them.
 * A param may itself be a ref (a step name, a rig), worded first. `text` is
 * data shown as-is (names, paths), never English; `list` joins finished
 * pieces with punctuation only.
 */
export type MessageRef = KeyedRef | { text: string } | { list: MessageRef[]; separator: string }

type ParamArgs<K extends MessageKey> = {} extends MessageInputs<K> ? [params?: MessageInputs<K>] : [params: MessageInputs<K>]

/** A ref to the catalogue message `key`: `msg("blocker_unreadable_inputs", { count })`. */
export function msg<K extends MessageKey>(key: K, ...[params]: ParamArgs<K>): MessageRef {
  return { key, params: params ?? {} } as KeyedRef
}

/** Data shown as-is in every language: a name, a path, a dash for an absent value. */
export function verbatim(text: string): MessageRef {
  return { text }
}

/** Finished pieces joined by punctuation: refusal reasons by "; ". */
export function joinRefs(list: MessageRef[], separator: string): MessageRef {
  return { list, separator }
}

function isRef(value: unknown): value is MessageRef {
  return typeof value === "object" && value !== null && ("key" in value || "text" in value || "list" in value)
}

/** Word a ref with the caller's catalogue (`useMessages()` in a component, so it re-renders on a language switch). */
export function say(m: Messages, ref: MessageRef): string {
  if ("text" in ref) return ref.text
  if ("list" in ref) return ref.list.map((item) => say(m, item)).join(ref.separator)
  const params: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(ref.params)) params[name] = isRef(value) ? say(m, value) : value
  // A key a later build renamed reads as the key, as Paraglide renders a missing variant, rather than crashing the page.
  const word = m[ref.key] as unknown
  return typeof word === "function" ? (word as (inputs: Record<string, unknown>) => string)(params) : ref.key
}

/**
 * How much human scrutiny a catalogue has had. `source` is the catalogue the
 * others are translated from, so "reviewed" does not apply to it.
 */
export type LocaleReviewStatus = "source" | "reviewed" | "machine-generated"

export interface LocaleMeta {
  id: Locale
  /** The language's own name for itself, in its own script: the accessible name of the choice. */
  nativeName: string
  /**
   * Decorative only, never the accessible name: a flag denotes a country,
   * not a language, and a screen reader announcing "flag of Brazil" is noise.
   */
  flag: string
  /** An unreviewed translation must be identifiable as such in the chooser. */
  reviewStatus: LocaleReviewStatus
}

/** Keyed by `Locale`, so a locale added to project.inlang/settings.json without an entry here fails typecheck. */
export const LOCALE_META: Record<Locale, LocaleMeta> = {
  "en-GB": { id: "en-GB", nativeName: "English (UK)", flag: "🇬🇧", reviewStatus: "source" },
  "pt-BR": { id: "pt-BR", nativeName: "Português (Brasil)", flag: "🇧🇷", reviewStatus: "machine-generated" },
}

/** Whether the chooser marks the locale "Machine-generated": `source` and `reviewed` are both trustworthy. */
export function needsReviewNotice(id: Locale): boolean {
  return LOCALE_META[id].reviewStatus === "machine-generated"
}
