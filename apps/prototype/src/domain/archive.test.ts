import { beforeAll, describe, expect, it } from "vitest"
import { m, say } from "@/lib/i18n"
import { archivePlan, sessionArchiveBlocker, sessionsArchivePlan, trashOffer, unusableFramesOffer } from "./archive"
import { archiveDestination, defaultArchiveLocation, liveAssetIds, projectSessionIds, type World } from "./derive"
import { qualityApplicability } from "./library"
import { createSeed } from "./seed"
import type { Session } from "./types"

let demo: World
beforeAll(() => {
  const seed = createSeed("demo")
  demo = { catalog: seed.catalog, disk: seed.disk, operations: seed.operations, settings: seed.settings, faults: seed.faults }
})

const sessions = (): Session[] => Object.values(demo.catalog.sessions).filter((s) => s.imageType === "light")

describe("sessionsArchivePlan", () => {
  it("moves each session's frames to the Default archive location along the naming template, oldest night first, keeping those an open Project holds", () => {
    const destination = defaultArchiveLocation(demo)!
    expect(destination).not.toBeNull()
    const plan = sessionsArchivePlan(demo, sessions())
    expect(plan.destination?.id).toBe(destination.id)
    expect(plan.volume?.id).toBe(destination.volumeId)
    expect(plan.kept.length).toBeGreaterThan(0)
    for (const { session } of plan.kept) expect(sessionArchiveBlocker(demo.catalog, session.id)).not.toBeNull()
    for (const row of plan.rows) expect(sessionArchiveBlocker(demo.catalog, row.session.id)).toBeNull()
    expect(plan.rows.length).toBeGreaterThan(0)
    const nights = plan.rows.map((r) => r.session.night)
    expect(nights).toEqual([...nights].sort())
    for (const row of plan.rows) {
      expect(row.moves.length).toBeGreaterThan(0)
      expect(row.sizeBytes).toBe(row.moves.reduce((n, mv) => n + mv.sizeBytes, 0))
      for (const move of row.moves) {
        expect(move.to.locationId).toBe(destination.id)
        expect(move.to.volumeId).toBe(destination.volumeId)
        expect(move.to.path.startsWith(`${destination.path.replace(/\/+$/, "")}/`)).toBe(true)
        expect(move.to.path.split("/").slice(0, -1).join("/")).toBe(row.folder)
        expect(liveAssetIds(demo.catalog, row.session)).toContain(move.assetId)
      }
    }
    expect(plan.sizeBytes).toBe(plan.rows.reduce((n, r) => n + r.sizeBytes, 0))
    // Every session lands in exactly one of rows or refused, or has nothing to move.
    const listed = [...plan.rows.map((r) => r.session.id), ...plan.refused.map((r) => r.session.id)]
    expect(new Set(listed).size).toBe(listed.length)
  })

  it("is blocked without an archive location", () => {
    const world: World = { ...demo, catalog: { ...demo.catalog, locations: Object.fromEntries(Object.entries(demo.catalog.locations).filter(([, l]) => l.role !== "archive")) } }
    const plan = sessionsArchivePlan(world, sessions())
    expect(plan.destination).toBeNull()
    expect(plan.blocked && say(m, plan.blocked)).toBe(m.wrapup_no_archive_location())
  })
})

describe("unusableFramesOffer", () => {
  it("offers the applicable Unusable frames, and counts each frame once", () => {
    const ids = sessions().flatMap((s) => liveAssetIds(demo.catalog, s))
    const unusable = new Set(ids.filter((id) => demo.catalog.assets[id]!.quality.value === "unusable" && qualityApplicability(demo.catalog.assets[id]!) === "applicable"))
    expect(unusable.size).toBeGreaterThan(0)
    const offer = unusableFramesOffer(demo, [...ids, ...ids])
    expect(offer.kind).toBe("rejected-frames")
    expect(offer.count).toBe(offer.entries.length)
    expect(offer.count + offer.refusals.length).toBe(unusable.size)
    for (const entry of offer.entries) expect(unusable.has(entry.key)).toBe(true)
    expect(new Set(offer.items.map((i) => i.assetId))).toEqual(new Set(offer.entries.map((e) => e.key)))
    expect(offer.title).toContain(String(offer.count))
  })

  it("offers nothing for Usable frames", () => {
    const usable = sessions()
      .flatMap((s) => liveAssetIds(demo.catalog, s))
      .filter((id) => demo.catalog.assets[id]!.quality.value === "usable")
    const offer = unusableFramesOffer(demo, usable)
    expect(offer.count).toBe(0)
    expect(offer.title).toBe(m.wrapup_offer_rejected_none())
  })
})

describe("archivePlan", () => {
  it("archives a Project's sessions to its archive location", () => {
    const project = Object.values(demo.catalog.projects).find((p) => p.state === "open" && p.inputs.length > 0)!
    const held = new Set(projectSessionIds(project))
    const plan = archivePlan(demo, project)
    expect(plan.destination?.id).toBe(archiveDestination(demo, project)?.id)
    expect(plan.rows.length + plan.refused.length + plan.kept.length).toBeGreaterThan(0)
    for (const row of plan.rows) expect(held.has(row.session.id)).toBe(true)
    for (const { session } of plan.kept) expect(held.has(session.id)).toBe(true)
  })
})

describe("sessionArchiveBlocker", () => {
  it("refuses a session an open Project holds, naming it, and allows one only a Closed Project holds", () => {
    const open = Object.values(demo.catalog.projects).find((p) => p.state === "open" && p.inputs.length > 0)!
    const sessionId = open.inputs[0]!.sessionId
    expect(say(m, sessionArchiveBlocker(demo.catalog, sessionId)!)).toContain(open.name)
    const holdersClosed = Object.fromEntries(Object.entries(demo.catalog.projects).map(([id, p]) => [id, p.inputs.some((i) => i.sessionId === sessionId) ? { ...p, state: "closed" as const } : p]))
    expect(sessionArchiveBlocker({ ...demo.catalog, projects: holdersClosed }, sessionId)).toBeNull()
  })
})

describe("trashOffer", () => {
  it("titles an empty offer with its 'none left' form", () => {
    const offer = trashOffer("processing-files", demo.disk, new Map(), [], [], [])
    expect(offer).toMatchObject({ kind: "processing-files", count: 0, sizeBytes: 0, keptLinks: 0, title: m.wrapup_offer_processing_none() })
  })
})
