/**
 * Bundled offline catalogues and the SIMBAD fixture (slice E, S10).
 *
 * Production ships the Messier, NGC, IC, Sharpless, LBN, LDN, Caldwell and
 * Barnard catalogues and queries SIMBAD through the resolver (PLAN-TGT-FR-02,
 * PLAN-TGT-FR-03). The prototype bundles a representative subset with
 * catalogued sizes and coordinates; the SIMBAD set is fixture data that
 * "resolves" only objects outside the bundled subset. Foundation candidate:
 * move these next to `SKY_OBJECTS` in `src/domain/sky.ts`.
 */
import { normalizeName } from "@/domain/sky"

export const CATALOGUES = ["Messier", "NGC", "IC", "Sharpless", "LBN", "LDN", "Caldwell", "Barnard"] as const
export type CatalogueId = (typeof CATALOGUES)[number]

export interface CatalogueEntry {
  designation: string
  aliases: string[]
  catalogues: CatalogueId[]
  ra: number
  dec: number
  sizeDeg: { width: number; height: number }
  objectType: string
}

function e(designation: string, aliases: string[], catalogues: CatalogueId[], ra: number, dec: number, width: number, height: number, objectType: string): CatalogueEntry {
  return { designation, aliases, catalogues, ra, dec, sizeDeg: { width, height }, objectType }
}

export const BUNDLED: CatalogueEntry[] = [
  e("M 1", ["Crab Nebula", "NGC 1952"], ["Messier", "NGC"], 83.63, 22.01, 0.12, 0.08, "Supernova remnant"),
  e("M 8", ["Lagoon Nebula", "NGC 6523"], ["Messier", "NGC"], 270.9, -24.38, 1.5, 0.6, "Emission nebula"),
  e("M 13", ["Hercules Cluster", "NGC 6205"], ["Messier", "NGC"], 250.42, 36.46, 0.33, 0.33, "Globular cluster"),
  e("M 16", ["Eagle Nebula", "NGC 6611"], ["Messier", "NGC"], 274.7, -13.81, 0.6, 0.5, "Emission nebula"),
  e("M 20", ["Trifid Nebula", "NGC 6514"], ["Messier", "NGC"], 270.6, -23.03, 0.47, 0.47, "Emission nebula"),
  e("M 27", ["Dumbbell Nebula", "NGC 6853"], ["Messier", "NGC"], 299.9, 22.72, 0.13, 0.1, "Planetary nebula"),
  e("M 31", ["Andromeda Galaxy", "NGC 224", "Messier 31"], ["Messier", "NGC"], 10.685, 41.269, 3.2, 1.0, "Spiral galaxy"),
  e("M 33", ["Triangulum Galaxy", "NGC 598"], ["Messier", "NGC"], 23.462, 30.66, 1.2, 0.7, "Spiral galaxy"),
  e("M 42", ["Orion Nebula", "NGC 1976"], ["Messier", "NGC"], 83.82, -5.39, 1.1, 1.0, "Emission nebula"),
  e("M 45", ["Pleiades"], ["Messier"], 56.75, 24.12, 1.8, 1.8, "Open cluster with reflection nebula"),
  e("M 51", ["Whirlpool Galaxy", "NGC 5194"], ["Messier", "NGC"], 202.47, 47.2, 0.18, 0.12, "Spiral galaxy"),
  e("M 57", ["Ring Nebula", "NGC 6720"], ["Messier", "NGC"], 283.4, 33.03, 0.04, 0.03, "Planetary nebula"),
  e("M 81", ["Bode's Galaxy", "NGC 3031"], ["Messier", "NGC"], 148.89, 69.07, 0.45, 0.23, "Spiral galaxy"),
  e("M 82", ["Cigar Galaxy", "NGC 3034"], ["Messier", "NGC"], 148.97, 69.68, 0.18, 0.08, "Starburst galaxy"),
  e("M 97", ["Owl Nebula", "NGC 3587"], ["Messier", "NGC"], 168.7, 55.02, 0.06, 0.06, "Planetary nebula"),
  e("M 101", ["Pinwheel Galaxy", "NGC 5457"], ["Messier", "NGC"], 210.8, 54.35, 0.48, 0.45, "Spiral galaxy"),
  e("NGC 104", ["47 Tucanae", "Caldwell 106"], ["NGC", "Caldwell"], 6.024, -72.081, 0.5, 0.5, "Globular cluster"),
  e("NGC 281", ["Pacman Nebula", "Sh2-184"], ["NGC", "Sharpless"], 13.2, 56.6, 0.58, 0.5, "Emission nebula"),
  e("NGC 869", ["Double Cluster", "Caldwell 14"], ["NGC", "Caldwell"], 34.75, 57.13, 0.5, 0.5, "Open cluster"),
  e("NGC 891", ["Caldwell 23"], ["NGC", "Caldwell"], 35.64, 42.35, 0.22, 0.05, "Edge-on spiral galaxy"),
  e("NGC 2237", ["Rosette Nebula", "Caldwell 49", "Sh2-275"], ["NGC", "Caldwell", "Sharpless"], 97.98, 4.95, 1.3, 1.3, "Emission nebula"),
  e("NGC 6888", ["Crescent Nebula", "Caldwell 27"], ["NGC", "Caldwell"], 303.0, 38.35, 0.33, 0.2, "Emission nebula"),
  e("NGC 6960", ["Western Veil Nebula", "Witch's Broom", "Caldwell 34"], ["NGC", "Caldwell"], 311.42, 30.71, 1.2, 0.3, "Supernova remnant"),
  e("NGC 6992", ["Eastern Veil Nebula", "Caldwell 33"], ["NGC", "Caldwell"], 314.0, 31.7, 1.0, 0.5, "Supernova remnant"),
  e("NGC 7000", ["North America Nebula", "Caldwell 20"], ["NGC", "Caldwell"], 314.75, 44.53, 2.0, 1.7, "Emission nebula"),
  e("NGC 7293", ["Helix Nebula", "Caldwell 63"], ["NGC", "Caldwell"], 337.41, -20.84, 0.27, 0.27, "Planetary nebula"),
  e("NGC 7331", ["Caldwell 30"], ["NGC", "Caldwell"], 339.27, 34.42, 0.17, 0.07, "Spiral galaxy"),
  e("NGC 7380", ["Wizard Nebula", "Sh2-142"], ["NGC", "Sharpless"], 341.8, 58.1, 0.4, 0.4, "Emission nebula"),
  e("NGC 7635", ["Bubble Nebula", "Caldwell 11", "Sh2-162"], ["NGC", "Caldwell", "Sharpless"], 350.2, 61.2, 0.25, 0.17, "Emission nebula"),
  e("IC 434", ["Horsehead Nebula", "Barnard 33"], ["IC", "Barnard"], 85.25, -2.46, 1.0, 0.5, "Dark nebula"),
  e("IC 1396", ["Elephant's Trunk Nebula", "Sh2-131"], ["IC", "Sharpless"], 324.7, 57.5, 3.0, 2.5, "Emission nebula"),
  e("IC 1805", ["Heart Nebula", "Sh2-190"], ["IC", "Sharpless"], 38.2, 61.45, 1.2, 1.2, "Emission nebula"),
  e("IC 1848", ["Soul Nebula", "Sh2-199"], ["IC", "Sharpless"], 42.8, 60.43, 1.2, 0.9, "Emission nebula"),
  e("IC 5070", ["Pelican Nebula"], ["IC"], 312.75, 44.37, 1.0, 0.8, "Emission nebula"),
  e("IC 5146", ["Cocoon Nebula", "Caldwell 19", "Sh2-125"], ["IC", "Caldwell", "Sharpless"], 328.4, 47.27, 0.2, 0.2, "Emission nebula"),
  e("Sh2-129", ["Flying Bat Nebula"], ["Sharpless"], 318.5, 60.2, 2.2, 1.6, "Emission nebula"),
  e("Sh2-240", ["Simeis 147", "Spaghetti Nebula"], ["Sharpless"], 85.0, 28.0, 3.3, 3.3, "Supernova remnant"),
  e("LBN 437", ["Gecko Nebula"], ["LBN"], 337.2, 55.9, 0.8, 0.6, "Reflection nebula"),
  e("LDN 1235", ["Shark Nebula"], ["LDN"], 333.3, 73.4, 1.0, 0.6, "Dark nebula"),
  e("LDN 1251", [], ["LDN"], 339.6, 75.2, 1.2, 0.4, "Dark nebula"),
  e("Barnard 150", ["Seahorse Nebula"], ["Barnard"], 314.9, 60.3, 1.0, 0.2, "Dark nebula"),
]

/** SIMBAD fixture: objects the resolver finds that no bundled catalogue holds. */
export const SIMBAD_FIXTURE: CatalogueEntry[] = [
  e("Abell 39", ["PN G047.0+42.4"], [], 246.89, 27.91, 0.05, 0.05, "Planetary nebula"),
  e("Jones-Emberson 1", ["PK 164+31.1", "Headphone Nebula"], [], 112.58, 53.42, 0.11, 0.11, "Planetary nebula"),
  e("Arp 273", ["UGC 1810"], [], 35.38, 39.37, 0.05, 0.03, "Interacting galaxies"),
  e("Stephan's Quintet", ["HCG 92"], [], 339.01, 33.96, 0.06, 0.05, "Galaxy group"),
  e("vdB 141", ["Ghost Nebula"], [], 318.6, 68.2, 0.3, 0.25, "Reflection nebula"),
]

/** Names an entry answers to, normalized ("M31", "M 31" and "m31" are one name). */
export function entryKeys(entry: { designation: string; aliases: string[] }): string[] {
  return [entry.designation, ...entry.aliases].map(normalizeName)
}

/** The bundled entry a library Target is, by name or alias. */
export function bundledEntryFor(name: string, aliases: string[]): CatalogueEntry | null {
  const keys = new Set([name, ...aliases].map(normalizeName))
  return BUNDLED.find((entry) => entryKeys(entry).some((k) => keys.has(k))) ?? null
}

/** Whether a normalized query matches a name: whole-name or prefix match, ignoring case and spaces. */
export function matchesQuery(names: string[], query: string): boolean {
  const q = normalizeName(query)
  if (!q) return false
  return names.some((name) => normalizeName(name).startsWith(q) || (q.length >= 3 && normalizeName(name).includes(q)))
}

export type ObjectKind = "emission" | "galaxy" | "planetary" | "snr" | "cluster" | "reflection" | "dark" | "other"

export function objectKind(objectType: string | null): ObjectKind {
  const t = (objectType ?? "").toLowerCase()
  if (t.includes("planetary")) return "planetary"
  if (t.includes("galax")) return "galaxy"
  if (t.includes("supernova")) return "snr"
  if (t.includes("emission")) return "emission"
  if (t.includes("dark")) return "dark"
  if (t.includes("reflection")) return "reflection"
  if (t.includes("cluster")) return "cluster"
  return "other"
}
