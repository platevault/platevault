/**
 * FolderPicker against a FolderSource the test answers by hand: each listing
 * stays pending until the test resolves, denies or rejects it, so the loading,
 * listed, denied and failed states, a listing that answers after the user has
 * moved on, and focus after Retry are each driven explicitly, and each state
 * of the open chooser runs under axe.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { axeViolations } from "@/test/axe"
import { type FolderEntry, type FolderListing, FolderPicker, type FolderRoot } from "./folder-picker"

const ROOTS: readonly FolderRoot[] = [
  { id: "astro", name: "Astro", mountPath: "/Volumes/Astro", mounted: true },
  { id: "t7", name: "T7", mountPath: "/Volumes/T7", mounted: true },
]

const folder = (path: string): FolderEntry => ({ path, name: path.slice(path.lastIndexOf("/") + 1), kind: "folder", denied: false })
const listed = (...entries: FolderEntry[]): FolderListing => ({ denied: false, entries })

interface PendingListing {
  path: string
  resolve: (listing: FolderListing) => void
  reject: (reason: unknown) => void
}

/** A source whose listings answer only when the test settles them, in any order. */
function manualSource() {
  const calls: PendingListing[] = []
  const listFolder = (path: string) => new Promise<FolderListing>((resolve, reject) => calls.push({ path, resolve, reject }))
  return { source: { roots: ROOTS, listFolder }, calls }
}

async function settle(run: () => void) {
  await act(async () => run())
}

async function renderPicker(onChoose = vi.fn()) {
  const { source, calls } = manualSource()
  render(<FolderPicker open onOpenChange={vi.fn()} title="Choose a capture folder" source={source} initialPath="/Volumes/Astro" onChoose={onChoose} />)
  const dialog = await screen.findByRole("dialog", { name: "Choose a capture folder" })
  return { calls, dialog, onChoose, user: userEvent.setup() }
}

describe("FolderPicker", () => {
  it("shows loading until the listing resolves, then lists the folders and chooses the open one", async () => {
    const { calls, dialog, onChoose, user } = await renderPicker()
    expect(calls.map((call) => call.path)).toEqual(["/Volumes/Astro"])
    expect(within(dialog).getByRole("status", { name: m.common_loading() })).toBeInTheDocument()

    await settle(() => calls[0]!.resolve(listed(folder("/Volumes/Astro/Captures"), { path: "/Volumes/Astro/a.fits", name: "a.fits", kind: "file", denied: false })))
    const list = within(dialog).getByRole("list", { name: m.folder_picker_list({ name: "Astro" }) })
    // Folder mode lists folders only.
    expect(within(list).getAllByRole("button").map((row) => row.textContent)).toEqual(["Captures"])
    expect(within(dialog).queryByRole("status", { name: m.common_loading() })).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: `${m.verb_choose()} Astro` }))
    expect(onChoose).toHaveBeenCalledWith("/Volumes/Astro")
  })

  it("shows access denied when the folder's contents are denied", async () => {
    const { calls, dialog } = await renderPicker()
    await settle(() => calls[0]!.resolve({ denied: true }))
    expect(within(dialog).getByText(m.status_access_denied())).toBeInTheDocument()
    expect(within(dialog).getByText(m.folder_picker_live_denied({ name: "Astro" }))).toBeInTheDocument()
    expect(within(dialog).queryByRole("list", { name: m.folder_picker_list({ name: "Astro" }) })).not.toBeInTheDocument()
  })

  it("reports a rejected listing as an alert whose Retry lists the folder again", async () => {
    const { calls, dialog, user } = await renderPicker()
    await settle(() => calls[0]!.reject(new Error("disk unreadable")))
    const alert = within(dialog).getByRole("alert")
    expect(alert).toHaveTextContent(m.folder_picker_list_failed({ name: "Astro" }))

    await user.click(within(alert).getByRole("button", { name: m.verb_retry() }))
    expect(calls.map((call) => call.path)).toEqual(["/Volumes/Astro", "/Volumes/Astro"])
    await settle(() => calls[1]!.resolve(listed(folder("/Volumes/Astro/Captures"))))
    expect(within(dialog).getByRole("button", { name: "Captures" })).toBeInTheDocument()
  })

  it("ignores a listing that answers after the user has moved to another folder", async () => {
    const { calls, dialog, user } = await renderPicker()
    await user.click(within(dialog).getByRole("button", { name: "T7" }))
    expect(calls.map((call) => call.path)).toEqual(["/Volumes/Astro", "/Volumes/T7"])

    // The abandoned folder answers first, while T7 is still loading: the list stays loading.
    await settle(() => calls[0]!.resolve(listed(folder("/Volumes/Astro/Captures"))))
    expect(within(dialog).queryByRole("button", { name: "Captures" })).not.toBeInTheDocument()
    expect(within(dialog).getByRole("status", { name: m.common_loading() })).toBeInTheDocument()

    await settle(() => calls[1]!.resolve(listed(folder("/Volumes/T7/Darks"))))
    expect(within(dialog).getByRole("list", { name: m.folder_picker_list({ name: "T7" }) })).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Darks" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Captures" })).not.toBeInTheDocument()
  })

  it("keeps keyboard focus in the list after Retry: on the first row, or on Retry when it fails again", async () => {
    const { calls, dialog, user } = await renderPicker()
    await settle(() => calls[0]!.reject(new Error("disk unreadable")))
    within(dialog).getByRole("button", { name: m.verb_retry() }).focus()

    await user.keyboard("{Enter}")
    await settle(() => calls[1]!.reject(new Error("disk unreadable")))
    await waitFor(() => expect(within(dialog).getByRole("button", { name: m.verb_retry() })).toHaveFocus())

    await user.keyboard("{Enter}")
    await settle(() => calls[2]!.resolve(listed(folder("/Volumes/Astro/Captures"))))
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Captures" })).toHaveFocus())
  })
})

describe("FolderPicker under axe", () => {
  const STATES: [state: string, settle: (call: PendingListing) => void, shown: () => HTMLElement][] = [
    ["loading", () => {}, () => screen.getByRole("status", { name: m.common_loading() })],
    ["listed", (call) => call.resolve(listed(folder("/Volumes/Astro/Captures"))), () => screen.getByRole("list", { name: m.folder_picker_list({ name: "Astro" }) })],
    ["denied", (call) => call.resolve({ denied: true }), () => screen.getByText(m.status_access_denied())],
    ["failed", (call) => call.reject(new Error("disk unreadable")), () => screen.getByRole("alert")],
  ]

  it.each(STATES)("%s has no violations", async (_state, answer, shown) => {
    const { calls } = await renderPicker()
    await settle(() => answer(calls[0]!))
    expect(shown()).toBeInTheDocument()
    expect(await axeViolations()).toEqual([])
  })
})
