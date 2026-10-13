import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DetailPage, type DetailSection } from "./detail-page"

const section = (id: string): DetailSection => ({ id, title: id, content: id })

/** The section headings in document order: the order a narrow window stacks them in. */
const headings = () => screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)

describe("DetailPage", () => {
  // DetailDock measures its room; jsdom has no ResizeObserver and lays nothing out.
  const original = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => {
    globalThis.ResizeObserver = original
  })

  it("without an aside stays one column of sections", () => {
    const { container } = render(<DetailPage title="Project" sections={[section("Facts"), section("Runs")]} />)
    expect(headings()).toEqual(["Facts", "Runs"])
    expect(container.querySelector("[data-detail-columns]")).toBeNull()
  })

  it("puts the aside in a second column from 1280 px, and stacks it after the sections below", () => {
    const { container } = render(<DetailPage title="Home" sections={[section("Pending"), section("Open work")]} aside={[section("Status"), section("Tonight")]} />)
    expect(headings()).toEqual(["Pending", "Open work", "Status", "Tonight"])
    const columns = container.querySelector("[data-detail-columns]")!
    expect(columns).toHaveClass("grid", "xl:grid-cols-2")
    expect(columns.children).toHaveLength(2)
    expect(columns.children[1]!.textContent).toContain("Status")
  })
})
