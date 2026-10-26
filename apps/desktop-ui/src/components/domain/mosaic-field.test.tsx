import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { MosaicField, type MosaicFieldPanel } from "./mosaic-field"

const PANELS: MosaicFieldPanel[] = [
  { id: "p1", name: "Panel 1", centre: { ra: 11.4, dec: 41.6 }, rotationDeg: 0, sessions: 2 },
  { id: "p2", name: "Panel 2", centre: null, rotationDeg: null, sessions: 1 },
]

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
