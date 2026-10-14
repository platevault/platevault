import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { Action, Column, MenuItem } from "./contracts"
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

  it("hover: only a row that acts tints under the pointer, never the open row", () => {
    const rowOf = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!
    const open: Action = { id: "open", label: "Open", run: vi.fn() }
    const { unmount } = render(
      <DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} rowLabel={(row) => row.name} primaryRowAction={(row) => (row.id === "a" ? open : null)} />,
    )
    // A primary action makes the row interactive; the hover tint also outranks the stripe and skips the current row.
    expect(rowOf("Vega").className).toContain("hover:not-data-selected:not-aria-[current=true]:bg-foreground/5")
    expect(rowOf("Altair").className).not.toMatch(/hover:/)
    unmount()

    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} onRowClick={vi.fn()} />)
    for (const name of ["Vega", "Altair", "Deneb"]) expect(rowOf(name).className).toMatch(/hover:\S*bg-/)
  })

  describe("selection", () => {
    const toolbar = { search: { label: "Search frames", value: "", onChange: vi.fn() } }
    const batch = () => [{ id: "trash", label: "Move to Trash", run: vi.fn() }]

    function Selectable({
      membership,
      initial = [],
      onShowHidden,
      batchActions = batch,
    }: {
      membership?: boolean
      initial?: string[]
      onShowHidden?: () => void
      batchActions?: (ids: string[]) => Action[]
    }) {
      const [selected, setSelected] = useState<string[]>(initial)
      return (
        <DataTable
          label="Frames"
          rows={ROWS}
          columns={COLUMNS}
          getRowId={(row) => row.id}
          toolbar={toolbar}
          batchActions={batchActions}
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

    describe("a batch action's confirmation", () => {
      const reject = (id = "reject"): ((ids: string[]) => Action[]) => (ids) => [{ id, label: "Reject", confirm: { title: `Reject ${ids.length} frames?`, confirm: { label: "Reject" } }, run: vi.fn() }]

      // The row checkbox holds focus and the batch button is clicked without taking it, as a click does in WebKit.
      async function openFromCheckbox(batchActions: (ids: string[]) => Action[]) {
        const user = userEvent.setup()
        const view = render(<Selectable batchActions={batchActions} />)
        const checkbox = screen.getByRole("checkbox", { name: m.table_select_row({ name: "Vega" }) })
        await user.click(checkbox)
        expect(checkbox).toHaveFocus()
        const button = within(screen.getByRole("region", { name: m.selection_region() })).getByRole("button", { name: "Reject…" })
        fireEvent.click(button)
        const dialog = await screen.findByRole("alertdialog", { name: "Reject 1 frames?" })
        return { user, view, button, dialog }
      }

      it("returns focus to the batch action on Escape", async () => {
        const { user, button } = await openFromCheckbox(reject())
        await user.keyboard("{Escape}")
        await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
        await waitFor(() => expect(button).toHaveFocus())
      })

      it("returns focus to the batch action on Cancel", async () => {
        const { user, button, dialog } = await openFromCheckbox(reject())
        await user.click(within(dialog).getByRole("button", { name: m.verb_cancel() }))
        await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
        await waitFor(() => expect(button).toHaveFocus())
      })

      it("returns focus to the batch bar's first control when the action's button is gone", async () => {
        const { user, view, button, dialog } = await openFromCheckbox(reject())
        view.rerender(<Selectable batchActions={reject("reject-all")} />)
        expect(button).not.toBeInTheDocument()
        await user.click(within(dialog).getByRole("button", { name: m.verb_cancel() }))
        await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
        const bar = screen.getByRole("region", { name: m.selection_region() })
        await waitFor(() => expect(within(bar).getAllByRole("button")[0]).toHaveFocus())
      })
    })
  })

  describe("Columns menu", () => {
    // Name is the row header, so `hideable` on it is ignored; Kind starts hidden.
    const HIDEABLE: Column<Frame>[] = [
      { id: "name", header: "Name", cell: (row) => row.name, sortValue: (row) => row.name, rowHeader: true, hideable: true },
      { id: "size", header: "Size", cell: (row) => row.size, sortValue: (row) => row.size, align: "right", hideable: true },
      { id: "kind", header: "Kind", cell: () => "Light", sortValue: () => "Light", hideable: true, defaultHidden: true },
    ]
    const Hideable = ({ columnsId }: { columnsId?: string }) => (
      <DataTable label="Frames" rows={ROWS} columns={HIDEABLE} columnsId={columnsId} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => ITEMS} />
    )
    const headers = () => screen.getAllByRole("columnheader").map((cell) => cell.textContent)
    const trigger = () => screen.getByRole("button", { name: m.display_menu_columns() })
    const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(trigger())
      return screen.findByRole("menu")
    }

    it("starts a defaultHidden column hidden and lists only the hideable columns, never the row header or the actions", async () => {
      const user = userEvent.setup()
      render(<Hideable />)
      expect(headers()).toEqual(["Name", "Size", m.table_actions_column()])
      const items = within(await openMenu(user)).getAllByRole("menuitemcheckbox")
      expect(items.map((item) => item.textContent)).toEqual(["Size", "Kind"])
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["true", "false"])
    })

    it("toggling a column shows and hides it, and the menu stays open", async () => {
      const user = userEvent.setup()
      render(<Hideable />)
      const menu = await openMenu(user)
      await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Kind" }))
      expect(headers()).toEqual(["Name", "Size", "Kind", m.table_actions_column()])
      await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Size" }))
      expect(headers()).toEqual(["Name", "Kind", m.table_actions_column()])
      expect(screen.getAllByRole("row")[1]).toHaveTextContent("Light")
      expect(menu).toBeInTheDocument()
    })

    it("works from the keyboard: Enter opens, arrows move, Space toggles, Escape closes back to the trigger", async () => {
      const user = userEvent.setup()
      render(<Hideable />)
      trigger().focus()
      await user.keyboard("{Enter}")
      const items = within(await screen.findByRole("menu")).getAllByRole("menuitemcheckbox")
      await user.keyboard("{ArrowDown}")
      await waitFor(() => expect(items[1]).toHaveFocus())
      await user.keyboard(" ")
      expect(headers()).toContain("Kind")
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
      expect(trigger()).toHaveFocus()
    })

    it("keeps the choice under columnsId in localStorage, and a remounted table shows it again", async () => {
      const user = userEvent.setup()
      const view = render(<Hideable columnsId="test.kept" />)
      await user.click(within(await openMenu(user)).getByRole("menuitemcheckbox", { name: "Kind" }))
      expect(JSON.parse(localStorage.getItem("platevault.columns.test.kept") ?? "null")).toEqual({ kind: true })
      view.unmount()
      render(<Hideable columnsId="test.kept" />)
      expect(headers()).toContain("Kind")
    })

    it("a table with no hideable column has no Columns menu", () => {
      render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />)
      expect(screen.queryByRole("button", { name: m.display_menu_columns() })).not.toBeInTheDocument()
    })
  })
})
