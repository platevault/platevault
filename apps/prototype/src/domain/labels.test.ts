import { describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { orderedProfiles, profileRef } from "./labels"
import { createSeed } from "./seed"
import type { ApplicationProfile, Catalog } from "./types"

describe("orderedProfiles", () => {
  const demo = createSeed("demo").catalog
  const app = Object.values(demo.profiles)[0]!
  /** An application the user added (Add application…): a generic launcher under the name they gave it. */
  const added = (id: string, name: string): ApplicationProfile => ({ ...app, id, name, application: "generic", capability: { ...app.capability, verified: false } })

  it("ships no generic Open in… profile: the demo lists only the applications PlateVault has a profile for", () => {
    expect(Object.values(demo.profiles).filter((p) => p.application === "generic")).toEqual([])
  })

  it("lists the applications by name, then the ones the user added by name", () => {
    // Insert the added ones first and an "Aaa" application last, so neither order nor insertion decides.
    const profiles: Catalog["profiles"] = { prof_zz: added("prof_zz", "Zeta tool"), prof_app: added("prof_app", "Astro Pixel Processor"), ...demo.profiles, prof_aaa: { ...app, id: "prof_aaa", name: "Aaa" } }
    const ordered = orderedProfiles({ profiles })
    expect(ordered.slice(-2).map((p) => p.id)).toEqual(["prof_app", "prof_zz"])
    const names = ordered.slice(0, -2).map((p) => p.name)
    expect(names[0]).toBe("Aaa")
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it("words every profile by its name, an added application included", () => {
    expect(say(m, profileRef(app))).toBe(app.name)
    expect(say(m, profileRef(added("prof_app", "Astro Pixel Processor")))).toBe("Astro Pixel Processor")
  })
})
