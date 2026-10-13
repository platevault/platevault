import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { Column, MenuItem } from "./contracts"
import { DataTable } from "./data-table"

interface Frame {
  id: string
  name: string
  size: number
}

const ROWS: Frame[] = [
  { id: "a", name: "Vega", size: 3 },
  { id: "b", name: "Altair", size: 1 },
  { id: "c", name: "Deneb", size: 2 },
]

const COLUMNS: Column<Frame>[] = [
  { id: "name", header: "Name", cell: (row) => row.name, sortValue: (row) => row.name, rowHeader: true },
  { id: "size", header: "Size", cell: (row) => row.size, sortValue: (row) => row.size, align: "right" },
  // `static` wins over a sort value: a thumbnail or an actions column has no order.
  { id: "preview", header: "Preview", cell: () => null, sortValue: (row) => row.name, static: true },
]

const ITEMS: MenuItem[] = [
  { id: "open", label: "Open", run: vi.fn() },
  { id: "trash", label: "Move to Trash", kind: "destructive", run: vi.fn() },
]

const rowOrder = () => screen.getAllByRole("rowheader").map((cell) => cell.textContent)
const header = (name: string) => screen.getByRole("columnheader", { name })

describe("DataTable", () => {
  it("makes every column with a sort value sortable, with no opt-in", () => {
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />)
    for (const name of ["Name", "Size"]) {
      expect(header(name)).toHaveAttribute("aria-sort", "none")
      expect(within(header(name)).getByRole("button", { name })).toBeInTheDocument()
    }
    expect(rowOrder()).toEqual(["Vega", "Altair", "Deneb"])
  })

  it("toggles aria-sort and the row order on the active column only", async () => {
    const user = userEvent.setup()
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />)
    const sortByName = within(header("Name")).getByRole("button", { name: "Name" })

    await user.click(sortByName)
    expect(header("Name")).toHaveAttribute("aria-sort", "ascending")
    expect(header("Size")).toHaveAttribute("aria-sort", "none")
    expect(rowOrder()).toEqual(["Altair", "Deneb", "Vega"])

    await user.click(sortByName)
    expect(header("Name")).toHaveAttribute("aria-sort", "descending")
    expect(rowOrder()).toEqual(["Vega", "Deneb", "Altair"])

    await user.click(within(header("Size")).getByRole("button", { name: "Size" }))
    expect(header("Size")).toHaveAttribute("aria-sort", "ascending")
    expect(header("Name")).toHaveAttribute("aria-sort", "none")
    expect(rowOrder()).toEqual(["Altair", "Deneb", "Vega"])
  })

  it("gives a static column no sort button and no aria-sort", () => {
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />)
    expect(header("Preview")).not.toHaveAttribute("aria-sort")
    expect(within(header("Preview")).queryByRole("button")).not.toBeInTheDocument()
  })

  it("opens a row's ⋯ entries as its context menu on Shift+F10", async () => {
    const user = userEvent.setup()
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => ITEMS} />)
    const more = screen.getByRole("button", { name: m.actions_for({ name: "Altair" }) })
    more.focus()

    await user.keyboard("{Enter}")
    const entries = within(await screen.findByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent)
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(more).toHaveFocus()

    await user.keyboard("{Shift>}{F10}{/Shift}")
    const context = await screen.findByRole("menu", { name: "Altair" })
    expect(within(context).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(entries)
  })
})
