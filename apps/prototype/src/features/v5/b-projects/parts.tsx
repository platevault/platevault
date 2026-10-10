/**
 * Slice B UI parts shared by the Project screens and sheets: the subject
 * search (My targets, the bundled catalogues and SIMBAD, D-W17) and the
 * commit outcome beside a control: a refusal reads as the terse `Refusal`
 * line with its blocker chips, any other failure as an inline error. The
 * Project state is the shared `StatusBadge kind="project"`; a run's six-step
 * rail is `StepRail` in `src/app/run-ui.tsx`.
 */
import { Loader, Search } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ClearableInput } from "@/components/app/clearable-input"
import { ActionError, Notice } from "@/components/app/feedback"
import { type Blocker, Refusal, refusalFrom } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { myTargets } from "@/domain/derive"
import { objectTypeRef } from "@/domain/labels"
import { BUNDLED_CATALOGUE, type CatalogueEntry, matchesQuery, normalizeName, SIMBAD_FIXTURE } from "@/domain/sky"
import type { Catalog, TargetId } from "@/domain/types"
import { formatDec, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { store, useStore } from "@/store/core"

// ---------------------------------------------------------------------------
// Commit outcome beside the control
// ---------------------------------------------------------------------------

/** Runs a store action and keeps its refusal or failure next to the control (D08). */
export function useCommitError() {
  const [result, setResult] = useState<CommitResult | null>(null)
  function run(action: () => CommitResult): boolean {
    const next = action()
    setResult(next.ok ? null : next)
    return next.ok
  }
  const error = result && !result.ok ? result.message : null
  const setError = (message: string | null) => setResult(message ? { ok: false, reason: "write-failed", message } : null)
  return { error, result, setError, run }
}

export function InlineError({ message, className }: { message: string | null; className?: string }) {
  return message ? <ActionError message={message} className={className} /> : null
}

/**
 * A failed store action: a refusal as `<action> · <reason> ▸` with its
 * blockers as chips, anything else as an inline error. `reason` words the
 * count ("used by 6 runs"); `blockers` maps the action's reasons to chips.
 */
export function CommitOutcome({
  result,
  action,
  reason,
  blockers,
  className,
}: {
  result: CommitResult | null
  action: string
  reason?: (count: number) => string
  blockers?: (reasons: string[]) => Blocker[]
  className?: string
}) {
  if (!result || result.ok) return null
  const refusal = refusalFrom(result, action)
  if (!refusal || result.reason !== "refused") return <ActionError message={result.message} className={className} />
  const chips = blockers ? blockers(result.reasons) : refusal.blockers
  return <Refusal {...refusal} reason={reason ? reason(chips.length) : refusal.reason} blockers={chips} className={className} />
}

// ---------------------------------------------------------------------------
// Subject search: My targets, catalogues and SIMBAD (D-W17)
// ---------------------------------------------------------------------------

const LOOKUP_MS = 600
/** The resolver's name: a proper noun, not translated. */
const SIMBAD = "SIMBAD"

/** A subject the user picked: an existing Target, or a catalogue or resolver entry that becomes a Target record on save. */
export type SubjectPick =
  | { kind: "target"; targetId: TargetId; name: string; ra: number | null; dec: number | null; size: { width: number; height: number } | null }
  | { kind: "new"; entry: CatalogueEntry; resolver: string | null; name: string; ra: number; dec: number; size: { width: number; height: number } | null }

function matches(query: string, name: string, aliases: string[]): boolean {
  return matchesQuery([name, ...aliases], query)
}

function fromEntry(entry: CatalogueEntry, resolver: string | null): SubjectPick {
  return { kind: "new", entry, resolver, name: entry.designation, ra: entry.ra, dec: entry.dec, size: entry.sizeDeg }
}

interface ResultRow {
  key: string
  pick: SubjectPick
  aliases: string[]
  type: string | null
}

type LookupState = { query: string; status: "running" } | { query: string; status: "done"; rows: ResultRow[] } | { query: string; status: "off" | "failed"; message: string } | null

/**
 * Search across My targets, the bundled catalogues and, on request, SIMBAD.
 * The list is a group of buttons, each naming what it adds. `taken` names
 * subjects already chosen; they read "Added".
 */
export function SubjectSearch({ taken, onPick, autoFocus = false }: { taken: string[]; onPick: (pick: SubjectPick) => void; autoFocus?: boolean }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const lookup = useStore((s) => s.settings.targetLookup)
  const [query, setQuery] = useState("")
  const [simbad, setSimbad] = useState<LookupState>(null)
  const timer = useRef<number | null>(null)
  const inputId = useId()
  useEffect(() => () => window.clearTimeout(timer.current ?? undefined), [])

  const groups = useMemo(() => localResults(m, catalog, query), [m, catalog, query])
  const providerName = lookup.provider === "simbad" ? SIMBAD : m.project_lookup_sesame()

  function searchSimbad() {
    const text = query.trim()
    if (!text || simbad?.status === "running") return
    if (!lookup.enabled) {
      setSimbad({ query: text, status: "off", message: m.project_lookup_turn_on({ path: `${m.nav_settings()} › ${m.settings_target_lookup()}` }) })
      return
    }
    setSimbad({ query: text, status: "running" })
    timer.current = window.setTimeout(() => {
      const state = store.getState()
      if (state.faults.failNextResolverLookup) {
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        setSimbad({ query: text, status: "failed", message: m.project_lookup_no_response({ provider: providerName }) })
        return
      }
      const known = new Set(groups.flatMap((g) => g.rows.map((r) => normalizeName(r.pick.name))))
      const rows = SIMBAD_FIXTURE.filter((o) => matches(text, o.designation, o.aliases) && !known.has(normalizeName(o.designation))).map(
        (o): ResultRow => ({ key: `simbad:${o.designation}`, pick: fromEntry(o, providerName), aliases: o.aliases, type: o.objectType }),
      )
      setSimbad({ query: text, status: "done", rows })
    }, LOOKUP_MS)
  }

  const simbadCurrent = simbad && simbad.query === query.trim() ? simbad : null
  const shown = query.trim() !== ""

  return (
    <div className="space-y-2">
      <div className="grid gap-1.5">
        <Label htmlFor={inputId}>{m.project_target_label()}</Label>
        <div className="flex gap-2">
          <ClearableInput
            id={inputId}
            wrapperClassName="flex-1"
            value={query}
            autoFocus={autoFocus}
            placeholder={m.project_search_placeholder()}
            onValueChange={setQuery}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                searchSimbad()
              }
            }}
          />
          <Button variant="outline" onClick={searchSimbad} disabled={!shown} aria-busy={simbadCurrent?.status === "running" || undefined}>
            {simbadCurrent?.status === "running" ? <Loader aria-hidden="true" className="motion-safe:animate-spin" data-icon="inline-start" /> : <Search aria-hidden="true" data-icon="inline-start" />}
            {SIMBAD}
          </Button>
        </div>
      </div>
      {shown ? (
        <div className="max-h-72 overflow-y-auto rounded-md border" role="group" aria-label={m.project_search_results()}>
          {groups.map((group) => (
            <ResultGroup key={group.title} title={group.title} rows={group.rows} taken={taken} onPick={onPick} />
          ))}
          {simbadCurrent?.status === "done" ? <ResultGroup title={`${SIMBAD} (${providerName})`} rows={simbadCurrent.rows} taken={taken} onPick={onPick} empty={m.project_search_no_new_match()} /> : null}
          {groups.every((g) => g.rows.length === 0) && !simbadCurrent ? <p className="px-3 py-2 text-sm text-muted-foreground">{m.project_search_no_match()}</p> : null}
          {simbadCurrent?.status === "running" ? (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
              {m.project_lookup_asking({ provider: providerName })}
            </p>
          ) : null}
        </div>
      ) : null}
      {simbadCurrent && (simbadCurrent.status === "off" || simbadCurrent.status === "failed") ? (
        <Notice tone={simbadCurrent.status === "failed" ? "offline" : "info"} title={simbadCurrent.status === "failed" ? m.project_lookup_failed() : m.project_lookup_off()}>
          {simbadCurrent.message}
        </Notice>
      ) : null}
    </div>
  )
}

function localResults(m: Messages, catalog: Catalog, query: string): Array<{ title: string; rows: ResultRow[] }> {
  if (!query.trim()) return []
  const mine = myTargets(catalog)
  const mineIds = new Set(mine.map((t) => t.target.id))
  const myRows = mine
    .filter(({ target }) => matches(query, target.name, target.aliases))
    .map(({ target, projects }): ResultRow => ({
      key: target.id,
      pick: { kind: "target", targetId: target.id, name: target.name, ra: target.ra, dec: target.dec, size: target.sizeDeg },
      aliases: target.aliases,
      type: projects.length > 0 ? m.project_search_subject_of({ names: projects.map((p) => p.name).join(", ") }) : m.project_search_favourite(),
    }))
  const byName = new Map(Object.values(catalog.targets).map((t) => [t.name, t]))
  const catalogueRows = BUNDLED_CATALOGUE.filter((o) => matches(query, o.designation, o.aliases) && !(byName.get(o.designation) && mineIds.has(byName.get(o.designation)!.id))).map((o): ResultRow => {
    const record = byName.get(o.designation)
    return {
      key: `sky:${o.designation}`,
      pick: record ? { kind: "target", targetId: record.id, name: record.name, ra: record.ra, dec: record.dec, size: record.sizeDeg } : fromEntry(o, null),
      aliases: o.aliases,
      type: o.objectType,
    }
  })
  // Target records outside My targets and the bundled list (for example created by indexing).
  const otherRows = Object.values(catalog.targets)
    .filter((t) => !mineIds.has(t.id) && !BUNDLED_CATALOGUE.some((o) => o.designation === t.name) && matches(query, t.name, t.aliases))
    .map((t): ResultRow => ({ key: t.id, pick: { kind: "target", targetId: t.id, name: t.name, ra: t.ra, dec: t.dec, size: t.sizeDeg }, aliases: t.aliases, type: m.project_search_library_target() }))
  return [
    { title: m.project_search_my_targets(), rows: myRows },
    { title: m.project_search_catalogues(), rows: [...catalogueRows, ...otherRows] },
  ]
}

function ResultGroup({ title, rows, taken, onPick, empty }: { title: string; rows: ResultRow[]; taken: string[]; onPick: (pick: SubjectPick) => void; empty?: string }) {
  const m = useMessages()
  if (rows.length === 0 && !empty) return null
  return (
    <div className="border-b last:border-0">
      <p className="bg-chrome px-3 py-1 text-[0.6875rem] font-semibold text-muted-foreground" data-chrome>
        {title}
      </p>
      {rows.length === 0 ? <p className="px-3 py-1.5 text-sm text-muted-foreground">{empty}</p> : null}
      <ul>
        {rows.map((row) => {
          const added = taken.includes(row.pick.name)
          return (
            <li key={row.key} className="flex min-h-(--row-h) items-center gap-3 px-3 py-1 text-sm odd:bg-foreground/[0.02]">
              <div className="min-w-0 flex-1">
                <span className="font-medium">{row.pick.name}</span>
                {row.aliases[0] ? <span className="ml-2 text-muted-foreground">{row.aliases[0]}</span> : null}
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {row.type ? `${say(m, objectTypeRef(row.type))} · ` : ""}
                  {row.pick.ra !== null && row.pick.dec !== null ? `${formatRa(row.pick.ra)} ${formatDec(row.pick.dec)}` : m.project_search_position_unknown()}
                  {row.pick.kind === "new" ? ` · ${row.pick.resolver ? m.project_search_new_from({ source: row.pick.resolver }) : m.project_search_new_from_catalogue()}` : ""}
                </span>
              </div>
              <Button size="sm" variant="outline" disabled={added} onClick={() => onPick(row.pick)}>
                {added ? m.project_search_added() : m.verb_add()}
                <span className="sr-only"> {row.pick.name}</span>
              </Button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
