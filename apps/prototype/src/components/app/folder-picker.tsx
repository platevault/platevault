/**
 * Simulated OS folder chooser (foundation-owned, HLD §8). Lists volumes and
 * folders from the simulated disk, including empty folders; offline volumes
 * and access-denied folders show their reason. Choosing only returns a path:
 * it never registers a location or writes anything. Used for locations (T1),
 * View folder parents (T4) and storage destinations (T5).
 */
import { ArrowUp, ChevronRight, Folder, FolderLock, HardDrive } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { listFolders, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import type { Disk, Volume } from "@/domain/types"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { PathText } from "./data"
import { Notice } from "./feedback"

export interface FolderPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the task, e.g. "Choose a capture folder". */
  title: string
  description?: string
  /** Folder to open at. Falls back to the first mounted volume when it is offline or unknown. */
  initialPath?: string | null
  /** Verb of the primary action; the folder name follows: "Choose Captures". */
  chooseVerb?: string
  onChoose: (path: string) => void
}

/** One entry per mount path: the mounted volume wins (the impostor Archive shares a path). */
function volumeRoots(disk: Disk): Volume[] {
  const byPath = new Map<string, Volume>()
  for (const volume of Object.values(disk.volumes)) {
    const seen = byPath.get(volume.mountPath)
    if (!seen || (!seen.mounted && volume.mounted)) byPath.set(volume.mountPath, volume)
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function startPath(disk: Disk, initialPath: string | null | undefined): string {
  const volumeId = initialPath ? volumeForPath(disk, initialPath) : null
  if (initialPath && volumeId && disk.volumes[volumeId]?.mounted) return initialPath
  return volumeRoots(disk).find((v) => v.mounted)?.mountPath ?? "/Volumes"
}

export function FolderPicker({ open, onOpenChange, title, description, initialPath, chooseVerb = "Choose", onChoose }: FolderPickerProps) {
  const disk = useStore((s) => s.disk)
  const [current, setCurrent] = useState(() => startPath(disk, initialPath))
  const listPane = useRef<HTMLDivElement>(null)
  const upButton = useRef<HTMLButtonElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef(false)
  // Each opening starts at the requested folder, as an OS dialog does; later disk changes do not move it.
  useEffect(() => {
    if (open) setCurrent(startPath(disk, initialPath))
  }, [open])
  // Opening a folder replaces the control that was pressed: keep keyboard focus in the list.
  useEffect(() => {
    if (!focusAfterMove.current) return
    focusAfterMove.current = false
    const firstRow = listPane.current?.querySelector<HTMLElement>("[data-folder-row]")
    const up = upButton.current && !upButton.current.disabled ? upButton.current : null
    ;(firstRow ?? up ?? chooseButton.current)?.focus()
  }, [current])

  function openFolder(path: string) {
    focusAfterMove.current = true
    setCurrent(path)
  }

  const roots = volumeRoots(disk)
  const root = roots.find((v) => v.mounted && isUnder(current, v.mountPath))
  const folders = listFolders(disk, current)
  const denied = disk.deniedPaths.some((p) => isUnder(current, p))
  const crumbs = root
    ? [root.mountPath, ...current.slice(root.mountPath.length).split("/").filter(Boolean)].map((_, index, parts) =>
        index === 0 ? root.mountPath : `${root.mountPath}/${parts.slice(1, index + 1).join("/")}`,
      )
    : []
  const parent = root && current !== root.mountPath ? current.slice(0, current.lastIndexOf("/")) : null
  const currentName = root && current === root.mountPath ? root.name : current.slice(current.lastIndexOf("/") + 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Start where the user is: the first folder, else the current volume (never another volume).
        initialFocus={() =>
          listPane.current?.querySelector<HTMLElement>("[data-folder-row]") ?? document.querySelector<HTMLElement>('nav[aria-label="Volumes"] [aria-current="location"]')
        }
      >
        <DialogHeader className="border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description ?? "Prototype folder chooser: volumes and folders come from the simulated disk."}</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-72 grid-cols-[11rem_minmax(0,1fr)]">
          <nav aria-label="Volumes" className="border-r p-2">
            <ul className="space-y-0.5">
              {roots.map((volume) => {
                const active = volume.mounted && isUnder(current, volume.mountPath)
                return (
                  <li key={volume.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!volume.mounted}
                      aria-current={active ? "location" : undefined}
                      aria-describedby={volume.mounted ? undefined : `${volume.id}-offline`}
                      className={cn("w-full justify-start", active && "bg-primary/10 text-foreground")}
                      onClick={() => setCurrent(volume.mountPath)}
                    >
                      <HardDrive aria-hidden="true" data-icon="inline-start" />
                      <span className="truncate">{volume.name}</span>
                    </Button>
                    {volume.mounted ? null : (
                      <p id={`${volume.id}-offline`} className="pl-8 text-xs text-muted-foreground">
                        Offline
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <Button ref={upButton} variant="ghost" size="icon-sm" disabled={!parent} aria-label="Up one folder" onClick={() => parent && openFolder(parent)}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <nav aria-label="Folder path" className="min-w-0 flex-1">
                <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
                  {crumbs.map((crumb, index) => {
                    const last = index === crumbs.length - 1
                    const label = index === 0 && root ? root.name : crumb.slice(crumb.lastIndexOf("/") + 1)
                    return (
                      <li key={crumb} className="flex min-w-0 items-center gap-0.5">
                        {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                        {last ? (
                          <span aria-current="location" className="truncate px-1.5 font-medium text-foreground">
                            {label}
                          </span>
                        ) : (
                          <Button variant="ghost" size="sm" className="px-1.5 font-normal text-muted-foreground hover:text-foreground hover:underline" onClick={() => openFolder(crumb)}>
                            {label}
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </nav>
            </div>
            <div ref={listPane} className="max-h-80 min-h-0 flex-1 overflow-y-auto p-2">
              <p className="sr-only" aria-live="polite">
                {open ? `${currentName}: ${denied ? "access denied" : `${folders.length} ${folders.length === 1 ? "folder" : "folders"}`}` : ""}
              </p>
              {denied ? (
                <Notice tone="warning" title="Access denied">
                  PlateVault cannot list this folder. You can still choose it; indexing reports it as unreadable until access is restored.
                </Notice>
              ) : folders.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                  No folders inside {currentName}. Choose this folder, or go up one level.
                </p>
              ) : (
                <ul aria-label={`Folders in ${currentName}`} className="space-y-0.5">
                  {folders.map((folder) => (
                    <li key={folder.path}>
                      <Button data-folder-row variant="ghost" size="sm" className="w-full justify-start" onClick={() => openFolder(folder.path)}>
                        {folder.denied ? <FolderLock aria-hidden="true" data-icon="inline-start" /> : <Folder aria-hidden="true" data-icon="inline-start" />}
                        <span className="truncate">{folder.name}</span>
                        {folder.denied ? <span className="ml-auto text-xs text-muted-foreground">Access denied</span> : null}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="bottom-0 m-0 items-center rounded-b-xl sm:justify-between">
          <PathText path={current} className="min-w-0 text-muted-foreground" />
          <div className="flex shrink-0 gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              ref={chooseButton}
              onClick={() => {
                onChoose(current)
                onOpenChange(false)
              }}
            >
              {chooseVerb} {currentName}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
