/**
 * An indexing run for the catalogue's OperationPanel and OperationLine
 * specimens: files that read, one that is unsupported and one access-denied,
 * so a finished run settles partial. `advanceRun` moves a running run on by
 * one file, as the library's progress events would. Names and paths are
 * sample data. Catalogue only.
 */
import type { OperationItemStatus, OperationItemView, OperationStatus, OperationView } from "@/components/app/operation-panel"
import { msg, verbatim } from "@/lib/i18n"

export interface SampleLocation {
  id: string
  name: string
  root: string
}

export const SAMPLE_LOCATIONS: readonly SampleLocation[] = [
  { id: "loc_t7", name: "Astro-T7 Captures", root: "/Volumes/Astro-T7/Captures/M31/2026-09-18" },
  { id: "loc_astro", name: "Astro Captures", root: "/Volumes/Astro/Captures" },
]

/** Each file's outcome once the run reaches it. */
const FILES: ReadonlyArray<{ name: string; outcome: OperationItemStatus }> = [
  ...Array.from({ length: 10 }, (_, i) => ({ name: `Light_M31_L_300s_${String(i + 1).padStart(4, "0")}.fits`, outcome: "done" as const })),
  { name: "notes.txt", outcome: "skipped" },
  { name: "Light_M31_L_300s_0011.fits", outcome: "blocked" },
]

function item(root: string, name: string, status: OperationItemStatus): OperationItemView {
  const detail = status === "blocked" ? msg("op_index_access_denied") : status === "skipped" ? msg("op_index_unsupported", { count: 1 }) : null
  return { id: name, label: verbatim(name), path: `${root}/${name}`, status, phase: null, detail }
}

/** A run that has just started on `location`: the first file reading, the rest pending. */
export function indexingRun(location: SampleLocation, startedAt: string): OperationView {
  return {
    id: `op_index_${location.id}_${startedAt}`,
    title: msg("op_index_title_one", { name: location.name }),
    status: "running",
    progress: { done: 0, total: FILES.length, unit: "files" },
    items: FILES.map((file, index) => item(location.root, file.name, index === 0 ? "running" : "pending")),
    summary: null,
    createdAt: startedAt,
    settledAt: null,
  }
}

/** The run one file further on; after the last file it settles, partial when a file was not read. */
export function advanceRun(op: OperationView, now: string): OperationView {
  if (op.status !== "running") return op
  const done = op.progress.done + 1
  const items = op.items.map((it, index) => (index === done - 1 ? { ...it, status: FILES[index]!.outcome } : index === done ? { ...it, status: "running" as const } : it))
  if (done < op.progress.total) return { ...op, progress: { ...op.progress, done }, items }
  const read = FILES.filter((f) => f.outcome === "done").length
  const status: OperationStatus = read === FILES.length ? "succeeded" : "partial"
  return { ...op, status, progress: { ...op.progress, done }, items, summary: msg("op_index_files_read", { count: read, n: String(read) }), settledAt: now }
}

/** The run stopped: paused, cancelled with the files it read, or interrupted by a restart. */
export function stopRun(op: OperationView, status: Extract<OperationStatus, "paused" | "canceled" | "interrupted">, now: string): OperationView {
  if (status === "paused") return { ...op, status }
  const summary = status === "canceled" ? msg("op_canceled_summary", { done: op.progress.done, total: op.progress.total }) : msg("op_interrupted_summary")
  return { ...op, status, summary, settledAt: status === "canceled" ? now : null }
}

const T0 = "2026-10-13T20:04:00.000Z"
const T1 = "2026-10-13T20:06:30.000Z"
const run = (n: number) => Array.from({ length: n }).reduce<OperationView>((op) => advanceRun(op, T1), indexingRun(SAMPLE_LOCATIONS[0]!, T0))

/** One run in each line state: running half way, paused, interrupted, settled partial, cancelled. */
export const OPERATION_LINES: readonly OperationView[] = [
  { ...run(6), id: "op_running" },
  { ...stopRun(run(4), "paused", T1), id: "op_paused" },
  { ...stopRun(run(3), "interrupted", T1), id: "op_interrupted" },
  { ...run(FILES.length), id: "op_partial" },
  { ...stopRun(run(2), "canceled", T1), id: "op_canceled" },
]
