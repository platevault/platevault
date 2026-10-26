/**
 * Keyboard use of the interactive primitives the catalogue ports (WCAG 2.1.1,
 * 2.4.3): menu, dialog, tabs, select and combobox, each driven by keys alone,
 * and focus back on the trigger when a menu or dialog closes.
 */
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { Button } from "./button"
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from "./combobox"
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "./dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs"

function Menu({ onOpen }: { onOpen: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Display</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
        <DropdownMenuItem>Rescan</DropdownMenuItem>
        <DropdownMenuItem>Move to Trash</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe("DropdownMenu by keyboard", () => {
  it("opens on Enter with the first item focused, and arrows move between items", async () => {
    const user = userEvent.setup()
    render(<Menu onOpen={() => {}} />)
    await user.tab()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus())
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("menuitem", { name: "Rescan" })).toHaveFocus()
    await user.keyboard("{ArrowUp}")
    expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus()
  })

  it("Escape closes the menu and returns focus to its trigger", async () => {
    const user = userEvent.setup()
    render(<Menu onOpen={() => {}} />)
    const trigger = screen.getByRole("button", { name: "Display" })
    await user.tab()
    await user.keyboard("{Enter}")
    await screen.findByRole("menu")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it("Enter on an item runs it, closes the menu and returns focus to its trigger", async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    render(<Menu onOpen={onOpen} />)
    const trigger = screen.getByRole("button", { name: "Display" })
    await user.tab()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Open" })).toHaveFocus())
    await user.keyboard("{Enter}")
    expect(onOpen).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
    expect(trigger).toHaveFocus()
  })
})

function EditDialog() {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" />}>Edit run</DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit run</DialogTitle>
        <input aria-label="Name" />
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog by keyboard", () => {
  it("keeps Tab inside the open dialog", async () => {
    const user = userEvent.setup()
    render(<EditDialog />)
    await user.tab()
    await user.keyboard("{Enter}")
    const dialog = await screen.findByRole("dialog", { name: "Edit run" })
    await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    // Tab past the last control lands on Base UI's focus guard, which hands focus back into the dialog.
    for (let step = 0; step < 4; step += 1) {
      await user.tab()
      await waitFor(() => expect(dialog).toContainElement(document.activeElement as HTMLElement))
    }
  })

  it("Escape closes the dialog and returns focus to its trigger", async () => {
    const user = userEvent.setup()
    render(<EditDialog />)
    const trigger = screen.getByRole("button", { name: "Edit run" })
    await user.tab()
    await user.keyboard("{Enter}")
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(trigger).toHaveFocus()
  })

  it("Cancel closes the dialog and returns focus to its trigger", async () => {
    const user = userEvent.setup()
    render(<EditDialog />)
    const trigger = screen.getByRole("button", { name: "Edit run" })
    await user.tab()
    await user.keyboard("{Enter}")
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(trigger).toHaveFocus()
  })
})

describe("Tabs by keyboard", () => {
  it("arrows move between tabs, a disabled tab cannot be chosen, and Enter shows the chosen panel", async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="sessions">
        <TabsList>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="calibration" disabled>
            Calibration
          </TabsTrigger>
          <TabsTrigger value="targets">Targets</TabsTrigger>
        </TabsList>
        <TabsContent value="sessions">Sessions panel</TabsContent>
        <TabsContent value="targets">Targets panel</TabsContent>
      </Tabs>,
    )
    await user.tab()
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveFocus()
    // A disabled tab stays focusable (aria-disabled), so it can be discovered, but Enter does not choose it.
    await user.keyboard("{ArrowRight}")
    const calibration = screen.getByRole("tab", { name: "Calibration" })
    expect(calibration).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(calibration).toHaveAttribute("aria-selected", "false")
    await user.keyboard("{ArrowRight}")
    const targets = screen.getByRole("tab", { name: "Targets" })
    expect(targets).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(targets).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Targets panel")
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "Sessions" })).toHaveFocus()
  })
})

const FRAMES = [
  { value: "lights", label: "Lights" },
  { value: "darks", label: "Darks" },
  { value: "flats", label: "Flats" },
]

function FramesSelect() {
  const [value, setValue] = useState("lights")
  return (
    <Select items={FRAMES} value={value} onValueChange={(next) => setValue(String(next))}>
      <SelectTrigger aria-label="Frames">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {FRAMES.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

describe("Select by keyboard", () => {
  it("opens from the keyboard, arrows to an option, Enter picks it and returns focus to the trigger", async () => {
    const user = userEvent.setup()
    render(<FramesSelect />)
    const trigger = screen.getByRole("combobox", { name: "Frames" })
    await user.tab()
    expect(trigger).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    await screen.findByRole("listbox")
    await waitFor(() => expect(screen.getByRole("option", { name: "Lights" })).toHaveFocus())
    await user.keyboard("{ArrowDown}")
    expect(screen.getByRole("option", { name: "Darks" })).toHaveFocus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
    expect(trigger).toHaveTextContent("Darks")
    expect(trigger).toHaveFocus()
  })
})

const TARGETS = ["M 31", "M 33", "M 42"]

function TargetCombobox() {
  const [value, setValue] = useState<string | null>(null)
  return (
    <>
      <Combobox items={TARGETS} value={value} onValueChange={(next: string | null) => setValue(next)}>
        <ComboboxInput aria-label="Target" />
        <ComboboxContent>
          <ComboboxEmpty>No match</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <output aria-label="Chosen">{value ?? ""}</output>
    </>
  )
}

describe("Combobox by keyboard", () => {
  it("filters as you type, arrows highlight an option and Enter picks it", async () => {
    const user = userEvent.setup()
    render(<TargetCombobox />)
    const input = screen.getByRole("combobox", { name: "Target" })
    await user.click(input)
    await user.keyboard("M 3")
    const listbox = await screen.findByRole("listbox")
    await waitFor(() => expect(screen.queryByRole("option", { name: "M 42" })).toBeNull())
    expect(listbox).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{ArrowDown}")
    expect(input).toHaveAttribute("aria-activedescendant", screen.getByRole("option", { name: "M 33" }).id)
    await user.keyboard("{Enter}")
    await waitFor(() => expect(screen.getByRole("status", { name: "Chosen" })).toHaveTextContent("M 33"))
    expect(input).toHaveValue("M 33")
    expect(input).toHaveFocus()
  })
})
