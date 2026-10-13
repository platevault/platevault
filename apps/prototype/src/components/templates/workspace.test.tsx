import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { WORKSPACE_ROW_PRESETS, Workspace, type WorkspaceAside, type WorkspaceProps } from "./workspace"

// jsdom has no ResizeObserver: the workspace then reads as unmeasured, so the list may take up to 40 rows.
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
/** The fallback row height jsdom gets: no stylesheet defines `--table-row-h` there. */
const ROW = 26
const px = (rows: number) => (rows + 1) * ROW

function renderWorkspace(props: Partial<WorkspaceProps> = {}) {
  const onRowsPx = vi.fn()
  render(
    <Workspace
      label="Frames to review"
      toolbar={{}}
      list={<p>list</p>}
      listHeight="rows"
      rowsPx={px(8)}
      onRowsPx={onRowsPx}
      stage={[]}
      status={[]}
      statusLabel="Review status"
      {...props}
    />,
  )
  return { onRowsPx, handle: screen.queryByRole("separator", { name: m.workspace_list_height() }) as HTMLElement }
}

describe("Workspace list height", () => {
  it("names its height in rows and steps a row per arrow key, five per page key", () => {
    const { onRowsPx, handle } = renderWorkspace()
    expect(handle).toHaveAttribute("aria-valuenow", "8")
    expect(handle).toHaveAttribute("aria-valuetext", m.workspace_list_rows({ count: 8 }))
    fireEvent.keyDown(handle, { key: "ArrowDown" })
    expect(onRowsPx).toHaveBeenLastCalledWith(px(9))
    fireEvent.keyDown(handle, { key: "ArrowUp" })
    expect(onRowsPx).toHaveBeenLastCalledWith(px(7))
    fireEvent.keyDown(handle, { key: "PageDown" })
    expect(onRowsPx).toHaveBeenLastCalledWith(px(13))
  })

  it("goes to the fewest rows on Home and the most on End, and never past them", () => {
    const { onRowsPx, handle } = renderWorkspace({ rowsPx: px(3) })
    fireEvent.keyDown(handle, { key: "Home" })
    expect(onRowsPx).toHaveBeenLastCalledWith(px(3))
    fireEvent.keyDown(handle, { key: "ArrowUp" })
    expect(onRowsPx).toHaveBeenLastCalledWith(px(3))
    fireEvent.keyDown(handle, { key: "End" })
    expect(onRowsPx).toHaveBeenLastCalledWith(Number(handle.getAttribute("aria-valuemax")) * ROW + ROW)
  })

  it("steps to the next preset height on a click without a drag (WCAG 2.5.7)", () => {
    const { onRowsPx, handle } = renderWorkspace({ rowsPx: px(8) })
    fireEvent.pointerDown(handle, { clientY: 100 })
    fireEvent.pointerUp(handle, { clientY: 100 })
    const next = WORKSPACE_ROW_PRESETS.find((n) => n > 8)!
    expect(onRowsPx).toHaveBeenLastCalledWith(px(next))
  })

  it("shows no separator unless the list is at a set height", () => {
    renderWorkspace({ listHeight: "full" })
    expect(screen.queryByRole("separator")).not.toBeInTheDocument()
  })
})

function OverlayHost({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false)
  const aside: WorkspaceAside = {
    label: "Frame inspector",
    title: "Light_0001.fits",
    closeLabel: "Close the inspector",
    onClose: () => {
      onClose()
      setOpen(false)
    },
    children: <button type="button">Picked</button>,
  }
  return (
    <Workspace
      label="Frames to review"
      toolbar={{ start: <button type="button" onClick={() => setOpen(true)}>Open inspector</button> }}
      list={null}
      listHeight="full"
      rowsPx={px(8)}
      onRowsPx={() => {}}
      stage={[]}
      status={[]}
      statusLabel="Review status"
      asideOverlay
      aside={() => (open ? aside : null)}
    />
  )
}

describe("Workspace overlay inspector", () => {
  it("holds focus, closes on Escape and hands focus back to its opener", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<OverlayHost onClose={onClose} />)
    const opener = screen.getByRole("button", { name: "Open inspector" })
    await user.click(opener)
    const dialog = screen.getByRole("dialog", { name: "Frame inspector" })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.tab()
    await user.tab()
    await user.tab()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
