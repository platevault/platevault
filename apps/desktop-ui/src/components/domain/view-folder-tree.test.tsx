import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { VIEW_EMPTY, VIEW_GROUPS, VIEW_ONE_GROUP, VIEW_PANELS } from "@/app/catalogue/fixtures/view-tree"
import { formatBytes } from "@/lib/format"
import { m } from "@/lib/i18n"
import { type ViewFolderNode, ViewFolderTree } from "./view-folder-tree"

const item = (name: string) => screen.getAllByRole("treeitem").find((el) => el.dataset.path?.split("/").pop() === name || (name === "View" && el.dataset.path === ""))!
const names = () => screen.getAllByRole("treeitem").map((el) => el.dataset.path)
const entriesIn = (node: ViewFolderNode): number => node.entries + node.children.reduce((n, child) => n + entriesIn(child), 0)
const bytesIn = (node: ViewFolderNode): number => node.bytes + node.children.reduce((n, child) => n + bytesIn(child), 0)

describe("ViewFolderTree", () => {
  it("renders the planned folders at their depth; Symlinks count each folder's links and the total", () => {
    render(<ViewFolderTree label="New View" tree={VIEW_GROUPS} mode="symlink" />)
    const tree = screen.getByRole("tree", { name: "New View" })
    expect(within(tree).getAllByRole("treeitem", { name: /^View/ })[0]).toHaveAttribute("aria-level", "1")
    expect(names()).toContain("GROUP_RedCat-51-ASI2600MM/NIGHT_2026-09-18/Lights/Ha_GAIN_100_300s")
    expect(names()).toContain("GROUP_Esprit-100-ASI533MC/Darks/GAIN_101")
    expect(item("GROUP_RedCat-51-ASI2600MM")).toHaveAttribute("aria-level", "2")
    expect(item("Ha_GAIN_100_300s")).toHaveTextContent(m.view_tree_links({ count: 52 }))
    const total = entriesIn(VIEW_GROUPS)
    expect(screen.getByText(m.view_tree_links_note({ count: total, n: String(total) }))).toBeInTheDocument()
  })

  it("Copies count each folder's copies; folders keep the plan's order", () => {
    render(<ViewFolderTree label="New View" tree={VIEW_ONE_GROUP} mode="copy" />)
    expect(names().slice(0, 3)).toEqual(["", "Bias", "NIGHT_2026-09-02"])
    expect(item("NIGHT_2026-09-02")).toHaveAttribute("aria-level", "2")
    const lights = screen.getAllByRole("treeitem").find((el) => el.dataset.path === "NIGHT_2026-09-02/Lights/L")
    expect(lights).toHaveTextContent(`${m.wrapup_copies({ count: 55 })} · ${formatBytes(55 * 62_000_000)}`)
    const total = entriesIn(VIEW_ONE_GROUP)
    expect(screen.getByText(m.view_tree_copies_note({ count: total, n: String(total), size: formatBytes(bytesIn(VIEW_ONE_GROUP)) }))).toBeInTheDocument()
  })

  it("lists every top-level folder the plan names", () => {
    render(<ViewFolderTree label="New View" tree={VIEW_PANELS} mode="symlink" />)
    expect(names().filter((path) => path && !path.includes("/"))).toEqual(["PANEL_Panel-1", "PANEL_Panel-2", "PANEL_Panel-3"])
  })

  it("is one Tab stop; ↑/↓, ←/→, Home and End move through and fold the folders", async () => {
    const user = userEvent.setup()
    render(
      <>
        <ViewFolderTree label="New View" tree={VIEW_ONE_GROUP} mode="copy" />
        <button type="button">After</button>
      </>,
    )
    const items = screen.getAllByRole("treeitem")
    expect(items.filter((el) => el.tabIndex === 0)).toHaveLength(1)
    await user.tab()
    expect(item("View")).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(item("View")).toHaveFocus()

    await user.keyboard("{ArrowDown}")
    expect(item("Bias")).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    const night = item("NIGHT_2026-09-02")
    expect(night).toHaveFocus()
    expect(night).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{ArrowLeft}")
    expect(night).toHaveAttribute("aria-expanded", "false")
    expect(names()).not.toContain("NIGHT_2026-09-02/Lights")
    await user.keyboard("{ArrowRight}")
    expect(night).toHaveAttribute("aria-expanded", "true")
    await user.keyboard("{ArrowRight}")
    expect(item("Flats")).toHaveFocus()
    await user.keyboard("{ArrowLeft}{ArrowLeft}")
    expect(night).toHaveFocus()
    await user.keyboard("{End}")
    expect(screen.getAllByRole("treeitem").at(-1)).toHaveFocus()
    await user.keyboard("{Home}")
    expect(item("View")).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(screen.getAllByRole("treeitem")).toHaveLength(1)
  })

  it("shows its loading, empty and error states", async () => {
    const empty = VIEW_EMPTY
    const onRetry = vi.fn()
    const { unmount } = render(<ViewFolderTree label="New View" tree={empty} mode="symlink" />)
    expect(screen.getByText(m.view_tree_empty())).toBeInTheDocument()
    unmount()
    const loading = render(<ViewFolderTree label="New View" tree={empty} mode="symlink" loading />)
    expect(screen.getByRole("status")).toHaveTextContent(m.view_tree_loading())
    loading.unmount()
    render(<ViewFolderTree label="New View" tree={empty} mode="symlink" error={{ message: "Can't read the plan", onRetry }} />)
    await userEvent.setup().click(screen.getByRole("button", { name: m.verb_retry() }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
