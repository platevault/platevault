/**
 * Shared localization boundary: product code imports messages and locale types from here.
 *
 * A React component takes the catalogue from `useMessages()`
 * (src/app/preferences.ts) instead of the bare `m`, so it re-renders when the
 * language changes.
 */
import { m as generated } from "../paraglide/messages"
import { baseLocale, getLocale, isLocale, locales, type Locale } from "../paraglide/runtime"
import { formatBytes, formatCount, formatNight } from "./format"

export { getLocale, isLocale, type Locale }
export const DEFAULT_LOCALE = baseLocale
export const LOCALES = locales

type Generated = typeof generated

/**
 * Paraglide types every input as `NonNullable<unknown>`, so a MessageRef
 * passed straight into `m.*()` would compile and render "[object Object]".
 * The catalogue's public type takes finished words only: word a ref with
 * `say` first, or build the whole message as a ref with `msg`.
 */
type Word = string | number
type WordInputs<I> = I extends object ? { [P in keyof I]: Word } : I
type WordsOnly<F> = F extends (...args: infer A) => infer R ? (...args: { [i in keyof A]: i extends "0" ? WordInputs<A[i]> : A[i] }) => R : F

/** The catalogue's type, for helpers that take `m` from a component's `useMessages()`. */
export type Messages = { [K in keyof Generated]: WordsOnly<Generated[K]> }

export const m: Messages = generated

type MessageKey = keyof Generated
/** `msg` params may themselves be refs: `say` words them first. */
type MessageInputs<K extends MessageKey> = NonNullable<Parameters<Generated[K]>[0]>

/** One catalogue message: the key is the kind, `params` its inputs (type-checked where `msg` builds it). */
interface KeyedRef {
  key: MessageKey
  params: Record<string, unknown>
}

/**
 * Copy that is worded later, in the reader's language: what derived objects
 * (gates, warnings, blockers) carry instead of a finished string, so a
 * language switch re-words them. A param may itself be a ref, worded first.
 * `text` is data shown as-is (names, paths), never English; `night` is an
 * observing night (`YYYY-MM-DD`); `count` and `bytes` keep numeric values so
 * they format in the reader's locale; `list` joins finished pieces with
 * punctuation only.
 */
export type MessageRef = KeyedRef | { text: string } | { night: string } | { count: number } | { bytes: number } | { list: MessageRef[]; separator: string }

type ParamArgs<K extends MessageKey> = {} extends MessageInputs<K> ? [params?: MessageInputs<K>] : [params: MessageInputs<K>]

/** A ref to the catalogue message `key`: `msg("blocker_unreadable_inputs", { count })`. */
export function msg<K extends MessageKey>(key: K, ...[params]: ParamArgs<K>): MessageRef {
  return { key, params: params ?? {} }
}

/** Data shown as-is in every language: a name, a path, a dash for an absent value. */
export function verbatim(text: string): MessageRef {
  return { text }
}

/** An observing night (`YYYY-MM-DD`), worded "18 Sep" or "18 set" when read. */
export function nightRef(night: string): MessageRef {
  return { night }
}

/** Finished pieces joined by punctuation: refusal reasons by "; ". */
export function joinRefs(list: MessageRef[], separator: string): MessageRef {
  return { list, separator }
}

function isRef(value: unknown): value is MessageRef {
  return typeof value === "object" && value !== null && ("key" in value || "text" in value || "night" in value || "count" in value || "bytes" in value || "list" in value)
}

/** Word a ref with the caller's catalogue (`useMessages()` in a component, so it re-renders on a language switch). */
export function say(m: Messages, ref: MessageRef): string {
  if ("text" in ref) return ref.text
  if ("night" in ref) return formatNight(ref.night)
  if ("count" in ref) return formatCount(ref.count)
  if ("bytes" in ref) return formatBytes(ref.bytes)
  if ("list" in ref) return ref.list.map((item) => say(m, item)).join(ref.separator)
  const params: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(ref.params)) params[name] = isRef(value) ? say(m, value) : value
  const word = m[ref.key] as unknown
  return typeof word === "function" ? (word as (inputs: Record<string, unknown>) => string)(params) : ref.key
}
