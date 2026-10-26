/**
 * In-app OS chooser (foundation-owned, HLD §8). Lists the volumes and folders
 * a `FolderSource` reads, including empty folders; offline volumes and
 * access-denied folders show their reason. `mode` picks what it returns, as
 * the native panels do: a folder (default), a file matching `filters`,
 * several files of one folder ("files", each press selects or clears one),
 * or an application bundle (the Applications folder is a root).
 * Choosing only returns a path: it never registers a location or writes
 * anything. Used for locations (T1), View folder parents (T4), storage
 * destinations (T5) and by `PathField` (fields.tsx).
 */
import { AppWindow, ArrowUp, ChevronRight, File, Folder, FolderLock, HardDrive } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"
import { PathText } from "./data"
import { ActionError, Notice } from "./feedback"

/** What the chooser returns: the current folder, a file, or an application bundle. */
export type PathPickerMode = "folder" | "file" | "executable"

/** One entry directly inside a listed folder. `app` is an application bundle, chosen like a file. */
export interface FolderEntry {
  path: string
  name: string
  kind: "folder" | "file" | "app"
  /** Read access denied: the folder is listed but its contents are not. */
  denied: boolean
}

/** A folder's direct entries, or that reading its contents was denied. */
export type FolderListing = { denied: false; entries: readonly FolderEntry[] } | { denied: true }

/** A place in the side list: one volume. */
export interface FolderRoot {
  id: string
  name: string
  mountPath: string
  mounted: boolean
}

/**
 * Where the chooser reads the disk. The library registers no folder-listing
 * command yet (astro-plan-wre19), so the shell that opens the chooser supplies
 * it. Keep `listFolder` stable (a module function or a memoized callback): a
 * new function lists the open folder again.
 */
export interface FolderSource {
  /** The volumes, in side-list order. */
  roots: readonly FolderRoot[]
  /** The folder's direct entries; rejects when the folder cannot be read at all. */
  listFolder: (path: string) => Promise<FolderListing>
}

interface FolderPickerBaseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Names the task, e.g. "Choose a capture folder". */
  title: string
  description?: string
  source: FolderSource
  /** Folder to open at. Falls back to the first mounted volume (Applications for `executable`) when it is on no mounted root. */
  initialPath?: string | null
  /** Verb of the primary action; the chosen name follows: "Choose Captures". */
  chooseVerb?: string
  /** File extensions `file` and `files` modes list, e.g. `[".fits", ".xisf"]`; every file when omitted. */
  filters?: readonly string[]
}

/** One path (default "folder"), or with `mode: "files"` the files selected in one folder, in list order. */
export type FolderPickerProps = FolderPickerBaseProps & ({ mode?: PathPickerMode; onChoose: (path: string) => void } | { mode: "files"; onChoose: (paths: string[]) => void })

/** The open folder's contents as the list shows them. */
type Listing = { state: "loading" } | { state: "listed"; entries: FolderEntry[] } | { state: "denied" } | { state: "failed" }

const APPLICATIONS_ID = "applications"
const APPLICATIONS = "/Applications"
const EXECUTABLE_EXTENSIONS = [".app", ".exe"]

const isUnder = (path: string, folder: string) => path === folder || path.startsWith(`${folder}/`)
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"))
const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)
const matches = (path: string, extensions: readonly string[] | undefined) => !extensions?.length || extensions.some((ext) => path.toLowerCase().endsWith(ext.toLowerCase()))
const byName = (a: FolderEntry, b: FolderEntry) => a.name.localeCompare(b.name)

function startPath(roots: readonly FolderRoot[], initialPath: string | null | undefined): string {
  if (initialPath && roots.some((root) => root.mounted && isUnder(initialPath, root.mountPath))) return initialPath
  return roots.find((root) => root.mounted)?.mountPath ?? "/"
}

/** The entries `mode` offers, folders first: folders only, or the files `filters` match, or application bundles. */
function shownEntries(entries: readonly FolderEntry[], mode: PathPickerMode, filters: readonly string[] | undefined): FolderEntry[] {
  const folders = entries.filter((entry) => entry.kind === "folder").sort(byName)
  if (mode === "folder") return folders
  const choosable =
    mode === "executable"
      ? entries.filter((entry) => entry.kind === "app" || (entry.kind === "file" && matches(entry.path, EXECUTABLE_EXTENSIONS))).map((entry): FolderEntry => ({ ...entry, kind: "app" }))
      : entries.filter((entry) => entry.kind === "file" && matches(entry.path, filters))
  return [...folders, ...choosable.sort(byName)]
}

export function FolderPicker(props: FolderPickerProps) {
  const { open, onOpenChange, title, description, source, initialPath, chooseVerb, filters } = props
  const many = props.mode === "files"
  const mode: PathPickerMode = props.mode === "files" ? "file" : (props.mode ?? "folder")
  const m = useMessages()
  const roots: readonly FolderRoot[] = mode === "executable" ? [{ id: APPLICATIONS_ID, name: m.folder_picker_applications(), mountPath: APPLICATIONS, mounted: true }, ...source.roots] : source.roots
  const [current, setCurrent] = useState(() => startPath(roots, initialPath))
  const [listing, setListing] = useState<Listing>({ state: "loading" })
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const listPane = useRef<HTMLDivElement>(null)
  const upButton = useRef<HTMLButtonElement>(null)
  const chooseButton = useRef<HTMLButtonElement>(null)
  const focusAfterMove = useRef(false)
  const { listFolder } = source
  // Each opening starts at the requested folder, as an OS dialog does.
  useEffect(() => {
    if (!open) return
    setCurrent(startPath(roots, initialPath))
    setSelected([])
  }, [open])
  useEffect(() => {
    if (!open) return
    let live = true
    setListing({ state: "loading" })
    listFolder(current).then(
      (result) => {
        if (live) setListing(result.denied ? { state: "denied" } : { state: "listed", entries: shownEntries(result.entries, mode, filters) })
      },
      () => {
        if (live) setListing({ state: "failed" })
      },
    )
    return () => {
      live = false
    }
  }, [open, current, attempt, listFolder, mode, filters])
  // Opening a folder replaces the control that was pressed: keep keyboard focus in the list once it is listed.
  useEffect(() => {
    if (!focusAfterMove.current || listing.state === "loading") return
    focusAfterMove.current = false
    const firstRow = listPane.current?.querySelector<HTMLElement>("[data-folder-row]")
    const up = upButton.current && !upButton.current.disabled ? upButton.current : null
    ;(firstRow ?? up ?? chooseButton.current)?.focus()
  }, [listing])

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

  const root = roots.find((r) => r.mounted && isUnder(current, r.mountPath))
  const entries = listing.state === "listed" ? listing.entries : []
  /** The selection in list order. */
  const inOrder = (paths: readonly string[]) => entries.filter((e) => paths.includes(e.path)).map((e) => e.path)
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
  const chosenName = chosen.length > 1 ? m.op_count_files({ count: chosen.length, n: formatCount(chosen.length) }) : chosen.length === 1 ? (choosesFolder ? currentName : nameOf(chosen[0]!)) : null
  // A failed listing announces itself (ActionError is an alert); loading says nothing until the list arrives.
  const liveText =
    listing.state === "denied"
      ? m.folder_picker_live_denied({ name: currentName })
      : listing.state !== "listed"
        ? ""
        : choosesFolder
          ? m.folder_picker_live_count({ name: currentName, count: entries.length })
          : m.folder_picker_live_items({ name: currentName, count: entries.length })

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
                      {volume.id === APPLICATIONS_ID ? <AppWindow aria-hidden="true" data-icon="inline-start" /> : <HardDrive aria-hidden="true" data-icon="inline-start" />}
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
            <div ref={listPane} className="max-h-80 min-h-0 flex-1 overflow-y-auto p-2" aria-busy={listing.state === "loading"}>
              <p className="sr-only" aria-live="polite">
                {open ? liveText : ""}
              </p>
              {listing.state === "loading" ? (
                <div className="flex justify-center px-2 py-6">
                  <Spinner />
                </div>
              ) : listing.state === "denied" ? (
                <Notice tone="warning" title={m.status_access_denied()} />
              ) : listing.state === "failed" ? (
                <ActionError className="px-2 py-6" message={m.folder_picker_list_failed({ name: currentName })} onRetry={() => setAttempt((n) => n + 1)} />
              ) : entries.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-muted-foreground">{choosesFolder ? m.folder_picker_empty() : m.folder_picker_empty_items()}</p>
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
