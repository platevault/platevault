import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { m } from "@/paraglide/messages"
import { App } from "@/App"
describe("frontend package configuration", () => {
  it("resolves the local alias and generated base-locale messages", () => {
    render(<App />)
    expect(screen.getByRole("main", { name: m.app_name() })).toHaveTextContent(m.app_name())
  })
})
