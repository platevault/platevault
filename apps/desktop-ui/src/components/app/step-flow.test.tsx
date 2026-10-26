import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { StepFlow } from "./contracts"
import { StepStrip } from "./step-flow"

const FLOW: StepFlow = {
  steps: [
    { id: "cleanup", label: "Clean up", state: "finished" },
    { id: "trash", label: "Trash", state: "current" },
    { id: "archive", label: "Archive", state: "todo" },
  ],
  current: "trash",
  ordered: true,
  proceed: { id: "proceed", label: "Proceed", run: vi.fn() },
  next: null,
}

describe("StepStrip", () => {
  it("marks the step on screen with a fill at body size, not with a tab underline", () => {
    render(<StepStrip flow={FLOW} viewing="cleanup" onSelect={vi.fn()} />)
    const viewed = screen.getByText("Clean up").closest<HTMLElement>("[data-step]")!
    const other = screen.getByText("Archive").closest<HTMLElement>("[data-step]")!
    expect(viewed).toHaveAttribute("aria-current", "true")
    expect(viewed).toHaveClass("text-sm", "rounded-md", "bg-accent")
    expect(other).not.toHaveClass("bg-accent")
    for (const step of [viewed, other]) expect(step.className).not.toMatch(/(^|\s)border-b/)
  })
})
