/**
 * OperationPanel's controls per status: each action shows only in the states
 * it applies to and only when the owner offers it, and a press calls the
 * owner's callback (interrupted Retry resumes; settled Retry retries).
 */
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, type Mock, vi } from "vitest"
import { m, verbatim } from "@/lib/i18n"
import { type OperationActions, OperationPanel, type OperationStatus, type OperationView } from "./operation-panel"

function operation(status: OperationStatus): OperationView {
  return {
    id: "scan",
    title: verbatim("Scan Captures"),
    status,
    progress: { done: 12, total: 40, unit: "frames" },
    items: [],
    summary: null,
    createdAt: "2026-09-18T21:04:00Z",
    settledAt: status === "running" || status === "paused" || status === "interrupted" ? null : "2026-09-18T21:30:00Z",
  }
}

function renderPanel(status: OperationStatus, offered: (keyof OperationActions)[] = ["onPause", "onResume", "onCancel", "onRetry"]) {
  const actions: Partial<Record<keyof OperationActions, Mock<() => void>>> = {}
  for (const name of offered) actions[name] = vi.fn()
  render(<OperationPanel operation={operation(status)} {...actions} />)
  const panel = screen.getByRole("region", { name: "Scan Captures" })
  return { actions, panel, buttons: () => within(panel).queryAllByRole("button").map((button) => button.textContent) }
}

/** Each status's buttons in order, and the callback each one calls. */
const CONTROLS: [OperationStatus, [label: string, callback: keyof OperationActions][]][] = [
  [
    "running",
    [
      [m.verb_pause(), "onPause"],
      [m.verb_cancel(), "onCancel"],
    ],
  ],
  [
    "paused",
    [
      [m.verb_resume(), "onResume"],
      [m.verb_cancel(), "onCancel"],
    ],
  ],
  [
    "interrupted",
    [
      [m.verb_retry(), "onResume"],
      [m.verb_cancel(), "onCancel"],
    ],
  ],
  ["failed", [[m.verb_retry(), "onRetry"]]],
  ["partial", [[m.verb_retry(), "onRetry"]]],
  ["succeeded", []],
  ["canceled", []],
]

describe("OperationPanel controls", () => {
  it.each(CONTROLS)("%s shows only its own actions, each calling its callback", async (status, controls) => {
    const user = userEvent.setup()
    const { actions, panel, buttons } = renderPanel(status)
    expect(buttons()).toEqual(controls.map(([label]) => label))
    for (const [label, callback] of controls) {
      vi.clearAllMocks()
      await user.click(within(panel).getByRole("button", { name: label }))
      for (const [name, fn] of Object.entries(actions)) expect(fn).toHaveBeenCalledTimes(name === callback ? 1 : 0)
    }
  })

  it("leaves out an action the owner does not offer", () => {
    expect(renderPanel("running", ["onCancel"]).buttons()).toEqual([m.verb_cancel()])
  })

  it("shows no controls when the owner offers none", () => {
    expect(renderPanel("failed", []).buttons()).toEqual([])
  })
})
