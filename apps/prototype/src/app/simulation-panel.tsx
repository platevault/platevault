/**
 * Simulation controls (foundation-owned, prototype only). Reach offline,
 * unreadable, drift, restore, copy, collision, new-arrival, failed-write,
 * resolver, clock and permission states without a real filesystem. Opened
 * from the header "Prototype" button; T1 may embed `SimulationControls` in
 * Settings › About.
 */
import { FlaskConical, RotateCcw } from "lucide-react"
import { useId, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { fileAt } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { formatDateTime } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { resetPrototype } from "@/store"
import {
  copyFolderExternally,
  copyNewCaptures,
  createExternalFile,
  deleteFileExternally,
  modifyFileExternally,
  newCapturesArrived,
  resetClock,
  restoreFileExternally,
  setClockTo,
  setFault,
  setFolderAccess,
  setPathReadOnly,
  setVolumeMounted,
} from "@/store/simulation"
import { closePanel, useShellUi } from "./ui-state"

function ToggleRow({ label, detail, checked, onChange }: { label: string; detail?: string; checked: boolean; onChange: (checked: boolean) => void }) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {detail ? <p className="truncate font-mono text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={(value) => onChange(value)} />
    </div>
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
  const seed = useStore((s) => s.seed)
  const arrived = useStore(() => newCapturesArrived())
  const [folderQuery, setFolderQuery] = useState("")
  const [path, setPath] = useState("")
  const [destination, setDestination] = useState("")
  const [clock, setClock] = useState("")
  const [pathMessage, setPathMessage] = useState<string | null>(null)
  const [clockMessage, setClockMessage] = useState<string | null>(null)
  const [confirmSeed, setConfirmSeed] = useState<"empty" | "demo" | null>(null)
  const folderInput = useId()
  const pathInput = useId()
  const destinationInput = useId()
  const clockInput = useId()

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

  return (
    <div className="space-y-6">
      <Section title="Volumes" level={3} description="Unmount to make a location offline. Two volumes cannot share a mount path.">
        <div className="divide-y rounded-md border px-3">
          {Object.values(volumes).map((volume) => (
            <ToggleRow
              key={volume.id}
              label={`${volume.name}${volume.id.includes("impostor") ? " (different volume, same name)" : ""}`}
              detail={`${volume.mountPath} · ${volume.volumeUuid} · ${volume.trash === "supported" ? "Trash" : "no Trash"}`}
              checked={volume.mounted}
              onChange={(mounted) => setVolumeMounted(volume.id, mounted)}
            />
          ))}
        </div>
      </Section>

      <Section title="Folder access" level={3} description="Deny access to make a folder unreadable at the next scan or operation.">
        <div className="space-y-2">
          <Label htmlFor={folderInput}>Filter folders</Label>
          <Input id={folderInput} placeholder="e.g. NGC7000" value={folderQuery} onChange={(e) => setFolderQuery(e.target.value)} />
          <div className="max-h-64 divide-y overflow-y-auto rounded-md border px-3">
            {shownFolders.map((folder) => {
              const registered = Object.values(locations).some((l) => isUnder(folder, l.path))
              return (
                <ToggleRow
                  key={folder}
                  label={folder.split("/").slice(-2).join("/")}
                  detail={`${folder}${registered ? "" : " · not registered"}`}
                  checked={denied.includes(folder)}
                  onChange={(value) => setFolderAccess(folder, value)}
                />
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">On = access denied.</p>
        </div>
      </Section>

      <Section title="Outside PlateVault" level={3} description="Changes another application or the user makes on disk.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={arrived} onClick={() => copyNewCaptures()}>
              Copy 2 Oct NGC 7000 captures to Astro-T7
            </Button>
            {arrived ? <span className="text-xs text-muted-foreground">Already copied. Rescan to index them.</span> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={pathInput}>File or folder path</Label>
            <Input id={pathInput} className="font-mono text-xs" placeholder="/Volumes/Astro-T7/…" value={path} onChange={(e) => setPath(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!fileAt(store.getState().disk, path)) return setPathMessage(`No file at ${path || "(empty path)"}. Enter the full path of an existing file.`)
                  modifyFileExternally(path)
                  setPathMessage(`Overwrote ${path} with new bytes. Restore original bytes puts them back.`)
                }}
              >
                Overwrite existing file
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!fileAt(store.getState().disk, path)) return setPathMessage(`No file at ${path || "(empty path)"}. Enter the full path of an existing file.`)
                  setPathMessage(
                    restoreFileExternally(path) ? `Restored the original bytes of ${path}.` : `${path} has not been overwritten, so there is nothing to restore.`,
                  )
                }}
              >
                Restore original bytes
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (fileAt(store.getState().disk, path)) return setPathMessage(`A file already exists at ${path}.`)
                  createExternalFile(path)
                  setPathMessage(fileAt(store.getState().disk, path) ? `Created ${path}.` : `Could not create ${path}: no mounted volume holds that path.`)
                }}
              >
                Create unrelated file
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!fileAt(store.getState().disk, path)) return setPathMessage(`No file at ${path || "(empty path)"}. Enter the full path of an existing file.`)
                  deleteFileExternally(path)
                  setPathMessage(`Deleted ${path} outside PlateVault. It is not in the OS Trash.`)
                }}
              >
                Delete outside PlateVault
              </Button>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor={destinationInput}>Copy into folder</Label>
                <Input
                  id={destinationInput}
                  className="font-mono text-xs"
                  placeholder="/Volumes/Spare/Captures"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path || !destination) return setPathMessage("Enter the file or folder to copy and the folder to copy it into.")
                  const outcome = copyFolderExternally(path, destination)
                  setPathMessage(outcome.ok ? `Copied ${outcome.copied} file${outcome.copied === 1 ? "" : "s"} byte for byte to ${outcome.destination}.` : outcome.message)
                }}
              >
                Copy byte for byte
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage("Enter a folder or file path first.")
                  const deny = !denied.includes(path)
                  setFolderAccess(path, deny)
                  setPathMessage(deny ? `Access denied: ${path}.` : `Access restored: ${path}.`)
                }}
              >
                {denied.includes(path) ? "Restore read access" : "Deny read access"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!path) return setPathMessage("Enter a folder or file path first.")
                  const readOnly = !readOnlyPaths.includes(path)
                  setPathReadOnly(path, readOnly)
                  setPathMessage(readOnly ? `Write permission removed: ${path}.` : `Write permission restored: ${path}.`)
                }}
              >
                {readOnlyPaths.includes(path) ? "Restore write permission" : "Remove write permission"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {pathMessage}
            </p>
          </div>
        </div>
      </Section>

      <Section title="Faults" level={3}>
        <div className="divide-y rounded-md border px-3">
          <ToggleRow label="Fail the next catalog write" checked={faults.failNextCatalogWrite} onChange={(value) => setFault("failNextCatalogWrite", value)} />
          <div className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-sm">Next notification permission answer</span>
            <Select
              items={[
                { value: "grant", label: "Allow" },
                { value: "deny", label: "Deny" },
              ]}
              value={faults.notificationResponse}
              onValueChange={(value) => setFault("notificationResponse", value === "deny" ? "deny" : "grant")}
            >
              <SelectTrigger size="sm" aria-label="Next notification permission answer" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="grant">Allow</SelectItem>
                <SelectItem value="deny">Deny</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ToggleRow
            label="Fail the next hash verification"
            detail="Archive transfer or master adoption"
            checked={faults.failNextHashVerification}
            onChange={(value) => setFault("failNextHashVerification", value)}
          />
          <ToggleRow
            label="Next revision-checked save is stale"
            detail="Another writer changes the record first"
            checked={faults.staleNextWrite}
            onChange={(value) => setFault("staleNextWrite", value)}
          />
          <ToggleRow
            label="Fail the next Target resolver lookup"
            detail="As if the network were unavailable"
            checked={faults.failNextResolverLookup}
            onChange={(value) => setFault("failNextResolverLookup", value)}
          />
        </div>
      </Section>

      <Section
        title="Clock"
        level={3}
        description={`PlateVault time: ${formatDateTime(new Date(Date.now() + faults.clockOffsetMs).toISOString())}${faults.clockOffsetMs ? " (set by this control; kept after reload)" : " (system clock)"}.`}
      >
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={clockInput}>Set PlateVault time</Label>
            <Input id={clockInput} type="datetime-local" className="w-56" value={clock} onChange={(e) => setClock(e.target.value)} />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (!clock || Number.isNaN(new Date(clock).getTime())) return setClockMessage("Enter a date and time first.")
              setClockTo(new Date(clock).toISOString())
              setClockMessage(`PlateVault time set to ${formatDateTime(new Date(clock).toISOString())}. It keeps running from there.`)
            }}
          >
            Set time
          </Button>
          {faults.clockOffsetMs !== 0 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                resetClock()
                setClockMessage("PlateVault uses the system clock again.")
              }}
            >
              Use system clock
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {clockMessage}
        </p>
      </Section>

      <Section title="Prototype data" level={3} description={`Current seed: ${seed === "demo" ? "demo library" : "empty library (first run)"}. Theme and density are kept.`}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setConfirmSeed("empty")}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Reset to empty library
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirmSeed("demo")}>
            Load demo library
          </Button>
        </div>
        <ConfirmDialog
          open={confirmSeed !== null}
          onOpenChange={(open) => !open && setConfirmSeed(null)}
          title={confirmSeed === "demo" ? "Load the demo library?" : "Reset to an empty library?"}
          description="This replaces all prototype data in this browser. It cannot be undone."
          changes={[
            confirmSeed === "demo"
              ? "Replace the catalog with the indexed demo library (M 31, NGC 7000, Heart and Soul mosaic)"
              : "Remove every location, session, Project and View; onboarding starts again",
            "Discard running operations and Activity",
          ]}
          unchanged={["Theme and density", "No real files exist; nothing on your computer is touched"]}
          confirmLabel={confirmSeed === "demo" ? "Load demo library" : "Reset to empty library"}
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
  const { panel } = useShellUi()
  // Initial focus on the heading, never on a switch: one Space press must not unmount a volume.
  const headingRef = useRef<HTMLHeadingElement>(null)
  return (
    <Sheet open={panel === "simulation"} onOpenChange={(open) => !open && closePanel()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" initialFocus={headingRef}>
        <SheetHeader>
          <SheetTitle ref={headingRef} tabIndex={-1} className="flex items-center gap-2 outline-none">
            <FlaskConical aria-hidden="true" className="size-4" />
            Simulation
          </SheetTitle>
          <SheetDescription>
            Prototype controls. They change the simulated disk outside PlateVault; PlateVault notices on its next read.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SimulationControls />
        </div>
      </SheetContent>
    </Sheet>
  )
}
