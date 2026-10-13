import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { DetailDock, type PageDetail } from "./detail-panel"
import { DOCK_MIN_WIDTH_PX } from "./dock"

/** The dock lays out in 1200 px: the side panel takes 320 px to 600 px. */
const ROOM_PX = 1200
const KEY = "platevault.dock.test-presets"

const DETAIL: PageDetail = { dockId: "test-presets", title: "M 31", content: <p>Facts</p>, onClose: () => {} }

const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as { pin: string; width: number } | null
const panelWidth = () => screen.getByRole("complementary", { name: "M 31" }).style.getPropertyValue("--dock-w")

async function pickPreset(label: string) {
  const user = userEvent.setup()
  await user.click(within(screen.getByRole("complementary", { name: "M 31" })).getByRole("button", { name: m.display_menu_label() }))
  const menu = await screen.findByRole("menu")
  expect(within(menu).getByText(m.dock_width())).toBeInTheDocument()
  await user.click(within(menu).getByRole("menuitemradio", { name: label }))
  await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument())
}

describe("DetailPanel width presets (WCAG 2.5.7)", () => {
  const original = { matchMedia: window.matchMedia, ResizeObserver: globalThis.ResizeObserver }
  beforeAll(() => {
    // A wide window (the panel docks at the side) and a measurable room; jsdom lays nothing out.
    window.matchMedia = (media: string): MediaQueryList => Object.assign(new EventTarget(), { matches: media.includes("min-width"), media, onchange: null, addListener() {}, removeListener() {} })
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(ROOM_PX)
  })
  afterAll(() => {
    window.matchMedia = original.matchMedia
    globalThis.ResizeObserver = original.ResizeObserver
    vi.restoreAllMocks()
  })
  beforeEach(() => localStorage.removeItem(KEY))

  it("sets the side panel's width with one click per preset, clamped to its room, and keeps it", async () => {
    const { unmount } = render(
      <DetailDock detail={DETAIL}>
        <p>Body</p>
      </DetailDock>,
    )
    expect(screen.getByRole("complementary", { name: "M 31" })).toHaveAttribute("data-detail-panel", "side")

    await pickPreset(m.dock_width_wide())
    expect(panelWidth()).toBe(`${ROOM_PX / 2}px`)
    expect(stored()?.width).toBe(ROOM_PX / 2)

    await pickPreset(m.dock_width_narrow())
    expect(panelWidth()).toBe(`${DOCK_MIN_WIDTH_PX}px`)
    expect(stored()?.width).toBe(DOCK_MIN_WIDTH_PX)

    await pickPreset(m.dock_width_medium())
    const medium = (DOCK_MIN_WIDTH_PX + ROOM_PX / 2) / 2
    expect(panelWidth()).toBe(`${medium}px`)

    // A reload: the store reads the kept width back, and the menu marks the preset it matches.
    unmount()
    render(
      <DetailDock detail={DETAIL}>
        <p>Body</p>
      </DetailDock>,
    )
    expect(stored()?.width).toBe(medium)
    expect(panelWidth()).toBe(`${medium}px`)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: m.display_menu_label() }))
    expect(within(await screen.findByRole("menu")).getByRole("menuitemradio", { name: m.dock_width_medium() })).toHaveAttribute("aria-checked", "true")
  })

  it("keeps the arrow keys on the resize handle", async () => {
    render(
      <DetailDock detail={DETAIL}>
        <p>Body</p>
      </DetailDock>,
    )
    const handle = screen.getByRole("separator", { name: m.dock_width() })
    act(() => handle.focus())
    const user = userEvent.setup()
    await user.keyboard("{End}")
    expect(stored()?.width).toBe(ROOM_PX / 2)
    await user.keyboard("{ArrowRight}")
    expect(stored()?.width).toBe(ROOM_PX / 2 - 16)
  })
})
