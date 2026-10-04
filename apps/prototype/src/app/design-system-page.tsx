/**
 * Design-system reference (foundation-owned route `/design-system`).
 * Renders the tokens and every shared app component in its applicable
 * states, using live prototype data where a component reads the store.
 * Tracks use it as the visual contract; reviewers use it as evidence.
 */
import { Inbox, Play } from "lucide-react"
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
import { emptyBreakdown, sessionBreakdown } from "@/domain/derive"
import type { Session } from "@/domain/types"
import { formatDuration, formatExposure, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"

const COLOR_TOKENS = [
  ["background", "Page canvas"],
  ["card", "Raised surface, tables"],
  ["popover", "Menus, dialogs"],
  ["muted", "Quiet fill, skeletons"],
  ["secondary", "Neutral badges, chips"],
  ["accent", "Hover and highlight surface"],
  ["primary", "The one accent: primary action, selection, focus"],
  ["success", "Usable, verified, prepared"],
  ["warning", "Needs review, offline, partial"],
  ["destructive", "Failed, refused, blocked, destructive action"],
  ["border", "Dividers and outlines"],
] as const

const TYPE_SCALE = [
  ["text-lg font-semibold", "Page title (h1) · 18/28"],
  ["text-base font-semibold", "Section title (h2) · 16/24"],
  ["text-sm font-semibold", "Sub-section (h3) · 14/20"],
  ["text-sm", "Body and controls · 14/20"],
  ["text-xs text-muted-foreground", "Meta, captions, table headers · 12/16"],
  ["font-mono text-xs", "/Volumes/Astro-T7/Captures · paths, hashes"],
  ["text-sm tabular-nums", "208 lights · 17h 20m · 300 s (tabular numerals)"],
] as const

const Z_SCALE = [
  ["z-0", "Page content"],
  ["z-10", "Sticky table headers"],
  ["z-20", "Shell chrome (header)"],
  ["z-30", "Non-modal flyouts anchored to the shell"],
  ["z-50", "Portalled layers: dialogs, sheets, menus, popovers, tooltips (DOM order decides)"],
] as const

function SessionTable({ loading, empty, grouped }: { loading: boolean; empty: boolean; grouped: boolean }) {
  const sessions = useStore((s) => Object.values(s.catalog.sessions).filter((x) => x.imageType === "light"))
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const [selected, setSelected] = useState<string[]>([])
  const columns: Column<Session>[] = [
    { id: "night", header: "Night", cell: (s) => formatNight(s.night), sortValue: (s) => s.night, rowHeader: true },
    { id: "channel", header: "Channel", cell: (s) => s.channel ?? <UnknownValue label="No filter" />, sortValue: (s) => s.channel },
    { id: "exposure", header: "Exposure", cell: (s) => formatExposure(s.exposureS), sortValue: (s) => s.exposureS, align: "right" },
    { id: "frames", header: "Frames", cell: (s) => s.assetIds.length, sortValue: (s) => s.assetIds.length, align: "right" },
    {
      id: "integration",
      header: "Integration",
      cell: (s) => formatDuration(sessionBreakdown(disk, catalog, s).captured.seconds),
      sortValue: (s) => s.assetIds.length * s.exposureS,
      align: "right",
    },
    { id: "object", header: "OBJECT", cell: (s) => s.objectLabel ?? <UnknownValue label="Missing OBJECT" />, sortValue: (s) => s.objectLabel },
    { id: "target", header: "Target", cell: (s) => <StatusBadge kind="association" value={s.target.status} /> },
  ]
  const [query, setQuery] = useState("")
  const shown = sessions.filter((s) => `${s.channel ?? ""} ${s.objectLabel ?? "Missing OBJECT"} ${formatNight(s.night)}`.toLowerCase().includes(query.toLowerCase()))
  const hidden = selected.filter((id) => !shown.some((s) => s.id === id)).length
  return (
    <div className="space-y-2">
      <TableToolbar search={{ label: "Filter sessions", placeholder: "Filter by channel, OBJECT or night", value: query, onChange: setQuery }} />
      <SelectionBar
        count={selected.length}
        hiddenByFilters={hidden}
        noun="session"
        onShowSelected={() => setQuery("")}
        onClear={() => setSelected([])}
      />
      <DataTable
        label="Light sessions (design-system sample)"
        rows={empty ? [] : shown}
        columns={columns}
        getRowId={(s) => s.id}
        loading={loading}
        initialSort={{ columnId: "night", direction: "asc" }}
        groups={
          grouped
            ? { key: (s) => s.channel ?? "No filter", label: (channel, rows) => `${channel} · ${plural(rows.length, "session")}` }
            : undefined
        }
        selection={{ selected, onChange: setSelected, rowLabel: (s) => `${formatNight(s.night)} ${s.channel ?? ""} session` }}
        activeRowId={shown[0]?.id ?? null}
        empty={
          <EmptyState
            icon={Inbox}
            title="No sessions match these filters"
            description="Filters change the list, not the selection. Clear them to see every session."
            action={<Button size="sm" variant="outline">Clear filters</Button>}
            className="border-0"
          />
        }
      />
    </div>
  )
}

function SampleOperation() {
  const locations = useStore((s) => Object.values(s.catalog.locations))
  const latest = useStore((s) => Object.values(s.operations).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0])
  const [locationId, setLocationId] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label id="sample-op-label">Location to index (indexing never changes files)</Label>
          <Select items={locations.map((l) => ({ value: l.id, label: l.displayName }))} value={locationId} onValueChange={(value) => setLocationId(value as string)}>
            <SelectTrigger aria-labelledby="sample-op-label" className="w-64">
              <SelectValue placeholder="Choose a location" />
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
          Start indexing
        </Button>
        {!locationId ? (
          <p id="sample-op-reason" className="pb-2 text-xs text-muted-foreground">
            Choose a location first.
          </p>
        ) : null}
      </div>
      {locations.length === 0 ? <p className="text-sm text-muted-foreground">Register a location first; this library has none.</p> : null}
      {latest ? <OperationPanel operationId={latest.id} /> : <p className="text-sm text-muted-foreground">No operation has run yet.</p>}
    </div>
  )
}

function SampleFolderPicker() {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" onClick={() => setOpen(true)}>
        Choose a folder…
      </Button>
      {chosen ? <PathText path={chosen} className="text-muted-foreground" /> : <span className="text-sm text-muted-foreground">No folder chosen yet.</span>}
      <FolderPicker
        open={open}
        onOpenChange={setOpen}
        title="Choose a capture folder"
        initialPath="/Volumes/Astro-T7"
        onChoose={(path) => setChosen(path)}
      />
    </div>
  )
}

export function DesignSystemPage() {
  const [tableLoading, setTableLoading] = useState(false)
  const [tableEmpty, setTableEmpty] = useState(false)
  const [tableGrouped, setTableGrouped] = useState(false)
  const [chips, setChips] = useState([
    { id: "ha", label: "Channel: Ha" },
    { id: "object", label: "Missing OBJECT" },
    { id: "unreviewed", label: "Quality: Unreviewed" },
  ])
  const sample = useStore((s) => Object.values(s.catalog.sessions).find((x) => x.target.status === "needs-review") ?? Object.values(s.catalog.sessions)[0])
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const breakdown = sample ? sessionBreakdown(disk, catalog, sample) : emptyBreakdown()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Design system reference"
        description="Tokens and shared components in their states. Foundation-owned; tracks compose these instead of styling ad hoc."
        eyebrow="Foundation · prototype reference"
      />
      <PageBody className="space-y-6">
        <Section title="Colour roles" description="Neutral base, one accent. Switch the theme from the header to check both.">
          <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {COLOR_TOKENS.map(([token, use]) => (
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

        <Section title="Type, spacing, radius, density, layers">
          <div className="grid gap-6 xl:grid-cols-2">
            <ul className="space-y-2">
              {TYPE_SCALE.map(([cls, sample]) => (
                <li key={sample} className={cls}>
                  {sample}
                </li>
              ))}
            </ul>
            <div className="space-y-4 text-sm">
              <p className="text-muted-foreground">Spacing uses the Tailwind 4 px scale: control gap 2, card padding 4, page padding 6 × 5, section gap 6.</p>
              <div className="flex items-end gap-3">
                {["rounded-sm", "rounded-md", "rounded-lg", "rounded-xl"].map((r) => (
                  <div key={r} className="space-y-1 text-center text-xs text-muted-foreground">
                    <div className={`size-10 border bg-muted ${r}`} aria-hidden="true" />
                    {r}
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground">Row height token --row-h: compact 28 px, comfortable 32 px (default), spacious 40 px (Settings › Appearance).</p>
              <table className="w-full text-xs">
                <caption className="sr-only">Z-index scale</caption>
                <tbody>
                  {Z_SCALE.map(([z, use]) => (
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

        <Section title="Buttons" description="Default, focus-visible (Tab to a button), active (press), disabled with a reason, and loading.">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button>Start indexing</Button>
              <Button variant="outline">Choose folder again</Button>
              <Button variant="secondary">Inspect session</Button>
              <Button variant="ghost">Show selected</Button>
              <Button variant="destructive">Send 14 files to Trash</Button>
              <Button variant="link">Reveal location</Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button disabled aria-describedby="ds-prepare-reason">
                Prepare View
              </Button>
              <p id="ds-prepare-reason" className="text-xs text-muted-foreground">
                Disabled: accept or resolve 2 calibration suggestions first.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* Loading is not disabled-looking: full opacity, busy, not clickable twice. */}
              <Button aria-busy="true" aria-disabled="true" className="pointer-events-none">
                <Spinner data-icon="inline-start" aria-hidden="true" />
                Saving
              </Button>
              <p className="text-xs text-muted-foreground">Loading: full opacity with a spinner and aria-busy; disabled: 50% opacity with its reason beside it.</p>
            </div>
          </div>
        </Section>

        <Section title="Status vocabulary" description="Every domain state: icon plus label, never colour alone.">
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

        <Section title="Feedback states">
          <div className="grid gap-4 xl:grid-cols-2">
            <EmptyState
              icon={Inbox}
              title="No Targets yet"
              description="Targets appear when indexing finds OBJECT or pointing evidence. Index a capture location to begin."
              action={<Button size="sm">Add capture location</Button>}
            />
            <div className="space-y-3">
              <Notice tone="offline" title="Cold-1 is offline" actions={<Button size="sm" variant="outline">Reconnect</Button>}>
                12 Sep counts in captured integration with last-observed values. It is not offered as an available input.
              </Notice>
              <Notice tone="warning" title="Scan scope is incomplete">
                Access denied: /Volumes/Astro-T7/Imaging/M33/2026-08-30. Files there are unknown, not missing.
              </Notice>
              <Notice tone="refusal" title="Direct source refused" actions={<Button size="sm" variant="outline">Review Copy or Clone</Button>}>
                SETI Astro Suite Pro consumes the whole folder, which contains 6 excluded frames.
              </Notice>
              <Notice tone="info" title="Totals are provisional">Indexing is still running; totals cover Astro-T7 captures only.</Notice>
            </div>
            <div className="space-y-3">
              <ActionError message="Target correction not saved: the catalog write failed. Your change is kept; choose Retry." onRetry={() => undefined} />
              <SaveState state="saved" />
              <SaveState state="unsaved" />
              <SaveState state="saving" />
              <SaveState state="failed" onRetry={() => undefined} message="The catalog write failed. The edit is still on screen." />
              <SaveState state="stale" onReview={() => undefined} message="This Project changed since you opened it (revision 3 → 4)." />
              <p className="text-sm">
                Distance: <UnknownValue label="Position unknown" reason="No pointing in header" /> · FWHM: <UnknownValue label="Not measured" />
              </p>
            </div>
            <div className="grid gap-3">
              <TableSkeleton label="Loading sessions" rows={4} />
              <DetailSkeleton label="Loading session detail" />
            </div>
          </div>
        </Section>

        <Section title="Data display">
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-4">
              <KeyValueList
                items={[
                  { label: "Path", value: <PathText path="/Volumes/Astro-T7/Captures/NGC7000/2026-09-30/OIII" />, mono: false },
                  { label: "Channel", value: "OIII", source: "Header FILTER" },
                  { label: "Exposure", value: "300 s", source: "Header EXPTIME" },
                  { label: "Pixel scale", value: <UnknownValue label="FOV unknown" reason="Equipment not confirmed" /> },
                ]}
              />
              <div className="flex gap-8">
                <Stat label="Included" value="208 lights" hint="17h 20m" />
                <Stat label="Excluded from View" value="6" hint="Files stay on disk" />
                <Stat label="Unresolved" value="0" />
              </div>
              <ChannelCoverage channel={sample?.channel ?? "Ha"} breakdown={breakdown} goalS={10 * 3600} />
            </div>
            <div className="space-y-3">
              {sample ? <EvidenceList evidence={sample.target.evidence} caption="Target association evidence" /> : null}
              <FilterChips
                chips={chips}
                onRemove={(id) => setChips((c) => c.filter((chip) => chip.id !== id))}
                onClear={() => setChips([])}
                matchLabel="1 matching session · Selected outside current filters: 3"
              />
              <StepIndicator
                label="Cleanup steps"
                steps={[
                  { id: "choose", label: "Choose files" },
                  { id: "review", label: "Review cleanup" },
                  { id: "trash", label: "Send to Trash" },
                ]}
                current="review"
                completed={["choose"]}
              />
            </div>
          </div>
        </Section>

        <Section
          title="Data table"
          description="Sort, select, ↑/↓ between rows. Selection is controlled by the caller and survives filtering. Groups are header rows in one table, so columns line up across groups."
          actions={
            <>
              <Button size="sm" variant="outline" aria-pressed={tableLoading} onClick={() => setTableLoading((v) => !v)}>
                Loading state
              </Button>
              <Button size="sm" variant="outline" aria-pressed={tableEmpty} onClick={() => setTableEmpty((v) => !v)}>
                Empty state
              </Button>
              <Button size="sm" variant="outline" aria-pressed={tableGrouped} onClick={() => setTableGrouped((v) => !v)}>
                Group by channel
              </Button>
            </>
          }
        >
          <SessionTable loading={tableLoading} empty={tableEmpty} grouped={tableGrouped} />
        </Section>

        <Section title="Confirmation" description="Destructive or scope-changing actions always confirm in an AlertDialog that names the scope.">
          <ConfirmDialog
            trigger={<Button variant="outline">Mark included frames usable</Button>}
            title="Mark 208 included frames Usable in the library?"
            description="This is a library-scope quality decision."
            changes={["208 frames become Usable in the library", "NGC 7000 usable integration rises by 17h 20m"]}
            unchanged={["Source files and headers", "Other Views and their membership", "Project rejections"]}
            confirmLabel="Mark 208 frames usable"
            onConfirm={() => undefined}
          />
        </Section>

        <Section title="Folder picker" description="Simulated OS folder chooser. Volumes and folders, including empty ones, come from the simulated disk; offline volumes and denied folders show why.">
          <SampleFolderPicker />
        </Section>

        <Section title="Operation" description="Running with progress, per-item outcomes and one settled status. Uses a real indexing run.">
          <SampleOperation />
        </Section>
      </PageBody>
    </div>
  )
}
