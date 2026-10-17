import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { StatusBadge, StatusBadges } from "./status"

describe("StatusBadges", () => {
  it("holds its badges in one wrapping row, 8 px apart", () => {
    render(
      <StatusBadges>
        <StatusBadge kind="availability" value="online" />
        <StatusBadge kind="developerMode" value="off" />
      </StatusBadges>,
    )
    const online = screen.getByText(m.status_online())
    const off = screen.getByText(m.status_off())
    const group = online.parentElement!
    expect(off.parentElement).toBe(group)
    expect(group).toHaveClass("inline-flex", "flex-wrap", "gap-2")
  })
})
