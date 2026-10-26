/**
 * Planned Views for the catalogue's ViewFolderTree specimens and its tests:
 * the folders the next Apply builds for three sample Projects, as the
 * library's plan would return them. Symlink trees count links (0 bytes);
 * copy trees count copies and their bytes. Catalogue and test only.
 */
import type { ViewFolderNode } from "@/components/domain/view-folder-tree"

/** A folder under `parent` with `entries` directly inside, each `bytes` big. */
function folder(parent: string, name: string, entries: number, bytes: number, children: (path: string) => ViewFolderNode[] = () => []): ViewFolderNode {
  const path = parent ? `${parent}/${name}` : name
  return { name, path, entries, bytes: entries * bytes, children: children(path) }
}

const root = (children: ViewFolderNode[]): ViewFolderNode => ({ name: "View", path: "", entries: 0, bytes: 0, children })

const FRAME = 62_000_000
const MASTER = 250_000_000

/** M 31: one group, so the nights and the shared Bias sit right under View; copies; this camera takes no darks. */
export const VIEW_ONE_GROUP: ViewFolderNode = root([
  folder("", "Bias", 1, MASTER),
  folder("", "NIGHT_2026-09-02", 0, 0, (night) => [folder(night, "Flats", 0, 0, (flats) => [folder(flats, "L", 1, MASTER)]), folder(night, "Lights", 0, 0, (lights) => [folder(lights, "L", 55, FRAME)])]),
  folder("", "NIGHT_2026-09-18", 0, 0, (night) => [folder(night, "Flats", 0, 0, (flats) => [folder(flats, "L", 1, MASTER)]), folder(night, "Lights", 0, 0, (lights) => [folder(lights, "L", 40, FRAME)])]),
])

const nightWith = (group: string, date: string, filter: string, lights: number) =>
  folder(group, `NIGHT_${date}`, 0, 0, (night) => [folder(night, "Flats", 0, 0, (flats) => [folder(flats, `${filter}_GAIN_100`, 1, 0)]), folder(night, "Lights", 0, 0, (sets) => [folder(sets, `${filter}_GAIN_100_300s`, lights, 0)])])

/** Cygnus HOO: two groups in GROUP_ folders, NIGHT_ folders, Lights and Flats per filter, Darks and Bias per group; symlinks. */
export const VIEW_GROUPS: ViewFolderNode = root([
  folder("", "GROUP_Esprit-100-ASI533MC", 0, 0, (group) => [folder(group, "Bias", 0, 0, (bias) => [folder(bias, "GAIN_101", 1, 0)]), folder(group, "Darks", 0, 0, (darks) => [folder(darks, "GAIN_101", 1, 0)]), nightWith(group, "2026-09-20", "OIII", 36)]),
  folder("", "GROUP_RedCat-51-ASI2600MM", 0, 0, (group) => [
    folder(group, "Bias", 0, 0, (bias) => [folder(bias, "GAIN_100", 1, 0)]),
    folder(group, "Darks", 0, 0, (darks) => [folder(darks, "GAIN_100_300s", 1, 0)]),
    nightWith(group, "2026-09-18", "Ha", 52),
    nightWith(group, "2026-09-20", "OIII", 48),
  ]),
])

/** Cygnus what-if: mixed dark versions, so every night folder carries its own Darks; copies. */
export const VIEW_MIXED: ViewFolderNode = root([
  folder("", "Bias", 1, MASTER),
  ...[
    ["2026-09-18", "Ha", 52],
    ["2026-09-20", "OIII", 48],
    ["2026-09-20-2", "Ha", 30],
  ].map(([date, filter, lights]) =>
    folder("", `NIGHT_${date}`, 0, 0, (night) => [
      folder(night, "Darks", 1, MASTER),
      folder(night, "Flats", 0, 0, (flats) => [folder(flats, String(filter), 1, MASTER)]),
      folder(night, "Lights", 0, 0, (sets) => [folder(sets, String(filter), Number(lights), FRAME)]),
    ]),
  ),
])

/** IC 5070 mosaic: each panel in its PANEL_ folder; symlinks. */
export const VIEW_PANELS: ViewFolderNode = root(
  [1, 2, 3].map((n) => folder("", `PANEL_Panel-${n}`, 0, 0, (panel) => [folder(panel, "Bias", 1, 0), nightWith(panel, "2026-09-20", "OIII", 24)])),
)

/** A plan that places nothing yet. */
export const VIEW_EMPTY: ViewFolderNode = root([])
