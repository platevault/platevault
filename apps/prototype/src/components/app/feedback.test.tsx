import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { useSaveState } from "./feedback"

/** A section with one control that saves through `write`, and the section's indicator. */
function Section({ write }: { write: () => CommitResult | void }) {
  const { save, indicator } = useSaveState()
  return (
    <div>
      <button type="button" onClick={() => save(write)}>
        Change
      </button>
      <div data-testid="indicator">{indicator}</div>
    </div>
  )
}

describe("useSaveState", () => {
  it("shows nothing before the first save", () => {
    render(<Section write={() => ({ ok: true })} />)
    expect(screen.getByTestId("indicator")).toBeEmptyDOMElement()
  })

  it("reads Saved after a write that succeeds", async () => {
    render(<Section write={() => ({ ok: true })} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_saved())
  })

  it("keeps a failed write Not saved, and Retry runs the same write again", async () => {
    const write = vi
      .fn<() => CommitResult>()
      .mockReturnValueOnce({ ok: false, reason: "write-failed", message: "Theme was not saved: disk full" })
      .mockReturnValueOnce({ ok: true })
    render(<Section write={write} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByText("Theme was not saved: disk full")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: m.verb_retry() }))
    expect(write).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_saved())
    expect(screen.queryByRole("button", { name: m.verb_retry() })).not.toBeInTheDocument()
  })

  it("reads stale with the commit message after a stale write", async () => {
    render(<Section write={() => ({ ok: false, reason: "stale", message: "Changed elsewhere first" })} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_changed_elsewhere())
    expect(screen.getByText("Changed elsewhere first")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: m.verb_retry() })).not.toBeInTheDocument()
  })
})
