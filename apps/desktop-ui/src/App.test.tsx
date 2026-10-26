import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { App } from "@/App"

describe("frontend package configuration", () => {
  it("resolves the local alias and generated base-locale messages", () => {
    render(<App />)
    expect(screen.getByRole("main", { name: "PlateVault Library" })).toHaveTextContent("PlateVault Library")
  })
})
