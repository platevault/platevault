/**
 * A small disk for the catalogue's FolderPicker, PathField and FilesField
 * specimens: two mounted volumes and an offline one, capture folders with
 * FITS and XISF files, an empty folder, an access-denied folder, and an
 * Applications folder with two application bundles. Listing answers after a
 * short delay, so the chooser shows its loading state. Catalogue only.
 */
import type { FolderEntry, FolderListing, FolderRoot, FolderSource } from "@/components/app/folder-picker"

/** Folders by path, with the names directly inside; a `/` in a name marks a folder, `!` a denied folder. */
const TREE: Record<string, readonly string[]> = {
  "/Volumes/Astro-T7": ["Captures/", "Calibration/", "Scratch/", "Locked!"],
  "/Volumes/Astro-T7/Captures": ["M31/", "NGC 7000/", "IC 5070/"],
  "/Volumes/Astro-T7/Captures/M31": ["2026-09-02/", "2026-09-18/"],
  "/Volumes/Astro-T7/Captures/M31/2026-09-18": ["Light_M31_L_300s_0001.fits", "Light_M31_L_300s_0002.fits", "Light_M31_L_300s_0003.fits", "notes.txt"],
  "/Volumes/Astro-T7/Captures/M31/2026-09-02": ["Light_M31_L_300s_0001.fits"],
  "/Volumes/Astro-T7/Captures/NGC 7000": ["Light_NGC7000_Ha_600s_0001.xisf", "Light_NGC7000_Ha_600s_0002.xisf"],
  "/Volumes/Astro-T7/Captures/IC 5070": [],
  "/Volumes/Astro-T7/Calibration": ["masterDark_300s.xisf", "masterFlat_Ha.xisf", "masterBias.xisf"],
  "/Volumes/Astro-T7/Scratch": [],
  "/Volumes/Astro": ["Captures/", "Processed/"],
  "/Volumes/Astro/Captures": ["Light_IC5070_OIII_600s_0001.fits", "Light_IC5070_OIII_600s_0002.fits"],
  "/Volumes/Astro/Processed": [],
  "/Applications": ["PixInsight.app", "Siril.app", "Utilities/"],
  "/Applications/Utilities": ["ASTAP.app"],
}

const DENIED = new Set(["/Volumes/Astro-T7/Locked"])

export const DISK_ROOTS: readonly FolderRoot[] = [
  { id: "astro", name: "Astro", mountPath: "/Volumes/Astro", mounted: true },
  { id: "astro-t7", name: "Astro-T7", mountPath: "/Volumes/Astro-T7", mounted: true },
  { id: "archive", name: "Archive", mountPath: "/Volumes/Archive", mounted: false },
]

/** The frame files a file chooser lists; one array, so the chooser does not list again on every render. */
export const FRAME_FILES: readonly string[] = [".fits", ".fit", ".xisf"]

function entry(folder: string, name: string): FolderEntry {
  const isFolder = name.endsWith("/") || name.endsWith("!")
  const bare = isFolder ? name.slice(0, -1) : name
  const path = `${folder}/${bare}`
  return { path, name: bare, kind: isFolder ? "folder" : bare.endsWith(".app") ? "app" : "file", denied: DENIED.has(path) }
}

/** The fixture disk's listing of `path`, after a short delay. */
export function listFixtureFolder(path: string): Promise<FolderListing> {
  return new Promise((resolve, reject) =>
    setTimeout(() => {
      if (DENIED.has(path)) resolve({ denied: true })
      else if (path in TREE) resolve({ denied: false, entries: TREE[path]!.map((name) => entry(path, name)) })
      else reject(new Error(`catalogue disk: no folder ${path}`))
    }, 150),
  )
}

/** The fixture disk as a chooser's source. */
export const FIXTURE_DISK: FolderSource = { roots: DISK_ROOTS, listFolder: listFixtureFolder }
