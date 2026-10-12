/**
 * Design-system reference (foundation-owned route `/design-system`).
 * Renders the tokens and every shared app component in its applicable
 * states, using live prototype data where a component reads the store.
 * Tracks use it as the visual contract; reviewers use it as evidence.
 */
import { Inbox, Play, Sparkles } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { FolderPicker } from "@/components/app/folder-picker"
import { ChannelCoverage, EvidenceList, FilterChips, KeyValueList, PathText, Stat } from "@/components/app/data"
import { type Column, DataTable, SelectionBar, TableToolbar } from "@/components/app/data-table"
import { ActionError, DetailSkeleton, EmptyState, Notice, SaveState, TableSkeleton, UnknownValue } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section, StepIndicator } from "@/components/app/page"
import { STATUS, type StatusKind, StatusBadge, type StatusValue } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { emptyBreakdown, sessionBreakdown } from "@/domain/library"
import type { Session } from "@/domain/types"
import { formatDuration, formatExposure, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { CATALOGUE } from "./catalogue/registry"
import { useMessages } from "./preferences"

/** Each colour token with what it is for. */
function colorTokens(m: Messages): Array<[token: string, use: string]> {
  return [
    ["background", m.ds_color_background()],
    ["card", m.ds_color_card()],
    ["popover", m.ds_color_popover()],
    ["muted", m.ds_color_muted()],
    ["secondary", m.ds_color_secondary()],
    ["accent", m.ds_color_accent()],
    ["primary", m.ds_color_primary()],
    ["success", m.ds_color_success()],
    ["warning", m.ds_color_warning()],
    ["destructive", m.ds_color_destructive()],
    ["border", m.ds_color_border()],
  ]
}

/** Each type style with a sample line that names its use. */
function typeScale(m: Messages): Array<[className: string, sample: string]> {
  return [
    ["text-lg font-semibold", m.ds_type_page_title()],
    ["text-base font-semibold", m.ds_type_section_title()],
    ["text-sm font-semibold", m.ds_type_sub_section()],
    ["text-sm", m.ds_type_body()],
    ["text-xs text-muted-foreground", m.ds_type_meta()],
    ["font-mono text-xs", m.ds_type_mono({ path: "/Volumes/Astro-T7/Captures" })],
    ["text-sm tabular-nums", m.ds_type_numerals()],
  ]
}

/** Each z-index layer with what sits on it. */
function zScale(m: Messages): Array<[layer: string, use: string]> {
  return [
    ["z-0", m.ds_z_page()],
    ["z-1", m.ds_z_pinned_column()],
    ["z-10", m.ds_z_sticky_headers()],
    ["z-20", m.ds_z_shell()],
    ["z-30", m.ds_z_flyouts()],
    ["z-50", m.ds_z_portalled()],
  ]
}

function SessionTable({ loading, empty, grouped, pinned, locked }: { loading: boolean; empty: boolean; grouped: boolean; pinned: boolean; locked: boolean }) {
  const m = useMessages()
  const sessions = useStore((s) => Object.values(s.catalog.sessions).filter((x) => x.imageType === "light"))
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [selected, setSelected] = useState<string[]>([])
  const columns: Column<Session>[] = [
    { id: "night", header: m.run_col_night(), cell: (s) => formatNight(s.night), sortValue: (s) => s.night, rowHeader: true },
    { id: "channel", header: m.run_col_channel(), cell: (s) => s.channel ?? <UnknownValue label={m.palette_session_no_filter()} />, sortValue: (s) => s.channel },
    { id: "exposure", header: m.session_column_exposure(), cell: (s) => formatExposure(s.exposureS), sortValue: (s) => s.exposureS, align: "right" },
    { id: "frames", header: m.sessions_column_frames(), cell: (s) => s.assetIds.length, sortValue: (s) => s.assetIds.length, align: "right" },
    {
      id: "integration",
      header: m.run_col_integration(),
      cell: (s) => formatDuration(sessionBreakdown(disk, catalog, s).captured.seconds),
      sortValue: (s) => s.assetIds.length * s.exposureS,
      align: "right",
    },
    // OBJECT is the FITS header keyword, never translated.
    { id: "object", header: "OBJECT", cell: (s) => s.objectLabel ?? <UnknownValue label={m.palette_session_missing_object()} />, sortValue: (s) => s.objectLabel },
    { id: "target", header: m.sessions_column_target(), cell: (s) => <StatusBadge kind="association" value={s.target.status} /> },
    // Wide-table sample: the extra columns make the table scroll sideways at 1024px.
    ...(pinned
      ? ([
          { id: "camera", header: m.session_camera(), cell: (s) => s.cameraName ?? <UnknownValue label={m.status_not_set()} />, sortValue: (s) => s.cameraName },
          { id: "telescope", header: m.session_telescope(), cell: (s) => s.telescopeName ?? <UnknownValue label={m.status_not_set()} />, sortValue: (s) => s.telescopeName },
          { id: "gain", header: m.ds_col_gain_offset(), cell: (s) => `${s.gain ?? "–"} / ${s.offset ?? "–"}`, align: "right" },
          { id: "binning", header: m.domain_criterion_binning(), cell: (s) => `${s.binning}×${s.binning}`, align: "right" },
          { id: "equipment", header: m.settings_equipment(), cell: (s) => <StatusBadge kind="association" value={s.equipment.status} /> },
        ] satisfies Column<Session>[])
      : []),
  ]
  const [query, setQuery] = useState("")
  const shown = sessions.filter((s) => `${s.channel ?? ""} ${s.objectLabel ?? m.palette_session_missing_object()} ${formatNight(s.night)}`.toLowerCase().includes(query.toLowerCase()))
  const hidden = selected.filter((id) => !shown.some((s) => s.id === id)).length
  return (
    <div className="space-y-2">
      <TableToolbar search={{ label: m.sessions_filter(), placeholder: m.ds_filter_placeholder(), value: query, onChange: setQuery }} />
      <DataTable
        label={m.ds_table_label()}
        rows={empty ? [] : shown}
        columns={columns}
        getRowId={(s) => s.id}
        loading={loading}
        initialSort={{ columnId: "night", direction: "asc" }}
        groups={grouped ? { key: (s) => s.channel ?? m.palette_session_no_filter(), label: (channel, rows) => `${channel} · ${rows.length}` } : undefined}
        selection={{ selected, onChange: setSelected, rowLabel: (s) => m.ds_row_label({ night: formatNight(s.night), channel: s.channel ?? "" }) }}
        activeRowId={shown[0]?.id ?? null}
        empty={
          <EmptyState
            icon={Inbox}
            title={m.ds_empty_title()}
            description={m.ds_empty_description()}
            action={
              <Button size="sm" variant="outline">
                {m.filters_clear()}
              </Button>
            }
            className="border-0"
          />
        }
        stickyFirstColumn={pinned}
        contextMenu={(s) => [
          { heading: selected.length > 1 ? m.status_bar_selected({ count: selected.length }) : `${formatNight(s.night)} ${s.channel ?? ""}` },
          { label: selected.includes(s.id) ? m.ds_deselect() : m.review_select(), onSelect: () => setSelected(selected.includes(s.id) ? selected.filter((id) => id !== s.id) : [...selected, s.id]) },
          { separator: true },
          { label: m.selection_clear(), onSelect: () => setSelected([]), disabled: selected.length === 0 },
        ]}
      />
      <SelectionBar
        count={selected.length}
        hiddenByFilters={hidden}
        label={m.status_bar_selected({ count: selected.length })}
        onShowSelected={() => setQuery("")}
        onClear={() => setSelected([])}
        clearDisabledReason={locked ? m.ds_selection_locked() : undefined}
      />
    </div>
  )
}

function SampleOperation() {
  const m = useMessages()
  const locations = useStore((s) => Object.values(s.catalog.locations))
  const latest = useStore((s) => Object.values(s.operations).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  const [locationId, setLocationId] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label id="sample-op-label">{m.ds_op_location()}</Label>
          <Select items={locations.map((l) => ({ value: l.id, label: l.displayName }))} value={locationId} onValueChange={(value) => setLocationId(value as string)}>
            <SelectTrigger aria-labelledby="sample-op-label" className="w-64">
              <SelectValue placeholder={m.ds_op_choose_location()} />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={!locationId} aria-describedby={locationId ? undefined : "sample-op-reason"} onClick={() => locationId && startIndexing([locationId])}>
          <Play data-icon="inline-start" aria-hidden="true" />
          {m.setup_start_indexing()}
        </Button>
        {!locationId ? (
          <p id="sample-op-reason" className="pb-2 text-xs text-muted-foreground">
            {m.ds_op_choose_first()}
          </p>
        ) : null}
      </div>
      {locations.length === 0 ? <p className="text-sm text-muted-foreground">{m.ds_op_no_locations()}</p> : null}
      {latest ? <OperationPanel operationId={latest.id} /> : <p className="text-sm text-muted-foreground">{m.ds_op_none()}</p>}
    </div>
  )
}

function SampleFolderPicker() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        {m.ds_choose_folder_ellipsis()}
      </Button>
      {chosen ? <PathText path={chosen} className="text-muted-foreground" /> : <span className="text-sm text-muted-foreground">{m.ds_no_folder()}</span>}
      <FolderPicker open={open} onOpenChange={setOpen} title={m.location_role_captures_picker()} initialPath="/Volumes/Astro-T7" onChoose={(path) => setChosen(path)} />
    </div>
  )
}

type ChipId = "ha" | "object" | "unreviewed"

export function DesignSystemPage() {
  const m = useMessages()
  const [tableLoading, setTableLoading] = useState(false)
  const [tableEmpty, setTableEmpty] = useState(false)
  const [tableGrouped, setTableGrouped] = useState(false)
  const [tablePinned, setTablePinned] = useState(false)
  const [selectionLocked, setSelectionLocked] = useState(false)
  const [zoom, setZoom] = useState("fit")
  const [stretch, setStretch] = useState("auto")
  const [starsOn, setStarsOn] = useState(true)
  // Chip ids live in state; their labels are worded at render, so a language switch re-words them.
  const [chipIds, setChipIds] = useState<ChipId[]>(["ha", "object", "unreviewed"])
  const chipLabel: Record<ChipId, string> = {
    ha: m.ds_chip_channel({ channel: "Ha" }),
    object: m.palette_session_missing_object(),
    unreviewed: m.ds_chip_quality({ quality: m.status_unreviewed() }),
  }
  const chips = chipIds.map((id) => ({ id, label: chipLabel[id] }))
  const sample = useStore((s) => Object.values(s.catalog.sessions).find((x) => x.target.status === "needs-review") ?? Object.values(s.catalog.sessions)[0])
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const breakdown = sample ? sessionBreakdown(disk, catalog, sample) : emptyBreakdown()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={m.ds_title()} description={m.ds_description()} eyebrow={m.prototype_ds_eyebrow()} />
      <PageBody className="space-y-6">
        <Section title={m.ds_colour_title()} description={m.ds_colour_description()}>
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {colorTokens(m).map(([token, use]) => (
              <li key={token} className="flex items-center gap-3 rounded-lg border p-2">
                <span className="size-8 shrink-0 rounded-md border" style={{ background: `var(--${token})` }} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-mono text-xs">--{token}</span>
                  <span className="block text-xs text-muted-foreground">{use}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title={m.ds_type_title()}>
          <div className="grid gap-6 xl:grid-cols-2">
            <ul className="space-y-2">
              {typeScale(m).map(([cls, sample]) => (
                <li key={cls} className={cls}>
                  {sample}
                </li>
              ))}
            </ul>
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">{m.ds_spacing()}</p>
              <div className="flex items-end gap-3">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((r) => (
                  <div key={r} className="space-y-1 text-center text-xs text-muted-foreground">
                    <div className={`size-10 border bg-muted ${r}`} aria-hidden="true" />
                    {r}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground">{m.ds_row_height()}</p>
              <table className="w-full text-xs">
                <caption className="sr-only">{m.ds_z_caption()}</caption>
                <tbody>
                  {zScale(m).map(([z, use]) => (
                    <tr key={z} className="border-b last:border-0">
                      <th scope="row" className="py-1 pr-3 text-left font-mono font-normal whitespace-nowrap">
                        {z}
                      </th>
                      <td className="py-1 text-muted-foreground">{use}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        <Section title={m.ds_buttons_title()} description={m.ds_buttons_description()}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button>{m.setup_start_indexing()}</Button>
              <Button variant="outline">{m.location_choose_folder_again()}</Button>
              <Button variant="secondary">{m.ds_inspect_session()}</Button>
              <Button variant="ghost">{m.selection_show()}</Button>
              <Button variant="destructive">{m.ds_send_files_to_trash({ count: 14 })}</Button>
              <Button variant="link">{m.ds_reveal_location()}</Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button disabled aria-describedby="ds-prepare-reason">
                {m.ds_prepare_view()}
              </Button>
              <p id="ds-prepare-reason" className="text-xs text-muted-foreground">
                {m.ds_prepare_disabled({ count: 2 })}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* Loading is not disabled-looking: full opacity, busy, not clickable twice. */}
              <Button aria-busy="true" aria-disabled="true" className="pointer-events-none">
                <Spinner data-icon="inline-start" aria-hidden="true" />
                {m.status_saving()}
              </Button>
              <p className="text-xs text-muted-foreground">{m.ds_loading_vs_disabled()}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup value={[zoom]} onValueChange={(value) => value[0] && setZoom(value[0])} variant="outline" size="sm" spacing={0} aria-label={m.review_zoom()}>
                <ToggleGroupItem value="fit">{m.review_zoom_fit()}</ToggleGroupItem>
                <ToggleGroupItem value="1">1:1</ToggleGroupItem>
                <ToggleGroupItem value="2">2:1</ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup value={[stretch]} onValueChange={(value) => value[0] && setStretch(value[0])} variant="outline" size="sm" aria-label={m.review_display_stretch()}>
                <ToggleGroupItem value="linear">{m.review_stretch_linear()}</ToggleGroupItem>
                <ToggleGroupItem value="auto">{m.review_stretch_auto()}</ToggleGroupItem>
                <ToggleGroupItem value="strong">{m.review_stretch_strong()}</ToggleGroupItem>
              </ToggleGroup>
              <Toggle variant="outline" size="sm" pressed={starsOn} onPressedChange={setStarsOn}>
                <Sparkles aria-hidden="true" data-icon="inline-start" />
                {m.review_tab_stars()}
              </Toggle>
            </div>
          </div>
        </Section>

        <Section title={m.ds_status_title()} description={m.ds_status_description()}>
          <div className="space-y-3">
            {(Object.keys(STATUS) as StatusKind[]).map((kind) => (
              <div key={kind} className="grid grid-cols-[9rem_1fr] items-start gap-3">
                <span className="pt-0.5 font-mono text-xs text-muted-foreground">{kind}</span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(STATUS[kind]) as StatusValue<typeof kind>[]).map((value) => (
                    <StatusBadge key={value} kind={kind} value={value} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title={m.ds_feedback_title()}>
          <div className="grid gap-4 xl:grid-cols-2">
            <EmptyState
              icon={Inbox}
              title={m.targets_empty()}
              description={m.ds_targets_empty_description()}
              action={<Button size="sm">{m.location_role_captures_add()}</Button>}
            />
            <div className="space-y-3">
              <Notice
                tone="offline"
                title={m.run_cleanup_volume_offline({ name: "Cold-1" })}
                actions={
                  <Button size="sm" variant="outline">
                    {m.ds_reconnect()}
                  </Button>
                }
              >
                {m.ds_offline_body({ night: formatNight("2026-09-12") })}
              </Notice>
              <Notice tone="warning" title={m.ds_scan_incomplete_title()}>
                {m.ds_scan_incomplete_body({ path: "/Volumes/Astro-T7/Imaging/M33/2026-08-30" })}
              </Notice>
              <Notice
                tone="refusal"
                title={m.run_cant_prepare()}
                actions={
                  <Button size="sm" variant="outline">
                    {m.run_use_copies()}
                  </Button>
                }
              >
                {m.ds_symlinks_body()}
              </Notice>
              <Notice tone="info" title={m.ds_provisional_title()}>
                {m.ds_provisional_body({ volume: "Astro-T7" })}
              </Notice>
            </div>
            <div className="space-y-3">
              <ActionError message={m.store_not_saved_message({ label: m.ds_target_correction() })} onRetry={() => undefined} />
              <SaveState state="saved" />
              <SaveState state="unsaved" />
              <SaveState state="saving" />
              <SaveState state="failed" onRetry={() => undefined} message={m.ds_save_failed()} />
              <SaveState state="stale" onReview={() => undefined} message={m.ds_save_stale({ from: 3, to: 4 })} />
              <p className="text-sm">
                {m.run_col_distance()}: <UnknownValue label={m.project_search_position_unknown()} reason={m.indexing_pointing_none()} /> · {m.measure_metric_fwhm()}: <UnknownValue label={m.status_not_measured()} />
              </p>
            </div>
            <div className="grid gap-3">
              <TableSkeleton label={m.ds_loading_sessions()} rows={4} />
              <DetailSkeleton label={m.ds_loading_session_detail()} />
            </div>
          </div>
        </Section>

        <Section title={m.ds_data_title()}>
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
              <KeyValueList
                items={[
                  { label: m.location_path(), value: <PathText path="/Volumes/Astro-T7/Captures/NGC7000/2026-09-30/OIII" />, mono: false },
                  { label: m.run_col_channel(), value: "OIII", source: m.session_header_source({ keyword: "FILTER" }) },
                  { label: m.session_column_exposure(), value: formatExposure(300), source: m.session_header_source({ keyword: "EXPTIME" }) },
                  { label: m.ds_pixel_scale(), value: <UnknownValue label={m.ds_fov_unknown()} reason={m.ds_equipment_not_confirmed()} /> },
                ]}
              />
              <div className="flex gap-8">
                <Stat label={m.review_member_included()} value={m.ds_lights_count({ count: 208 })} hint={formatDuration(62_400)} />
                <Stat label={m.status_excluded_from_view()} value="6" hint={m.ds_files_stay()} />
                <Stat label={m.status_unresolved()} value="0" />
              </div>
              <ChannelCoverage channel={sample?.channel ?? "Ha"} breakdown={breakdown} goalS={10 * 3600} />
            </div>
            <div className="space-y-3">
              {sample ? <EvidenceList evidence={sample.target.evidence} caption={m.ds_evidence_caption()} /> : null}
              <FilterChips
                chips={chips}
                onRemove={(id) => setChipIds((ids) => ids.filter((chip) => chip !== id))}
                onClear={() => setChipIds([])}
                matchLabel={`${m.ds_matching_sessions({ count: 1 })} · ${m.selection_outside_filters({ count: 3 })}`}
              />
              <StepIndicator
                label={m.ds_cleanup_steps()}
                steps={[
                  { id: "choose", label: m.ds_cleanup_choose() },
                  { id: "review", label: m.ds_cleanup_review() },
                  { id: "trash", label: m.ds_cleanup_trash() },
                ]}
                current="review"
                completed={["choose"]}
              />
            </div>
          </div>
        </Section>

        <Section
          title={m.ds_table_title()}
          description={m.ds_table_description()}
          actions={
            <>
              <Button size="sm" variant="outline" aria-pressed={tableLoading} onClick={() => setTableLoading((v) => !v)}>
                {m.ds_table_loading()}
              </Button>
              <Button size="sm" variant="outline" aria-pressed={tableEmpty} onClick={() => setTableEmpty((v) => !v)}>
                {m.ds_table_empty()}
              </Button>
              <Button size="sm" variant="outline" aria-pressed={tableGrouped} onClick={() => setTableGrouped((v) => !v)}>
                {m.ds_table_grouped()}
              </Button>
              <Button size="sm" variant="outline" aria-pressed={tablePinned} onClick={() => setTablePinned((v) => !v)}>
                {m.ds_table_pinned()}
              </Button>
              <Button size="sm" variant="outline" aria-pressed={selectionLocked} onClick={() => setSelectionLocked((v) => !v)}>
                {m.ds_table_lock()}
              </Button>
            </>
          }
        >
          <SessionTable loading={tableLoading} empty={tableEmpty} grouped={tableGrouped} pinned={tablePinned} locked={selectionLocked} />
        </Section>

        <Section title={m.ds_confirm_title()} description={m.ds_confirm_description()}>
          <ConfirmDialog
            trigger={<Button variant="outline">{m.ds_confirm_trigger()}</Button>}
            title={m.ds_confirm_dialog_title({ count: 208 })}
            description={m.ds_confirm_dialog_description()}
            changes={[m.ds_confirm_change_frames({ count: 208 }), m.ds_confirm_change_integration({ target: "NGC 7000", duration: formatDuration(62_400) })]}
            unchanged={[m.ds_confirm_unchanged_files(), m.ds_confirm_unchanged_views(), m.ds_confirm_unchanged_rejections()]}
            confirmLabel={m.ds_confirm_label({ count: 208 })}
            onConfirm={() => undefined}
          />
        </Section>

        <Section title={m.ds_folder_picker_title()} description={m.simulation_ds_folder_picker_description()}>
          <SampleFolderPicker />
        </Section>

        <Section title={m.ds_operation_title()} description={m.ds_operation_description()}>
          <SampleOperation />
        </Section>

        {CATALOGUE.map(({ id, Entry }) => (
          <Entry key={id} />
        ))}
      </PageBody>
    </div>
  )
}
