import { act, render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { type FrameThumbnail, FrameThumbnails, type Thumbnail } from "./frame-thumbnails"

// The list measures its room for the grid and scrolls the current frame into view; jsdom has neither.
const original = { resizeObserver: globalThis.ResizeObserver, scrollIntoView: Element.prototype.scrollIntoView }
const scrollIntoView = vi.fn()
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = scrollIntoView
})
afterAll(() => {
  globalThis.ResizeObserver = original.resizeObserver
  Element.prototype.scrollIntoView = original.scrollIntoView
})

const frame = (id: string, thumb: Thumbnail): FrameThumbnail => ({ id, name: `M42_Ha_${id}.fits`, thumb, status: m.status_unreviewed(), statusText: m.status_unreviewed(), dimmed: false })

describe("FrameThumbnails", () => {
  it("names a frame without pixels with the reason its tile shows, and a pending or decoded one by its name and status", () => {
    const items = [frame("0001", { state: "unreadable", reason: "Offline" }), frame("0002", { state: "pending" }), frame("0003", { state: "ready", url: "data:image/png;base64," })]
    render(<FrameThumbnails layout="strip" label="Filmstrip" items={items} activeId={null} selected={new Set()} onActivate={vi.fn()} empty={null} />)
    // The host's reason: the copy is offline.
    expect(screen.getByRole("button", { name: `M42_Ha_0001.fits, ${m.status_unreviewed()}, Offline` })).toHaveTextContent("Offline")
    // Still decoding: the tile reads Pending, and the name carries no reason.
    expect(screen.getByRole("button", { name: `M42_Ha_0002.fits, ${m.status_unreviewed()}` })).toHaveTextContent(m.status_pending())
    // Decoded: the pixels, as a decorative image inside the named button.
    expect(screen.getByRole("button", { name: `M42_Ha_0003.fits, ${m.status_unreviewed()}` }).querySelector("img")).toHaveAttribute("alt", "")
  })

  it.each(["strip", "grid"] as const)("mounts a bounded window of a long %s, keeping the current frame mounted, in view and focused", (layout) => {
    const items = Array.from({ length: 5000 }, (_, i) => frame(String(i).padStart(4, "0"), { state: "pending" }))
    const tile = (id: string) => screen.getByRole("button", { name: `M42_Ha_${id}.fits, ${m.status_unreviewed()}` })
    const view = (activeId: string) => <FrameThumbnails layout={layout} label="Frames" items={items} activeId={activeId} selected={new Set()} onActivate={vi.fn()} empty={null} />
    const { rerender } = render(view("4000"))
    expect(screen.getAllByRole("listitem").length).toBeLessThan(60)
    expect(tile("4000")).toHaveAttribute("aria-current", "true")
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(tile("4000"))
    expect(tile("4000").closest("li")).toHaveAttribute("aria-posinset", "4001")
    expect(tile("4000").closest("li")).toHaveAttribute("aria-setsize", "5000")
    // Focus in the list follows the current frame (J, K), mounted wherever it is.
    act(() => tile("4000").focus())
    rerender(view("0100"))
    expect(tile("0100")).toHaveFocus()
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(tile("0100"))
    expect(screen.getAllByRole("listitem").length).toBeLessThan(60)
  })
})
