/**
 * Lock's accessibility contract (docs/adr/0002-lock-and-infotip-stay-separate.md):
 * labelled, a focusable role=note named by the reason ("Protected" without one)
 * while the popup is closed; decorative, aria-hidden with no role, name or tab stop.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { Lock } from "./lock"

const REASON = "PlateVault never moves or deletes raw frames."

describe("Lock, labelled", () => {
  it("is a note named by its reason before any popup opens, with no describedby", () => {
    render(<Lock reason={REASON} />)
    const note = screen.getByRole("note", { name: REASON })
    expect(note).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByText(REASON)).toBeNull()
  })

  it('is named "Protected" without a reason', () => {
    render(<Lock />)
    expect(screen.getByRole("note", { name: m.status_protected() })).toBeInTheDocument()
  })

  it("is a tab stop, and focus reveals the reason", async () => {
    const user = userEvent.setup()
    render(<Lock reason={REASON} />)
    await user.tab()
    expect(screen.getByRole("note", { name: REASON })).toHaveFocus()
    expect(await screen.findByText(REASON)).toBeVisible()
  })
})

describe("Lock, decorative", () => {
  it("is hidden from assistive technology, with no role, name or tab stop", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <>
        <Lock decorative />
        <button type="button">after</button>
      </>,
    )
    const glyph = container.querySelector('[data-slot="lock"]')!
    expect(glyph).toHaveAttribute("aria-hidden", "true")
    expect(glyph).not.toHaveAttribute("role")
    expect(glyph).not.toHaveAttribute("aria-label")
    expect(glyph).not.toHaveAttribute("tabindex")
    expect(screen.queryByRole("note")).toBeNull()
    await user.tab()
    expect(screen.getByRole("button", { name: "after" })).toHaveFocus()
  })
})
