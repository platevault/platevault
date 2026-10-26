/**
 * axe-core over the shared overlays while they are open: a menu, a form
 * dialog and a grouped combobox with a highlighted option. The catalogue
 * pass (catalogue.a11y.test.tsx) only meets them closed. Each test finds the
 * open overlay first, so a run cannot pass over a closed one.
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { ActionMenu } from "@/components/app/actions"
import { ComboboxField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { axeViolations } from "./axe"

function CameraCombobox() {
  const [camera, setCamera] = useState<string | null>(null)
  return (
    <ComboboxField
      label="Camera"
      value={camera}
      onChange={setCamera}
      groups={[
        { label: "Mono", items: [{ value: "asi2600mm", label: "ASI2600MM Pro" }, { value: "asi1600mm", label: "ASI1600MM" }] },
        { label: "Colour", items: [{ value: "asi2600mc", label: "ASI2600MC Pro" }] },
      ]}
    />
  )
}

describe("open overlays under axe", () => {
  it("an open menu", async () => {
    const user = userEvent.setup()
    render(<ActionMenu label="Run" items={[{ id: "start", label: "Start", run: vi.fn() }, { id: "stop", label: "Stop", run: vi.fn() }]} />)
    await user.click(screen.getByRole("button", { name: "Run" }))
    expect(within(await screen.findByRole("menu")).getAllByRole("menuitem")).toHaveLength(2)
    expect(await axeViolations()).toEqual([])
  })

  it("an open form dialog", async () => {
    render(
      <FormDialog open onOpenChange={() => {}} title="Edit run" confirm={{ id: "save", label: "Save", kind: "primary", run: vi.fn() }}>
        <TextField label="Name" value="M 31 Ha" onChange={() => {}} />
      </FormDialog>,
    )
    expect(within(await screen.findByRole("dialog", { name: "Edit run" })).getByRole("textbox", { name: "Name" })).toBeInTheDocument()
    expect(await axeViolations()).toEqual([])
  })

  it("an open combobox with a highlighted option", async () => {
    const user = userEvent.setup()
    render(<CameraCombobox />)
    const input = screen.getByRole("combobox", { name: "Camera" })
    await user.click(input)
    await user.keyboard("ASI{ArrowDown}")
    expect(within(await screen.findByRole("listbox")).getAllByRole("option")).toHaveLength(3)
    expect(input).toHaveAttribute("aria-activedescendant")
    expect(await axeViolations()).toEqual([])
  })
})
