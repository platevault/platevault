/**
 * Import's Review step (STO-IMP-FR-02 to STO-IMP-FR-05, LIB-FR-24): the
 * library's preview of one import, at its revision. Nothing is written
 * until Import starts.
 *
 * - Destinations: per role, the location the items go to with their count
 *   and bytes, the volume's free space and whether it can be written; a
 *   role with several locations offers Use location.
 * - Sessions: the lights' sessions as intake will form them, each filed
 *   under its Target (or Unclassified), with Merge framings over two or
 *   more and Re-split on a merged one.
 * - Files: every file with its type, where it goes and why one is held:
 *   Unclassified until typed (Type as), still being written, blocked by a
 *   collision or a missing location, or left out by the user.
 * - Duplicates: what each skipped file matches, by SHA-256.
 * - Copy or Move, each with its effect, then Import N frames.
 *
 * Every choice names the revision the user saw; a stale one is refused as
 * `conflict`, the import reads again, and the choice is not applied. The
 * mode the user picked is local until Import starts, so a refused start
 * keeps it.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type ImportDestination, type ImportItem, type ImportMode, type ImportOperation_Serialize, type ImportSession_Serialize, library, type NamingFrameType } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionBar } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { SegmentedField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { fileName, formatBytes, formatCount, formatExposure, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { importWrite } from "./queries"
import { blockText, duplicateText, frameTypeText, itemType, phaseText } from "./words"

const TYPES: NamingFrameType[] = ["light", "flat", "dark", "bias", "master_flat", "master_dark", "master_bias"]

/** What Copy and Move do to the sources (STO-IMP-FR-04): Copy keeps them; Move trashes each once its copy and it re-verify. */
export function modeEffect(m: Messages, mode: ImportMode): string {
  return mode === "copy" ? m.import_copy_effect() : m.import_move_effect()
}

/** Import N frames, with every destination in its confirm; unavailable while nothing is Ready or the source is away. */
export function startAction(m: Messages, op: ImportOperation_Serialize, mode: ImportMode, run: () => Promise<unknown> | unknown): Action {
  const ready = op.summary.ready
  const label = m.import_import_frames({ count: ready, frames: formatCount(ready) })
  const blocked = (reason: string) => ({ action: m.actions_blocked({ action: label }), reason, blockers: [] })
  const unavailable = op.sourceAvailability !== "available" ? blocked(m.import_source_offline()) : ready === 0 ? blocked(m.import_nothing_to_import()) : undefined
  const chosen = op.destinations.filter((d) => d.chosen && d.items > 0)
  const bytes = chosen.reduce((sum, d) => sum + d.bytes, 0)
  return {
    id: "start-import",
    label,
    unavailable,
    confirm: {
      title: m.import_import_frames_title({ count: ready, frames: formatCount(ready) }),
      summary: `${m.import_copies_into({ size: formatBytes(bytes), locations: chosen.map((d) => d.name).join(", ") })} · ${modeEffect(m, mode)}`,
      confirm: { label: mode === "move" ? m.import_move() : m.import_copy(), kind: "primary" },
    },
    run: run as Action["run"],
  }
}

export function ReviewStep({ op, mode, onMode, editable }: { op: ImportOperation_Serialize; mode: ImportMode; onMode: (mode: ImportMode) => void; editable: boolean }) {
  const m = useMessages()
  const client = useQueryClient()
  const write = (call: () => ReturnType<typeof library.importRecheck>) => importWrite(client, op.id, call)
  const locationName = (id: string) => op.destinations.find((d) => d.locationId === id)?.name ?? "–"
  const s = op.summary
  return (
    <>
      {op.sourceAvailability !== "available" ? <Notice tone="offline" title={m.import_source_disconnected({ name: op.sourcePath.display })}>{m.import_source_offline_detail()}</Notice> : null}
      <Section
        title={m.import_preview()}
        actions={editable ? <ActionBar actions={[{ id: "recheck", label: m.apps_check_again(), run: () => write(() => library.importRecheck(op.id, op.revision)) }]} /> : undefined}
      >
        <KeyValueList
          columns={2}
          items={[
            { label: m.import_phase_ready(), value: formatCount(s.ready) },
            { label: m.import_duplicates(), value: formatCount(s.duplicates) },
            { label: m.import_type_unclassified(), value: formatCount(s.unclassified) },
            { label: m.import_phase_settling(), value: formatCount(s.settling) },
            { label: m.import_held(), value: formatCount(s.blocked) },
            { label: m.import_phase_excluded(), value: formatCount(s.excluded) },
          ]}
        />
      </Section>
      <Section title={m.import_destinations()}>
        <Destinations op={op} editable={editable} write={write} />
      </Section>
      <Section title={m.import_review_sessions()}>
        <Sessions op={op} editable={editable} write={write} />
      </Section>
      <Section title={m.import_column_files()}>
        <Items op={op} editable={editable} write={write} locationName={locationName} />
      </Section>
      <Section title={m.import_copy_or_move()}>
        <SegmentedField
          label={m.import_copy_or_move()}
          value={mode}
          options={[
            { value: "copy", label: m.import_copy() },
            { value: "move", label: m.import_move() },
          ]}
          onChange={onMode}
          disabled={!editable}
          description={modeEffect(m, mode)}
        />
      </Section>
    </>
  )
}

type Write = (call: () => ReturnType<typeof library.importRecheck>) => ReturnType<typeof importWrite>

function Destinations({ op, editable, write }: { op: ImportOperation_Serialize; editable: boolean; write: Write }) {
  const m = useMessages()
  const roleName = (d: ImportDestination) => (d.role === "captures" ? m.import_captures_location() : d.role === "calibration" ? m.import_calibration_location() : m.status_role_results())
  const several = (d: ImportDestination) => op.destinations.filter((x) => x.role === d.role).length > 1
  const columns: Column<ImportDestination>[] = [
    { id: "location", header: m.import_destination(), rowHeader: true, truncate: true, sortValue: (d) => d.name, cell: (d) => d.name },
    { id: "role", header: m.project_col_kind(), sortValue: roleName, cell: roleName },
    { id: "items", header: m.import_column_files(), align: "right", sortValue: (d) => d.items, cell: (d) => (d.chosen ? `${formatCount(d.items)} · ${formatBytes(d.bytes)}` : "–") },
    { id: "free", header: m.run_check_space(), align: "right", sortValue: (d) => d.freeBytes, cell: (d) => (d.freeBytes === null ? "–" : m.import_free({ size: formatBytes(d.freeBytes) })) },
    {
      id: "writable",
      header: m.import_writable(),
      sortValue: (d) => d.writability.state,
      cell: (d) => (d.writability.state === "writable" ? m.import_writable() : d.writability.state === "not_writable" ? m.import_not_writable() : m.status_not_checked()),
    },
  ]
  return (
    <BoxTable
      label={m.import_destinations()}
      rows={op.destinations}
      columns={columns}
      getRowId={(d) => `${d.role}:${d.locationId}`}
      rowLabel={(d) => d.name}
      primaryRowAction={(d) =>
        !editable || d.chosen || !several(d) ? null : { id: "use-location", label: m.import_use_location(), run: () => write(() => library.importChooseLocation(op.id, op.revision, d.role, d.locationId)) }
      }
      empty={m.import_nothing_to_import()}
    />
  )
}

function sessionName(m: Messages, s: ImportSession_Serialize): string {
  return [s.object ?? m.session_no_object(), s.filter ?? "–", ...(s.exposureSeconds !== null ? [formatExposure(s.exposureSeconds)] : []), ...(s.night ? [formatNight(s.night)] : [])].join(" · ")
}

function Sessions({ op, editable, write }: { op: ImportOperation_Serialize; editable: boolean; write: Write }) {
  const m = useMessages()
  const [selected, setSelected] = useState<string[]>([])
  const id = (s: ImportSession_Serialize) => String(s.items[0] ?? s.key)
  const targetText = (s: ImportSession_Serialize) => (s.target ? s.target.designation : m.import_type_unclassified())
  const columns: Column<ImportSession_Serialize>[] = [
    { id: "session", header: m.session_label(), rowHeader: true, truncate: true, sortValue: (s) => sessionName(m, s), cell: (s) => sessionName(m, s) },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (s) => s.items.length, cell: (s) => formatCount(s.items.length) },
    { id: "framing", header: m.project_col_framing(), sortValue: (s) => s.framing, cell: (s) => (s.merged ? m.import_framings_merged({ count: 1 }) : s.framing !== null ? m.domain_session_framing({ n: s.framing }) : m.project_framing_unknown()) },
    { id: "target", header: m.sessions_column_target(), sortValue: targetText, cell: (s) => (s.targetChosen || s.target ? targetText(s) : s.recommended ? m.import_target_recommended({ name: s.recommended.designation }) : targetText(s)) },
  ]
  const rowActions = (s: ImportSession_Serialize): MenuItem[] => {
    if (!editable) return []
    const seq = s.items[0]
    if (seq === undefined) return []
    return [
      ...(s.recommended && s.target?.id !== s.recommended.id ? [{ id: "use-recommended", label: m.import_use_named_target({ name: s.recommended.designation }), run: () => write(() => library.importChooseTarget(op.id, op.revision, seq, s.recommended!.id)) }] : []),
      ...(s.target ? [{ id: "unclassified", label: m.import_file_unclassified(), run: () => write(() => library.importChooseTarget(op.id, op.revision, seq, null)) }] : []),
      ...(s.merged ? [{ id: "resplit", label: m.import_resplit_framings(), run: () => write(() => library.importResplitSession(op.id, op.revision, seq)) }] : []),
    ]
  }
  return (
    <DataTable
      label={m.import_review_sessions()}
      rows={op.sessions}
      columns={columns}
      getRowId={id}
      rowLabel={(s) => sessionName(m, s)}
      rowActions={rowActions}
      scroll="none"
      selection={editable ? { selected, onChange: setSelected, rowLabel: (s) => sessionName(m, s) } : undefined}
      batchActions={(ids) => [
        {
          id: "merge",
          label: m.import_merge_framings({ count: ids.length }),
          unavailable: ids.length < 2 ? { action: m.actions_blocked({ action: m.import_merge_framings({ count: ids.length }) }), reason: m.import_merge_two(), blockers: [] } : undefined,
          run: async () => {
            const result = await write(() => library.importMergeSessions(op.id, op.revision, ids.map(Number)))
            if (result.ok) setSelected([])
            return result
          },
        },
      ]}
      empty={m.import_no_lights()}
    />
  )
}

function Items({ op, editable, write, locationName }: { op: ImportOperation_Serialize; editable: boolean; write: Write; locationName: (id: string) => string }) {
  const m = useMessages()
  const state = (item: ImportItem) => (item.block ? blockText(m, item.block, locationName) : item.duplicate ? duplicateText(m, item.duplicate) : phaseText(m, item.phase))
  const columns: Column<ImportItem>[] = [
    { id: "file", header: m.session_column_file(), rowHeader: true, truncate: true, sortValue: (i) => i.relativePath.display, cell: (i) => fileName(i.relativePath.display) },
    { id: "type", header: m.import_column_type(), sortValue: (i) => frameTypeText(m, itemType(i)), cell: (i) => (i.userType ? m.import_type_typed({ type: frameTypeText(m, i.userType) }) : frameTypeText(m, i.classification)) },
    { id: "into", header: m.import_column_into(), truncate: true, sortValue: (i) => i.destinationPath?.display ?? null, cell: (i) => i.destinationPath?.display ?? "–" },
    { id: "size", header: m.import_column_size(), align: "right", sortValue: (i) => i.sizeBytes, cell: (i) => formatBytes(i.sizeBytes) },
    {
      id: "state",
      header: m.import_column_state(),
      truncate: true,
      sortValue: state,
      cell: (i) => (i.phase === "blocked" ? <StatusBadge kind="item" value="blocked" label={state(i)} /> : state(i)),
    },
  ]
  const rowActions = (item: ImportItem): MenuItem[] => {
    if (!editable) return []
    const typeItems: MenuItem[] = TYPES.filter((t) => t !== itemType(item)).map((t) => ({ id: `type-${t}`, label: frameTypeText(m, t), run: () => write(() => library.importSetType(op.id, op.revision, item.seq, t)) }))
    return [
      { submenu: m.import_type_as(), items: typeItems },
      item.excluded
        ? { id: "include", label: m.import_take_back(), run: () => write(() => library.importSetExcluded(op.id, op.revision, item.seq, false)) }
        : { id: "exclude", label: m.import_leave_out(), run: () => write(() => library.importSetExcluded(op.id, op.revision, item.seq, true)) },
    ]
  }
  return (
<DataTable label={m.import_column_files()} rows={op.items} columns={columns} getRowId={(i) => String(i.seq)} rowLabel={(i) => fileName(i.relativePath.display)} rowActions={rowActions} scroll="frame" empty={m.import_nothing_to_import()} />
  )
}
