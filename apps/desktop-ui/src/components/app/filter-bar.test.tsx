import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { Preset } from "./contracts"
import { FilterBar } from "./filter-bar"

const PRESETS: Preset[] = [
  { id: "tonight", label: "Tonight", source: "builtin" },
  { id: "deep", label: "Deep sky", source: "custom" },
]

/** Presets ▾ › Delete › "Deep sky": the item opens the confirmation, and deletes nothing yet. */
async function chooseDelete() {
  const user = userEvent.setup()
  const remove = vi.fn()
  render(<FilterBar presets={{ items: PRESETS, apply: vi.fn(), remove }} />)
  await user.click(screen.getByRole("button", { name: m.filter_bar_presets() }))
  await user.click(await screen.findByRole("menuitem", { name: m.filter_bar_preset_delete() }))
  // The submenu item is pressed while the submenu still animates open, so it is clicked directly.
  fireEvent.click(await screen.findByRole("menuitem", { name: "Deep sky" }))
  const dialog = await screen.findByRole("alertdialog", { name: m.filter_bar_preset_delete_title({ name: "Deep sky" }) })
  expect(remove).not.toHaveBeenCalled()
  return { user, remove, dialog }
}

describe("FilterBar: deleting a saved preset", () => {
  it("deletes the preset on Delete in the confirmation", async () => {
    const { user, remove, dialog } = await chooseDelete()
    await user.click(within(dialog).getByRole("button", { name: m.filter_bar_preset_delete() }))
    expect(remove).toHaveBeenCalledExactlyOnceWith("deep")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
  })

  it("deletes nothing on Cancel", async () => {
    const { user, remove, dialog } = await chooseDelete()
    await user.click(within(dialog).getByRole("button", { name: m.verb_cancel() }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(remove).not.toHaveBeenCalled()
  })

  it("deletes nothing on Escape", async () => {
    const { user, remove } = await chooseDelete()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(remove).not.toHaveBeenCalled()
  })
})
