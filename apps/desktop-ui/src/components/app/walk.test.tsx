import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { type CoachStep, CoachWalk } from "./walk"

// jsdom has no ResizeObserver; the walk only needs it to follow an anchor that resizes.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

// jsdom lays nothing out: give the anchors a box so the walk finds them.
function anchor(id: string) {
  const element = document.createElement("button")
  element.dataset.anchor = id
  element.textContent = id
  element.getBoundingClientRect = () => new DOMRect(10, 10, 80, 20)
  document.body.append(element)
  return element
}

const steps: CoachStep[] = [
  { id: "one", title: "One", body: "First", anchors: ['[data-anchor="one"]'] },
  { id: "gone", title: "Gone", body: "No anchor", anchors: ['[data-anchor="none"]'] },
  { id: "two", title: "Two", body: "Second", anchors: ['[data-anchor="two"]'] },
]

describe("CoachWalk", () => {
  it("traps focus in its card, passes over a step without an anchor, and returns focus at the end", async () => {
    const user = userEvent.setup()
    const start = anchor("one")
    anchor("two")
    start.focus()
    const onEnd = vi.fn()
    render(<CoachWalk steps={steps} onEnd={onEnd} waitFrames={2} />)
    const card = await screen.findByRole("dialog", { name: "One" })
    expect(screen.getByText(`One. ${m.walk_step({ step: 1, total: 3 })}`)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole("button", { name: m.walk_next() })).toHaveFocus())
    for (let i = 0; i < 3; i++) {
      await user.tab()
      expect(card).toContainElement(document.activeElement as HTMLElement)
    }
    await user.click(screen.getByRole("button", { name: m.walk_next() }))
    expect(await screen.findByRole("dialog", { name: "Two" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: m.walk_done() }))
    expect(onEnd).toHaveBeenCalledWith("done")
    await waitFor(() => expect(start).toHaveFocus())
  })

  it("ends as skipped on Escape", async () => {
    const user = userEvent.setup()
    anchor("one")
    const onEnd = vi.fn()
    render(<CoachWalk steps={steps} onEnd={onEnd} waitFrames={2} />)
    await screen.findByRole("dialog", { name: "One" })
    await user.keyboard("{Escape}")
    expect(onEnd).toHaveBeenCalledWith("skipped")
  })
})
