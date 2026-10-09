/**
 * The status bar's context slot (foundation-owned): a list with a selection
 * reports its count with `useStatusSelection(count)` while it is mounted, and
 * the status bar reads "3 selected". `DataTable` reports its own selection,
 * so screens call the hook only for lists that are not a DataTable (a
 * filmstrip, a grid). The latest non-zero report wins; unmounting clears it.
 */
import { useEffect, useId, useSyncExternalStore } from "react"

export interface StatusSelection {
  count: number
  /** "3 of 120 selected" when the list passes its size. */
  total: number | null
}

const reports = new Map<string, StatusSelection & { seq: number }>()
const listeners = new Set<() => void>()
let seq = 0
let current: StatusSelection | null = null

function publish() {
  let latest: (StatusSelection & { seq: number }) | null = null
  for (const report of reports.values()) if (report.count > 0 && (!latest || report.seq > latest.seq)) latest = report
  const next = latest ? { count: latest.count, total: latest.total } : null
  if (next?.count === current?.count && next?.total === current?.total) return
  current = next
  for (const listener of listeners) listener()
}

/** Report this list's selection to the status bar while the component is mounted. */
export function useStatusSelection(count: number, total: number | null = null) {
  const id = useId()
  useEffect(() => {
    seq += 1
    reports.set(id, { count, total, seq })
    publish()
  }, [id, count, total])
  useEffect(
    () => () => {
      reports.delete(id)
      publish()
    },
    [id],
  )
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The selection the status bar shows, or null when no list has one. */
export function useSelectionContext(): StatusSelection | null {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
