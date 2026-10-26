import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { m, verbatim } from "@/lib/i18n"
import { type Evidence, EvidenceList } from "./evidence-list"

const EVIDENCE: Evidence[] = [
  { source: "header", label: verbatim("OBJECT"), value: verbatim("M 31"), agrees: true },
  { source: "pointing", label: verbatim("RA/Dec"), value: verbatim("00h42m +41°16′"), agrees: null },
  { source: "resolver", label: verbatim("SIMBAD"), value: verbatim("M 33"), agrees: false },
] as Evidence[]

const evidenceColumn = () =>
  within(screen.getByRole("table", { name: "Evidence of M 31" }))
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent)

describe("EvidenceList", () => {
  it("lists the evidence in the order given, under a sortable header per column", () => {
    render(<EvidenceList evidence={EVIDENCE} caption="Evidence of M 31" />)
    expect(evidenceColumn()).toEqual(["OBJECT", "RA/Dec", "SIMBAD"])
    const table = screen.getByRole("table", { name: "Evidence of M 31" })
    for (const header of [m.evidence_column_source(), m.evidence_column_evidence(), m.evidence_column_value(), m.evidence_column_result()]) {
      expect(within(within(table).getByRole("columnheader", { name: new RegExp(header) })).getByRole("button")).toBeInTheDocument()
    }
  })

  it("sorts by Result: conflicts first, then unknown, then agreeing evidence", async () => {
    const user = userEvent.setup()
    render(<EvidenceList evidence={EVIDENCE} caption="Evidence of M 31" />)
    const table = screen.getByRole("table", { name: "Evidence of M 31" })
    await user.click(within(within(table).getByRole("columnheader", { name: new RegExp(m.evidence_column_result()) })).getByRole("button"))
    expect(evidenceColumn()).toEqual(["SIMBAD", "RA/Dec", "OBJECT"])
  })
})
