import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { useAction } from "./actions"
import type { MenuItem } from "./contracts"
import { RowActions, RowContextMenu } from "./row-actions"

const ROW = "M 31 Ha"
const ITEMS: MenuItem[] = [
  { id: "open", label: "Open", run: vi.fn() },
  { id: "rename", label: "Rename", opensDialog: true, run: vi.fn() },
  { id: "trash", label: "Move to Trash", kind: "destructive", run: vi.fn() },
]

/** One row outside a DataTable: its ⋯ and its context menu share the host's runner and items. */
function Row() {
  const runner = useAction()
  return (
    <>
      <ul>
        <RowContextMenu name={ROW} items={ITEMS} runner={runner}>
          <li>
            {ROW} <RowActions name={ROW} items={ITEMS} runner={runner} />
          </li>
        </RowContextMenu>
      </ul>
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

const entries = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((item) => item.textContent)

/** Focuses the row's ⋯ from the keyboard. */
async function focusMore(user: ReturnType<typeof userEvent.setup>) {
  await user.tab()
  const more = screen.getByRole("button", { name: m.actions_for({ name: ROW }) })
  expect(more).toHaveFocus()
  return more
}

describe("RowActions", () => {
  it.each(["{Enter}", "{ArrowDown}"])("opens the ⋯ on %s and returns focus to it on Escape", async (key) => {
    const user = userEvent.setup()
    render(<Row />)
    const more = await focusMore(user)

    await user.keyboard(key)
    const menu = await screen.findByRole("menu")
    expect(entries(menu)).toEqual(["Open", "Rename…", "Move to Trash"])
    await waitFor(() => expect(menu).toContainElement(document.activeElement as HTMLElement))

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(more).toHaveFocus()
  })

  it.each(["{Shift>}{F10}{/Shift}", "{ContextMenu}"])("opens the row's context menu with the ⋯ entries on %s", async (key) => {
    const user = userEvent.setup()
    render(<Row />)
    await focusMore(user)
    await user.keyboard("{Enter}")
    const more = entries(await screen.findByRole("menu"))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())

    await user.keyboard(key)
    const context = await screen.findByRole("menu", { name: ROW })
    expect(entries(context)).toEqual(more)
  })
})
