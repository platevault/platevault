/**
 * Slice B parts shared by New Project, Add subject and Edit subject: the
 * results a TargetPicker shows for a subject search (My
 * targets, the bundled catalogues and, after a short wait, SIMBAD; D-W17),
 * and the pick each result stands for. A pick of a catalogue or resolver
 * entry becomes a Target record on save (`resolvePick`).
 */
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { TargetOption, TargetResultGroup, TargetSource } from "@/components/app/pickers"
import { myTargets } from "@/domain/derive"
import { objectTypeRef } from "@/domain/labels"
import { BUNDLED_CATALOGUE, type CatalogueEntry, matchesQuery, normalizeName, SIMBAD_FIXTURE } from "@/domain/sky"
import type { Catalog, Target, TargetId } from "@/domain/types"
import { formatDec, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { store, useStore } from "@/store/core"

/** SIMBAD answers after this wait, so the local results follow the typing at once. */
const LOOKUP_MS = 600
/** SIMBAD is asked from this many characters on. */
const LOOKUP_MIN = 3
/** The resolver's name: a proper noun, not translated. */
const SIMBAD = "SIMBAD"

/** A subject the user picked: an existing Target, or a catalogue or resolver entry that becomes a Target record on save. */
export type SubjectPick =
  | { kind: "target"; targetId: TargetId; name: string; ra: number | null; dec: number | null; size: { width: number; height: number } | null }
  | { kind: "new"; entry: CatalogueEntry; resolver: string | null; name: string; ra: number; dec: number; size: { width: number; height: number } | null }

export function pickFromTarget(target: Target): SubjectPick {
  return { kind: "target", targetId: target.id, name: target.name, ra: target.ra, dec: target.dec, size: target.sizeDeg }
}

function pickFromEntry(entry: CatalogueEntry, resolver: string | null): SubjectPick {
  return { kind: "new", entry, resolver, name: entry.designation, ra: entry.ra, dec: entry.dec, size: entry.sizeDeg }
}

interface Result {
  id: string
  pick: SubjectPick
  aliases: string[]
  /** The object type, or where the result comes from ("Subject of Cygnus HOO"). */
  kind: string | null
}

/** One line under a result: an alias, the kind and the position, or where a new Target comes from. */
function detailOf(m: Messages, result: Result): string {
  const { pick } = result
  const position = pick.ra !== null && pick.dec !== null ? `${formatRa(pick.ra)} ${formatDec(pick.dec)}` : m.project_search_position_unknown()
  const origin = pick.kind === "new" ? (pick.resolver ? m.project_search_new_from({ source: pick.resolver }) : m.project_search_new_from_catalogue()) : null
  return [result.aliases[0], result.kind, position, origin].filter((part): part is string => Boolean(part)).join(" · ")
}

function matches(query: string, name: string, aliases: string[]): boolean {
  return matchesQuery([name, ...aliases], query)
}

/** My targets, then the bundled catalogues plus Target records in neither (created by indexing). */
function localResults(m: Messages, catalog: Catalog, query: string): { mine: Result[]; catalogue: Result[] } {
  if (!query.trim()) return { mine: [], catalogue: [] }
  const mine = myTargets(catalog)
  const mineIds = new Set(mine.map((t) => t.target.id))
  const own = mine
    .filter(({ target }) => matches(query, target.name, target.aliases))
    .map(({ target, projects }): Result => ({
      id: `target:${target.id}`,
      pick: pickFromTarget(target),
      aliases: target.aliases,
      kind: projects.length > 0 ? m.project_search_subject_of({ names: projects.map((p) => p.name).join(", ") }) : m.project_search_favourite(),
    }))
  const byName = new Map(Object.values(catalog.targets).map((t) => [t.name, t]))
  const bundled = BUNDLED_CATALOGUE.filter((o) => matches(query, o.designation, o.aliases) && !mineIds.has(byName.get(o.designation)?.id ?? "")).map((o): Result => {
    const record = byName.get(o.designation)
    return { id: `sky:${o.designation}`, pick: record ? pickFromTarget(record) : pickFromEntry(o, null), aliases: o.aliases, kind: say(m, objectTypeRef(o.objectType)) }
  })
  const others = Object.values(catalog.targets)
    .filter((t) => !mineIds.has(t.id) && !BUNDLED_CATALOGUE.some((o) => o.designation === t.name) && matches(query, t.name, t.aliases))
    .map((t): Result => ({ id: `target:${t.id}`, pick: pickFromTarget(t), aliases: t.aliases, kind: m.project_search_library_target() }))
  return { mine: own, catalogue: [...bundled, ...others] }
}

type Lookup = { query: string; status: "loading" | "off" | "error" } | { query: string; status: "done"; results: Result[] } | null

export interface TargetSearch {
  query: string
  setQuery: (query: string) => void
  /** The TargetPicker's results for `query`, by source. */
  groups: TargetResultGroup[]
  /** The pick a chosen result stands for. */
  pickOf: (option: TargetOption) => SubjectPick | null
}

/**
 * The subject search behind a TargetPicker. `taken` names the subjects
 * already chosen; they read "Added". SIMBAD is asked once the query has
 * three characters and has rested for a moment; with online lookup off its
 * group says so (Settings › Target lookup).
 */
export function useTargetSearch(taken: readonly string[]): TargetSearch {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const lookup = useStore((s) => s.settings.targetLookup)
  const [query, setQueryState] = useState("")
  const [remote, setRemote] = useState<Lookup>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const local = localResults(m, catalog, query)
  const providerName = lookup.provider === "simbad" ? SIMBAD : m.project_lookup_sesame()

  function setQuery(next: string) {
    setQueryState(next)
    window.clearTimeout(timer.current ?? undefined)
    const text = next.trim()
    if (text.length < LOOKUP_MIN) {
      setRemote(null)
      return
    }
    if (!lookup.enabled) {
      setRemote({ query: text, status: "off" })
      return
    }
    setRemote({ query: text, status: "loading" })
    timer.current = window.setTimeout(() => {
      const state = store.getState()
      if (state.faults.failNextResolverLookup) {
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        setRemote({ query: text, status: "error" })
        return
      }
      const found = localResults(m, state.catalog, text)
      const known = new Set([...found.mine, ...found.catalogue].map((r) => normalizeName(r.pick.name)))
      const results = SIMBAD_FIXTURE.filter((o) => matches(text, o.designation, o.aliases) && !known.has(normalizeName(o.designation))).map(
        (o): Result => ({ id: `simbad:${o.designation}`, pick: pickFromEntry(o, providerName), aliases: o.aliases, kind: say(m, objectTypeRef(o.objectType)) }),
      )
      setRemote({ query: text, status: "done", results })
    }, LOOKUP_MS)
  }

  const current = remote && remote.query === query.trim() ? remote : null
  const remoteResults = current?.status === "done" ? current.results : []
  const all = [...local.mine, ...local.catalogue, ...remoteResults]
  const option = (result: Result): TargetOption => ({ id: result.id, name: result.pick.name, detail: detailOf(m, result), added: taken.includes(result.pick.name) })
  const group = (source: TargetSource, results: Result[], status?: TargetResultGroup["status"]): TargetResultGroup => ({ source, items: results.map(option), status })
  const groups: TargetResultGroup[] = [group("mine", local.mine), group("catalogue", local.catalogue)]
  if (current) groups.push(group("simbad", remoteResults, current.status === "done" ? undefined : current.status))

  return { query, setQuery, groups, pickOf: (picked) => all.find((r) => r.id === picked.id)?.pick ?? null }
}
