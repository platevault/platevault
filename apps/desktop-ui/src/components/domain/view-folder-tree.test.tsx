import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { applyPlan, type ViewFolderNode, viewTree } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ViewFolderTree } from "./view-folder-tree"

let seed: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(Date.parse("2026-10-13T12:00:00Z"))
  seed = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})

const treeOf = (projectId: string) => applyPlan(seed, seed.catalog.projects[projectId]!).tree
const item = (name: string) => screen.getAllByRole("treeitem").find((el) => el.dataset.path?.split("/").pop() === name || (name === "View" && el.dataset.path === ""))!
const names = () => screen.getAllByRole("treeitem").map((el) => el.dataset.path)
const entriesIn = (node: ViewFolderNode): number => node.entries + node.children.reduce((n, child) => n + entriesIn(child), 0)

describe("ViewFolderTree", () => {
  it("renders the planned layout: GROUP_ folders with several groups, NIGHT_ folders, Lights and Flats per filter, Darks and Bias per group", () => {
    const planned = treeOf("prj_cygnus")
    render(<ViewFolderTree label="New View" tree={planned} mode="symlink" />)
    const tree = screen.getByRole("tree", { name: "New View" })
    expect(within(tree).getAllByRole("treeitem", { name: /^View/ })[0]).toHaveAttribute("aria-level", "1")
    expect(names()).toContain("GROUP_RedCat-51-ASI2600MM/NIGHT_2026-09-18/Lights/Ha_GAIN_100_300s")
    expect(names()).toContain("GROUP_RedCat-51-ASI2600MM/NIGHT_2026-09-18/Flats/Ha_GAIN_100")
    expect(names()).toContain("GROUP_Esprit-100-ASI533MC/Darks/GAIN_101")
    expect(item("GROUP_RedCat-51-ASI2600MM")).toHaveAttribute("aria-level", "2")
    // Symlinks: each folder counts its links; nothing is copied.
    expect(item("Ha_GAIN_100_300s")).toHaveTextContent(m.view_tree_links({ count: 52 }))
    const total = entriesIn(planned)
    expect(screen.getByText(m.view_tree_links_note({ count: total, n: String(total) }))).toBeInTheDocument()
  })

  it("one group: the nights and the shared Bias sit right under View; Copies count copies and bytes", () => {
    render(<ViewFolderTree label="New View" tree={treeOf("prj_m31")} mode="copy" />)
    expect(item("NIGHT_2026-09-02")).toHaveAttribute("aria-level", "2")
    expect(names().some((path) => path?.startsWith("GROUP_"))).toBe(false)
    expect(item("Bias")).toHaveAttribute("aria-level", "2")
    // The FRA400 camera's "Don't use darks": no Darks folder at all.
    expect(names()).not.toContain("Darks")
    const lights = screen.getAllByRole("treeitem").find((el) => el.dataset.path === "NIGHT_2026-09-02/Lights/L")
    expect(lights).toHaveTextContent(m.wrapup_copies({ count: 55 }))
  })

  it("panel groups use PANEL_ folders", () => {
    render(<ViewFolderTree label="New View" tree={treeOf("prj_ic5070")} mode="copy" />)
    expect(names().filter((path) => path && !path.includes("/") && path.startsWith("PANEL_"))).toEqual(["PANEL_Panel-1", "PANEL_Panel-2", "PANEL_Panel-3"])
  })

  it("is one Tab stop; ↑/↓, ←/→, Home and End move through and fold the folders", async () => {
    const user = userEvent.setup()
    render(
      <>
        <ViewFolderTree label="New View" tree={treeOf("prj_m31")} mode="copy" />
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
    const empty: ViewFolderNode = viewTree([], "symlink")
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
