/**
 * Observing plans (spec 072; J29): the Target Plan area (B3, K) and the Plans
 * overview. Windows come from a labelled prototype calculation; reminders use
 * the default site only and are delivered only while PlateVault is open.
 */
import { Link, useParams } from "@tanstack/react-router"
import { CalendarDays, MapPin, Telescope } from "lucide-react"
import { useEffect, useId, useMemo, useState } from "react"
import { ChannelCoverage, KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, SaveState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge, type StatusValue } from "@/components/app/status"
import { openPanel } from "@/app/ui-state"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { projectProgress, targetCoverage } from "@/domain/derive"
import type { CalendarExport, ObservingSite, ObservingWindow, PlanCriteria, Target } from "@/domain/types"
import { formatDateTime, formatDuration, formatNight, formatTime, plural } from "@/lib/format"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import { resetClock, setClockTo } from "@/store/simulation"
import { disableNotifications, enableNotifications, type EnableOutcome, saveCalendarExport, savePlan, setPlanningSite } from "./lib/actions"
import { calendarFile, computeWindows, criteriaSummary, defaultCriteria, downloadText, nightAt, PLAN_NIGHTS, reminderKey, zoneAbbreviation } from "./lib/planning"
import { PrototypeControls } from "./shared"

const LEAD_TIMES = [
  { value: "30", label: "30 min before" },
  { value: "60", label: "1 h before" },
  { value: "120", label: "2 h before" },
  { value: "180", label: "3 h before" },
]

/** PlateVault's clock (honours the simulated clock), refreshed every 15 s. */
export function usePlateVaultNow(): number {
  const offset = useStore((s) => s.faults.clockOffsetMs)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 15_000)
    return () => window.clearInterval(timer)
  }, [])
  return useMemo(() => Date.parse(nowIso()), [tick, offset])
}

function windowTimes(w: ObservingWindow, site: ObservingSite): string {
  return `${formatTime(w.start, site.timeZone)}–${formatTime(w.end, site.timeZone)} ${zoneAbbreviation(w.start, site.timeZone)}`
}

function windowDuration(w: ObservingWindow): string {
  return formatDuration((Date.parse(w.end) - Date.parse(w.start)) / 1000)
}

function slug(text: string): string {
  return text.replace(/[^A-Za-z0-9]+/g, "")
}

export function TargetPlanPage() {
  const { targetId } = useParams({ strict: false }) as { targetId?: string }
  const target = useStore((s) => (targetId ? s.catalog.targets[targetId] : undefined))
  if (!target) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Plan" />
        <PageBody>
          <EmptyState titleAs="h2" icon={Telescope} title="Target not found" description="This Target is not in the catalog." action={<Button render={<Link to="/targets" />}>Open Targets</Button>} />
        </PageBody>
      </div>
    )
  }
  return <TargetPlan target={target} />
}

type CriteriaErrors = Partial<Record<keyof PlanCriteria, string>>

function validate(c: PlanCriteria): CriteriaErrors {
  const e: CriteriaErrors = {}
  if (!Number.isFinite(c.minAltitudeDeg) || c.minAltitudeDeg < 0 || c.minAltitudeDeg > 90) e.minAltitudeDeg = "Minimum altitude: enter 0 to 90 degrees."
  if (!Number.isFinite(c.minDurationMin) || c.minDurationMin < 10 || c.minDurationMin > 720) e.minDurationMin = "Minimum duration: enter 10 to 720 minutes."
  if (c.maxMoonIlluminationPct !== null && (c.maxMoonIlluminationPct < 0 || c.maxMoonIlluminationPct > 100)) e.maxMoonIlluminationPct = "Maximum Moon illumination: enter 0 to 100 %, or leave it empty for no limit."
  if (c.minMoonSeparationDeg !== null && (c.minMoonSeparationDeg < 0 || c.minMoonSeparationDeg > 180)) e.minMoonSeparationDeg = "Minimum Moon separation: enter 0 to 180 degrees, or leave it empty for no limit."
  return e
}

function TargetPlan({ target }: { target: Target }) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const settings = useStore((s) => s.settings)
  const now = usePlateVaultNow()
  const sites = Object.values(catalog.sites).sort((a, b) => a.name.localeCompare(b.name))
  const planningSite = settings.planningSiteId ? (catalog.sites[settings.planningSiteId] ?? null) : null
  const defaultSite = settings.defaultSiteId ? (catalog.sites[settings.defaultSiteId] ?? null) : null
  const plan = catalog.plans[target.id]
  const savedCriteria = plan?.criteria ?? defaultCriteria(planningSite)
  const [criteria, setCriteria] = useState<PlanCriteria>(savedCriteria)
  const [draftText, setDraftText] = useState<Record<string, string>>({})
  const [saveState, setSaveState] = useState<StatusValue<"save">>("saved")
  const [saveMessage, setSaveMessage] = useState<string | undefined>(undefined)
  const [plannedError, setPlannedError] = useState<string | null>(null)
  const [siteError, setSiteError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [lastExport, setLastExport] = useState<CalendarExport | null>(null)
  const errors = validate(criteria)
  const valid = Object.keys(errors).length === 0
  const siteSelectId = useId()
  const returnPath = `/targets/${target.id}/plan`

  // Criteria save themselves shortly after a valid change (D08: failures stay visibly unsaved).
  const changed = JSON.stringify(criteria) !== JSON.stringify(savedCriteria)
  useEffect(() => {
    if (!changed || !valid) return
    setSaveState("unsaved")
    const timer = window.setTimeout(() => {
      const result = savePlan(target.id, { criteria }, criteria)
      setSaveState(result.ok ? "saved" : result.reason === "stale" ? "stale" : "failed")
      setSaveMessage(result.ok ? undefined : result.message)
    }, 500)
    return () => window.clearTimeout(timer)
  }, [JSON.stringify(criteria), valid])

  const windows = useMemo(
    () => (planningSite && valid ? computeWindows(target, planningSite, criteria, now) : []),
    [target, planningSite, JSON.stringify(criteria), now, valid],
  )

  const coverage = targetCoverage(disk, catalog, target.id)
  const projects = Object.values(catalog.projects).filter((p) => p.targetIds.includes(target.id))

  const setNumber = (key: keyof PlanCriteria, text: string, optional = false) => {
    setDraftText((d) => ({ ...d, [key]: text }))
    const trimmed = text.trim()
    const value = trimmed === "" ? (optional ? null : Number.NaN) : Number(trimmed)
    setCriteria((c) => ({ ...c, [key]: value }))
  }
  const textFor = (key: keyof PlanCriteria) => draftText[key] ?? (criteria[key] === null ? "" : String(criteria[key]))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/targets/$targetId" params={{ targetId: target.id }} className="hover:underline">
            Target · {target.name}
          </Link>
        }
        title={`Plan ${target.name}`}
        description="Astronomical windows from a planning site you choose. Planning changes no library, Project or session data and starts no indexing."
        meta={plan?.planned ? <StatusBadge kind="association" value="confirmed" label="Planned" /> : null}
        actions={
          <>
            {windows.length === 0 ? (
              <span id="t5-export-reason" className="text-xs text-muted-foreground">
                No windows to export: choose a planning site or relax the criteria.
              </span>
            ) : null}
            <Button variant="outline" disabled={windows.length === 0} aria-describedby={windows.length === 0 ? "t5-export-reason" : undefined} onClick={() => setExportOpen(true)}>
              <CalendarDays aria-hidden="true" data-icon="inline-start" />
              Export calendar
            </Button>
          </>
        }
      />
      <PageBody>
        {lastExport ? (
          <Notice
            tone="info"
            title={`Saved ${lastExport.fileName}`}
            actions={
              <Button size="sm" variant="outline" onClick={() => downloadSnapshot(lastExport)}>
                Download again
              </Button>
            }
          >
            {plural(lastExport.windows.length, "window")} at {catalog.sites[lastExport.siteId]?.name}, times in {lastExport.timeZone}. The file is a one-time snapshot: later criteria changes need a new export.
          </Notice>
        ) : null}

        <Section id="t5-plan-site" title="Planning site" description="Only changes which windows you see. Project membership and session capture sites stay as they are.">
          {sites.length === 0 ? (
            <EmptyState
              icon={MapPin}
              title="No observing sites saved"
              description="Windows need a site with coordinates and a time zone."
              action={<Button render={<Link to="/settings/sites" search={{ return: returnPath }} />}>Add a site</Button>}
            />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label id={siteSelectId}>Planning site</Label>
                <Select
                  items={sites.map((s) => ({ value: s.id, label: s.name }))}
                  value={planningSite?.id ?? null}
                  onValueChange={(value) => {
                    const result = setPlanningSite(value as string, target.id)
                    setSiteError(result.ok ? null : result.message)
                  }}
                >
                  <SelectTrigger aria-labelledby={siteSelectId} className="w-64">
                    <SelectValue placeholder="Choose a planning site" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.id === settings.defaultSiteId ? " (default)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {planningSite ? (
                <span className="text-sm text-muted-foreground tabular-nums">
                  {planningSite.latitude.toFixed(2)}°, {planningSite.longitude.toFixed(2)}° · {planningSite.timeZone}
                </span>
              ) : null}
              <Button variant="ghost" size="sm" render={<Link to="/settings/sites" search={{ return: returnPath }} />}>
                Manage sites
              </Button>
              {siteError ? <ActionError message={siteError} className="w-full" /> : null}
            </div>
          )}
        </Section>

        <Section id="t5-plan-criteria" title="Criteria" description="Every listed window meets all of these at each 10-minute sample it covers.">
          <fieldset className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="sr-only">Window criteria</legend>
            <NumberField id="min-alt" label="Minimum altitude (°)" value={textFor("minAltitudeDeg")} error={errors.minAltitudeDeg} onChange={(t) => setNumber("minAltitudeDeg", t)} />
            <NumberField id="min-dur" label="Minimum duration (min)" value={textFor("minDurationMin")} error={errors.minDurationMin} onChange={(t) => setNumber("minDurationMin", t)} />
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Darkness</legend>
              <RadioGroup value={criteria.darkness} onValueChange={(v) => setCriteria((c) => ({ ...c, darkness: v as PlanCriteria["darkness"] }))} className="flex gap-4">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="astronomical" id="dark-astro" />
                  <Label htmlFor="dark-astro" className="font-normal">
                    Astronomical
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="nautical" id="dark-naut" />
                  <Label htmlFor="dark-naut" className="font-normal">
                    Nautical
                  </Label>
                </div>
              </RadioGroup>
            </fieldset>
            <NumberField
              id="moon-illum"
              label="Maximum Moon illumination (%)"
              hint="Empty: no limit. Applies while the Moon is up."
              value={textFor("maxMoonIlluminationPct")}
              error={errors.maxMoonIlluminationPct}
              onChange={(t) => setNumber("maxMoonIlluminationPct", t, true)}
            />
            <NumberField
              id="moon-sep"
              label="Minimum Moon separation (°)"
              hint="Empty: no limit. Applies while the Moon is up."
              value={textFor("minMoonSeparationDeg")}
              error={errors.minMoonSeparationDeg}
              onChange={(t) => setNumber("minMoonSeparationDeg", t, true)}
            />
            <div className="flex items-end">
              <SaveState state={!valid ? "unsaved" : saveState} message={saveMessage} onRetry={() => {
                const result = savePlan(target.id, { criteria }, criteria)
                setSaveState(result.ok ? "saved" : "failed")
                setSaveMessage(result.ok ? undefined : result.message)
              }} />
            </div>
          </fieldset>
        </Section>

        <Section
          id="t5-plan-windows"
          title="Windows"
          description={planningSite ? `Next ${PLAN_NIGHTS} nights at ${planningSite.name}. Times in ${planningSite.timeZone}.` : "Choose a planning site to calculate windows."}
        >
          {target.ra === null || target.dec === null ? (
            <EmptyState
              icon={Telescope}
              title="Position unknown"
              description={`${target.name} has no coordinates, so no window can be calculated.`}
              action={<Button render={<Link to="/targets/$targetId" params={{ targetId: target.id }} />}>Open Target</Button>}
            />
          ) : !planningSite ? (
            <p className="text-sm text-muted-foreground">No planning site chosen. PlateVault never picks one for you.</p>
          ) : (
            <WindowTable windows={windows} site={planningSite} onReset={() => {
              setDraftText({})
              setCriteria(defaultCriteria(planningSite))
            }} />
          )}
          <p className="text-xs text-pretty text-muted-foreground">
            Prototype calculation: astronomical suitability only. A window does not promise clear weather, telescope availability or processing readiness.
          </p>
        </Section>

        <Section id="t5-plan-coverage" title="Coverage and Project goals" description="Captured and library-usable integration by channel, beside unmet Project checklist items.">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              {coverage.channels.length === 0 ? <p className="text-sm text-muted-foreground">No light sessions for {target.name} yet.</p> : null}
              {coverage.channels.map((c) => (
                <ChannelCoverage key={c.channel} channel={c.channel} breakdown={c.breakdown} />
              ))}
            </div>
            <div className="space-y-3">
              {projects.length === 0 ? <p className="text-sm text-muted-foreground">No Project targets {target.name}.</p> : null}
              {projects.map((project) => {
                const gaps = projectProgress(catalog, project).filter((p) => p.state !== "met")
                return (
                  <div key={project.id} className="space-y-1.5">
                    <h3 className="text-sm font-semibold">
                      <Link to="/projects/$projectId" params={{ projectId: project.id }} className="hover:underline">
                        Project {project.name}
                      </Link>
                    </h3>
                    {gaps.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Every checklist item is met.</p>
                    ) : (
                      <ul className="space-y-1 text-sm">
                        {gaps.map((g) => (
                          <li key={g.item.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span>
                              {g.item.kind === "integration"
                                ? `${g.item.channel} ${formatDuration(g.item.goalS)}: ${formatDuration(g.totals?.projectAccepted.seconds ?? 0)} Project-accepted`
                                : g.item.kind === "frame-count"
                                  ? `${g.item.channel} ${g.item.goalFrames} frames: ${g.totals?.projectAccepted.frames ?? 0} Project-accepted`
                                  : g.reason ?? g.item.kind}
                            </span>
                            <StatusBadge kind="checklist" value={g.state} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </Section>

        <Section id="t5-plan-planned" title="Planned" description="Marking a Target Planned is an explicit opt-in. Reminders cover planned Targets only.">
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              id="t5-planned"
              checked={Boolean(plan?.planned)}
              onCheckedChange={(checked) => {
                const result = savePlan(target.id, { planned: checked }, criteria)
                setPlannedError(result.ok ? null : result.message)
              }}
            />
            <Label htmlFor="t5-planned">Planned</Label>
            {plannedError ? <ActionError message={plannedError} className="w-full" /> : null}
          </div>
        </Section>

        <RemindersSection target={target} planned={Boolean(plan?.planned)} planningSite={planningSite} defaultSite={defaultSite} savedCriteria={savedCriteria} now={now} returnPath={returnPath} />
      </PageBody>

      {planningSite ? (
        <ExportDialog
          open={exportOpen}
          onOpenChange={setExportOpen}
          target={target}
          site={planningSite}
          windows={windows}
          onSaved={(record) => {
            setLastExport(record)
            downloadSnapshot(record)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The .ics is generated once, when the export is saved, and kept with the
 * export: renaming a site or Target later never changes Download again (PLAN-AC-03).
 */
function downloadSnapshot(record: CalendarExport) {
  const { catalog, slices } = store.getState()
  const saved = slices.t5.calendarFiles[record.id]
  if (saved) return downloadText(record.fileName, saved)
  const names = Object.fromEntries(Object.values(catalog.targets).map((t) => [t.id, t.name]))
  const text = calendarFile(record, catalog.sites[record.siteId]?.name ?? record.siteId, names)
  updateSlice("t5", (s) => ({ ...s, calendarFiles: { ...s.calendarFiles, [record.id]: text } }))
  downloadText(record.fileName, text)
}

function NumberField({ id, label, value, error, hint, onChange }: { id: string; label: string; value: string; error?: string; hint?: string; onChange: (text: string) => void }) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <Input id={id} inputMode="decimal" value={value} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)} className="w-32 tabular-nums" />
      {error ? (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}

function WindowTable({ windows, site, onReset }: { windows: ObservingWindow[]; site: ObservingSite; onReset: () => void }) {
  const columns: Column<ObservingWindow>[] = [
    { id: "night", header: "Night", rowHeader: true, sortValue: (w) => w.start, cell: (w) => formatNight(nightAt(Date.parse(w.start), site), true) },
    { id: "time", header: `Time (${site.timeZone})`, cell: (w) => windowTimes(w, site) },
    { id: "duration", header: "Duration", align: "right", cell: (w) => windowDuration(w) },
    { id: "alt", header: "Max altitude", align: "right", cell: (w) => `${Math.round(w.maxAltitudeDeg)}°` },
    { id: "moon", header: "Moon", cell: (w) => `${w.moonIlluminationPct}% · ${Math.round(w.moonSeparationDeg)}° away` },
    { id: "site", header: "Site", cell: () => site.name },
  ]
  return (
    <DataTable
      label={`Observing windows at ${site.name}, times in ${site.timeZone}`}
      rows={windows}
      columns={columns}
      getRowId={(w) => w.key}
      scroll="none"
      empty={
        <EmptyState
          icon={CalendarDays}
          title={`No window meets these criteria in the next ${PLAN_NIGHTS} nights`}
          description="Lower the minimum altitude or duration, or relax the Moon limits."
          action={
            <Button variant="outline" onClick={onReset}>
              Reset criteria
            </Button>
          }
        />
      }
    />
  )
}

function RemindersSection({
  target,
  planned,
  planningSite,
  defaultSite,
  savedCriteria,
  now,
  returnPath,
}: {
  target: Target
  planned: boolean
  planningSite: ObservingSite | null
  defaultSite: ObservingSite | null
  savedCriteria: PlanCriteria
  now: number
  returnPath: string
}) {
  const reminders = useStore((s) => s.catalog.reminders)
  const sites = useStore((s) => s.catalog.sites)
  const plan = useStore((s) => s.catalog.plans[target.id])
  const [lead, setLead] = useState<string | null>(reminders.leadTimeMin ? String(reminders.leadTimeMin) : null)
  const [outcome, setOutcome] = useState<EnableOutcome | null>(null)
  const [offError, setOffError] = useState<string | null>(null)
  const [clockMessage, setClockMessage] = useState<{ ok: boolean; message: string } | null>(null)
  const leadId = useId()
  const reminderSite = reminders.enabled && reminders.siteId ? (sites[reminders.siteId] ?? null) : defaultSite
  const upcoming = useMemo(
    () => (reminders.enabled && reminderSite && planned ? computeWindows(target, reminderSite, plan?.criteria ?? savedCriteria, now).slice(0, 5) : []),
    [reminders.enabled, reminderSite?.id, planned, JSON.stringify(plan?.criteria), now],
  )
  const status = reminders.permission === "denied" && !reminders.enabled ? "denied" : reminders.enabled ? "enabled" : "disabled"
  const leadMin = lead ? Number(lead) : null

  function enable() {
    setOutcome(enableNotifications(leadMin, target.id))
  }

  return (
    <Section id="t5-plan-reminders" title="Reminders" description="Opt-in reminders for planned Targets, always at the default site. Enabling them starts no indexing or processing.">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge kind="reminders" value={status} />
        <span className="text-xs text-muted-foreground">Delivered only while PlateVault is open. App-closed delivery is unavailable: no tested scheduler is installed.</span>
      </div>
      <KeyValueList
        items={[
          {
            label: "Reminder site",
            value: reminderSite ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {reminderSite.name}
                <StatusBadge kind="site" value="default" />
              </span>
            ) : (
              <UnknownValue label="Not set" reason="Reminders need a default site; set one in Settings › Observing sites." />
            ),
            source: reminders.enabled ? "Default site when reminders were enabled" : "Settings › Observing sites",
          },
          { label: "Criteria", value: criteriaSummary(plan?.criteria ?? savedCriteria), source: `Saved for ${target.name}` },
          { label: "Lead time", value: reminders.enabled && reminders.leadTimeMin ? `${reminders.leadTimeMin} min before each window` : lead ? `${lead} min before each window` : "Not set" },
          { label: "Permission", value: reminders.permission === "granted" ? "Allowed" : reminders.permission === "denied" ? "Denied" : "Not requested yet" },
        ]}
      />
      {planningSite && reminderSite && planningSite.id !== reminderSite.id ? (
        <p className="text-sm text-pretty text-muted-foreground">
          The windows above use {planningSite.name}. Reminders use {reminderSite.name} only; planning at {planningSite.name} schedules nothing there.
        </p>
      ) : null}

      {reminders.enabled ? (
        <div className="space-y-3">
          <p className="text-sm">
            Notifications on for {reminderSite?.name}, {reminders.leadTimeMin} min before each window of a planned Target.
          </p>
          {!planned ? <p className="text-sm text-muted-foreground">{target.name} is not Planned, so it gets no reminders. Turn on Planned above to include it.</p> : null}
          {upcoming.length > 0 ? (
            <ul className="divide-y rounded-lg border text-sm">
              {upcoming.map((w) => {
                const delivered = reminders.deliveredWindowKeys.includes(reminderKey(w, reminderSite!))
                const at = new Date(Date.parse(w.start) - (reminders.leadTimeMin ?? 0) * 60_000).toISOString()
                return (
                  <li key={w.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span>
                      {target.name} at {reminderSite?.name}: {formatNight(nightAt(Date.parse(w.start), reminderSite!))} {windowTimes(w, reminderSite!)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {delivered ? `Delivered · scheduled for ${formatTime(at, reminderSite!.timeZone)}` : `Scheduled for ${formatDateTime(at, reminderSite!.timeZone)}, not delivered yet`}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => {
                const result = disableNotifications()
                setOffError(result.ok ? null : result.message)
              }}
            >
              Turn off notifications
            </Button>
            {offError ? <ActionError message={offError} /> : null}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label id={leadId}>Lead time</Label>
            <Select items={LEAD_TIMES} value={lead} onValueChange={(v) => setLead(v as string)}>
              <SelectTrigger aria-labelledby={leadId} className="w-48" aria-invalid={outcome && !outcome.ok && outcome.reason === "no-lead-time" ? true : undefined}>
                <SelectValue placeholder="Choose a lead time" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_TIMES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={enable}>Enable notifications</Button>
            <span className="text-sm text-pretty text-muted-foreground">
              {reminderSite ? `For ${reminderSite.name}` : "Needs a default site"} · {criteriaSummary(plan?.criteria ?? savedCriteria)} · {lead ? `${lead} min before each window` : "lead time not chosen"}
            </span>
          </div>
          {outcome && !outcome.ok && outcome.reason === "no-default-site" ? (
            <Notice
              tone="warning"
              title="Set a default site first"
              actions={<Button size="sm" render={<Link to="/settings/sites" search={{ return: returnPath }} />}>Set default site</Button>}
            >
              {outcome.message}
            </Notice>
          ) : null}
          {status === "denied" ? (
            <Notice
              tone="refusal"
              title="Notification permission denied"
              actions={
                <>
                  <Button size="sm" variant="outline" onClick={() => openPanel("simulation")}>
                    System Settings
                  </Button>
                  <Button size="sm" variant="outline" onClick={enable}>
                    Retry
                  </Button>
                </>
              }
            >
              {outcome && !outcome.ok && outcome.reason === "denied" ? outcome.message : "Notification permission denied. PlateVault cannot show reminders until notifications are allowed in System Settings."} Notifications are not enabled and nothing was scheduled. Prototype: System Settings opens Prototype controls, where “Next notification permission answer” stands in for the operating system.
            </Notice>
          ) : null}
          {outcome && !outcome.ok && (outcome.reason === "no-lead-time" || outcome.reason === "write-failed" || outcome.reason === "stale") ? (
            <ActionError message={outcome.message} onRetry={outcome.reason === "no-lead-time" ? undefined : enable} />
          ) : null}
        </div>
      )}

      {reminders.enabled && upcoming[0] ? (
        <PrototypeControls
          title="Prototype: clock"
          outcome={clockMessage}
          description="J29 P4: move PlateVault's clock into the first upcoming reminder's lead time. The clock stays set across a reload."
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const first = upcoming.find((w) => !reminders.deliveredWindowKeys.includes(reminderKey(w, reminderSite!))) ?? upcoming[0]!
              const at = Date.parse(first.start) - ((reminders.leadTimeMin ?? 60) * 60_000) / 2
              setClockTo(new Date(at).toISOString())
              setClockMessage({ ok: true, message: `Clock set to ${formatDateTime(new Date(at).toISOString(), reminderSite?.timeZone)}.` })
            }}
          >
            Set clock inside the next lead time
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              resetClock()
              setClockMessage({ ok: true, message: "PlateVault uses the system clock again." })
            }}
          >
            Use system clock
          </Button>
        </PrototypeControls>
      ) : null}
    </Section>
  )
}

function ExportDialog({
  open,
  onOpenChange,
  target,
  site,
  windows,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: Target
  site: ObservingSite
  windows: ObservingWindow[]
  onSaved: (record: CalendarExport) => void
}) {
  const [checked, setChecked] = useState<string[]>([])
  const [fileName, setFileName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const fileId = useId()
  useEffect(() => {
    if (!open) return
    setChecked(windows.map((w) => w.key))
    setFileName(`${slug(target.name)}-${slug(site.name)}-${new Date().toISOString().slice(0, 10)}.ics`)
    setError(null)
  }, [open])
  const selected = windows.filter((w) => checked.includes(w.key))
  const from = selected[0] ? nightAt(Date.parse(selected[0].start), site) : null
  const to = selected.at(-1) ? nightAt(Date.parse(selected.at(-1)!.start), site) : null
  function save() {
    if (selected.length === 0) {
      setError("Windows: select at least one window to export.")
      return
    }
    if (!/^[^/\\]+\.ics$/.test(fileName.trim())) {
      setError("File name: use a name ending in .ics, without folders.")
      return
    }
    const { result, record } = saveCalendarExport({ siteId: site.id, timeZone: site.timeZone, from: from!, to: to!, fileName: fileName.trim(), windows: selected }, target.id)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onSaved(record)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Export calendar</DialogTitle>
          <DialogDescription>A one-time .ics snapshot of the windows you confirm. No calendar account, authorization or subscription is used.</DialogDescription>
        </DialogHeader>
        <KeyValueList
          items={[
            { label: "Planning site", value: site.name },
            { label: "Time zone", value: `${site.timeZone} (${zoneAbbreviation(windows[0]?.start ?? new Date().toISOString(), site.timeZone)})` },
            { label: "Date range", value: from && to ? `${formatNight(from, true)} to ${formatNight(to, true)}` : "No window selected" },
          ]}
        />
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Windows ({plural(selected.length, "selected window")})</legend>
          <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border text-sm">
            {windows.map((w) => (
              <li key={w.key} className="flex items-center gap-3 px-3 py-1.5">
                <Checkbox
                  id={`ics-${w.key}`}
                  checked={checked.includes(w.key)}
                  onCheckedChange={(on) => setChecked((c) => (on ? [...c, w.key] : c.filter((k) => k !== w.key)))}
                />
                <Label htmlFor={`ics-${w.key}`} className="font-normal tabular-nums">
                  {formatNight(nightAt(Date.parse(w.start), site))} · {windowTimes(w, site)} · {windowDuration(w)}
                </Label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={fileId}>File name</Label>
          <Input id={fileId} value={fileName} onChange={(e) => setFileName(e.target.value)} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">Prototype: the file downloads through the browser. The desktop app saves it with the native save dialog.</p>
        </div>
        {error ? <ActionError message={error} /> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={save}>Save .ics file</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Plans overview
// ---------------------------------------------------------------------------

export function PlansPage() {
  const catalog = useStore((s) => s.catalog)
  const settings = useStore((s) => s.settings)
  const notifications = useStore((s) => s.slices.t5.notifications)
  const now = usePlateVaultNow()
  const [offError, setOffError] = useState<string | null>(null)
  const { reminders } = catalog
  const defaultSite = settings.defaultSiteId ? catalog.sites[settings.defaultSiteId] : undefined
  const reminderSite = reminders.siteId ? catalog.sites[reminders.siteId] : undefined
  const planned = Object.values(catalog.plans).filter((p) => p.planned)
  const status = reminders.permission === "denied" && !reminders.enabled ? "denied" : reminders.enabled ? "enabled" : "disabled"
  const nextSite = reminderSite ?? defaultSite
  const rows = planned
    .map((p) => {
      const target = catalog.targets[p.targetId]
      const next = target && nextSite ? computeWindows(target, nextSite, p.criteria, now, 7)[0] : undefined
      return { plan: p, target, next }
    })
    .filter((r) => r.target)
  const delivered = reminders.deliveredWindowKeys.map((key) => {
    const [targetId, siteId, night] = key.split("/")
    return { key, target: catalog.targets[targetId ?? ""]?.name ?? targetId, site: catalog.sites[siteId ?? ""], night: night ?? "" }
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Plans" description="Planned Targets, reminder status and calendar exports. Suitability is astronomical only." />
      <PageBody>
        <Section id="t5-plans-reminders" title="Reminders" description="Notifications start off. They use the default site and need explicit criteria and a lead time.">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge kind="reminders" value={status} />
            <span className="text-xs text-muted-foreground">Delivered only while PlateVault is open. App-closed delivery is unavailable: no tested scheduler is installed.</span>
          </div>
          <KeyValueList
            items={[
              {
                label: "Default site",
                value: defaultSite ? defaultSite.name : <UnknownValue label="Not set" reason="Set a default site in Settings › Observing sites." />,
                source: "Settings › Observing sites",
              },
              { label: "Reminder site", value: reminders.enabled && reminderSite ? reminderSite.name : "None while notifications are off" },
              { label: "Lead time", value: reminders.enabled && reminders.leadTimeMin ? `${reminders.leadTimeMin} min before each window` : "Not set" },
              { label: "Permission", value: reminders.permission === "granted" ? "Allowed" : reminders.permission === "denied" ? "Denied" : "Not requested yet" },
              { label: "Enabled", value: reminders.enabledAt ? formatDateTime(reminders.enabledAt) : "Not enabled" },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            {reminders.enabled ? (
              <Button
                variant="outline"
                onClick={() => {
                  const result = disableNotifications()
                  setOffError(result.ok ? null : result.message)
                }}
              >
                Turn off notifications
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Enable notifications from a Target's Plan area, where its criteria are shown.</span>
            )}
            {!defaultSite ? (
              <Button size="sm" variant="outline" render={<Link to="/settings/sites" search={{ return: "/plans" }} />}>
                Set default site
              </Button>
            ) : null}
            {offError ? <ActionError message={offError} /> : null}
          </div>
        </Section>

        <Section id="t5-plans-planned" title="Planned Targets" description={nextSite ? `Next window at ${nextSite.name} within 7 nights.` : "Set a default site to see next windows here."}>
          {rows.length === 0 ? (
            <EmptyState icon={Telescope} title="No planned Targets" description="Mark a Target Planned in its Plan area." action={<Button render={<Link to="/targets" />}>Open Targets</Button>} />
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {rows.map(({ plan, target, next }) => (
                <li key={plan.targetId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="space-y-0.5">
                    <Link to="/targets/$targetId/plan" params={{ targetId: plan.targetId }} className="font-medium text-primary hover:underline">
                      Plan {target!.name}
                    </Link>
                    <span className="block text-xs text-muted-foreground">{criteriaSummary(plan.criteria)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {next && nextSite ? `${formatNight(nightAt(Date.parse(next.start), nextSite))} ${windowTimes(next, nextSite)}` : nextSite ? "No window in 7 nights" : "No site"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="t5-plans-delivered" title="Delivered reminders" description="Each delivered target, site and window is recorded, so a restart never repeats it.">
          {delivered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reminder has been delivered.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {delivered.map((d) => (
                <li key={d.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    {d.target} at {d.site?.name ?? "a removed site"}
                  </span>
                  <span className="text-xs text-muted-foreground">Night of {formatNight(d.night)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted-foreground">
            Prototype: {plural(notifications.length, "notification")} in the simulated OS notification list.
          </p>
        </Section>

        <Section id="t5-plans-exports" title="Calendar exports" description="Each export is a saved snapshot. Download again reproduces the same bytes; changed windows need a new export.">
          {catalog.calendarExports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calendar exported yet. Use Export calendar in a Target's Plan area.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {catalog.calendarExports.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 space-y-0.5">
                    <PathText path={e.fileName} />
                    <span className="block text-xs text-muted-foreground">
                      {plural(e.windows.length, "window")} at {catalog.sites[e.siteId]?.name ?? "a removed site"} · {e.timeZone} · {formatNight(e.from)} to {formatNight(e.to)} · saved {formatDateTime(e.at)}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" aria-label={`Download ${e.fileName} again`} onClick={() => downloadSnapshot(e)}>
                    Download again
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>
    </div>
  )
}
