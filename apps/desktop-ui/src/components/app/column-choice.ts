/**
 * The Columns menu's choice of a DataTable (`hideable` columns), kept per
 * table (`columnsId`) in localStorage the way the dock keeps its pin and
 * width per page (templates/dock.ts). Only the columns the user switched are stored, so a
 * column's own default (`defaultHidden`) still applies to the rest. A table
 * with no `columnsId` keeps the choice while it is mounted.
 */
import { useState, useSyncExternalStore } from "react"
import type { Column } from "./contracts"

const KEY_PREFIX = "platevault.columns."

/** Column id → shown, for the columns the user switched. */
type ColumnChoice = Readonly<Record<string, boolean>>

const NONE: ColumnChoice = {}
const cache = new Map<string, ColumnChoice>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function choiceOf(columnsId: string): ColumnChoice {
  const cached = cache.get(columnsId)
  if (cached) return cached
  let choice = NONE
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + columnsId) ?? "null")
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      choice = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
    }
  } catch {
    // Unreadable storage: every column at its default.
  }
  cache.set(columnsId, choice)
  return choice
}

function saveChoice(columnsId: string, choice: ColumnChoice) {
  cache.set(columnsId, choice)
  try {
    localStorage.setItem(KEY_PREFIX + columnsId, JSON.stringify(choice))
  } catch {
    // Storage full or blocked: the choice applies for this session only.
  }
  for (const listener of listeners) listener()
}

/** Whether a column shows: always, unless it is hideable; then the user's choice, else its default. */
export function isColumnShown<T>(column: Column<T>, choice: ColumnChoice): boolean {
  if (!isColumnHideable(column)) return true
  return choice[column.id] ?? !column.defaultHidden
}

/** A column the Columns menu lists: hideable and not the row header. */
export function isColumnHideable<T>(column: Column<T>): boolean {
  return column.hideable === true && column.rowHeader !== true
}

/** The table's column choice and its setter; kept under `columnsId`, or while mounted without one. */
export function useColumnChoice(columnsId: string | undefined): [ColumnChoice, (columnId: string, shown: boolean) => void] {
  const [own, setOwn] = useState<ColumnChoice>(NONE)
  const kept = useSyncExternalStore(subscribe, () => (columnsId === undefined ? NONE : choiceOf(columnsId)))
  const setShown = (columnId: string, shown: boolean) => {
    if (columnsId === undefined) setOwn((current) => ({ ...current, [columnId]: shown }))
    else saveChoice(columnsId, { ...choiceOf(columnsId), [columnId]: shown })
  }
  return [columnsId === undefined ? own : kept, setShown]
}
