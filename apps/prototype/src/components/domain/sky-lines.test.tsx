import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { MoonLine } from "./sky-lines"

describe("MoonLine", () => {
  it("wraps inside its container instead of running past it", () => {
    const { container } = render(<MoonLine moon={{ illuminationPct: 34, phase: { text: "Waxing crescent" }, rise: "2026-10-17T19:30:00Z", set: null }} timeZone="Europe/Amsterdam" />)
    const line = container.querySelector<HTMLElement>("[data-moon]")!
    expect(line).toHaveClass("max-w-full", "min-w-0")
    const text = line.lastElementChild!
    expect(text).toHaveTextContent("34%")
    expect(text).not.toHaveClass("truncate")
  })
})
