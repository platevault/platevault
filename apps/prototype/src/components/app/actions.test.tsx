import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ActionMenu } from "./actions"
import type { MenuItem } from "./contracts"

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
