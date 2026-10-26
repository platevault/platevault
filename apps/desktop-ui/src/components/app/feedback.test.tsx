import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Inbox } from "lucide-react"
import { describe, expect, it, vi } from "vitest"
import { libraryFailure, SUCCEEDED } from "@/app/catalogue/fixtures/results"
import { m } from "@/lib/i18n"
import { DataTable } from "./data-table"
import { EmptyState, useSaveState } from "./feedback"
import type { RunResult } from "./run-result"

/** A section with one control that saves through `write`, and the section's indicator. */
function Section({ write }: { write: () => RunResult }) {
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
    render(<Section write={() => SUCCEEDED} />)
    expect(screen.getByTestId("indicator")).toBeEmptyDOMElement()
  })

  it("reads Saved after a write that succeeds", async () => {
    render(<Section write={() => SUCCEEDED} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_saved())
  })

  it("keeps a failed write Not saved, and Retry runs the same write again", async () => {
    const write = vi.fn<() => RunResult>().mockReturnValueOnce(libraryFailure("persistence_failure", "retry")).mockReturnValueOnce(SUCCEEDED)
    render(<Section write={write} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByText(m.action_failure_persistence_failure())).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: m.verb_retry() }))
    expect(write).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_saved())
    expect(screen.queryByRole("button", { name: m.verb_retry() })).not.toBeInTheDocument()
  })

  it("reads stale with the worded failure when the library asks for a review", async () => {
    render(<Section write={() => libraryFailure("conflict", "review")} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByTestId("indicator")).toHaveTextContent(m.status_changed_elsewhere())
    expect(screen.getByText(m.action_failure_conflict())).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: m.verb_retry() })).not.toBeInTheDocument()
  })

  it("keeps a refused write Not saved with no Retry", async () => {
    render(<Section write={() => libraryFailure("input_write_risk", "none")} />)
    await userEvent.click(screen.getByRole("button", { name: "Change" }))
    expect(screen.getByText(m.action_failure_input_write_risk())).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: m.verb_retry() })).not.toBeInTheDocument()
  })
})

describe("EmptyState", () => {
  const empty = <EmptyState icon={Inbox} title="No sessions match" action={<button type="button">Clear filters</button>} />

  it("draws its dashed frame on a page, and none in a table cell, where the table is the frame", () => {
    render(
      <>
        <section aria-label="Page">{empty}</section>
        <DataTable label="Sessions" rows={[] as { id: string }[]} columns={[{ id: "name", header: "Name", cell: (r) => r.id, static: true }]} getRowId={(r) => r.id} empty={empty} />
      </>,
    )
    const onPage = within(screen.getByRole("region", { name: "Page" })).getByText("No sessions match").closest<HTMLElement>("[data-slot=empty]")!
    const inTable = within(screen.getByRole("table", { name: "Sessions" })).getByText("No sessions match").closest<HTMLElement>("[data-slot=empty]")!
    expect(onPage).toHaveClass("border", "border-dashed")
    expect(inTable.closest("td")).not.toBeNull()
    // Tailwind's `td &` variant: the class compiles to a rule that applies only under a table cell.
    expect(inTable).toHaveClass("[td_&]:border-0")
  })
})
