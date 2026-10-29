import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { registerReviewCommands } from "./commands"
import { reviewShell } from "./shell"

afterEach(() => registerReviewCommands(null))

describe("reviewShell", () => {
  it("lists the open review's commands with their keys under Review, and none while the palette is closed", () => {
    const run = vi.fn()
    registerReviewCommands([{ id: "pick", label: m.review_cmd_usable(), shortcut: "P", run }])
    const open = renderHook(() => reviewShell.useCommands!({ open: true }))
    expect(open.result.current).toEqual([{ id: "review:pick", label: m.review_cmd_usable(), group: m.step_review(), shortcut: "P", run }])
    const closed = renderHook(() => reviewShell.useCommands!({ open: false }))
    expect(closed.result.current).toEqual([])
  })

  it("lists nothing while no review is open", () => {
    expect(renderHook(() => reviewShell.useCommands!({ open: true })).result.current).toEqual([])
  })
})
