/**
 * The status bar's selection channel: a list reports its count while it is
 * mounted, the latest non-zero report is what the status bar reads, and
 * unmounting or a zero count withdraws it.
 */
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useSelectionContext, useStatusSelection } from "./status-selection"

function List({ count, total = null }: { count: number; total?: number | null }) {
  useStatusSelection(count, total)
  return null
}

function StatusBarSlot() {
  const selection = useSelectionContext()
  return <output aria-label="Selection">{selection ? `${selection.count} of ${selection.total ?? "?"}` : "none"}</output>
}

const slot = () => screen.getByRole("status", { name: "Selection" })

describe("status selection", () => {
  it("reads the latest non-zero report and falls back as lists withdraw", () => {
    const { rerender } = render(
      <>
        <StatusBarSlot />
        <List count={3} total={120} />
      </>,
    )
    expect(slot()).toHaveTextContent("3 of 120")

    rerender(
      <>
        <StatusBarSlot />
        <List count={3} total={120} />
        <List count={5} />
      </>,
    )
    expect(slot()).toHaveTextContent("5 of ?")

    // The later list unmounts: the earlier report shows again.
    rerender(
      <>
        <StatusBarSlot />
        <List count={3} total={120} />
      </>,
    )
    expect(slot()).toHaveTextContent("3 of 120")

    // A zero count is no selection.
    rerender(
      <>
        <StatusBarSlot />
        <List count={0} total={120} />
      </>,
    )
    expect(slot()).toHaveTextContent("none")
  })
})
