/**
 * DialogFooter's button order (C1, form-dialog.tsx): Cancel first, then an
 * optional Skip, then the dialog's one action, on every OS. Checked in DOM
 * order, and as the keyboard meets it, Tab by Tab, for a primary and a
 * destructive action.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { m } from "@/lib/i18n"
import type { Action } from "./contracts"
import { DIALOG_DEFAULT_ATTR, DialogFooter } from "./form-dialog"

function FooterDialog({ confirm, skip }: { confirm: Action; skip?: Action }) {
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogTitle>Edit run</DialogTitle>
        <DialogFooter confirm={confirm} skip={skip} />
      </DialogContent>
    </Dialog>
  )
}

/** The accessible names of the footer's buttons in Tab order, starting from the first. */
async function tabOrder(count: number) {
  const user = userEvent.setup()
  const names: string[] = []
  const first = screen.getByRole("button", { name: m.verb_cancel() })
  first.focus()
  names.push(first.textContent ?? "")
  for (let step = 1; step < count; step += 1) {
    await user.tab()
    names.push(document.activeElement?.textContent ?? "")
  }
  return names
}

/** The footer's button names in DOM order. Tab order alone would let a focus trap that wraps Tab pass a wrong order. */
function domOrder(dialog: HTMLElement) {
  return within(dialog)
    .getAllByRole("button")
    .map((button) => button.textContent)
}

describe("DialogFooter order", () => {
  it("Tab meets Cancel, then Skip, then the primary action last", async () => {
    render(<FooterDialog confirm={{ id: "save", label: "Save", kind: "primary", run: vi.fn() }} skip={{ id: "skip", label: "Skip", run: vi.fn() }} />)
    const dialog = await screen.findByRole("dialog", { name: "Edit run" })
    expect(domOrder(dialog)).toEqual([m.verb_cancel(), "Skip", "Save"])
    expect(await tabOrder(3)).toEqual([m.verb_cancel(), "Skip", "Save"])
  })

  it("keeps a destructive action last, and marks Cancel as the default instead of the action", async () => {
    render(<FooterDialog confirm={{ id: "trash", label: "Move to Trash", kind: "destructive", run: vi.fn() }} />)
    const dialog = await screen.findByRole("dialog", { name: "Edit run" })
    expect(domOrder(dialog)).toEqual([m.verb_cancel(), "Move to Trash"])
    expect(await tabOrder(2)).toEqual([m.verb_cancel(), "Move to Trash"])
    expect(screen.getByRole("button", { name: m.verb_cancel() })).toHaveAttribute(DIALOG_DEFAULT_ATTR)
    expect(screen.getByRole("button", { name: "Move to Trash" })).not.toHaveAttribute(DIALOG_DEFAULT_ATTR)
  })

  it("marks a non-destructive action as the default, not Cancel", async () => {
    render(<FooterDialog confirm={{ id: "save", label: "Save", kind: "primary", run: vi.fn() }} />)
    await screen.findByRole("dialog", { name: "Edit run" })
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(DIALOG_DEFAULT_ATTR)
    expect(screen.getByRole("button", { name: m.verb_cancel() })).not.toHaveAttribute(DIALOG_DEFAULT_ATTR)
  })
})
