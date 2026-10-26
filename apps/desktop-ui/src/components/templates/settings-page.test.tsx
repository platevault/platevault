import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SettingsPage } from "./settings-page"

describe("SettingsPage", () => {
  it("draws its level-2 header as a bar over the body, as the other templates do", () => {
    render(
      <SettingsPage title="Equipment">
        <p>Rigs</p>
      </SettingsPage>,
    )
    const header = screen.getByRole("heading", { level: 2, name: "Equipment" }).closest("header")!
    expect(header).toHaveClass("border-b", "border-separator", "py-2")
  })
})
