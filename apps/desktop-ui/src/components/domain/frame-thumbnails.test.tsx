import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { type FrameThumbnail, FrameThumbnails, type Thumbnail } from "./frame-thumbnails"

// The list measures its room for the grid; jsdom has no ResizeObserver.
const original = globalThis.ResizeObserver
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})
afterAll(() => {
  globalThis.ResizeObserver = original
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
})
