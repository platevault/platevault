/**
 * S13 Import's Preview step (StepPage `/import?step=preview`, §5.2): what
 * the import will do, before Import… runs it.
 *
 * - Copy or Move, and the destination per role with its space and
 *   writability (each a chip in the gate when it refuses).
 * - The destinations table: lights become sessions, split by framing as
 *   intake splits them (a second framing reads "framing 2", D-W107), each
 *   filed under the Target its pointing suggests (P-IMP2; OBJECT is only a
 *   hint), which the row's menu changes or files as Unclassified; raw
 *   calibration frames go to a calibration process (P-CAL3); masters go to
 *   the Calibration library.
 * - Held files (Unclassified until typed; still being written until they
 *   settle) and skipped files (duplicates by SHA-256, imported before, a
 *   destination name taken, not an image).
 */
import { Check, Eye, FolderSearch, Undo2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionBar } from "@/components/app/actions"
import type { Action, Column, ConfirmSpec, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { SegmentedField, SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { type TargetOption, TargetPicker } from "@/components/app/pickers"
import { StatusBadge } from "@/components/app/status"
import { nightOf } from "@/domain/indexing"
import { sessionLongLabel } from "@/domain/membership"
import { matchesQuery } from "@/domain/sky"
import type { DiskFile, ImageType, LocationId, TargetId } from "@/domain/types"
import { formatBytes, formatCount, formatExposure, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { type PrototypeState, updateSlice } from "@/store/core"
import type { ImportDraft } from "@/store/slices/a"
import { type DestinationGroup, destinationLocations, type ImportPlan, routeLabel, TYPEABLE, typeLabel } from "./import-model"

function setDraft(patch: Partial<ImportDraft>) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, ...patch } }))
}

/** The Target an incoming session files under (P-IMP2); null is Unclassified. */
function chooseTarget(sessionKey: string, targetId: TargetId | null) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, targets: { ...a.importDraft.targets, [sessionKey]: targetId } } }))
}

function setTyped(paths: string[], type: ImageType | null) {
  updateSlice("a", (a) => {
    const typed = { ...a.importDraft.typed }
    for (const path of paths) {
      if (type) typed[path] = type
      else delete typed[path]
    }
    return { ...a, importDraft: { ...a.importDraft, typed } }
  })
}

/** "Captures and Calibration": the destination location names as one phrase. */
function locationList(m: Messages, names: string[]): string {
  return names.length > 1 ? m.import_name_list({ first: names.slice(0, -1).join(", "), last: names.at(-1)! }) : (names[0] ?? "")
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"))
}

/** Import…'s confirm: every file it writes, by destination folder, and what Move does with the sources. */
export function importConfirm(m: Messages, plan: ImportPlan, draft: ImportDraft): ConfirmSpec {
  const count = plan.items.length
  const frames = formatCount(count)
  const move = draft.mode === "move"
  const locations = locationList(m, [...new Set(plan.items.map((i) => i.location.displayName))])
  return {
    title: move ? m.import_move_frames_title({ count, frames }) : m.import_import_frames_title({ count, frames }),
    summary: [
      m.import_copies_into({ count, frames, size: formatBytes(plan.bytes), locations }),
      m.import_verifies_copies(),
      ...(move ? [plan.volume ? m.import_sends_to_trash({ count, sources: frames, volume: plan.volume.name }) : m.import_sends_source_to_trash({ count, sources: frames })] : []),
    ].join(" · "),
    groups: plan.groups.map((g) => ({
      label: `${g.location.displayName}/${g.relative}`,
      rows: g.items.map((i) => ({ file: i.file.path.slice(i.file.path.lastIndexOf("/") + 1), from: folderOf(i.file.path), to: folderOf(i.destPath), action: move ? "move" : "copy", size: i.file.sizeBytes })),
    })),
    confirm: { label: move ? m.import_move_frames({ count, frames }) : m.import_import_frames({ count, frames }) },
  }
}

export function PreviewStep({ state, plan, draft, editable }: { state: PrototypeState; plan: ImportPlan; draft: ImportDraft; editable: boolean }) {
  return (
    <>
      <ModeSection plan={plan} draft={draft} editable={editable} />
      <DestinationSection state={state} plan={plan} editable={editable} />
      <GroupsSection state={state} plan={plan} editable={editable} />
      <HeldSection plan={plan} draft={draft} editable={editable} />
      <SkippedSection state={state} plan={plan} />
    </>
  )
}

function ModeSection({ plan, draft, editable }: { plan: ImportPlan; draft: ImportDraft; editable: boolean }) {
  const m = useMessages()
  return (
    <Section title={m.import_copy_or_move()}>
      <SegmentedField
        label={m.import_copy_or_move()}
        value={draft.mode}
        disabled={!editable}
        options={[
          { value: "copy", label: m.import_copy() },
          { value: "move", label: m.import_move(), disabled: !plan.move.allowed },
        ]}
        onChange={(mode) => setDraft({ mode })}
        description={draft.mode === "move" ? m.import_move_detail() : plan.move.allowed ? m.import_copy_detail() : `${m.import_copy_detail()} · ${m.import_move_blocked({ reason: plan.move.reason ?? "" })}`}
      />
    </Section>
  )
}

function DestinationSection({ state, plan, editable }: { state: PrototypeState; plan: ImportPlan; editable: boolean }) {
  const m = useMessages()
  const follow = useFollowLink()
  const naming: Action = { id: "naming", label: m.settings_naming(), run: () => follow({ to: "/settings/naming" }) }
  return (
    <Section title={m.import_destination()} actions={<ActionBar actions={[naming]} />}>
      {plan.destinations.map((d) => {
        const locations = destinationLocations(state.catalog, d.role)
        const label = d.role === "captures" ? m.import_captures_location() : m.import_calibration_location()
        const status = d.location ? `${d.writable ? m.import_writable() : m.import_not_writable()} · ${m.import_free({ size: formatBytes(d.freeBytes) })}${d.neededBytes > 0 ? ` · ${m.import_needs({ size: formatBytes(d.neededBytes) })}` : ""}` : m.import_no_location()
        return (
          <SelectField<string>
            key={d.role}
            label={label}
            value={d.location?.id ?? ""}
            disabled={!editable || locations.length === 0}
            options={locations.length > 0 ? locations.map((l) => ({ value: l.id, label: l.displayName })) : [{ value: "", label: m.import_no_location(), disabled: true }]}
            onChange={(next) => setDraft(d.role === "captures" ? { capturesLocationId: next as LocationId } : { calibrationLocationId: next as LocationId })}
            description={status}
            error={d.problem ?? undefined}
          />
        )
      })}
    </Section>
  )
}

/** An incoming light session in words: "1 Oct · Ha · 300 s", with "framing 2" for a later framing of the same capture (D-W107). */
function incomingLabel(m: Messages, g: DestinationGroup): string {
  const header = g.items[0]!.file.header!
  const framing = g.session && g.session.framing > 1 ? [m.domain_session_framing({ n: g.session.framing })] : []
  return [formatNight(nightOf(header.dateObs), true), header.filter ?? m.palette_session_no_filter(), formatExposure(header.exposureS), ...framing].join(" · ")
}

function GroupsSection({ state, plan, editable }: { state: PrototypeState; plan: ImportPlan; editable: boolean }) {
  const m = useMessages()
  const [changing, setChanging] = useState<DestinationGroup | null>(null)
  const name = (g: DestinationGroup) => (g.session ? incomingLabel(m, g) : `${g.location.displayName}/${g.relative}`)
  const columns: Column<DestinationGroup>[] = [
    { id: "folder", header: m.import_column_folder(), rowHeader: true, truncate: true, sortValue: (g) => `${g.route}|${g.relative}`, cell: (g) => `${g.location.displayName}/${g.relative}` },
    {
      id: "target",
      header: m.sessions_column_target(),
      sortValue: (g) => g.session?.target?.name ?? "",
      cell: (g) => {
        if (!g.session) return "–"
        if (!g.session.target) return <StatusBadge kind="association" value="unresolved" label={m.import_type_unclassified()} />
        return g.session.suggested?.id === g.session.target.id ? (
          <>
            {g.session.target.name} <StatusBadge kind="association" value="associated" label={m.import_from_pointing()} />
          </>
        ) : (
          g.session.target.name
        )
      },
    },
    { id: "type", header: m.import_column_type(), sortValue: (g) => g.type, cell: (g) => (g.items.some((i) => i.typed) ? m.import_type_typed({ type: typeLabel(m, g.type) }) : typeLabel(m, g.type)) },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (g) => g.items.length, cell: (g) => formatCount(g.items.length) },
    { id: "size", header: m.import_column_size(), align: "right", sortValue: (g) => g.bytes, cell: (g) => formatBytes(g.bytes) },
    { id: "into", header: m.import_column_into(), sortValue: (g) => g.route, cell: (g) => (g.fallbacks.length > 0 ? <>{routeLabel(m, g.route)} <Pill tone="warning">{m.import_fallback()}</Pill></> : routeLabel(m, g.route)) },
  ]
  const actions = (g: DestinationGroup): MenuItem[] => {
    const session = g.session
    if (!editable || !session) return []
    return [
      ...(session.suggested && session.target?.id !== session.suggested.id ? [{ id: "use-suggested", label: m.session_file_into({ name: session.suggested.name }), icon: Check, run: () => chooseTarget(session.key, session.suggested!.id) }] : []),
      { id: "change-target", label: m.session_choose_target(), icon: FolderSearch, opensDialog: true, run: () => setChanging(g) },
      ...(session.target ? [{ id: "unclassified", label: m.import_file_unclassified(), run: () => chooseTarget(session.key, null) }] : []),
    ]
  }
  return (
    <Section title={m.import_preview()}>
      <DataTable
        label={m.import_destinations()}
        rows={plan.groups}
        columns={columns}
        getRowId={(g) => g.key}
        rowLabel={name}
        rowActions={actions}
        expand={{ isExpandable: (g) => g.fallbacks.length > 0, render: (g) => m.import_fallback_used({ tokens: g.fallbacks.map((f) => `{${f}}`).join(", ") }) }}
        scroll="none"
        empty={m.import_nothing_to_import()}
      />
      {changing?.session ? <TargetDialog state={state} group={changing} label={incomingLabel(m, changing)} onClose={() => setChanging(null)} /> : null}
    </Section>
  )
}

/** Change Target…: any library Target for one incoming session. */
function TargetDialog({ state, group, label, onClose }: { state: PrototypeState; group: DestinationGroup; label: string; onClose: () => void }) {
  const m = useMessages()
  const session = group.session!
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState<TargetOption | null>(session.target ? { id: session.target.id, name: session.target.name } : null)
  const results: TargetOption[] = query.trim()
    ? Object.values(state.catalog.targets)
        .filter((t) => matchesQuery([t.name, ...t.aliases], query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 12)
        .map((t) => ({ id: t.id, name: t.name, detail: t.aliases[0] }))
    : []
  return (
    <FormDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={m.import_change_target_title({ name: label })}
      size="sm"
      confirm={{
        id: "use-target",
        label: m.import_use_this_target(),
        unavailable: picked ? undefined : { action: m.import_use_this_target(), reason: m.session_no_target_chosen(), blockers: [] },
        run: () => {
          if (picked) chooseTarget(session.key, picked.id as TargetId)
        },
      }}
    >
      <KeyValueList
        items={[
          { label: m.session_chosen_target(), value: picked?.name ?? m.session_none() },
          { label: m.evidence_source_pointing(), value: session.suggested?.name ?? m.session_none() },
          { label: m.session_header_label(), value: session.objectLabel ?? m.session_no_object() },
        ]}
      />
      <TargetPicker label={m.session_choose_a_target()} query={query} onQueryChange={setQuery} groups={[{ source: "mine", items: results }]} onPick={setPicked} />
    </FormDialog>
  )
}

interface HeldRow {
  key: string
  kind: "unclassified" | "typed" | "writing"
  folder: string
  paths: string[]
  type: ImageType | null
  objectLabel: string | null
}

function HeldSection({ plan, draft, editable }: { plan: ImportPlan; draft: ImportDraft; editable: boolean }) {
  const m = useMessages()
  const rel = (path: string) => path.slice(plan.sourcePath.length + 1) || path
  const typed = new Map<string, HeldRow>()
  for (const [path, type] of Object.entries(draft.typed)) {
    if (!path.startsWith(plan.sourcePath)) continue
    const key = `${folderOf(path)}|${type}`
    const row = typed.get(key) ?? { key: `typed:${key}`, kind: "typed" as const, folder: rel(folderOf(path)), paths: [], type, objectLabel: null }
    row.paths.push(path)
    typed.set(key, row)
  }
  const rows: HeldRow[] = [
    ...plan.held.unclassified.map((h): HeldRow => ({ key: `hold:${h.folder}`, kind: "unclassified", folder: rel(h.folder), paths: h.files.map((f) => f.path), type: null, objectLabel: h.objectLabel })),
    ...typed.values(),
    ...plan.held.settling.map((f): HeldRow => ({ key: `writing:${f.path}`, kind: "writing", folder: rel(f.path), paths: [f.path], type: null, objectLabel: null })),
  ]
  if (rows.length === 0) return null
  const reason = (r: HeldRow) =>
    r.kind === "unclassified" ? (
      <StatusBadge kind="association" value="unresolved" label={m.import_type_unclassified()} />
    ) : r.kind === "typed" ? (
      <StatusBadge kind="association" value="confirmed" label={m.import_typed_as({ type: typeLabel(m, r.type!) })} />
    ) : (
      <StatusBadge kind="operation" value="running" label={m.import_writing()} />
    )
  const columns: Column<HeldRow>[] = [
    { id: "folder", header: m.import_column_folder(), rowHeader: true, truncate: true, sortValue: (r) => r.folder, cell: (r) => r.folder },
    { id: "files", header: m.import_column_files(), align: "right", sortValue: (r) => r.paths.length, cell: (r) => formatCount(r.paths.length) },
    { id: "label", header: m.session_header_label(), truncate: true, sortValue: (r) => r.objectLabel ?? "", cell: (r) => r.objectLabel ?? "–" },
    { id: "state", header: m.import_column_state(), sortValue: (r) => r.kind, cell: reason },
  ]
  const actions = (r: HeldRow): MenuItem[] => {
    if (!editable) return []
    if (r.kind === "unclassified") return [{ submenu: m.import_type_as(), items: TYPEABLE.map((t) => ({ id: `type-${t}`, label: typeLabel(m, t), run: () => setTyped(r.paths, t) })) }]
    if (r.kind === "typed") return [{ id: "undo", label: m.import_undo(), icon: Undo2, run: () => setTyped(r.paths, null) }]
    return []
  }
  return (
    <Section title={m.import_held()}>
      <DataTable label={m.import_held()} rows={rows} columns={columns} getRowId={(r) => r.key} rowLabel={(r) => r.folder} rowActions={actions} scroll="none" />
    </Section>
  )
}

interface SkipRow {
  key: "duplicate" | "imported" | "name-taken" | "not-image"
  files: DiskFile[]
}

function SkippedSection({ state, plan }: { state: PrototypeState; plan: ImportPlan }) {
  const m = useMessages()
  const follow = useFollowLink()
  const s = plan.skipped
  const rows: SkipRow[] = (
    [
      { key: "duplicate", files: s.duplicate.map((d) => d.file) },
      { key: "imported", files: s.imported },
      { key: "name-taken", files: s.nameTaken.map((n) => n.file) },
      { key: "not-image", files: s.notImage },
    ] satisfies SkipRow[]
  ).filter((r) => r.files.length > 0)
  if (rows.length === 0) return null
  const reason: Record<SkipRow["key"], () => string> = {
    duplicate: m.import_duplicates,
    imported: m.import_skip_imported_before,
    "name-taken": m.import_name_taken,
    "not-image": m.import_skip_other,
  }
  const detail: Record<SkipRow["key"], () => string> = {
    duplicate: m.import_match_sha,
    imported: m.import_skip_imported_detail,
    "name-taken": m.import_name_taken_detail,
    "not-image": m.import_skip_other_detail,
  }
  const bySession = new Map<string, number>()
  for (const d of s.duplicate) if (d.sessionId) bySession.set(d.sessionId, (bySession.get(d.sessionId) ?? 0) + 1)
  const columns: Column<SkipRow>[] = [
    { id: "reason", header: m.import_column_reason(), rowHeader: true, sortValue: (r) => reason[r.key](), cell: (r) => reason[r.key]() },
    { id: "files", header: m.import_column_files(), align: "right", sortValue: (r) => r.files.length, cell: (r) => formatCount(r.files.length) },
    { id: "detail", header: m.import_column_detail(), truncate: true, sortValue: (r) => detail[r.key](), cell: (r) => detail[r.key]() },
  ]
  const actions = (r: SkipRow): MenuItem[] =>
    r.key !== "duplicate"
      ? []
      : [...bySession.entries()].flatMap(([sessionId, n]) => {
          const session = state.catalog.sessions[sessionId]
          return session ? [{ id: `open-${sessionId}`, label: `${sessionLongLabel(m, session)} · ${m.import_library_frames({ count: n })}`, icon: Eye, run: () => follow({ to: "/sessions/$sessionId", params: { sessionId } }) }] : []
        })
  return (
    <Section title={m.import_skipped()}>
      <DataTable label={m.import_skipped()} rows={rows} columns={columns} getRowId={(r) => r.key} rowLabel={(r) => reason[r.key]()} rowActions={actions} scroll="none" />
    </Section>
  )
}
