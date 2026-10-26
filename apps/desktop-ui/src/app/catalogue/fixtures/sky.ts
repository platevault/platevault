/**
 * A slice of a bundled sky catalogue and a SIMBAD answer for the catalogue's
 * TargetPicker specimens: designations, aliases, object types and J2000
 * positions. Names are proper nouns, the same in every language; object
 * types are worded from the messages. Catalogue only.
 */
import type { Messages } from "@/lib/i18n"

export type ObjectType = "emission" | "planetary" | "supernova" | "globular" | "open" | "spiral" | "interacting"

export const OBJECT_TYPE_NAME: Record<ObjectType, (m: Messages) => string> = {
  emission: (m) => m.domain_object_emission_nebula(),
  planetary: (m) => m.domain_object_planetary_nebula(),
  supernova: (m) => m.domain_object_supernova_remnant(),
  globular: (m) => m.domain_object_globular_cluster(),
  open: (m) => m.domain_object_open_cluster(),
  spiral: (m) => m.domain_object_spiral_galaxy(),
  interacting: (m) => m.domain_object_interacting_galaxies(),
}

export interface SkyObject {
  designation: string
  aliases: readonly string[]
  objectType: ObjectType
  /** Degrees, J2000. */
  ra: number
  dec: number
}

const o = (designation: string, aliases: string[], objectType: ObjectType, ra: number, dec: number): SkyObject => ({ designation, aliases, objectType, ra, dec })

/** The offline catalogue, as bundled: the first three are "my targets" in the samples. */
export const SKY_CATALOGUE: readonly SkyObject[] = [
  o("NGC 7000", ["North America Nebula", "Caldwell 20"], "emission", 314.75, 44.53),
  o("M 31", ["Andromeda Galaxy", "NGC 224"], "spiral", 10.685, 41.269),
  o("IC 5070", ["Pelican Nebula"], "emission", 312.75, 44.37),
  o("M 1", ["Crab Nebula", "NGC 1952"], "supernova", 83.63, 22.01),
  o("M 13", ["Hercules Cluster", "NGC 6205"], "globular", 250.42, 36.46),
  o("M 27", ["Dumbbell Nebula", "NGC 6853"], "planetary", 299.9, 22.72),
  o("M 33", ["Triangulum Galaxy", "NGC 598"], "spiral", 23.462, 30.66),
  o("M 42", ["Orion Nebula", "NGC 1976"], "emission", 83.82, -5.39),
  o("NGC 869", ["Double Cluster", "Caldwell 14"], "open", 34.75, 57.13),
  o("NGC 6888", ["Crescent Nebula", "Caldwell 27"], "emission", 303.0, 38.35),
  o("NGC 6960", ["Western Veil Nebula", "Caldwell 34"], "supernova", 311.42, 30.71),
  o("NGC 7023", ["Iris Nebula", "Caldwell 4"], "emission", 315.4, 68.17),
  o("NGC 7293", ["Helix Nebula", "Caldwell 63"], "planetary", 337.41, -20.84),
  o("NGC 7635", ["Bubble Nebula", "Caldwell 11"], "emission", 350.2, 61.2),
]

/** Objects the resolver finds that the bundled catalogue does not hold. */
export const SIMBAD_RESULTS: readonly SkyObject[] = [
  o("Abell 39", ["PN G047.0+42.4"], "planetary", 246.89, 27.91),
  o("Jones-Emberson 1", ["PK 164+31.1", "Headphone Nebula"], "planetary", 112.58, 53.42),
  o("Arp 273", ["UGC 1810"], "interacting", 35.38, 39.37),
  o("NGC 7027", ["PK 084-03.1"], "planetary", 316.76, 42.24),
]

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "")

/** Whether a query matches any of the names: whole-name or prefix match, or a substring from three characters, ignoring case and spaces. */
export function matchesQuery(names: readonly string[], query: string): boolean {
  const q = normalize(query)
  if (!q) return false
  return names.some((name) => normalize(name).startsWith(q) || (q.length >= 3 && normalize(name).includes(q)))
}
