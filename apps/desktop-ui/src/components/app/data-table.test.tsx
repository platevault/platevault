import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { type ReactNode, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { libraryFailure, SUCCEEDED } from "@/app/catalogue/fixtures/results"
import { setSingleKeyShortcuts } from "@/app/preferences"
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
  // A thumbnail or an actions column has no order: `static`, never a sort value.
  { id: "preview", header: "Preview", cell: () => null, static: true },
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

  it("marks every header the census must not count as a data column", () => {
    render(
      <DataTable
        label="Frames"
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        rowLabel={(row) => row.name}
        rowActions={() => ITEMS}
        selection={{ selected: [], onChange: vi.fn(), rowLabel: (row) => row.name }}
      />,
    )
    const kinds = screen.getAllByRole("columnheader").map((cell) => cell.getAttribute("data-column-kind"))
    // Selection, then Name and Size (data, unmarked), then the static Preview, then row actions.
    expect(kinds).toEqual(["selection", null, null, "static", "action"])
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
    const refused: MenuItem = { id: "remove", label: "Remove", run: () => libraryFailure("input_write_risk", "none") }
    render(<DataTable label="Frames" rows={ROWS} columns={COLUMNS} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => [refused]} />)
    await user.click(screen.getByRole("button", { name: m.actions_for({ name: "Vega" }) }))
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Remove" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent(m.actions_blocked({ action: "Remove" }))
    expect(alert).toHaveTextContent(m.action_failure_input_write_risk())
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
      // Opening from the keyboard focuses the first item, a frame after the menu mounts. Pressing an
      // arrow before then would land on the first item instead of moving past it.
      await waitFor(() => expect(items[0]).toHaveFocus())
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

  // P-KBD1 (HARNESS-V5-FEEDBACK-R1.md): one Tab stop per table, on its current row, then that row's controls.
  describe("keyboard (P-KBD1)", () => {
    type User = ReturnType<typeof userEvent.setup>
    // No sort buttons in the header: its one stop is select-all, where the table has a selection.
    const PLAIN: Column<Frame>[] = [
      { id: "name", header: "Name", cell: (row) => row.name, rowHeader: true, static: true },
      { id: "size", header: "Size", cell: (row) => row.size, align: "right", static: true },
    ]
    const rowOf = (name: string, scope: HTMLElement = document.body) => within(scope).getByRole("rowheader", { name }).closest("tr")!
    const checkboxOf = (name: string) => screen.getByRole("checkbox", { name: m.table_select_row({ name }) })
    const moreOf = (name: string) => screen.getByRole("button", { name: m.actions_for({ name }) })
    const before = () => screen.getByRole("button", { name: "Before" })
    const after = () => screen.getByRole("button", { name: "After" })
    const entries = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((item) => item.textContent)
    const menuItems = (): MenuItem[] => [
      { id: "open", label: "Open", run: vi.fn() },
      { id: "trash", label: "Move to Trash", kind: "destructive", run: vi.fn() },
    ]

    function Around({ children }: { children: ReactNode }) {
      return (
        <>
          <button type="button">Before</button>
          {children}
          <button type="button">After</button>
        </>
      )
    }

    function Selectable({ isSelectable, items = menuItems() }: { isSelectable?: (row: Frame) => boolean; items?: MenuItem[] }) {
      const [selected, setSelected] = useState<string[]>([])
      return (
        <Around>
          <DataTable
            label="Frames"
            rows={ROWS}
            columns={PLAIN}
            getRowId={(row) => row.id}
            rowLabel={(row) => row.name}
            rowActions={() => items}
            selection={{ selected, onChange: setSelected, rowLabel: (row) => row.name, isSelectable }}
            batchActions={() => [{ id: "trash", label: "Move to Trash", run: vi.fn() }]}
          />
        </Around>
      )
    }

    /** Tabs on until `element` has focus. */
    async function tabTo(user: User, element: HTMLElement, shift = false) {
      for (let i = 0; i < 20 && document.activeElement !== element; i++) await user.tab({ shift })
      expect(element).toHaveFocus()
    }

    /** Opens the focused row's menu with Shift+F10 and runs its item `label` from the keyboard. */
    async function runFromRowMenu(user: User, row: string, label: string) {
      await user.keyboard("{Shift>}{F10}{/Shift}")
      const menu = await screen.findByRole("menu", { name: row })
      const item = within(menu).getByRole("menuitem", { name: label })
      for (let i = 0; i < 10 && document.activeElement !== item; i++) await user.keyboard("{ArrowDown}")
      expect(item).toHaveFocus()
      await user.keyboard("{Enter}")
    }

    it("1. is one Tab stop: the current row, its checkbox and ⋯, then out; Shift+Tab walks it back", async () => {
      const user = userEvent.setup()
      render(<Selectable />)
      const order = [before(), screen.getByRole("checkbox", { name: m.table_select_all({ count: 3 }) }), rowOf("Vega"), checkboxOf("Vega"), moreOf("Vega"), after()]
      for (const element of order) {
        await user.tab()
        expect(element).toHaveFocus()
      }
      for (const element of order.slice(0, -1).reverse()) {
        await user.tab({ shift: true })
        expect(element).toHaveFocus()
      }
      // The other rows and their controls are out of the Tab order.
      for (const name of ["Altair", "Deneb"]) {
        for (const element of [rowOf(name), checkboxOf(name), moreOf(name)]) expect(element).toHaveAttribute("tabindex", "-1")
      }
    })

    it("2. Tab comes back to the row focused last; a first Tab lands on the open row", async () => {
      const user = userEvent.setup()
      const view = render(
        <Around>
          <DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} onRowClick={vi.fn()} />
        </Around>,
      )
      await tabTo(user, rowOf("Vega"))
      await user.keyboard("{ArrowDown}{ArrowDown}")
      expect(rowOf("Deneb")).toHaveFocus()
      await user.tab()
      expect(after()).toHaveFocus()
      await user.tab({ shift: true })
      expect(rowOf("Deneb")).toHaveFocus()
      view.unmount()

      render(
        <Around>
          <DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} activeRowId="b" onRowClick={vi.fn()} />
        </Around>,
      )
      await user.tab()
      await user.tab()
      expect(rowOf("Altair")).toHaveFocus()
    })

    it("3. ↑/↓ move a row across groups, skip details and do not wrap; Home/End; Page Up/Down move one screen", async () => {
      const many: Frame[] = ["a", "b", "c", "d", "e", "f"].map((id, index) => ({ id, name: `Star ${id}`, size: index < 3 ? 1 : 2 }))
      // A 32 px row in a 100 px frame under a 32 px header: a screen holds two rows.
      const height = vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(32)
      const frameHeight = vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(100)
      try {
        const user = userEvent.setup()
        render(
          <DataTable
            label="Stars"
            rows={many}
            columns={PLAIN}
            getRowId={(row) => row.id}
            rowLabel={(row) => row.name}
            groups={{ key: (row) => String(row.size), label: (key) => `Size ${key}` }}
            expand={{ render: (row) => `Detail of ${row.name}`, defaultExpanded: ["a"] }}
          />,
        )
        const star = (id: string) => rowOf(`Star ${id}`)
        await user.tab()
        expect(star("a")).toHaveFocus()
        const steps: [string, string][] = [
          ["{ArrowUp}", "a"],
          ["{ArrowDown}", "b"],
          ["{ArrowDown}", "c"],
          ["{ArrowDown}", "d"],
          ["{End}", "f"],
          ["{ArrowDown}", "f"],
          ["{Home}", "a"],
          ["{PageDown}", "c"],
          ["{PageDown}", "e"],
          ["{PageDown}", "f"],
          ["{PageUp}", "d"],
          ["{PageUp}", "b"],
        ]
        for (const [key, id] of steps) {
          await user.keyboard(key)
          expect(star(id)).toHaveFocus()
        }
      } finally {
        height.mockRestore()
        frameHeight.mockRestore()
      }
    })

    it("4. ↓ on a row's checkbox focuses the next row's, and that row becomes the Tab stop", async () => {
      const user = userEvent.setup()
      render(<Selectable />)
      await tabTo(user, checkboxOf("Vega"))
      await user.keyboard("{ArrowDown}")
      expect(checkboxOf("Altair")).toHaveFocus()
      expect(rowOf("Altair")).toHaveAttribute("tabindex", "0")
      expect(rowOf("Vega")).toHaveAttribute("tabindex", "-1")
      await user.tab({ shift: true })
      expect(rowOf("Altair")).toHaveFocus()
    })

    it("5. Space on a row ticks it and clears it, with the batch bar and the count; a row that cannot be selected stays", async () => {
      const user = userEvent.setup()
      const view = render(<Selectable isSelectable={(row) => row.id !== "b"} />)
      const live = view.container.querySelector<HTMLElement>("[aria-live=polite]")!
      const prevented: boolean[] = []
      const record = (event: KeyboardEvent) => event.key === " " && prevented.push(event.defaultPrevented)
      window.addEventListener("keydown", record)
      try {
        await tabTo(user, rowOf("Vega"))
        await user.keyboard(" ")
        expect(checkboxOf("Vega")).toBeChecked()
        expect(screen.getByRole("region", { name: m.selection_region() })).toBeInTheDocument()
        expect(live).toHaveTextContent(m.table_selected_count({ count: 1, n: "1" }))
        expect(rowOf("Vega")).toHaveFocus()
        await user.keyboard(" ")
        expect(checkboxOf("Vega")).not.toBeChecked()
        expect(screen.queryByRole("region", { name: m.selection_region() })).not.toBeInTheDocument()
        await user.keyboard("{ArrowDown} ")
        expect(rowOf("Altair")).toHaveFocus()
        expect(checkboxOf("Altair")).not.toBeChecked()
        expect(prevented).toEqual([true, true, true])
      } finally {
        window.removeEventListener("keydown", record)
      }
    })

    it("5. Space on a row follows the single-key shortcuts switch; the checkbox keeps its own Space", async () => {
      const user = userEvent.setup()
      setSingleKeyShortcuts(false)
      try {
        render(<Selectable />)
        await tabTo(user, rowOf("Vega"))
        await user.keyboard(" ")
        expect(checkboxOf("Vega")).not.toBeChecked()
        await user.tab()
        await user.keyboard(" ")
        expect(checkboxOf("Vega")).toBeChecked()
      } finally {
        setSingleKeyShortcuts(true)
      }
    })

    it("6. Enter on a row runs onRowClick once, else the primary action, else nothing; a control keeps its Enter", async () => {
      const user = userEvent.setup()
      const onRowClick = vi.fn()
      let view = render(<DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={menuItems} onRowClick={onRowClick} />)
      await user.tab()
      await user.keyboard("{Enter}")
      expect(onRowClick).toHaveBeenCalledOnce()
      expect(onRowClick).toHaveBeenCalledWith(ROWS[0])
      await user.tab()
      expect(moreOf("Vega")).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(await screen.findByRole("menu")).toBeInTheDocument()
      expect(onRowClick).toHaveBeenCalledOnce()
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
      view.unmount()

      const open = vi.fn()
      view = render(<DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} rowLabel={(row) => row.name} primaryRowAction={() => ({ id: "open", label: "Open", run: open })} />)
      await user.tab()
      expect(rowOf("Vega")).toHaveFocus()
      await user.keyboard("{Enter}")
      expect(open).toHaveBeenCalledOnce()
      view.unmount()

      const items = menuItems()
      render(<Selectable items={items} />)
      await tabTo(user, rowOf("Vega"))
      await user.keyboard("{Enter}")
      expect(checkboxOf("Vega")).not.toBeChecked()
      expect(screen.queryByRole("menu")).not.toBeInTheDocument()
      for (const item of items) if ("run" in item) expect(item.run).not.toHaveBeenCalled()
    })

    it.each(["{Shift>}{F10}{/Shift}", "{ContextMenu}"])("7. %s on a row opens its menu with the ⋯ entries; Escape returns focus to the row and runs nothing", async (key) => {
      const user = userEvent.setup()
      const items = menuItems()
      render(<DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => items} />)
      await user.tab()
      await user.keyboard("{ArrowDown}")
      const row = rowOf("Altair")
      expect(row).toHaveFocus()
      // 8. Tab reaches the current row's ⋯, and its menu holds the same entries.
      await user.tab()
      expect(moreOf("Altair")).toHaveFocus()
      await user.keyboard("{Enter}")
      const more = entries(await screen.findByRole("menu"))
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
      expect(moreOf("Altair")).toHaveFocus()
      await user.tab({ shift: true })
      expect(row).toHaveFocus()

      await user.keyboard(key)
      const menu = await screen.findByRole("menu", { name: "Altair" })
      expect(entries(menu)).toEqual(more)
      await user.keyboard("{Escape}")
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
      await waitFor(() => expect(row).toHaveFocus())
      for (const item of items) if ("run" in item) expect(item.run).not.toHaveBeenCalled()
    })

    it.each(["Escape", "Cancel"])("9. a confirm opened from the row's menu returns focus to the row on %s", async (close) => {
      const user = userEvent.setup()
      const remove = vi.fn()
      const items: MenuItem[] = [{ id: "remove", label: "Remove", confirm: { title: "Remove Altair?", confirm: { label: "Remove" } }, run: remove }]
      render(<DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={() => items} />)
      await user.tab()
      await user.keyboard("{ArrowDown}")
      await runFromRowMenu(user, "Altair", "Remove…")
      const dialog = await screen.findByRole("alertdialog", { name: "Remove Altair?" })
      if (close === "Escape") await user.keyboard("{Escape}")
      else {
        await tabTo(user, within(dialog).getByRole("button", { name: m.verb_cancel() }))
        await user.keyboard("{Enter}")
      }
      await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
      await waitFor(() => expect(rowOf("Altair")).toHaveFocus())
      expect(remove).not.toHaveBeenCalled()
    })

    /** Rows the user removes: Remove asks first unless `quick`. */
    function Removable({ quick = false }: { quick?: boolean }) {
      const [rows, setRows] = useState(ROWS)
      const remove = (row: Frame): MenuItem => ({
        id: "remove",
        label: "Remove",
        confirm: quick ? undefined : { title: `Remove ${row.name}?`, confirm: { label: "Remove" } },
        run: () => {
          setRows((current) => current.filter((other) => other.id !== row.id))
          return SUCCEEDED
        },
      })
      return <DataTable label="Frames" rows={rows} columns={PLAIN} getRowId={(row) => row.id} rowLabel={(row) => row.name} rowActions={(row) => [remove(row)]} />
    }

    it("10. after a confirmed action removes the focused row, focus moves to the next row, or the previous one at the end", async () => {
      const user = userEvent.setup()
      render(<Removable />)
      await user.tab()
      await user.keyboard("{ArrowDown}")
      for (const [name, next] of [
        ["Altair", "Deneb"],
        ["Deneb", "Vega"],
      ] as const) {
        expect(rowOf(name)).toHaveFocus()
        await runFromRowMenu(user, name, "Remove…")
        const dialog = await screen.findByRole("alertdialog", { name: `Remove ${name}?` })
        await tabTo(user, within(dialog).getByRole("button", { name: "Remove" }))
        await user.keyboard("{Enter}")
        await waitFor(() => expect(screen.queryByRole("rowheader", { name })).not.toBeInTheDocument())
        await waitFor(() => expect(rowOf(next)).toHaveFocus())
        expect(rowOf(next)).toHaveAttribute("tabindex", "0")
      }
    })

    it("10. an action without a confirm that removes the row from its ⋯ also hands focus to the next row", async () => {
      const user = userEvent.setup()
      render(<Removable quick />)
      await user.tab()
      await user.tab()
      expect(moreOf("Vega")).toHaveFocus()
      await user.keyboard("{Enter}")
      const item = within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Remove" })
      await waitFor(() => expect(item).toHaveFocus())
      await user.keyboard("{Enter}")
      await waitFor(() => expect(rowOf("Altair")).toHaveFocus())
    })

    it("10. an action without a confirm that removes the row from its context menu hands focus to the next row", async () => {
      const user = userEvent.setup()
      render(<Removable quick />)
      await user.tab()
      await user.keyboard("{ArrowDown}")
      await runFromRowMenu(user, "Altair", "Remove")
      await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Altair" })).not.toBeInTheDocument())
      await waitFor(() => expect(rowOf("Deneb")).toHaveFocus())
    })

    it("11. a click on a row's checkbox makes it current: Tab out and Shift+Tab back return to that row", async () => {
      const user = userEvent.setup()
      render(<Selectable />)
      await user.click(checkboxOf("Deneb"))
      await tabTo(user, after())
      await user.tab({ shift: true })
      expect(moreOf("Deneb")).toHaveFocus()
      expect(rowOf("Deneb")).toContainElement(document.activeElement as HTMLElement)
    })

    it("12. an expanded row's nested table is one stop of its own, and ↑/↓ in it leave the outer table alone", async () => {
      const user = userEvent.setup()
      const inner: Frame[] = [
        { id: "x", name: "Inner x", size: 1 },
        { id: "y", name: "Inner y", size: 1 },
      ]
      render(
        <Around>
          <DataTable
            label="Outer"
            rows={ROWS}
            columns={PLAIN}
            getRowId={(row) => row.id}
            rowLabel={(row) => row.name}
            expand={{ render: (row) => <DataTable label={`Inner of ${row.name}`} rows={inner} columns={PLAIN} getRowId={(r) => r.id} onRowClick={vi.fn()} scroll="none" />, defaultExpanded: ["a", "c"] }}
          />
        </Around>,
      )
      const vegaInner = screen.getByRole("table", { name: "Inner of Vega" })
      const denebInner = screen.getByRole("table", { name: "Inner of Deneb" })
      const order = [before(), rowOf("Vega"), screen.getByRole("button", { name: m.table_row_details({ name: "Vega" }) }), rowOf("Inner x", vegaInner), after()]
      for (const element of order) {
        await user.tab()
        expect(element).toHaveFocus()
      }
      // The current row's detail holds the only nested stop; Deneb's nested table and disclosure are out of the order.
      expect(rowOf("Inner x", denebInner)).toHaveAttribute("tabindex", "-1")
      expect(screen.getByRole("button", { name: m.table_row_details({ name: "Deneb" }) })).toHaveAttribute("tabindex", "-1")
      await user.tab({ shift: true })
      await user.keyboard("{ArrowDown}")
      expect(rowOf("Inner y", vegaInner)).toHaveFocus()
      await user.keyboard("{ArrowDown}")
      expect(rowOf("Inner y", vegaInner)).toHaveFocus()
      expect(rowOf("Vega")).toHaveAttribute("tabindex", "0")
    })

    it("12. a field in a row keeps its arrows, Space, Home and End", async () => {
      const user = userEvent.setup()
      const onRowClick = vi.fn()
      const withNote: Column<Frame>[] = [...PLAIN, { id: "note", header: "Note", static: true, cell: (row) => <input aria-label={`Note for ${row.name}`} defaultValue="" /> }]
      render(<DataTable label="Frames" rows={ROWS} columns={withNote} getRowId={(row) => row.id} onRowClick={onRowClick} />)
      await user.tab()
      await user.tab()
      const field = screen.getByRole("textbox", { name: "Note for Vega" })
      expect(field).toHaveFocus()
      await user.keyboard("ac{ArrowLeft}b{Home}x{End} {ArrowDown}{ArrowUp}")
      expect(field).toHaveValue("xabc ")
      expect(field).toHaveFocus()
      expect(onRowClick).not.toHaveBeenCalled()
    })

    it("13. a table whose rows do not act has no focusable row", async () => {
      const user = userEvent.setup()
      render(
        <Around>
          <DataTable label="Frames" rows={ROWS} columns={PLAIN} getRowId={(row) => row.id} />
        </Around>,
      )
      for (const name of ["Vega", "Altair", "Deneb"]) expect(rowOf(name)).not.toHaveAttribute("tabindex")
      await user.tab()
      await user.tab()
      expect(after()).toHaveFocus()
    })
  })
})

describe("DataTable windowing", () => {
  const MANY: Frame[] = Array.from({ length: 5000 }, (_, i) => ({ id: `f${i}`, name: `Light_${String(i).padStart(4, "0")}`, size: i }))
  const mountedRows = () => document.querySelectorAll("tbody > tr[data-row]")
  const rowNamed = (name: string) => screen.getByRole("rowheader", { name }).closest("tr")!
  const checkboxOf = (name: string) => screen.getByRole("checkbox", { name: m.table_select_row({ name }) })
  /** jsdom has no layout: a scroll sets the frame's offset, which the virtualizer reads on the scroll event. */
  const scrollFrameTo = (top: number) => {
    const frame = screen.getByRole("table", { name: "Frames" }).parentElement!
    frame.scrollTop = top
    fireEvent.scroll(frame)
  }
  function Many() {
    const [selected, setSelected] = useState<string[]>([])
    return <DataTable label="Frames" rows={MANY} columns={COLUMNS} getRowId={(row) => row.id} selection={{ selected, onChange: setSelected, rowLabel: (row) => row.name }} />
  }

  it("mounts a bounded window of a 5,000-row table and numbers its rows among all of them", () => {
    render(<Many />)
    expect(mountedRows().length).toBeGreaterThan(10)
    expect(mountedRows().length).toBeLessThan(100)
    expect(screen.getByRole("table", { name: "Frames" })).toHaveAttribute("aria-rowcount", "5001")
    expect(rowNamed("Light_0000")).toHaveAttribute("aria-rowindex", "2")
  })

  it("End mounts and focuses the last row, and the keys keep moving from there", async () => {
    const user = userEvent.setup()
    render(<Many />)
    act(() => rowNamed("Light_0000").focus())
    await user.keyboard("{End}")
    expect(rowNamed("Light_4999")).toHaveFocus()
    expect(rowNamed("Light_4999")).toHaveAttribute("aria-rowindex", "5001")
    expect(mountedRows().length).toBeLessThan(100)
    await user.keyboard("{ArrowUp}")
    expect(rowNamed("Light_4998")).toHaveFocus()
    await user.keyboard("{Home}")
    expect(rowNamed("Light_0000")).toHaveFocus()
  })

  it("keeps an off-screen row's selection when it scrolls back into view", async () => {
    const user = userEvent.setup()
    render(<Many />)
    act(() => rowNamed("Light_0000").focus())
    await user.keyboard(" ")
    expect(checkboxOf("Light_0000")).toBeChecked()
    // The current row moves to the end, so the first row is no longer kept mounted.
    await user.keyboard("{End}")
    scrollFrameTo(2500 * 26)
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Light_0000" })).not.toBeInTheDocument())
    expect(screen.getByRole("rowheader", { name: "Light_2500" })).toBeInTheDocument()
    scrollFrameTo(0)
    await waitFor(() => expect(checkboxOf("Light_0000")).toBeChecked())
    expect(rowNamed("Light_0000")).toHaveAttribute("data-selected", "true")
  })

  it('windows a scroll="none" table against its scrolling ancestor and follows that ancestor\'s scroll', async () => {
    render(
      <div data-testid="page" style={{ overflowY: "auto", height: 600 }}>
        <DataTable label="Frames" rows={MANY} columns={COLUMNS} getRowId={(row) => row.id} scroll="none" />
      </div>,
    )
    const page = screen.getByTestId("page")
    // jsdom has no layout: the table's box moves up as the page scrolls.
    vi.spyOn(screen.getByRole("table", { name: "Frames" }), "getBoundingClientRect").mockImplementation(() => ({ top: -page.scrollTop }) as DOMRect)
    expect(mountedRows().length).toBeGreaterThan(10)
    expect(mountedRows().length).toBeLessThan(100)
    page.scrollTop = 2500 * 26
    fireEvent.scroll(page)
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Light_0000" })).not.toBeInTheDocument())
    expect(screen.getByRole("rowheader", { name: "Light_2500" })).toBeInTheDocument()
    expect(mountedRows().length).toBeLessThan(100)
  })

  it("numbers group headers and open details among the rows", () => {
    render(
      <DataTable
        label="Frames"
        rows={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        groups={{ key: (row) => (row.size % 2 === 0 ? "Even" : "Odd"), label: (key) => key }}
        rowLabel={(row) => row.name}
        expand={{ render: (row) => <p>{`Details of ${row.name}`}</p>, defaultExpanded: ["c"] }}
      />,
    )
    const lineOf = (text: string) => screen.getByText(text).closest("tr")
    // Even: Deneb and its open detail; Odd: Vega, Altair. The header row is 1.
    expect(screen.getByRole("table", { name: "Frames" })).toHaveAttribute("aria-rowcount", "7")
    expect(lineOf("Even")).toHaveAttribute("aria-rowindex", "2")
    expect(rowNamed("Deneb")).toHaveAttribute("aria-rowindex", "3")
    expect(lineOf("Details of Deneb")).toHaveAttribute("aria-rowindex", "4")
    expect(lineOf("Odd")).toHaveAttribute("aria-rowindex", "5")
    expect(rowNamed("Vega")).toHaveAttribute("aria-rowindex", "6")
    expect(rowNamed("Altair")).toHaveAttribute("aria-rowindex", "7")
  })
})
