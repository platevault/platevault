/**
 * Simulated OS chooser (foundation-owned, HLD §8). Lists volumes and folders
 * from the simulated disk, including empty folders; offline volumes and
 * access-denied folders show their reason. `mode` picks what it returns, as
 * the native panels do: a folder (default), a file matching `filters`,
 * several files of one folder ("files", each press selects or clears one),
 * or an application bundle (the simulated computer's Applications folder is a root).
 * Choosing only returns a path: it never registers a location or writes
 * anything. Used for locations (T1), View folder parents (T4), storage
 * destinations (T5) and by `PathField` (fields.tsx).
 */
import { AppWindow, ArrowUp, ChevronRight, File, Folder, FolderLock, HardDrive } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { filesUnder, listFolders, volumeForPath } from "@/domain/disk"
import { isUnder } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import type { Disk } from "@/domain/types"
import { say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { PathText } from "./data"
import { Notice } from "./feedback"

/** What the chooser returns: the current folder, a file, or an application bundle. */
export type PathPickerMode = "folder" | "file" | "executable"

interface FolderPickerBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the task, e.g. "Choose a capture folder". */
  title: string
  description?: string
  /** Folder to open at. Falls back to the first mounted volume (Applications for `executable`) when it is offline or unknown. */
  initialPath?: string | null
  /** Verb of the primary action; the chosen name follows: "Choose Captures". */
  chooseVerb?: string
  /** File extensions `file` and `files` modes list, e.g. `[".fits", ".xisf"]`; every file when omitted. */
  filters?: readonly string[]
}

/** One path (default "folder"), or with `mode: "files"` the files selected in one folder, in list order. */
export type FolderPickerProps = FolderPickerBaseProps & ({ mode?: PathPickerMode; onChoose: (path: string) => void } | { mode: "files"; onChoose: (paths: string[]) => void })

/** A place in the side list: a volume, or the Applications folder in `executable` mode. */
interface Root {
  id: string
  name: string
  mountPath: string
  mounted: boolean
}

interface Entry {
  path: string
  name: string
  kind: "folder" | "file" | "app"
  /** Read access denied: the folder is listed but its contents are not. */
  denied: boolean
}

const APPLICATIONS = "/Applications"
const EXECUTABLE_EXTENSIONS = [".app", ".exe"]

/** One entry per mount path: the mounted volume wins (the impostor Archive shares a path). */
function volumeRoots(disk: Disk): Root[] {
  const byPath = new Map<string, Root>()
  for (const volume of Object.values(disk.volumes)) {
    const seen = byPath.get(volume.mountPath)
    if (!seen || (!seen.mounted && volume.mounted)) byPath.set(volume.mountPath, volume)
  }
  return [...byPath.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"))
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)
const matches = (path: string, extensions: readonly string[] | undefined) => !extensions?.length || extensions.some((ext) => path.toLowerCase().endsWith(ext.toLowerCase()))

function startPath(disk: Disk, roots: Root[], initialPath: string | null | undefined): string {
  if (initialPath && roots.some((r) => r.id === "applications") && isUnder(initialPath, APPLICATIONS)) return initialPath
  const volumeId = initialPath ? volumeForPath(disk, initialPath) : null
  if (initialPath && volumeId && disk.volumes[volumeId]?.mounted) return initialPath
  return roots.find((v) => v.mounted)?.mountPath ?? "/Volumes"
}

/** The application bundles and the folders that lead to them, directly inside `folder`. */
function applicationEntries(disk: Disk, folder: string): Entry[] {
  const apps = disk.apps.filter((app) => app.present && isUnder(app.path, folder) && app.path !== folder)
  const entries = new Map<string, Entry>()
  for (const app of apps) {
    if (parentOf(app.path) === folder) {
      entries.set(app.path, { path: app.path, name: nameOf(app.path), kind: "app", denied: false })
      continue
    }
    const child = `${folder}/${app.path.slice(folder.length + 1).split("/")[0]}`
    if (!entries.has(child)) entries.set(child, { path: child, name: nameOf(child), kind: "folder", denied: false })
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function entriesIn(disk: Disk, folder: string, mode: PathPickerMode, filters: readonly string[] | undefined): Entry[] {
  if (mode === "executable" && isUnder(folder, APPLICATIONS)) return applicationEntries(disk, folder)
  const folders = listFolders(disk, folder).map((f): Entry => ({ path: f.path, name: f.name, kind: "folder", denied: f.denied }))
  if (mode === "folder") return folders
  const extensions = mode === "executable" ? EXECUTABLE_EXTENSIONS : filters
  const fileKind: Entry["kind"] = mode === "executable" ? "app" : "file"
  const files = filesUnder(disk, folder)
    .filter((f) => parentOf(f.path) === folder && matches(f.path, extensions))
    .map((f): Entry => ({ path: f.path, name: nameOf(f.path), kind: fileKind, denied: false }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return [...folders, ...files]
}

export function FolderPicker(props: FolderPickerProps) {
  const { open, onOpenChange, title, description, initialPath, chooseVerb, filters } = props
  const many = props.mode === "files"
  const mode: PathPickerMode = props.mode === "files" ? "file" : (props.mode ?? "folder")
  const m = useMessages()
  const disk = useStore((s) => s.disk)
  const roots: Root[] = mode === "executable" ? [{ id: "applications", name: m.folder_picker_applications(), mountPath: APPLICATIONS, mounted: true }, ...volumeRoots(disk)] : volumeRoots(disk)
  const [current, setCurrent] = useState(() => startPath(disk, roots, initialPath))
  const [selected, setSelected] = useState<string[]>([])
  const listPane = useRef<HTMLDivElement>(null)
  const upButton = useRef<HTMLButtonElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef(false)
  // Each opening starts at the requested folder, as an OS dialog does; later disk changes do not move it.
  useEffect(() => {
    if (!open) return
    setCurrent(startPath(disk, roots, initialPath))
    setSelected([])
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
    setSelected([])
    setCurrent(path)
  }

  function choose(paths: string[]) {
    if (props.mode === "files") props.onChoose(paths)
    else props.onChoose(paths[0]!)
    onOpenChange(false)
  }

  /** A press selects a file; with several files it selects or clears that one. */
  function press(path: string) {
    setSelected(!many ? [path] : selected.includes(path) ? selected.filter((p) => p !== path) : [...selected, path])
  }

  const root = roots.find((v) => v.mounted && isUnder(current, v.mountPath))
  const entries = entriesIn(disk, current, mode, filters)
  /** The selection in list order. */
  const inOrder = (paths: readonly string[]) => entries.filter((e) => paths.includes(e.path)).map((e) => e.path)
  const denied = disk.deniedPaths.some((p) => isUnder(current, p))
  const crumbs = root
    ? [root.mountPath, ...current.slice(root.mountPath.length).split("/").filter(Boolean)].map((_, index, parts) =>
        index === 0 ? root.mountPath : `${root.mountPath}/${parts.slice(1, index + 1).join("/")}`,
      )
    : []
  const parent = root && current !== root.mountPath ? parentOf(current) : null
  const currentName = root && current === root.mountPath ? root.name : nameOf(current)
  const choosesFolder = mode === "folder"
  const chosen = choosesFolder ? [current] : inOrder(selected)
  const verb = chooseVerb ?? m.verb_choose()
  const chosenName = chosen.length > 1 ? say(m, unitCount("files", chosen.length)) : chosen.length === 1 ? (choosesFolder ? currentName : nameOf(chosen[0]!)) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 p-0 sm:max-w-2xl"
        // Start where the user is: the first folder, else the current volume (never another volume).
        initialFocus={() =>
          listPane.current?.querySelector<HTMLElement>("[data-folder-row]") ?? document.querySelector<HTMLElement>('nav[data-volumes] [aria-current="location"]')
        }
      >
        <DialogHeader className="border-b p-4">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="grid min-h-72 grid-cols-[11rem_minmax(0,1fr)]">
          <nav aria-label={m.folder_picker_volumes()} data-volumes className="border-r p-2">
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
                      onClick={() => openFolder(volume.mountPath)}
                    >
                      {volume.id === "applications" ? <AppWindow aria-hidden="true" data-icon="inline-start" /> : <HardDrive aria-hidden="true" data-icon="inline-start" />}
                      <span className="truncate">{volume.name}</span>
                    </Button>
                    {volume.mounted ? null : (
                      <p id={`${volume.id}-offline`} className="pl-8 text-xs text-muted-foreground">
                        {m.status_offline()}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1 border-b px-2 py-1.5">
              <Button ref={upButton} variant="ghost" size="icon-sm" disabled={!parent} aria-label={m.folder_picker_up()} onClick={() => parent && openFolder(parent)}>
                <ArrowUp aria-hidden="true" />
              </Button>
              <nav aria-label={m.folder_picker_path()} className="min-w-0 flex-1">
                <ol className="flex min-w-0 flex-wrap items-center gap-0.5 text-sm">
                  {crumbs.map((crumb, index) => {
                    const last = index === crumbs.length - 1
                    const label = index === 0 && root ? root.name : nameOf(crumb)
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
                {open
                  ? denied
                    ? m.folder_picker_live_denied({ name: currentName })
                    : choosesFolder
                      ? m.folder_picker_live_count({ name: currentName, count: entries.length })
                      : m.folder_picker_live_items({ name: currentName, count: entries.length })
                  : ""}
              </p>
              {denied ? (
                <Notice tone="warning" title={m.status_access_denied()}>
                  {m.folder_picker_denied_body()}
                </Notice>
              ) : entries.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">{choosesFolder ? m.folder_picker_empty({ name: currentName }) : m.folder_picker_empty_items({ name: currentName })}</p>
              ) : (
                <ul aria-label={choosesFolder ? m.folder_picker_list({ name: currentName }) : m.folder_picker_contents({ name: currentName })} className="space-y-0.5">
                  {entries.map((entry) => (
                    <li key={entry.path}>
                      {entry.kind === "folder" ? (
                        <Button data-folder-row variant="ghost" size="sm" className="w-full justify-start" onClick={() => openFolder(entry.path)}>
                          {entry.denied ? <FolderLock aria-hidden="true" data-icon="inline-start" /> : <Folder aria-hidden="true" data-icon="inline-start" />}
                          <span className="truncate">{entry.name}</span>
                          {entry.denied ? <span className="ml-auto text-xs text-muted-foreground">{m.status_access_denied()}</span> : null}
                        </Button>
                      ) : (
                        // A file is selected by a press and chosen by a double press or the Choose button, as in the OS panel.
                        <Button
                          data-folder-row
                          variant="ghost"
                          size="sm"
                          aria-pressed={selected.includes(entry.path)}
                          className={cn("w-full justify-start", selected.includes(entry.path) && "bg-primary/10 text-foreground")}
                          onClick={() => press(entry.path)}
                          // The two presses before it toggled the file back: a double press chooses the selection with this file.
                          onDoubleClick={() => choose(many ? inOrder([...selected, entry.path]) : [entry.path])}
                        >
                          {entry.kind === "app" ? <AppWindow aria-hidden="true" data-icon="inline-start" /> : <File aria-hidden="true" data-icon="inline-start" />}
                          <span className="truncate">{entry.name}</span>
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="bottom-0 m-0 items-center rounded-b-xl sm:justify-between">
          <PathText path={chosen.length === 1 ? chosen[0]! : current} className="min-w-0 text-muted-foreground" />
          <div className="flex shrink-0 gap-2">
            <DialogClose render={<Button variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button ref={chooseButton} disabled={chosen.length === 0} onClick={() => chosen.length > 0 && choose(chosen)}>
              {chosenName ? `${verb} ${chosenName}` : verb}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
