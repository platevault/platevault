/**
 * Add to the Plan list from a search (slice E, S11): the field matches My
 * targets, the library and the bundled catalogues by name or alias; picking
 * one plans it (`planRow`).
 */
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ClearableInput } from "@/components/app/clearable-input"
import { ActionError, announce } from "@/components/app/feedback"
import { matchesQuery } from "@/domain/sky"
import { useStore } from "@/store/core"
import { cn } from "@/lib/utils"
import { allRows, planRow, rowSource, type TargetRow } from "./targets-model"

const MAX_MATCHES = 8

export function PlanAddSearch({ planned }: { planned: ReadonlySet<string> }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rows = useMemo(() => allRows(catalog), [catalog])
  const matches = query.trim() ? rows.filter((r) => matchesQuery([r.designation, ...r.aliases], query)).slice(0, MAX_MATCHES) : []

  function add(row: TargetRow) {
    const result = planRow(row)
    if (!result.ok) return setError(result.message)
    setError(null)
    setQuery("")
    announce(m.plan_added({ name: row.designation }))
  }

  return (
    <div
      className="relative"
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("input, [data-plan-match]"))
        const at = items.indexOf(document.activeElement as HTMLElement)
        const next = items[at + (event.key === "ArrowDown" ? 1 : -1)]
        if (next) {
          event.preventDefault()
          next.focus()
        }
      }}
    >
      <ClearableInput
        search
        value={query}
        onValueChange={(value) => {
          setQuery(value)
          setError(null)
        }}
        aria-label={m.plan_add_search_label()}
        placeholder={m.plan_add_search_placeholder()}
        wrapperClassName="w-56"
        className="h-6"
      />
      {open && query.trim() ? (
        <div className="absolute top-full left-0 z-30 mt-1 w-80 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10" data-plan-matches>
          {matches.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">{m.sessions_no_match()}</p>
          ) : (
            <ul aria-label={m.plan_matches()}>
              {matches.map((row) => {
                const inPlan = row.target ? planned.has(row.target.id) : false
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      data-plan-match
                      disabled={inPlan}
                      onClick={() => add(row)}
                      className={cn("flex h-7 w-full items-center gap-2 rounded-sm px-2 text-left text-sm", inPlan ? "text-muted-foreground" : "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground")}
                    >
                      <span className="shrink-0 font-medium">{row.designation}</span>
                      {row.aliases[0] ? <span className="min-w-0 truncate text-xs text-muted-foreground">{row.aliases[0]}</span> : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{inPlan ? m.plan_in_plan() : rowSource(row)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
      {error ? <ActionError message={error} className="absolute top-full left-0 z-30 mt-1 w-80 rounded-md bg-popover p-2 shadow-md" /> : null}
    </div>
  )
}
