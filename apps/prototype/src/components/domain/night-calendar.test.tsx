import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { type CalendarNight, NightCalendar } from "./night-calendar"

/** Wednesday: in en-GB its week starts on Monday 12 October. */
const TODAY = "2026-10-14"

function nights(count: number): CalendarNight[] {
  return Array.from({ length: count }, (_, i) => {
    const night = new Date(Date.parse(`${TODAY}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10)
    return {
      night,
      moon: { illuminationPct: 40 + i, phase: { text: "Waxing gibbous" }, rise: null, set: null },
      waxing: true,
      darkS: i === 1 ? null : 6 * 3600,
      goals: i % 3,
      planned: i === 0 ? 1 : 0,
      link: { to: "/targets", search: { night } },
      card: <p>{`Card for ${night}`}</p>,
    }
  })
}

async function renderCalendar() {
  const root = createRootRoute({ component: () => <NightCalendar label="Next 5 weeks" today={TODAY} nights={nights(19)} /> })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
  return screen.findByRole("grid", { name: "Next 5 weeks" })
}

const night = (date: string) => document.querySelector<HTMLElement>(`[data-night="${date}"]`)!

describe("NightCalendar", () => {
  // The card's positioner measures the trigger; jsdom has no ResizeObserver.
  const original = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => {
    globalThis.ResizeObserver = original
  })

  it("starts on the locale's first day of this week, with earlier nights as dates only", async () => {
    const grid = await renderCalendar()
    expect(within(grid).getAllByRole("columnheader")[0]).toHaveAccessibleName("Monday")
    // Monday and Tuesday are past: no link. Tonight holds the one Tab stop.
    expect(document.querySelector("[data-night='2026-10-12']")).toBeNull()
    expect(night(TODAY)).toHaveAttribute("aria-current", "date")
    expect(within(grid).getAllByRole("link").filter((link) => link.tabIndex === 0)).toEqual([night(TODAY)])
    // The grid ends with the week of the last night: Monday 12 to Sunday 1 November.
    expect(within(grid).getAllByRole("row")).toHaveLength(4)
    expect(night("2026-10-15")).toHaveAccessibleName(new RegExp(`Moon 41% Waxing gibbous, never dark, 1 goal suits it, ${m.calendar_planned({ count: 0, n: "0" })}`))
  })

  it("moves a night or a week with the arrows, to the week's ends with Home and End, never before tonight", async () => {
    await renderCalendar()
    const user = userEvent.setup()
    await user.tab()
    expect(night(TODAY)).toHaveFocus()
    await user.keyboard("{ArrowLeft}")
    expect(night(TODAY)).toHaveFocus()
    await user.keyboard("{ArrowRight}")
    expect(night("2026-10-15")).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(night("2026-10-22")).toHaveFocus()
    await user.keyboard("{Home}")
    expect(night("2026-10-19")).toHaveFocus()
    await user.keyboard("{End}")
    expect(night("2026-10-25")).toHaveFocus()
    // Tab leaves the grid from the night it holds, and comes back to it.
    expect(night("2026-10-25")).toHaveAttribute("tabindex", "0")
    expect(night(TODAY)).toHaveAttribute("tabindex", "-1")
  })

  it("opens the night's card on keyboard focus, and Escape closes it with focus kept on the night", async () => {
    await renderCalendar()
    const user = userEvent.setup()
    await user.tab()
    expect(await screen.findByText(`Card for ${TODAY}`, {}, { timeout: 2000 })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByText(`Card for ${TODAY}`)).toBeNull())
    expect(night(TODAY)).toHaveFocus()
  })
})
