import { renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { registerReviewCommands } from "./commands"
import { reviewShell } from "./shell"

afterEach(() => registerReviewCommands(null))

describe("reviewShell", () => {
  it("asks the open review for its commands under Review, and reads nothing while the palette is closed", () => {
    const source = vi.fn((group: string) => [{ id: "action:mark-usable", label: m.review_cmd_usable(), group, shortcut: "P", unavailable: m.review_no_current_frame() }])
    registerReviewCommands(source)
    const closed = renderHook(() => reviewShell.useCommands!({ open: false }))
    expect(closed.result.current).toEqual([])
    expect(source).not.toHaveBeenCalled()
    const open = renderHook(() => reviewShell.useCommands!({ open: true }))
    expect(open.result.current).toEqual([{ id: "action:mark-usable", label: m.review_cmd_usable(), group: m.step_review(), shortcut: "P", unavailable: m.review_no_current_frame() }])
  })

  it("lists nothing while no review is open", () => {
    expect(renderHook(() => reviewShell.useCommands!({ open: true })).result.current).toEqual([])
  })
})
