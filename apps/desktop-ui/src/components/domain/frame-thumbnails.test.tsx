import { render, screen } from "@testing-library/react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { type FrameThumbnail, FrameThumbnails } from "./frame-thumbnails"

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

const frame = (id: string, unreadable: string | null): FrameThumbnail => ({ id, name: `M42_Ha_${id}.fits`, file: undefined, unreadable, status: m.status_unreviewed(), statusText: m.status_unreviewed(), dimmed: false })

describe("FrameThumbnails", () => {
  it("names a frame without pixels with the reason its tile shows", () => {
    render(<FrameThumbnails layout="strip" label="Filmstrip" items={[frame("0001", "Offline"), frame("0002", null)]} activeId={null} selected={new Set()} onActivate={vi.fn()} empty={null} />)
    // The host's reason: the copy is offline.
    expect(screen.getByRole("button", { name: `M42_Ha_0001.fits, ${m.status_unreviewed()}, Offline` })).toHaveTextContent("Offline")
    // No decodable copy and no reason from the host: the tile's own reason.
    expect(screen.getByRole("button", { name: `M42_Ha_0002.fits, ${m.status_unreviewed()}, ${m.review_no_pixel_data()}` })).toHaveTextContent(m.review_no_pixel_data())
  })
})
