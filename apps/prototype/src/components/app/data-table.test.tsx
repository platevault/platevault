import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { Column, MenuItem } from "./contracts"
import { DataTable, sortRows } from "./data-table"

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

  it('scroll="fill": the frame takes the rest of a flex-column parent, with no height cap; the toolbar row stays fixed', () => {
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} scroll="fill" toolbar={{ search: { label: "Search", value: "", onChange: vi.fn() } }} />)
    const frame = screen.getByRole("table", { name: "Frames" }).parentElement!
    expect(frame).toHaveClass("min-h-0", "flex-1", "overflow-auto")
    expect(frame.className).not.toMatch(/max-h-/)
    const root = frame.parentElement!
    expect(root).toHaveClass("flex", "min-h-0", "flex-1", "flex-col")
    expect(within(root).getByRole("group", { name: m.filter_bar_label() }).parentElement).toHaveClass("shrink-0")
  })

  it('scroll="frame" (the default) keeps its window-height cap', () => {
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />)
    expect(screen.getByRole("table", { name: "Frames" }).parentElement!.className).toMatch(/max-h-/)
  })

  it("shows a refused row action beside a table without a toolbar", async () => {
    const user = userEvent.setup()
    const refused: MenuItem = { id: "remove", label: "Remove", run: () => ({ ok: false, reason: "refused", message: "In use", reasons: ["Used by 2 runs"] }) }
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => [refused]} />)
    await user.click(screen.getByRole("button", { name: m.actions_for({ name: "Vega" }) }))
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Remove" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(m.actions_blocked({ action: "Remove" }))
    expect(alert).toHaveTextContent(m.refusal_blockers({ count: 1 }))
  })

  it("toolbar select: one labelled choice, keyboard operable, with no All and no filter chip", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <DataTable
        label="Frames"
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        toolbar={{ select: { label: "Destination", value: "nas", options: [{ value: "nas", label: "Archive NAS" }, { value: "cold", label: "Cold storage" }], onChange } }}
      />,
    )
    const trigger = screen.getByRole("button", { name: "Destination: Archive NAS" })
    trigger.focus()
    await user.keyboard("{Enter}")
    const menu = await screen.findByRole("menu")
    const options = within(menu).getAllByRole("menuitemradio")
    expect(options.map((option) => option.textContent)).toEqual(["Archive NAS", "Cold storage"])
    expect(options[0]).toHaveAttribute("aria-checked", "true")
    await user.keyboard("{ArrowDown}")
    await waitFor(() => expect(options[1]).toHaveFocus())
    await user.keyboard("{Enter}")
    expect(onChange).toHaveBeenCalledWith("cold")
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
    expect(screen.queryByRole("button", { name: m.filters_clear() })).not.toBeInTheDocument()
  })

  it("a disabled toolbar select cannot open", () => {
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} toolbar={{ select: { label: "Destination", value: "nas", options: [{ value: "nas", label: "Archive NAS" }], onChange: vi.fn(), disabled: true } }} />)
    expect(screen.getByRole("button", { name: "Destination: Archive NAS" })).toBeDisabled()
  })

  it("controlled sort: the host's sort orders the rows, a header click reports the next one, and sortRows matches", async () => {
    const user = userEvent.setup()
    const onSortChange = vi.fn()
    const sort = { columnId: "size", direction: "desc" } as const
    const { rerender } = render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} sort={sort} onSortChange={onSortChange} />)
    expect(rowOrder()).toEqual(sortRows(ROWS, COLUMNS, sort).map((row) => row.name))
    expect(rowOrder()).toEqual(["Vega", "Deneb", "Altair"])

    await user.click(within(header("Name")).getByRole("button", { name: "Name" }))
    expect(onSortChange).toHaveBeenCalledWith({ columnId: "name", direction: "asc" })
    // Controlled: nothing moves until the host passes the new sort.
    expect(rowOrder()).toEqual(["Vega", "Deneb", "Altair"])
    rerender(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} sort={{ columnId: "name", direction: "asc" }} onSortChange={onSortChange} />)
    expect(rowOrder()).toEqual(["Altair", "Deneb", "Vega"])
    expect(header("Name")).toHaveAttribute("aria-sort", "ascending")
  })

  it("sortRows puts nulls last in both directions and leaves a static column's order", () => {
    const columns: Column<Frame>[] = [{ id: "size", header: "Size", cell: (row) => row.size, sortValue: (row) => (row.id === "b" ? null : row.size) }, ...COLUMNS.slice(2)]
    const ids = (direction: "asc" | "desc") => sortRows(ROWS, columns, { columnId: "size", direction }).map((row) => row.id)
    expect(ids("asc")).toEqual(["c", "a", "b"])
    expect(ids("desc")).toEqual(["a", "c", "b"])
    expect(sortRows(ROWS, COLUMNS, { columnId: "preview", direction: "asc" })).toBe(ROWS)
  })

  it("truncate: the text sits in a track with no min-content width, and shows in full on hover only while cut", async () => {
    const user = userEvent.setup()
    const columns: Column<Frame>[] = [
      { id: "name", header: "Name", cell: (row) => row.name, sortValue: (row) => row.name, rowHeader: true, truncate: true },
      { id: "size", header: "Size", cell: (row) => row.size, sortValue: (row) => row.size, align: "right" },
    ]
    render(<DataTable label="Frames" rows={ROWS} columns={columns} getRowId={(row) => row.id} />)
    const cell = screen.getByRole("rowheader", { name: "Vega" })
    const text = within(cell).getByText("Vega")
    // One minmax(0, 1fr) grid track: the column can narrow below its text, so the truncated columns share the frame.
    expect(text).toHaveClass("truncate")
    expect(text.parentElement).toHaveClass("grid", "grid-cols-1")
    expect(cell).not.toHaveClass("whitespace-nowrap")
    expect(screen.getByRole("cell", { name: "3" })).toHaveClass("whitespace-nowrap")

    Object.defineProperty(text, "clientWidth", { configurable: true, value: 40 })
    Object.defineProperty(text, "scrollWidth", { configurable: true, value: 80 })
    await user.hover(text)
    expect(text).toHaveAttribute("title", "Vega")
    Object.defineProperty(text, "scrollWidth", { configurable: true, value: 40 })
    await user.unhover(text)
    await user.hover(text)
    expect(text).not.toHaveAttribute("title")
  })

  describe("selection", () => {
    const toolbar = { search: { label: "Search frames", value: "", onChange: vi.fn() } }
    const batch = () => [{ id: "trash", label: "Move to Trash", run: vi.fn() }]

    function Selectable({ membership, initial = [], onShowHidden }: { membership?: boolean; initial?: string[]; onShowHidden?: () => void }) {
      const [selected, setSelected] = useState<string[]>(initial)
      return (
        <DataTable
          label="Frames"
          rows={ROWS}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          toolbar={toolbar}
          batchActions={batch}
          selection={{ selected, onChange: setSelected, rowLabel: (row) => row.name, membership, countLabel: membership ? (count) => `${count} frames in the run` : undefined, onShowHidden }}
        />
      )
    }

    it("membership: selecting keeps the toolbar row, shows no batch bar, and counts the members", async () => {
      const user = userEvent.setup()
      render(<Selectable membership initial={["gone"]} onShowHidden={vi.fn()} />)
      expect(screen.getByText("1 frames in the run")).toBeInTheDocument()
      // A member the filters hide is counted with Show.
      expect(screen.getByText(`· ${m.table_selection_hidden({ count: 1, n: "1" })}`)).toBeInTheDocument()
      expect(screen.getByRole("button", { name: m.table_selection_show() })).toBeInTheDocument()

      await user.click(screen.getByRole("checkbox", { name: m.table_select_row({ name: "Vega" }) }))
      expect(screen.getByText("2 frames in the run")).toBeInTheDocument()
      expect(screen.getByRole("searchbox", { name: "Search frames" })).toBeInTheDocument()
      expect(screen.queryByRole("region", { name: m.selection_region() })).not.toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Move to Trash" })).not.toBeInTheDocument()
    })

    it("default: selecting still swaps the toolbar row for the batch bar", async () => {
      const user = userEvent.setup()
      render(<Selectable />)
      await user.click(screen.getByRole("checkbox", { name: m.table_select_row({ name: "Vega" }) }))
      const bar = screen.getByRole("region", { name: m.selection_region() })
      expect(within(bar).getByText(m.table_selected_count({ count: 1, n: "1" }))).toBeInTheDocument()
      expect(within(bar).getByRole("button", { name: "Move to Trash" })).toBeInTheDocument()
      expect(screen.queryByRole("searchbox", { name: "Search frames" })).not.toBeInTheDocument()
    })
  })
})
