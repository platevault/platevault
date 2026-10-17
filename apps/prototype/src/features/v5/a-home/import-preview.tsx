/**
 * S13 Import's Preview step (StepPage `/import?step=preview`, §5.2): what
 * the import will do, before Import… runs it.
 *
 * - Copy or Move, and the destination per role with its space and
 *   writability (each a chip in the gate when it refuses).
 * - The destinations table: lights become sessions, split by framing as
 *   intake splits them (a second framing reads "framing 2", D-W107); the
 *   row's menu merges a capture's framings into one session and re-splits
 *   them (LIB-AC-31). Each session files under the Target its pointing
 *   suggests (P-IMP2; OBJECT is only a hint), which the row's menu changes
 *   or files as Unclassified; raw calibration frames go to a calibration
 *   process (P-CAL3); masters go to the Calibration library. Its
 *   Calibration column reads each session's darks, flats and bias as the
 *   import's ingestion will leave them (pinned automatically, suggested or
 *   not found), and each calibration set what it would calibrate ("Used
 *   for", provisional).
 * - Calibration: the new sessions' choices (CalibrationChoices on the
 *   what-if): Confirm, Choose ▸ and No darks/flats/bias are kept in the
 *   draft and applied once the frames are read; Add calibration files…
 *   adds a folder to the batch. Leaving a kind for later never blocks
 *   Import: the session waits in Needs calibration (LIB-FR-23).
 * - Held files (Unclassified until typed; still being written until they
 *   settle) and skipped files (duplicates by SHA-256, imported before, a
 *   destination name taken, not an image).
 */
import { Check, Eye, FolderPlus, FolderSearch, Merge, RotateCcw, Split, Undo2, X } from "lucide-react"
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionBar } from "@/components/app/actions"
import type { Action, Column, ConfirmSpec, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { SegmentedField, SelectField } from "@/components/app/fields"
import { FolderPicker } from "@/components/app/folder-picker"
import { FormDialog } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { type TargetOption, TargetPicker } from "@/components/app/pickers"
import { StatusBadge } from "@/components/app/status"
import { CalibrationChoices, type CalibrationChoiceRow, calibrationChoiceRows } from "@/components/domain/calibration-choices"
import { isUnder, nightOf } from "@/domain/indexing"
import { sessionLongLabel } from "@/domain/membership"
import { matchesQuery } from "@/domain/sky"
import type { CalibrationSource, Catalog, DiskFile, ImageType, LocationId, PinKind, Session, TargetId } from "@/domain/types"
import { formatBytes, formatCount, formatExposure, formatNight } from "@/lib/format"
import { joinRefs, type MessageRef, type Messages, msg } from "@/lib/i18n"
import type { SessionKind } from "@/store/actions/calibration"
import { nowIso, type PrototypeState, updateSlice } from "@/store/core"
import type { ImportCalibrationChoice, ImportDraft } from "@/store/slices/a"
import { type DestinationGroup, destinationLocations, type ImportPlan, type ImportPreview, previewImport, routeLabel, TYPEABLE, typeLabel, withChoice } from "./import-model"
import { CalibrationSummary } from "./session"

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

/** Merge framings (true) or Re-split (false): the capture's framings import as one session, or split by the Settings margins (D-W107). */
function setMerged(captureKey: string, merged: boolean) {
  updateSlice("a", (a) => {
    const rest = a.importDraft.merged.filter((key) => key !== captureKey)
    return { ...a, importDraft: { ...a.importDraft, merged: merged ? [...rest, captureKey] : rest } }
  })
}

/** Keep a calibration choice for these incoming sessions' kinds until the import reads their frames. */
function setChoices(picks: Array<{ sessionKey: string; kind: PinKind }>, choice: ImportCalibrationChoice) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, calibration: picks.reduce((c, p) => withChoice(c, p.sessionKey, p.kind, choice), a.importDraft.calibration) } }))
}

function setExtraFolders(change: (folders: string[]) => string[]) {
  updateSlice("a", (a) => ({ ...a, importDraft: { ...a.importDraft, extraFolders: change(a.importDraft.extraFolders) } }))
}

/** "Captures and Calibration": the destination location names as one phrase. */
function locationList(m: Messages, names: string[]): string {
  return names.length > 1 ? m.import_name_list({ first: names.slice(0, -1).join(", "), last: names.at(-1)! }) : (names[0] ?? "")
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"))
}

/** Import…'s confirm: every file it writes, by destination folder; the summary's totals say where they go, that each copy is verified, and where Move sends the sources. */
export function importConfirm(m: Messages, plan: ImportPlan, draft: ImportDraft): ConfirmSpec {
  const count = plan.items.length
  const frames = formatCount(count)
  const move = draft.mode === "move"
  const locations = locationList(m, [...new Set(plan.items.map((i) => i.location.displayName))])
  return {
    title: move ? m.import_move_frames_title({ count, frames }) : m.import_import_frames_title({ count, frames }),
    summary: [
      m.import_copies_into({ size: formatBytes(plan.bytes), locations }),
      m.import_verifies_copies(),
      ...(move ? [plan.volume ? m.import_sends_to_trash({ volume: plan.volume.name }) : m.op_import_sources_to_trash()] : []),
    ].join(" · "),
    groups: plan.groups.map((g) => ({
      label: `${g.location.displayName}/${g.relative}`,
      rows: g.items.map((i) => ({ file: i.file.path.slice(i.file.path.lastIndexOf("/") + 1), from: folderOf(i.file.path), to: folderOf(i.destPath), action: move ? "move" : "copy", size: i.file.sizeBytes })),
    })),
    confirm: { label: move ? m.import_move_frames({ count, frames }) : m.import_import_frames({ count, frames }) },
  }
}

export function PreviewStep({ state, plan, draft, editable }: { state: PrototypeState; plan: ImportPlan; draft: ImportDraft; editable: boolean }) {
  // The what-if ingestion re-runs only when the library, the disk, the settings or the plan change (the page memoises the plan).
  const { catalog, disk, settings } = state
  const preview = useMemo(() => previewImport({ catalog, disk, settings }, plan, draft, nowIso()), [catalog, disk, settings, plan, draft])
  return (
    <>
      <ModeSection plan={plan} draft={draft} editable={editable} />
      <DestinationSection state={state} plan={plan} editable={editable} />
      <GroupsSection state={state} plan={plan} preview={preview} editable={editable} />
      <CalibrationSection state={state} plan={plan} draft={draft} preview={preview} editable={editable} />
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
        // Move's consequence (sources to the OS Trash) is in Import…'s confirm; only a refused Move says why here.
        description={plan.move.allowed ? undefined : m.import_move_blocked({ reason: plan.move.reason ?? "" })}
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

/** "Ha · 12 Oct": a session a calibration set would calibrate. */
function usedForName(m: Messages, session: Session): string {
  return `${session.channel ?? m.palette_session_no_filter()} · ${formatNight(session.night, true)}`
}

function GroupsSection({ state, plan, preview, editable }: { state: PrototypeState; plan: ImportPlan; preview: ImportPreview; editable: boolean }) {
  const m = useMessages()
  const [changing, setChanging] = useState<DestinationGroup | null>(null)
  const name = (g: DestinationGroup) => (g.session ? incomingLabel(m, g) : `${g.location.displayName}/${g.relative}`)
  const incoming = (g: DestinationGroup): Session | undefined => {
    const id = g.session ? preview.sessionOf.get(g.session.key) : undefined
    return id ? preview.world.catalog.sessions[id] : undefined
  }
  const calibration = (g: DestinationGroup) => {
    if (g.session) {
      const session = incoming(g)
      return session?.calibration ? <CalibrationSummary calibration={session.calibration} disk={preview.world.disk} incoming /> : "–"
    }
    const used = preview.usedFor.get(g.key) ?? []
    if (used.length === 0) return m.import_used_for_none()
    return (
      <>
        {m.import_used_for({ sessions: used.map((s) => usedForName(m, s)).join(", ") })} <StatusBadge kind="rule" value="provisional" />
      </>
    )
  }
  const columns: Column<DestinationGroup>[] = [
    // A light session reads as itself ("6 Oct · OIII · 300 s · framing 2"), a calibration set as its folder; each row's folder sits in its details, so the table fits from 1280 px.
    {
      id: "item",
      header: m.import_destination(),
      rowHeader: true,
      truncate: true,
      sortValue: (g) => `${g.route}|${name(g)}`,
      cell: (g) =>
        g.session?.merged ? (
          <>
            {name(g)} <Pill tone="info">{m.import_framings_merged({ count: g.session.framings })}</Pill>
          </>
        ) : (
          name(g)
        ),
    },
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
    {
      id: "type",
      header: m.import_column_type(),
      sortValue: (g) => g.type,
      cell: (g) => {
        const type = g.items.some((i) => i.typed) ? m.import_type_typed({ type: typeLabel(m, g.type) }) : typeLabel(m, g.type)
        return g.fallbacks.length > 0 ? (
          <>
            {type} <Pill tone="warning">{m.import_fallback()}</Pill>
          </>
        ) : (
          type
        )
      },
    },
    { id: "frames", header: m.sessions_column_frames(), align: "right", sortValue: (g) => g.items.length, cell: (g) => formatCount(g.items.length) },
    { id: "size", header: m.import_column_size(), align: "right", sortValue: (g) => g.bytes, cell: (g) => formatBytes(g.bytes) },
    { id: "calibration", header: m.nav_calibration(), sortValue: (g) => (g.session ? (incoming(g)?.calibration ? 1 : 0) : (preview.usedFor.get(g.key)?.length ?? 0)), cell: calibration },
  ]
  const actions = (g: DestinationGroup): MenuItem[] => {
    const session = g.session
    if (!editable || !session) return []
    const framing: MenuItem[] = session.merged
      ? [{ id: "resplit", label: m.import_resplit_framings(), icon: Split, run: () => setMerged(session.captureKey, false) }]
      : session.framings > 1
        ? [{ id: "merge", label: m.import_merge_framings({ count: session.framings }), icon: Merge, run: () => setMerged(session.captureKey, true) }]
        : []
    return [
      ...(session.suggested && session.target?.id !== session.suggested.id ? [{ id: "use-suggested", label: m.session_file_into({ name: session.suggested.name }), icon: Check, run: () => chooseTarget(session.key, session.suggested!.id) }] : []),
      { id: "change-target", label: m.session_choose_target(), icon: FolderSearch, opensDialog: true, run: () => setChanging(g) },
      ...(session.target ? [{ id: "unclassified", label: m.import_file_unclassified(), run: () => chooseTarget(session.key, null) }] : []),
      ...(framing.length > 0 ? [{ separator: true } as const, ...framing] : []),
    ]
  }
  const details = (g: DestinationGroup) => (
    <KeyValueList
      items={[
        { label: m.import_column_folder(), value: `${g.location.displayName}/${g.relative}` },
        { label: m.import_column_into(), value: routeLabel(m, g.route) },
        ...(g.fallbacks.length > 0 ? [{ label: m.import_fallback(), value: g.fallbacks.map((f) => `{${f}}`).join(", "), mono: true }] : []),
        ...(g.session && g.session.unpointed > 0
          ? [
              {
                label: m.import_no_pointing(),
                value: (
                  <>
                    {m.import_no_pointing_stays({ count: g.session.unpointed })} <StatusBadge kind="rule" value="provisional" />
                  </>
                ),
              },
            ]
          : []),
      ]}
    />
  )
  return (
    <Section title={m.import_preview()}>
      <DataTable
        label={m.import_destinations()}
        rows={plan.groups}
        columns={columns}
        getRowId={(g) => g.key}
        rowLabel={name}
        rowActions={actions}
        expand={{ render: details }}
        scroll="none"
        empty={m.import_nothing_to_import()}
      />
      {changing?.session ? <TargetDialog state={state} group={changing} label={incomingLabel(m, changing)} onClose={() => setChanging(null)} /> : null}
    </Section>
  )
}

/** Whether a calibration source is in the library already, not one this import brings. */
function inLibrary(catalog: Catalog, source: CalibrationSource): boolean {
  return source.type === "master" ? (catalog.masters[source.masterId]?.versions.some((v) => v.id === source.versionId) ?? false) : catalog.sessions[source.sessionId] !== undefined
}

/**
 * A what-if row for import review: the session and a source this import
 * brings are not in the library yet, so they read as text ("· in this
 * import") rather than links.
 */
function incomingRow(catalog: Catalog, row: CalibrationChoiceRow): CalibrationChoiceRow {
  const batch = (label: MessageRef) => joinRefs([label, msg("import_in_this_import")], " · ")
  const held = row.choice.state === "pinned" || row.choice.state === "suggested" ? row.choice.source : null
  const fromBatch = held !== null && !inLibrary(catalog, held)
  return {
    ...row,
    sessionLink: catalog.sessions[row.sessionId] ? row.sessionLink : null,
    source: fromBatch && row.source ? batch(row.source) : row.source,
    sourceLink: fromBatch ? null : row.sourceLink,
    offers: row.offers.map((offer) => (inLibrary(catalog, offer.source) ? offer : { ...offer, label: batch(offer.label) })),
  }
}

/**
 * The new sessions' darks, flats and bias as the import will leave them, with
 * the choices review can make before it runs: Confirm, Choose ▸ and No are
 * kept in the draft (the what-if shows them at once) and applied once the
 * frames are read. Add calibration files… adds a folder to the batch.
 */
function CalibrationSection({ state, plan, draft, preview, editable }: { state: PrototypeState; plan: ImportPlan; draft: ImportDraft; preview: ImportPreview; editable: boolean }) {
  const m = useMessages()
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const keyOf = new Map([...preview.sessionOf].map(([key, id]) => [id, key]))
  const sessionIds = [...new Set(plan.groups.flatMap((g) => (g.session ? (preview.sessionOf.get(g.session.key) ?? []) : [])))]
  const extras = plan.folders.filter((f) => f.extra)
  if (sessionIds.length === 0 && extras.length === 0) return null
  const rows = calibrationChoiceRows(preview.world, sessionIds).map((r) => incomingRow(state.catalog, r))
  const keep = (picks: SessionKind[], choice: ImportCalibrationChoice) => {
    setChoices(
      picks.flatMap((p) => {
        const sessionKey = keyOf.get(p.sessionId)
        return sessionKey ? [{ sessionKey, kind: p.kind }] : []
      }),
      choice,
    )
    setSelected([])
    return { ok: true } as const
  }
  const chosen = Object.values(draft.calibration).some((c) => Object.keys(c).length > 0)
  const actions: Action[] = editable
    ? [
        { id: "add-calibration", label: m.import_add_calibration_files_ellipsis(), icon: FolderPlus, opensDialog: true, run: () => setAdding(true) },
        ...(chosen ? [{ id: "reset-calibration", label: m.import_reset_calibration(), icon: RotateCcw, run: () => setDraft({ calibration: {} }) }] : []),
      ]
    : []
  const folderColumns: Column<(typeof extras)[number]>[] = [
    { id: "folder", header: m.import_column_folder(), rowHeader: true, truncate: true, sortValue: (f) => f.path, cell: (f) => f.path },
    { id: "state", header: m.import_column_state(), sortValue: (f) => Number(f.online), cell: (f) => <StatusBadge kind="availability" value={f.online ? "online" : "offline"} /> },
  ]
  return (
    <Section title={m.nav_calibration()} actions={actions.length > 0 ? <ActionBar actions={actions} /> : undefined}>
      {extras.length > 0 ? (
        <DataTable
          label={m.import_added_folders()}
          rows={extras}
          columns={folderColumns}
          getRowId={(f) => f.path}
          rowLabel={(f) => f.path}
          rowActions={(f) => (editable ? [{ id: "remove-folder", label: m.import_remove_folder(), icon: X, run: () => setExtraFolders((all) => all.filter((p) => p !== f.path)) }] : [])}
          scroll="none"
        />
      ) : null}
      {sessionIds.length > 0 ? (
        <CalibrationChoices
          label={m.import_calibration_of_sessions()}
          rows={rows}
          groupBySession
          changeable={editable}
          selection={{ selected, onChange: setSelected }}
          onConfirm={(picks) => keep(picks, { state: "confirm" })}
          onNo={(picks) => keep(picks, { state: "none" })}
          onPick={(pick) => keep([pick], { state: "pick", source: pick.source })}
          onAddFiles={() => setAdding(true)}
        />
      ) : null}
      <FolderPicker
        open={adding}
        onOpenChange={(open) => !open && setAdding(false)}
        title={m.import_add_calibration_title()}
        initialPath={plan.sourcePath}
        chooseVerb={m.verb_add()}
        onChoose={(path) => {
          setExtraFolders((all) => [...all.filter((p) => p !== path), path])
          setAdding(false)
        }}
      />
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
  // Relative to the source; a file of an added folder shows its full path.
  const rel = (path: string) => (isUnder(path, plan.sourcePath) ? path.slice(plan.sourcePath.length + 1) || path : path)
  const typed = new Map<string, HeldRow>()
  for (const [path, type] of Object.entries(draft.typed)) {
    if (!plan.folders.some((f) => isUnder(path, f.path))) continue
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
