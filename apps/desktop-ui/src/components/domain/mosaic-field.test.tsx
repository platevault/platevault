import { render, screen, within } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { MosaicField, type MosaicFieldPanel, mosaicFieldModel } from "./mosaic-field"

let seed: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(Date.parse("2026-10-13T12:00:00Z"))
  seed = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})

const PANELS: MosaicFieldPanel[] = [
  { id: "p1", name: "Panel 1", centre: { ra: 11.4, dec: 41.6 }, rotationDeg: 0, sessions: 2 },
  { id: "p2", name: "Panel 2", centre: null, rotationDeg: null, sessions: 1 },
]

describe("mosaicFieldModel", () => {
  it("reads a mosaic Project's panel groups in order, each at its sessions' median pointing, with the rig's field", () => {
    const model = mosaicFieldModel(seed.catalog, seed.catalog.projects.prj_ic5070!)
    expect(model.panels.map((p) => [p.name, p.sessions])).toEqual([
      ["Panel 1", 2],
      ["Panel 2", 2],
      ["Panel 3", 1],
    ])
    expect(model.panels.every((p) => p.centre !== null)).toBe(true)
    expect(model.field?.widthDeg).toBeCloseTo(5.384, 2)
    expect(model.pointings).toHaveLength(5)
    expect(model.pointings.every((p) => p.inside)).toBe(true)
  })

  it("a session pointing beyond its panel's field reads as outside", () => {
    const catalog = structuredClone(seed.catalog)
    const project = catalog.projects.prj_ic5070!
    const moved = project.inputs.find((i) => i.groupId === "grp_ic5070_p3")!
    // Put Panel 1's first session in Panel 3's group: its pointing is far outside Panel 3's field.
    const first = project.inputs.find((i) => i.groupId === "grp_ic5070_p1")!
    project.inputs = project.inputs.map((i) => (i.sessionId === first.sessionId ? { ...i, groupId: moved.groupId } : i))
    const model = mosaicFieldModel(catalog, project)
    expect(model.pointings.find((p) => p.id === first.sessionId)).toMatchObject({ panelId: "grp_ic5070_p3" })
    expect(model.pointings.some((p) => !p.inside)).toBe(true)
  })

  it("a Project without panel groups has none", () => {
    expect(mosaicFieldModel(seed.catalog, seed.catalog.projects.prj_m31!).panels).toEqual([])
  })
})

describe("MosaicField", () => {
  it("is a read-only map described by the panel list: nothing on it takes focus", () => {
    const { container } = render(<MosaicField panels={PANELS} pointings={[{ id: "s1", ra: 11.4, dec: 41.6, panelId: "p1", inside: true }]} field={{ widthDeg: 1.2, heightDeg: 0.8 }} />)
    const map = screen.getByRole("img", { name: m.mosaic_map_label({ count: 1 }) })
    const list = screen.getByRole("list", { name: m.mosaic_panels_label() })
    expect(map).toHaveAttribute("aria-describedby", list.id)
    expect(within(list).getAllByRole("listitem")).toHaveLength(2)
    expect(within(list).getByText(m.project_search_position_unknown())).toBeInTheDocument()
    expect(container.querySelectorAll("[tabindex], button, a, [role=checkbox], [role=button]")).toHaveLength(0)
  })

  it("notes sessions outside their panel", () => {
    render(<MosaicField panels={PANELS} pointings={[{ id: "s1", ra: 13, dec: 41.6, panelId: "p1", inside: false }]} field={{ widthDeg: 1.2, heightDeg: 0.8 }} />)
    expect(screen.getByText(m.mosaic_outside_note({ count: 1 }))).toBeInTheDocument()
  })

  it("with an unknown field of view, shows the list without a map", () => {
    render(<MosaicField panels={PANELS} field={null} />)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.getByText(m.ds_fov_unknown())).toBeInTheDocument()
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
  })

  it("empty: says there are no panel groups", () => {
    render(<MosaicField panels={[]} field={{ widthDeg: 1.2, heightDeg: 0.8 }} />)
    expect(screen.getByText(m.mosaic_no_panels())).toBeInTheDocument()
  })
})
