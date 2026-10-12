/**
 * Catalogue entry: DataTable, FilterBar and the table parts (plan P4, P5).
 * One table over the seed's light sessions shows every DataTable feature at
 * once: sortable and static columns, the toolbar slot with search, a single
 * and a multi facet, Presets ▾ (built-in, unavailable, saved; Save current…
 * and Delete), selection with batch actions (one unavailable, one
 * confirmed, two under More), row actions (inline primary, ⋯, context
 * menu), expand with a nested table, and the loading, empty and error
 * states. Reviewer controls switch density, the wide pinned layout and the
 * states; the shift line measures how far the table moved when the
 * selection last appeared or went (it must read 0 px).
 *
 * Component content uses real copy (m.*); reviewer captions are plain
 * English (this folder is outside the i18n gate).
 */
import { Inbox } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { Action, Column, Facet, MenuItem, Preset } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { FilterBar, type FacetPatch } from "@/components/app/filter-bar"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Asset, Session } from "@/domain/types"
import { formatBytes, formatDuration, formatExposure, formatNight } from "@/lib/format"
import { useStore } from "@/store/core"

type Density = "compact" | "comfortable" | "spacious"

interface Filters {
  channel: string
  exposure: string[]
}

interface SavedPreset extends Preset {
  filters: Filters
}

const NO_FILTERS: Filters = { channel: "", exposure: [] }

const sameFilters = (a: Filters, b: Filters) => a.channel === b.channel && a.exposure.length === b.exposure.length && a.exposure.every((value) => b.exposure.includes(value))

const sessionName = (s: Session) => `${formatNight(s.night)} ${s.channel ?? "–"}`

function distinct<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function DataTableCatalogue() {
  const m = useMessages()
  const sessions = useStore((s) => Object.values(s.catalog.sessions).filter((x) => x.imageType === "light" && x.supersededBy === null))
  const assets = useStore((s) => s.catalog.assets)
  const [density, setDensity] = useState<Density>("comfortable")
  const [wide, setWide] = useState(false)
  const [state, setState] = useState<"rows" | "loading" | "empty" | "error">("rows")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [saved, setSaved] = useState<SavedPreset[]>([{ id: "saved-long", label: "Long subs", source: "custom", filters: { channel: "", exposure: ["300"] } }])
  const [selected, setSelected] = useState<string[]>([])
  const [trashed, setTrashed] = useState<string[]>([])
  const [lastAction, setLastAction] = useState<string | null>(null)

  const live = sessions.filter((s) => !trashed.includes(s.id))
  const channels = distinct(live.map((s) => s.channel ?? "–")).sort()
  const exposures = distinct(live.map((s) => s.exposureS)).sort((a, b) => a - b)
  const shown = live.filter(
    (s) =>
      (filters.channel === "" || (s.channel ?? "–") === filters.channel) &&
      (filters.exposure.length === 0 || filters.exposure.includes(String(s.exposureS))) &&
      `${sessionName(s)} ${s.objectLabel ?? ""} ${s.cameraName ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const facets: Facet[] = [
    {
      id: "channel",
      label: m.run_col_channel(),
      kind: "single",
      value: filters.channel,
      options: channels.map((channel) => ({ value: channel, label: channel, count: live.filter((s) => (s.channel ?? "–") === channel).length })),
    },
    {
      id: "exposure",
      label: m.session_column_exposure(),
      kind: "multi",
      value: filters.exposure,
      options: exposures.map((seconds) => ({ value: String(seconds), label: formatExposure(seconds), count: live.filter((s) => s.exposureS === seconds).length })),
    },
  ]
  const builtIn: SavedPreset[] = [
    ...channels.map((channel): SavedPreset => ({ id: `channel:${channel}`, label: channel, source: "builtin", filters: { channel, exposure: [] } })),
    ...(channels.includes("SII") ? [] : [{ id: "channel:SII", label: "SII", source: "builtin" as const, unavailable: m.targets_saved_needs_rig({ name: "SII" }), filters: { channel: "SII", exposure: [] } }]),
  ]
  const presets = [...builtIn, ...saved]
  const activePreset = presets.find((preset) => preset.unavailable === undefined && sameFilters(preset.filters, filters))?.id ?? null
  const onFacets = (patch: FacetPatch) =>
    setFilters((current) => ({
      channel: typeof patch.channel === "string" ? patch.channel : current.channel,
      exposure: Array.isArray(patch.exposure) ? patch.exposure : current.exposure,
    }))

  const note = (action: string, count: number) => setLastAction(`${action} · ${count} row(s)`)
  const trash = (ids: string[]): Action => ({
    id: "trash",
    label: m.run_move_to_trash(),
    kind: "destructive",
    confirm: {
      title: m.project_run_trash_title({ name: m.session_count({ count: ids.length }) }),
      groups: [{ label: m.session_count({ count: ids.length }), rows: [] }],
      confirm: { label: m.run_move_to_trash(), kind: "destructive" },
    },
    run: () => {
      setTrashed((current) => [...current, ...ids])
      setSelected((current) => current.filter((id) => !ids.includes(id)))
      note(m.run_move_to_trash(), ids.length)
      return { ok: true }
    },
  })
  const rowActions = (s: Session): MenuItem[] => [
    { id: "open", label: m.verb_open(), run: () => note(m.verb_open(), 1) },
    { id: "review", label: m.verb_review(), run: () => note(m.verb_review(), 1) },
    { separator: true },
    { id: "add", label: m.session_add_to_project(), run: () => note(m.session_add_to_project(), 1) },
    { separator: true },
    trash([s.id]),
  ]
  const batchActions = (ids: string[]): Action[] => {
    const needsReview = ids.filter((id) => live.find((s) => s.id === id)?.target.status === "needs-review").length
    return [
      { id: "add", label: m.session_add_to_project(), run: () => note(m.session_add_to_project(), ids.length) },
      {
        id: "archive",
        label: m.status_role_archive(),
        run: () => note(m.status_role_archive(), ids.length),
        unavailable: needsReview > 0 ? { action: m.sessions_cant_archive(), reason: m.status_needs_review(), blockers: [] } : undefined,
      },
      trash(ids),
      { id: "open", label: m.verb_open(), run: () => note(m.verb_open(), ids.length) },
      { id: "review", label: m.verb_review(), run: () => note(m.verb_review(), ids.length) },
    ]
  }

  const columns: Column<Session>[] = [
    { id: "night", header: m.run_col_night(), cell: (s) => formatNight(s.night), sortValue: (s) => s.night, rowHeader: true },
    { id: "channel", header: m.run_col_channel(), cell: (s) => s.channel ?? "–", sortValue: (s) => s.channel },
    { id: "exposure", header: m.session_column_exposure(), cell: (s) => formatExposure(s.exposureS), sortValue: (s) => s.exposureS, align: "right" },
    { id: "frames", header: m.run_col_frames(), cell: (s) => s.assetIds.length, sortValue: (s) => s.assetIds.length, align: "right" },
    { id: "integration", header: m.run_col_integration(), cell: (s) => formatDuration(s.assetIds.length * s.exposureS), sortValue: (s) => s.assetIds.length * s.exposureS, align: "right" },
    { id: "camera", header: m.project_col_camera(), cell: (s) => s.cameraName ?? "–", sortValue: (s) => s.cameraName, truncate: true },
    { id: "target", header: m.sessions_column_target(), cell: (s) => <StatusBadge kind="association" value={s.target.status} />, static: true },
    ...(wide
      ? ([
          { id: "telescope", header: m.equipment_telescope(), cell: (s) => s.telescopeName ?? "–", sortValue: (s) => s.telescopeName },
          { id: "gain", header: m.domain_criterion_gain(), cell: (s) => s.gain ?? "–", sortValue: (s) => s.gain, align: "right" },
          { id: "binning", header: m.domain_criterion_binning(), cell: (s) => `${s.binning}×${s.binning}`, sortValue: (s) => s.binning, align: "right" },
        ] satisfies Column<Session>[])
      : []),
  ]
  const frameColumns: Column<Asset>[] = [
    { id: "file", header: m.run_col_file(), cell: (a) => a.fileName, sortValue: (a) => a.fileName, rowHeader: true, truncate: true },
    { id: "size", header: m.run_col_size(), cell: (a) => formatBytes(a.sizeBytes), sortValue: (a) => a.sizeBytes, align: "right" },
    { id: "quality", header: m.session_column_quality(), cell: (a) => <StatusBadge kind="quality" value={a.quality.value} />, static: true },
  ]

  // Where the table sits under the toolbar slot, measured when the selection appears or goes.
  const host = useRef<HTMLDivElement>(null)
  const tableTop = useRef<number | null>(null)
  const [shift, setShift] = useState<number | null>(null)
  const selecting = selected.length > 0
  useLayoutEffect(() => {
    const table = host.current?.querySelector("table")
    if (!host.current || !table) return
    const top = table.getBoundingClientRect().top - host.current.getBoundingClientRect().top
    if (tableTop.current !== null) setShift(Math.round(top - tableTop.current))
    tableTop.current = top
  }, [selecting])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <ToggleGroup aria-label="Density" variant="outline" size="sm" spacing={0} value={[density]} onValueChange={(value) => value[0] && setDensity(value[0] as Density)}>
          <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
          <ToggleGroupItem value="comfortable">Comfortable</ToggleGroupItem>
          <ToggleGroupItem value="spacious">Spacious</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup aria-label="Table state" variant="outline" size="sm" spacing={0} value={[state]} onValueChange={(value) => value[0] && setState(value[0] as typeof state)}>
          <ToggleGroupItem value="rows">Rows</ToggleGroupItem>
          <ToggleGroupItem value="loading">Loading</ToggleGroupItem>
          <ToggleGroupItem value="empty">Empty</ToggleGroupItem>
          <ToggleGroupItem value="error">Error</ToggleGroupItem>
        </ToggleGroup>
        <Toggle variant="outline" size="sm" pressed={wide} onPressedChange={setWide}>
          Wide, pinned columns
        </Toggle>
        <Button variant="outline" size="sm" onClick={() => setTrashed([])} disabled={trashed.length === 0}>
          Restore trashed sample rows
        </Button>
      </div>
      <div className="space-y-1 text-xs text-muted-foreground">
        <p data-testid="catalogue-shift">Table moved {shift ?? 0} px when the selection last appeared or went.</p>
        <p>Last action: {lastAction ?? "none"}. The Target column is static (no sort); Camera truncates and shows its full text on hover only when cut.</p>
      </div>
      <div ref={host} data-density={density}>
        <DataTable
          label="Light sessions (catalogue sample)"
          rows={state === "empty" ? [] : shown}
          columns={columns}
          getRowId={(s) => s.id}
          rowLabel={sessionName}
          initialSort={{ columnId: "night", direction: "asc" }}
          loading={state === "loading"}
          error={state === "error" ? { message: m.store_record_missing(), onRetry: () => setState("rows") } : undefined}
          empty={
            <EmptyState
              icon={Inbox}
              title={m.sessions_no_match()}
              description={null}
              action={
                <Button size="sm" variant="outline" onClick={() => setState("rows")}>
                  {m.filters_clear()}
                </Button>
              }
              className="border-0"
            />
          }
          stickyFirstColumn={wide}
          toolbar={{
            search: { label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: setQuery },
            facets: { items: facets, onChange: onFacets },
            presets: {
              items: presets,
              active: activePreset,
              apply: (id) => setFilters(presets.find((preset) => preset.id === id)?.filters ?? NO_FILTERS),
              save: (name) => setSaved((current) => [...current, { id: `saved-${current.length}-${name}`, label: name, source: "custom", filters }]),
              remove: (id) => setSaved((current) => current.filter((preset) => preset.id !== id)),
            },
            actions: [{ id: "import", label: m.shell_import(), opensDialog: true, run: () => note(m.shell_import(), 0) }],
          }}
          selection={{
            selected,
            onChange: setSelected,
            rowLabel: sessionName,
            onShowHidden: () => {
              setQuery("")
              setFilters(NO_FILTERS)
            },
          }}
          batchActions={batchActions}
          rowActions={rowActions}
          primaryRowAction={(s) => (s.target.status === "needs-review" ? { id: "review", label: m.verb_review(), kind: "primary", run: () => note(m.verb_review(), 1) } : null)}
          expand={{
            render: (s) => (
              <DataTable
                label={sessionName(s)}
                rows={s.assetIds.flatMap((id) => (assets[id] ? [assets[id]] : []))}
                columns={frameColumns}
                getRowId={(a) => a.id}
                scroll="none"
                className="max-w-2xl"
              />
            ),
            isExpandable: (s) => s.assetIds.length > 0,
            defaultExpanded: live.slice(0, 1).map((s) => s.id),
          }}
        />
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">FilterBar outside a table</h3>
        <p className="text-xs text-muted-foreground">The same controlled filters for a list that is not a table: the controls row and the chip line under it.</p>
        <FilterBar
          search={{ label: m.sessions_search(), placeholder: m.sessions_search_placeholder(), value: query, onChange: setQuery }}
          facets={{ items: facets, onChange: onFacets }}
          matchCount={shown.length}
        />
      </div>
    </div>
  )
}
