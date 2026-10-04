/**
 * T5 shared pieces: the labelled prototype-controls box, the simulated OS
 * file chooser for Attach Result, and small formatting helpers.
 */
import { ArrowUp, ChevronRight, File as FileIcon, FlaskConical, Folder, HardDrive } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { PathText } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { listFolders, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { DiskFile } from "@/domain/types"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { baseName, parentFolder } from "./lib/files"
import type { ControlOutcome } from "./lib/prototype"

export function shortSha(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 12)}…` : "—"
}

/**
 * Reveal location: the desktop app opens the folder in Finder. The prototype
 * has no Finder, so it shows the folder and copies its path.
 */
export function RevealLocation({ path, label = "Reveal location" }: { path: string; label?: string }) {
  const [copied, setCopied] = useState<string | null>(null)
  return (
    <Popover>
      <PopoverTrigger render={<Button size="sm" variant="outline" />}>{label}</PopoverTrigger>
      <PopoverContent className="w-96">
        <PopoverHeader>
          <PopoverTitle>Location</PopoverTitle>
          <PopoverDescription>Prototype: the desktop app reveals this folder in Finder.</PopoverDescription>
        </PopoverHeader>
        <PathText path={path} />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                .writeText(path)
                .then(() => setCopied("Path copied."))
                .catch(() => setCopied("Copy failed: the browser refused clipboard access. Select the path above instead."))
            }
          >
            Copy path
          </Button>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {copied ?? ""}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Prototype controls stand in for events outside PlateVault. They are
 * labelled as such and never write the catalog.
 */
export function PrototypeControls({ title = "Prototype controls", description, children, outcome }: { title?: string; description: ReactNode; children: ReactNode; outcome?: ControlOutcome | null }) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border border-dashed p-4">
      <div className="flex items-start gap-2">
        <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-pretty text-muted-foreground">Prototype: changes the simulated disk outside PlateVault. {description}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
      <p aria-live="polite" className={cn("text-xs text-pretty", outcome && !outcome.ok ? "text-destructive" : "text-muted-foreground")}>
        {outcome?.message ?? ""}
      </p>
    </section>
  )
}

interface FileChooserProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initialPath: string | null
  onChoose: (file: DiskFile) => void
}

/**
 * Simulated OS file chooser (prototype). Lists volumes, folders and files from
 * the simulated disk; choosing returns a file and writes nothing.
 */
export function FileChooser({ open, onOpenChange, title, initialPath, onChoose }: FileChooserProps) {
  const disk = useStore((s) => s.disk)
  const start = () => {
    const volumeId = initialPath ? volumeForPath(disk, initialPath) : null
    if (initialPath && volumeId && disk.volumes[volumeId]?.mounted) return initialPath
    return Object.values(disk.volumes).find((v) => v.mounted)?.mountPath ?? "/Volumes"
  }
  const [current, setCurrent] = useState(start)
  const [selected, setSelected] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) {
      setCurrent(start())
      setSelected(null)
    }
  }, [open])
  const volumes = Object.values(disk.volumes)
    .filter((v, _i, all) => v.mounted || !all.some((o) => o.mounted && o.mountPath === v.mountPath))
    .filter((v, i, all) => all.findIndex((o) => o.mountPath === v.mountPath) === i)
    .sort((a, b) => a.name.localeCompare(b.name))
  const root = volumes.find((v) => v.mounted && isUnder(current, v.mountPath))
  const folders = listFolders(disk, current)
  const files = root
    ? Object.values(disk.files)
        .filter((f) => f.volumeId === root.id && parentFolder(f.path) === current && !f.linkTarget)
        .sort((a, b) => a.path.localeCompare(b.path))
    : []
  const parent = root && current !== root.mountPath ? parentFolder(current) : null
  const chosen = files.find((f) => f.path === selected) ?? null
  const go = (path: string) => {
    setCurrent(path)
    setSelected(null)
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>("[data-chooser-row]")?.focus())
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className="border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Prototype file chooser: volumes, folders and files come from the simulated disk.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-72 grid-cols-[11rem_minmax(0,1fr)]">
          <nav aria-label="Volumes" className="border-r p-2">
            <ul className="space-y-0.5">
              {volumes.map((volume) => (
                <li key={volume.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!volume.mounted}
                    aria-current={root?.id === volume.id ? "location" : undefined}
                    aria-describedby={volume.mounted ? undefined : `${volume.id}-chooser-offline`}
                    className={cn("w-full justify-start", root?.id === volume.id && "bg-primary/10 text-foreground")}
                    onClick={() => go(volume.mountPath)}
                  >
                    <HardDrive aria-hidden="true" data-icon="inline-start" />
                    <span className="truncate">{volume.name}</span>
                  </Button>
                  {volume.mounted ? null : (
                    <p id={`${volume.id}-chooser-offline`} className="pl-8 text-xs text-muted-foreground">
                      Offline
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <Button variant="ghost" size="icon-sm" disabled={!parent} aria-label="Up one folder" onClick={() => parent && go(parent)}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <PathText path={current} className="min-w-0 text-muted-foreground" />
            </div>
            <div ref={list} className="max-h-80 min-h-0 flex-1 overflow-y-auto p-2">
              <p className="sr-only" aria-live="polite">
                {open ? `${baseName(current) || current}: ${folders.length} folders, ${files.length} files` : ""}
              </p>
              {disk.deniedPaths.some((p) => isUnder(current, p)) ? (
                <Notice tone="warning" title="Access denied">
                  PlateVault cannot list this folder.
                </Notice>
              ) : folders.length === 0 && files.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">This folder is empty. Go up one level or choose another volume.</p>
              ) : (
                <ul aria-label={`Contents of ${baseName(current) || current}`} className="space-y-0.5">
                  {folders.map((folder) => (
                    <li key={folder.path}>
                      <Button data-chooser-row variant="ghost" size="sm" className="w-full justify-start" disabled={folder.denied} onClick={() => go(folder.path)}>
                        <Folder aria-hidden="true" data-icon="inline-start" />
                        <span className="truncate">{folder.name}</span>
                        <ChevronRight aria-hidden="true" className="ml-auto" />
                      </Button>
                    </li>
                  ))}
                  {files.map((file) => (
                    <li key={file.path}>
                      <Button
                        data-chooser-row
                        variant="ghost"
                        size="sm"
                        aria-pressed={selected === file.path}
                        className={cn("w-full justify-start", selected === file.path && "bg-primary/10 text-foreground")}
                        onClick={() => setSelected(file.path)}
                        onDoubleClick={() => {
                          onChoose(file)
                          onOpenChange(false)
                        }}
                      >
                        <FileIcon aria-hidden="true" data-icon="inline-start" />
                        <span className="truncate">{baseName(file.path)}</span>
                        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{formatBytes(file.sizeBytes)}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="m-0 items-center rounded-b-xl sm:justify-between">
          <span className="min-w-0 text-xs text-muted-foreground">{chosen ? baseName(chosen.path) : "No file selected"}</span>
          <div className="flex shrink-0 gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              disabled={!chosen}
              onClick={() => {
                if (!chosen) return
                onChoose(chosen)
                onOpenChange(false)
              }}
            >
              {chosen ? `Choose ${baseName(chosen.path)}` : "Choose file"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
