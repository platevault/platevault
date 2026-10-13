import { describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { orderedProfiles, profileRef } from "./labels"
import { createSeed } from "./seed"
import type { ApplicationProfile, Catalog } from "./types"

describe("orderedProfiles", () => {
  const demo = createSeed("demo").catalog

  it("lists the applications by name and the generic profile last", () => {
    const generic = Object.values(demo.profiles).find((p) => p.application === "generic")!
    const app = Object.values(demo.profiles).find((p) => p.application !== "generic")!
    // Insert the generic profile first and an "Aaa" application after it, so neither order nor insertion decides.
    const profiles: Catalog["profiles"] = { [generic.id]: generic, ...demo.profiles, prof_aaa: { ...app, id: "prof_aaa", name: "Aaa" } as ApplicationProfile }
    const ordered = orderedProfiles({ profiles })
    expect(ordered.at(-1)?.id).toBe(generic.id)
    const names = ordered.slice(0, -1).map((p) => p.name)
    expect(names[0]).toBe("Aaa")
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    expect(ordered.filter((p) => p.application === "generic")).toHaveLength(1)
  })

  it("words the generic profile as Other app and an application by its name", () => {
    const ordered = orderedProfiles(demo)
    expect(say(m, profileRef(ordered.at(-1)!))).toBe(m.startrun_profile_other())
    expect(say(m, profileRef(ordered[0]!))).toBe(ordered[0]!.name)
  })
})
