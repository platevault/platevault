import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ListDetail } from "./page"

describe("ListDetail", () => {
  it("keeps the list at 18rem on wide windows too", () => {
    render(<ListDetail list={<nav aria-label="Settings" />} detail={<p>Locations</p>} />)
    const grid = screen.getByRole("navigation", { name: "Settings" }).parentElement!.parentElement!
    expect(grid).toHaveClass("grid", "grid-cols-[18rem_minmax(0,1fr)]")
    expect(grid.className).not.toMatch(/(^|\s)(lg|xl|2xl):grid-cols-/)
  })
})
