import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"
import { m } from "@/lib/i18n"
import type { ActionKind } from "./contracts"
import { ConfirmDialog } from "./confirm-dialog"

/** Renders a confirmation and opens it from the keyboard, so focus starts on the trigger. */
async function openTrashDialog(kind: ActionKind, onConfirm = vi.fn()) {
  const user = userEvent.setup()
  render(<ConfirmDialog trigger={<Button>Clean up</Button>} title="Move 3 files to Trash?" confirm={{ label: "Move to Trash", kind }} onConfirm={onConfirm} />)
  await user.tab()
  const trigger = screen.getByRole("button", { name: "Clean up" })
  expect(trigger).toHaveFocus()
  await user.keyboard("{Enter}")
  const dialog = await screen.findByRole("alertdialog", { name: "Move 3 files to Trash?" })
  return {
    user,
    trigger,
    cancel: within(dialog).getByRole("button", { name: m.verb_cancel() }),
    action: within(dialog).getByRole("button", { name: "Move to Trash" }),
  }
}

describe("ConfirmDialog", () => {
  it("puts Cancel before a destructive action and focuses Cancel first", async () => {
    const { cancel, action } = await openTrashDialog("destructive")
    expect(cancel.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(cancel).toHaveFocus())
  })

  it("focuses the action first when it is not destructive", async () => {
    const { action } = await openTrashDialog("primary")
    await waitFor(() => expect(action).toHaveFocus())
  })

  it("closes on Escape and returns focus to the trigger", async () => {
    const { user, trigger, cancel } = await openTrashDialog("destructive")
    await waitFor(() => expect(cancel).toHaveFocus())
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it("closes after a successful confirm and returns focus to the trigger that stays on screen", async () => {
    const onConfirm = vi.fn()
    const { user, trigger, action } = await openTrashDialog("destructive", onConfirm)
    await user.click(action)
    expect(onConfirm).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(trigger).toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
