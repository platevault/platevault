import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ActionButton, ActionMenu } from "./actions"
import type { Action, MenuItem } from "./contracts"

const ITEMS: MenuItem[] = [
  { id: "start", label: "Start", run: vi.fn() },
  { id: "stop", label: "Stop", run: vi.fn() },
]

describe("ActionMenu", () => {
  it.each(["{Enter}", "{ArrowDown}"])("opens on %s and returns focus to its trigger on Escape", async (key) => {
    const user = userEvent.setup()
    render(<ActionMenu label="Run" items={ITEMS} />)
    await user.tab()
    const trigger = screen.getByRole("button", { name: "Run" })
    expect(trigger).toHaveFocus()

    await user.keyboard(key)
    const menu = await screen.findByRole("menu")
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Start", "Stop"])
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })
})

describe("ActionButton", () => {
  const BLOCKED: Action["unavailable"] = { action: "Can't archive", reason: "2 in a Project", blockers: [] }
  const archive = (unavailable?: Action["unavailable"]) => <ActionButton action={{ id: "archive", label: "Archive", run: vi.fn(), unavailable }} />

  it("keeps focus on the same button when its action turns unavailable and available again", async () => {
    const user = userEvent.setup()
    const { rerender } = render(archive())
    await user.tab()
    const button = screen.getByRole("button", { name: "Archive" })
    expect(button).toHaveFocus()

    rerender(archive(BLOCKED))
    expect(screen.getByRole("button", { name: "Archive" })).toBe(button)
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveAccessibleDescription("Can't archive · 2 in a Project")

    rerender(archive())
    expect(screen.getByRole("button", { name: "Archive" })).toBe(button)
    expect(button).toHaveFocus()
    expect(button).not.toHaveAttribute("aria-disabled", "true")
    expect(button).not.toHaveAttribute("aria-describedby")
  })
})
