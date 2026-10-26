import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { m } from "@/paraglide/messages"
import enGb from "../messages/en-GB.json"
import { App } from "@/App"
describe("frontend package configuration", () => {
  it("resolves the local alias and generated base-locale messages", () => {
    render(<App />)
    expect(screen.getByRole("main", { name: enGb.app_name })).toHaveTextContent(m.app_name())
  })
})
