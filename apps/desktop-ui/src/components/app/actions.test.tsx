import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { RotateCw } from "lucide-react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { ActionButton, ActionMenu } from "./actions"
import type { Action, ConfirmSpec, MenuItem } from "./contracts"

const ITEMS: MenuItem[] = [
  { id: "start", label: "Start", run: vi.fn() },
  { id: "stop", label: "Stop", run: vi.fn() },
]

const TRASH_CONFIRM: ConfirmSpec = { title: "Move 3 files to Trash?", confirm: { label: "Move", kind: "destructive" } }

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

  it("shows only its icon with iconOnly, named by its label and a tooltip, and keeps the label without an icon", async () => {
    const user = userEvent.setup()
    const rescan = (unavailable?: Action["unavailable"]) => <ActionButton action={{ id: "rescan", label: "Rescan", icon: RotateCw, run: vi.fn(), unavailable }} size="xs" iconOnly />
    const { rerender } = render(rescan())
    const button = screen.getByRole("button", { name: "Rescan" })
    expect(button).toHaveTextContent("")
    await user.hover(button)
    expect(await screen.findByText("Rescan", { selector: "[data-slot=tooltip-content]" }, { timeout: 2000 })).toBeInTheDocument()

    rerender(rescan(BLOCKED))
    expect(screen.getByRole("button", { name: "Rescan" })).toBe(button)
    expect(button).toHaveAttribute("aria-disabled", "true")
    expect(button).toHaveAccessibleDescription("Can't archive · 2 in a Project")

    rerender(<ActionButton action={{ id: "archive", label: "Archive", run: vi.fn() }} size="xs" iconOnly />)
    expect(screen.getByRole("button", { name: "Archive" })).toHaveTextContent("Archive")
  })

  it("keeps its ConfirmDialog open and busy until an async run settles", async () => {
    const user = userEvent.setup()
    let finish: (result: { ok: true }) => void = () => undefined
    const run = vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve)))
    render(<ActionButton action={{ id: "trash", label: "Move to Trash", kind: "destructive", run, confirm: TRASH_CONFIRM }} />)

    await user.click(screen.getByRole("button", { name: "Move to Trash…" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Move 3 files to Trash?" })
    await user.click(within(dialog).getByRole("button", { name: "Move" }))
    expect(run).toHaveBeenCalledOnce()
    expect(screen.getByRole("alertdialog")).toBe(dialog)
    expect(within(dialog).getByRole("button", { name: "Move" })).toHaveAttribute("aria-busy", "true")

    finish({ ok: true })
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })

  it("keeps its ConfirmDialog open with Retry when an async run fails", async () => {
    const user = userEvent.setup()
    const run = vi.fn(async () => ({ ok: false as const, reason: "write-failed" as const, message: "Cold-1 is offline" }))
    render(<ActionButton action={{ id: "trash", label: "Move to Trash", kind: "destructive", run, confirm: TRASH_CONFIRM }} />)

    await user.click(screen.getByRole("button", { name: "Move to Trash…" }))
    const dialog = await screen.findByRole("alertdialog", { name: "Move 3 files to Trash?" })
    await user.click(within(dialog).getByRole("button", { name: "Move" }))
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Cold-1 is offline")
    expect(within(dialog).getByRole("button", { name: m.verb_retry() })).toBeInTheDocument()
  })
})
