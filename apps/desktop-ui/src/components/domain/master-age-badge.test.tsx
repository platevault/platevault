import { act, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { MasterAgeBadge } from "./master-age-badge"

describe("MasterAgeBadge", () => {
  it.each([
    ["en-GB", "Old · 91 d"],
    ["pt-BR", "Antigo · 91 d"],
  ] as const)("renders the CAL-FR-15 wording in %s", (locale, expected) => {
    act(() => setLocale(locale))
    render(<MasterAgeBadge ageDays={91} />)
    expect(screen.getByText(expected)).toBeInTheDocument()
    expect(screen.getByText(expected)).toHaveAttribute("data-status", "masterAge:old")
  })
})
