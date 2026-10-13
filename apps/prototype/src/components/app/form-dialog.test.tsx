import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { Action } from "./contracts"
import { TextField } from "./fields"
import { FormDialog } from "./form-dialog"

/** Fails unless each element comes after the one before it in document order. */
function expectInOrder(...elements: HTMLElement[]) {
  for (const [index, element] of elements.slice(1).entries()) {
    expect(elements[index]!.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
}

function RenameDialog({ confirm, skip }: { confirm: Action; skip?: Action }) {
  const [name, setName] = useState("M 31 Ha")
  return (
    <FormDialog open onOpenChange={() => {}} title="Rename run" confirm={confirm} skip={skip}>
      <TextField label="Name" value={name} onChange={setName} />
    </FormDialog>
  )
}

describe("DialogFooter", () => {
  it("puts Cancel first, then Skip, then the dialog's action", async () => {
    render(<RenameDialog confirm={{ id: "save", label: "Save", kind: "primary", run: vi.fn() }} skip={{ id: "skip", label: "Skip", run: vi.fn() }} />)
    const dialog = await screen.findByRole("dialog", { name: "Rename run" })
    const cancel = within(dialog).getByRole("button", { name: m.verb_cancel() })
    const skip = within(dialog).getByRole("button", { name: "Skip" })
    const save = within(dialog).getByRole("button", { name: "Save" })
    expectInOrder(cancel, skip, save)
  })
})

describe("FormDialog", () => {
  it("submits on Enter in a field while the action is available", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    render(<RenameDialog confirm={{ id: "save", label: "Save", kind: "primary", run }} />)
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "{Enter}")
    expect(run).toHaveBeenCalledOnce()
  })

  it("does not submit on Enter while the action is unavailable", async () => {
    const user = userEvent.setup()
    const run = vi.fn()
    const unavailable = { action: "Save", reason: "The name is taken", blockers: [] }
    render(<RenameDialog confirm={{ id: "save", label: "Save", kind: "primary", run, unavailable }} />)
    await user.type(await screen.findByRole("textbox", { name: "Name" }), "{Enter}")
    expect(run).not.toHaveBeenCalled()
  })
})
