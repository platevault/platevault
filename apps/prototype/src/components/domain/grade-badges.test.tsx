import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { GradeBadges } from "./grade-badges"

describe("GradeBadges", () => {
  it("names the strip with each filter and its grade", () => {
    render(
      <GradeBadges
        grades={[
          { band: "OIII", grade: "good" },
          { band: "Ha", grade: "marginal" },
          { band: "L", grade: "poor" },
        ]}
      />,
    )
    const expected = [
      m.domain_grade_badge({ band: "OIII", grade: m.domain_grade_good() }),
      m.domain_grade_badge({ band: "Ha", grade: m.domain_grade_marginal() }),
      m.domain_grade_badge({ band: "L", grade: m.domain_grade_poor() }),
    ].join(", ")
    expect(screen.getByRole("img", { name: expected })).toBeDefined()
    expect(expected).toBe("OIII good, Ha marginal, L poor")
  })

  it("reads a dash without a verdict", () => {
    const { container } = render(<GradeBadges grades={null} />)
    expect(screen.queryByRole("img")).toBeNull()
    expect(container.textContent).toBe("–")
  })

  it("shows one badge per grade with its filters, good first, and hides the poor ones (byGrade)", () => {
    const { container } = render(
      <GradeBadges
        byGrade
        grades={[
          { band: "Ha", grade: "marginal" },
          { band: "OIII", grade: "good" },
          { band: "SII", grade: "good" },
          { band: "L", grade: "poor" },
        ]}
      />,
    )
    const badges = [...container.querySelectorAll("[data-grade-badges] > *")].map((badge) => badge.textContent)
    expect(badges).toEqual(["OIII, SII", "Ha"])
    expect(screen.getByRole("img", { name: "OIII good, SII good, Ha marginal" })).toBeDefined()
  })

  it("reads a plain dash, no tooltip, when every filter is poor (byGrade)", () => {
    const { container } = render(
      <GradeBadges
        byGrade
        grades={[
          { band: "Ha", grade: "poor" },
          { band: "OIII", grade: "poor" },
        ]}
      />,
    )
    expect(screen.queryByRole("img")).toBeNull()
    expect(screen.queryByRole("button")).toBeNull()
    expect(container.textContent).toBe("–")
  })
})
