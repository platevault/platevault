/**
 * Simulation controls (foundation-owned, prototype only). Reach offline,
 * unreadable, drift, restore, copy, collision, new-arrival, failed-write,
 * resolver, clock, permission and no-site states without a real
 * filesystem. Opened from the toolbar "Prototype" button and the palette's
 * Prototype controls command.
 */
import { useParams } from "@tanstack/react-router"
import { FlaskConical, RotateCcw } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"
import { ActionButton } from "@/components/app/actions"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { calibrationProcesses } from "@/domain/calibration-process"
import { fileAt } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { displayZone, formatZonedDateTime, reminderSiteOf, wallTimeToIso } from "@/domain/planning"
import { formatNight } from "@/lib/format"
import { type MessageRef, msg, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { store, useStore } from "@/store/core"
import { updateApp } from "@/store/actions/settings"
import { resetPrototype } from "@/store"
import { removableDevices } from "@/domain/devices"
import { runSimulations } from "@/features/v5/c-runs/actions"
import {
  connectDevice,
  copyFolderExternally,
  copyNewCaptures,
  createExternalFile,
  deleteFileExternally,
  ejectDevice,
  modifyFileExternally,
  newCapturesArrived,
  resetClock,
  restoreFileExternally,
  setClockTo,
  setFault,
  setFolderAccess,
  setPathReadOnly,
  setVolumeMounted,
  setWindowsWithoutDeveloperMode,
  toolFinishedStacking,
} from "@/store/simulation"
import { useMessages } from "./preferences"
import { closePanel, useShellUi } from "./ui-state"

/** `path` details render in monospace and truncate; prose details wrap in the body font. */
function ToggleRow({
  label,
  detail,
  path,
  checked,
  onChange,
}: {
  label: string
  detail?: string
  path?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {/* Wraps instead of truncating, so the whole path stays readable at 200% text (WCAG 1.4.4). */}
        {path ? <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{path}</p> : null}
        {detail ? <p className="text-xs text-pretty text-muted-foreground">{detail}</p> : null}
      </div>
      {/* 24 px tall target: these rows sit close to buttons and other switches (WCAG 2.5.8). */}
      <Switch id={id} size="lg" checked={checked} onCheckedChange={(value) => onChange(value)} />
    </div>
  )
}

/** The run or run group on screen: its prototype simulations (c-runs `runSimulations`), which change the simulated application and disk. */
function ThisRunSection() {
  const m = useMessages()
  const { runId, groupId } = useParams({ strict: false }) as { runId?: string; groupId?: string }
  const run = useStore((s) => (runId ? s.catalog.runs[runId] : undefined))
  const group = useStore((s) => (groupId ? s.catalog.runGroups[groupId] : undefined))
  const target = run ? { runId: run.id } : group ? { groupId: group.id } : null
  if (!target) return null
  return (
    <Section title={m.simulation_this_run_title({ name: run?.name ?? group?.name ?? "" })} level={3} description={m.simulation_this_run_description()}>
      <div className="flex flex-wrap gap-2">
        {runSimulations(target, m).map((action) => (
          <ActionButton key={action.id} action={action} />
        ))}
      </div>
    </Section>
  )
}

export function SimulationControls() {
  const volumes = useStore((s) => s.disk.volumes)
  const denied = useStore((s) => s.disk.deniedPaths)
  const readOnlyPaths = useStore((s) => s.disk.readOnlyPaths)
  const files = useStore((s) => s.disk.files)
  const explicitFolders = useStore((s) => s.disk.folders)
  const locations = useStore((s) => s.catalog.locations)
  const faults = useStore((s) => s.faults)
  const clockZone = useStore((s) => reminderSiteOf(s.catalog.sites, s.catalog.reminders, s.settings.defaultSiteId)?.timeZone)
  const seed = useStore((s) => s.seed)
  const arrived = useStore(() => newCapturesArrived())
  const devices = useStore((s) => removableDevices(s.disk))
  const stacking = useStore((s) => calibrationProcesses(s.catalog).filter((v) => v.status === "stacking"))
  const apps = useStore((s) => s.disk.apps)
  const m = useMessages()
  const [folderQuery, setFolderQuery] = useState("")
  const [path, setPath] = useState("")
  const [destination, setDestination] = useState("")
  const [clock, setClock] = useState("")
  /** Outcome of the last disk control; `invalid` names the field an error is about. */
  const [pathMessage, setPathMessage] = useState<{ ref: MessageRef; invalid: "path" | "destination" | null } | null>(null)
  const [clockMessage, setClockMessage] = useState<MessageRef | null>(null)
  const [confirmSeed, setConfirmSeed] = useState<"empty" | "demo" | null>(null)
  const folderInput = useId()
  const pathInput = useId()
  const destinationInput = useId()
  const clockInput = useId()
  const pathMessageId = useId()

  // Folders that hold files or exist explicitly, under any volume root, plus denied ones.
  const folders = useMemo(() => {
    const set = new Set<string>(denied)
    for (const folder of explicitFolders) set.add(folder.path)
    for (const file of Object.values(files)) {
      if (file.linkTarget) continue
      const parts = file.path.split("/")
      for (let depth = 4; depth < parts.length; depth += 1) set.add(parts.slice(0, depth).join("/"))
    }
    return [...set].filter((p) => !p.includes("/Work/Processing/") && !p.includes("/output")).sort()
  }, [files, explicitFolders, denied])
  const shownFolders = folders.filter((f) => f.toLowerCase().includes(folderQuery.toLowerCase())).slice(0, 60)
  /** The path field must name an existing file; returns the refusal to show, or null. */
  const missingFile = (): { ref: MessageRef; invalid: "path" } | null =>
    fileAt(store.getState().disk, path) ? null : { ref: path ? msg("simulation_no_file_at", { path }) : msg("simulation_enter_file_path"), invalid: "path" }

  return (
    <div className="space-y-6">
      <ThisRunSection />
      <Section title={m.folder_picker_volumes()} level={3} description={m.simulation_volumes_description()}>
        <div className="divide-y rounded-md border px-3">
          {Object.values(volumes).map((volume) => (
            <ToggleRow
              key={volume.id}
              label={volume.id.includes("impostor") ? m.simulation_volume_impostor({ name: volume.name }) : volume.name}
              path={`${volume.mountPath} · ${volume.volumeUuid} · ${volume.trash === "supported" ? m.trash_title() : m.simulation_no_trash()}`}
              checked={volume.mounted}
              onChange={(mounted) => setVolumeMounted(volume.id, mounted)}
            />
          ))}
        </div>
      </Section>

      <Section title={m.simulation_folder_access_title()} level={3} description={m.simulation_folder_access_description()}>
        <div className="space-y-2">
          <Label htmlFor={folderInput}>{m.simulation_filter_folders()}</Label>
          <Input id={folderInput} placeholder={m.simulation_filter_folders_placeholder({ example: "NGC7000" })} value={folderQuery} onChange={(e) => setFolderQuery(e.target.value)} />
          <div className="max-h-64 divide-y overflow-y-auto rounded-md border px-3">
            {shownFolders.map((folder) => {
              const registered = Object.values(locations).some((l) => isUnder(folder, l.path))
              return (
                <ToggleRow
                  key={folder}
                  label={folder.split("/").slice(-2).join("/")}
                  path={registered ? folder : `${folder} · ${m.simulation_not_registered()}`}
                  checked={denied.includes(folder)}
                  onChange={(value) => setFolderAccess(folder, value)}
                />
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">{m.simulation_on_denied()}</p>
        </div>
      </Section>

      <Section title={m.simulation_outside_title()} level={3} description={m.simulation_outside_description()}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={arrived} onClick={() => copyNewCaptures()}>
              {m.simulation_copy_new_captures({ night: formatNight("2026-10-02"), target: "NGC 7000", volume: "Astro-T7" })}
            </Button>
            {arrived ? <span className="text-xs text-muted-foreground">{m.simulation_already_copied()}</span> : null}
          </div>
          {devices.map((device) => (
            <ToggleRow
              key={device.volume.id}
              label={m.simulation_device_connected({ name: device.volume.name })}
              detail={device.layout ? m.simulation_device_layout({ label: device.label }) : m.simulation_generic_device()}
              path={device.volume.mountPath}
              checked={device.connected}
              onChange={(on) => (on ? connectDevice(device.volume.id) : ejectDevice(device.volume.id))}
            />
          ))}
          {stacking.map((view) => (
            <div key={view.process.id} className="flex items-center justify-between gap-3 py-1.5" data-sim-stacking={view.process.id}>
              <div className="min-w-0">
                <p className="text-sm">{say(m, view.name)}</p>
                <p className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{view.process.outputFolder}</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0" onClick={() => toolFinishedStacking(view.process.id)}>
                {m.simulation_tool_finished()}
              </Button>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor={pathInput}>{m.simulation_path_label()}</Label>
            <Input
              id={pathInput}
              className="font-mono text-xs"
              // eslint-disable-next-line alm/no-user-string -- an example path
              placeholder="/Volumes/Astro-T7/…"
              value={path}
              aria-invalid={pathMessage?.invalid === "path" || undefined}
              aria-describedby={pathMessage?.invalid === "path" ? pathMessageId : undefined}
              onChange={(e) => setPath(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const missing = missingFile()
                  if (missing) return setPathMessage(missing)
                  modifyFileExternally(path)
                  setPathMessage({ ref: msg("simulation_overwrote", { path }), invalid: null })
                }}
              >
                {m.simulation_overwrite()}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const missing = missingFile()
                  if (missing) return setPathMessage(missing)
                  setPathMessage(
                    restoreFileExternally(path) ? { ref: msg("simulation_restored", { path }), invalid: null } : { ref: msg("simulation_nothing_to_restore", { path }), invalid: "path" },
                  )
                }}
              >
                {m.simulation_restore_bytes()}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage({ ref: msg("simulation_enter_file_path"), invalid: "path" })
                  if (fileAt(store.getState().disk, path)) return setPathMessage({ ref: msg("simulation_file_exists", { path }), invalid: "path" })
                  createExternalFile(path)
                  setPathMessage(
                    fileAt(store.getState().disk, path) ? { ref: msg("simulation_created", { path }), invalid: null } : { ref: msg("simulation_create_no_volume", { path }), invalid: "path" },
                  )
                }}
              >
                {m.simulation_create_file()}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const missing = missingFile()
                  if (missing) return setPathMessage(missing)
                  deleteFileExternally(path)
                  setPathMessage({ ref: msg("simulation_deleted", { path }), invalid: null })
                }}
              >
                {m.simulation_delete_outside()}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage({ ref: msg("simulation_enter_path"), invalid: "path" })
                  const deny = !denied.includes(path)
                  setFolderAccess(path, deny)
                  setPathMessage({ ref: deny ? msg("simulation_access_denied", { path }) : msg("simulation_access_restored", { path }), invalid: null })
                }}
              >
                {denied.includes(path) ? m.simulation_restore_read() : m.simulation_deny_read()}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage({ ref: msg("simulation_enter_path"), invalid: "path" })
                  const readOnly = !readOnlyPaths.includes(path)
                  setPathReadOnly(path, readOnly)
                  setPathMessage({ ref: readOnly ? msg("simulation_write_removed", { path }) : msg("simulation_write_restored", { path }), invalid: null })
                }}
              >
                {readOnlyPaths.includes(path) ? m.simulation_restore_write() : m.simulation_remove_write()}
              </Button>
            </div>
            {/* Copying acts on two fields; its own group keeps it apart from the single-path controls. */}
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor={destinationInput}>{m.simulation_copy_into_label()}</Label>
                <Input
                  id={destinationInput}
                  className="font-mono text-xs"
                  // eslint-disable-next-line alm/no-user-string -- an example path
                  placeholder="/Volumes/Spare/Captures"
                  value={destination}
                  aria-invalid={pathMessage?.invalid === "destination" || undefined}
                  aria-describedby={pathMessage?.invalid === "destination" ? pathMessageId : undefined}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage({ ref: msg("simulation_copy_enter_source"), invalid: "path" })
                  if (!destination) return setPathMessage({ ref: msg("simulation_copy_enter_destination"), invalid: "destination" })
                  const outcome = copyFolderExternally(path, destination)
                  setPathMessage(
                    outcome.ok
                      ? { ref: msg("simulation_copied", { count: outcome.copied, path: outcome.destination }), invalid: null }
                      : { ref: outcome.message, invalid: outcome.field === "source" ? "path" : "destination" },
                  )
                }}
              >
                {m.simulation_copy_bytes()}
              </Button>
            </div>
            <p id={pathMessageId} className={cn("text-xs", pathMessage?.invalid ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
              {pathMessage ? say(m, pathMessage.ref) : null}
            </p>
          </div>
        </div>
      </Section>

      <Section title={m.simulation_faults_title()} level={3}>
        <div className="divide-y rounded-md border px-3">
          <ToggleRow label={m.simulation_fail_catalog_write()} checked={faults.failNextCatalogWrite} onChange={(value) => setFault("failNextCatalogWrite", value)} />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm">{m.simulation_notification_answer()}</span>
            <Select
              items={[
                { value: "grant", label: m.simulation_allow() },
                { value: "deny", label: m.simulation_deny() },
              ]}
              value={faults.notificationResponse}
              onValueChange={(value) => setFault("notificationResponse", value === "deny" ? "deny" : "grant")}
            >
              <SelectTrigger size="sm" aria-label={m.simulation_notification_answer()} className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grant">{m.simulation_allow()}</SelectItem>
                <SelectItem value="deny">{m.simulation_deny()}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ToggleRow
            label={m.simulation_fail_hash()}
            detail={m.simulation_fail_hash_detail()}
            checked={faults.failNextHashVerification}
            onChange={(value) => setFault("failNextHashVerification", value)}
          />
          <ToggleRow
            label={m.simulation_stale_save()}
            detail={m.simulation_stale_save_detail()}
            checked={faults.staleNextWrite}
            onChange={(value) => setFault("staleNextWrite", value)}
          />
          <ToggleRow
            label={m.simulation_fail_resolver()}
            detail={m.simulation_fail_resolver_detail()}
            checked={faults.failNextResolverLookup}
            onChange={(value) => setFault("failNextResolverLookup", value)}
          />
          <ToggleRow
            label={m.simulation_slow_index()}
            detail={m.simulation_slow_index_detail()}
            checked={faults.slowIndexing}
            onChange={(value) => setFault("slowIndexing", value)}
          />
          <ToggleRow
            label={m.simulation_no_site()}
            detail={m.simulation_no_site_detail()}
            checked={faults.noSite}
            onChange={(value) => setFault("noSite", value)}
          />
          <ToggleRow
            label={m.simulation_no_developer_mode()}
            detail={faults.developerMode === "on" ? m.simulation_developer_mode_on() : m.simulation_developer_mode_off()}
            checked={faults.developerMode === "off"}
            onChange={(value) => setWindowsWithoutDeveloperMode(value)}
          />
        </div>
      </Section>

      <Section title={m.settings_applications()} level={3}>
        <div className="divide-y rounded-md border px-3">
          {apps.map((app) => (
            <ToggleRow key={app.id} label={app.name} path={app.path} detail={app.present ? m.apps_present() : m.apps_moved_away()} checked={app.present} onChange={(present) => updateApp(app.id, { present })} />
          ))}
          {apps.map((app) => (
            <ToggleRow key={`${app.id}-launch`} label={m.apps_fail_next_launch()} detail={app.name} checked={app.launchFails} onChange={(launchFails) => updateApp(app.id, { launchFails })} />
          ))}
        </div>
      </Section>

      <Section
        title={m.simulation_clock_title()}
        level={3}
        description={(faults.clockOffsetMs ? m.simulation_clock_set : m.simulation_clock_system)({ time: formatZonedDateTime(new Date(Date.now() + faults.clockOffsetMs).toISOString(), clockZone) })}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={clockInput}>{m.simulation_clock_label({ zone: displayZone(clockZone) })}</Label>
            <Input id={clockInput} type="datetime-local" className="w-56" value={clock} onChange={(e) => setClock(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const at = wallTimeToIso(clock, clockZone)
              if (!at) return setClockMessage(msg("simulation_clock_enter"))
              setClockTo(at)
              setClockMessage(msg("simulation_clock_set_to", { time: formatZonedDateTime(at, clockZone) }))
            }}
          >
            {m.simulation_set_time()}
          </Button>
          {faults.clockOffsetMs !== 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                resetClock()
                setClockMessage(msg("simulation_clock_reset"))
              }}
            >
              {m.simulation_use_system_clock()}
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {clockMessage ? say(m, clockMessage) : null}
        </p>
      </Section>

      <Section title={m.simulation_data_title()} level={3} description={seed === "demo" ? m.simulation_data_demo() : m.simulation_data_empty()}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmSeed("empty")}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {m.simulation_reset_empty()}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmSeed("demo")}>
            {m.setup_demo_load()}
          </Button>
        </div>
        <ConfirmDialog
          open={confirmSeed !== null}
          onOpenChange={(open) => !open && setConfirmSeed(null)}
          title={confirmSeed === "demo" ? m.setup_demo_confirm_title() : m.simulation_confirm_empty_title()}
          description={m.simulation_confirm_description()}
          changes={[
            confirmSeed === "demo" ? m.simulation_confirm_demo_change({ projects: "Cygnus HOO 2026, M 31 LRGB, Heart and Soul" }) : m.simulation_confirm_empty_change(),
            m.simulation_confirm_discard(),
          ]}
          unchanged={[m.setup_demo_unchanged_appearance(), m.setup_demo_unchanged_files()]}
          confirmLabel={confirmSeed === "demo" ? m.setup_demo_load() : m.simulation_reset_empty()}
          tone="destructive"
          onConfirm={() => {
            if (!confirmSeed) return
            resetPrototype(confirmSeed)
            closePanel()
            window.location.hash = confirmSeed === "demo" ? "#/targets" : "#/welcome"
          }}
        />
      </Section>
    </div>
  )
}

export function SimulationSheet() {
  const m = useMessages()
  const { panel } = useShellUi()
  // Initial focus on the heading, never on a switch: one Space press must not unmount a volume.
  const headingRef = useRef<HTMLHeadingElement>(null)
  return (
    <Sheet open={panel === "simulation"} onOpenChange={(open) => !open && closePanel()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" initialFocus={headingRef}>
        <SheetHeader>
          <SheetTitle ref={headingRef} tabIndex={-1} className="flex items-center gap-2 outline-none">
            <FlaskConical aria-hidden="true" className="size-4" />
            {m.about_simulation()}
          </SheetTitle>
          <SheetDescription>{m.simulation_sheet_description()}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SimulationControls />
        </div>
      </SheetContent>
    </Sheet>
  )
}
