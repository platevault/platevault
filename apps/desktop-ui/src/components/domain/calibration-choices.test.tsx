import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { CHOICE_ROWS, CHOICE_SESSIONS, ONE_SESSION_ROWS, READ_ONLY_ROWS } from "@/app/catalogue/fixtures/calibration"
import { SUCCEEDED } from "@/app/catalogue/fixtures/results"
import { m, say } from "@/lib/i18n"
import { CalibrationChoices, type CalibrationChoiceRow } from "./calibration-choices"
import { CHOICE_STATE_NAME, KIND_NAME, NO_KIND_NAME } from "./calibration-model"

const { suggested: SUGGESTED, pinned: PINNED } = CHOICE_SESSIONS

/** The table's links go through the router, so it renders inside one. */
function inRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  return render(<RouterProvider router={router} />)
}

const row = (rows: CalibrationChoiceRow[], sessionId: string, kind: CalibrationChoiceRow["kind"]) => rows.find((r) => r.sessionId === sessionId && r.kind === kind)!
const rowOf = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement
const pinnedRows = CHOICE_ROWS.filter((r) => r.sessionId === PINNED)

/** Tabs on until `element` has focus: the header's sort buttons come before the table's one row stop. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let i = 0; i < 20 && document.activeElement !== element; i++) await user.tab()
  expect(element).toHaveFocus()
}

function renderChoices(rows: CalibrationChoiceRow[], extra: Partial<Parameters<typeof CalibrationChoices>[0]> = {}) {
  const calls = { onConfirm: vi.fn(() => SUCCEEDED), onPick: vi.fn(() => SUCCEEDED), onNo: vi.fn(() => SUCCEEDED) }
  inRouter(<CalibrationChoices label="Calibration" rows={rows} {...calls} {...extra} />)
  return calls
}

describe("CalibrationChoices", () => {
  it("words every state, in one group per session headed by a link to it, in the order given", async () => {
    renderChoices(CHOICE_ROWS)
    const table = await screen.findByRole("table", { name: "Calibration" })
    const heads = [...new Set(CHOICE_ROWS.map((r) => r.sessionId))].map((id) => say(m, CHOICE_ROWS.find((r) => r.sessionId === id)!.session))
    // The group headers: the only links in the body's header cells (a raw flat's source link sits in a data cell).
    const links = [...table.querySelectorAll("tbody th a[href]")].map((a) => a.textContent)
    expect(links).toEqual(heads)
    expect(within(table).getAllByText(say(m, CHOICE_STATE_NAME.suggested)).length).toBeGreaterThan(0)
    expect(within(table).getAllByText(say(m, CHOICE_STATE_NAME.waiting)).length).toBeGreaterThan(0)
    expect(within(table).getAllByText(m.calibration_choice_pinned_auto()).length).toBeGreaterThan(0)
    expect(within(table).getByText(m.calibration_choice_none_camera({ choice: say(m, NO_KIND_NAME.dark) }))).toBeInTheDocument()
    expect(within(table).getAllByText(m.calibration_choices_no_match()).length).toBeGreaterThan(0)
  })

  it("reads a pinned file that changed as changed, a user's No as its word, and links a pinned master to the Calibration library", async () => {
    renderChoices(READ_ONLY_ROWS, { changeable: false })
    const table = await screen.findByRole("table", { name: "Calibration" })
    expect(within(table).getByText(m.status_drifted())).toBeInTheDocument()
    expect(within(table).getByText(say(m, NO_KIND_NAME.bias))).toBeInTheDocument()
    expect(row(pinnedRows, PINNED, "dark")).toMatchObject({ choice: { state: "pinned", by: "matching" }, health: "ok", sourceLink: { to: "/calibration" } })
  })

  it("never offers under Choose ▸ the pin a kind already holds", () => {
    const dark = row(pinnedRows, PINNED, "dark")
    if (dark.choice.state !== "pinned") throw new Error("the sample dark is pinned")
    const pinnedSource = dark.choice.source
    expect(dark.offers.some((o) => JSON.stringify(o.source) === JSON.stringify(pinnedSource))).toBe(false)
  })

  it("calls the host's callbacks and writes nothing itself: Enter confirms a suggestion, the row menu sets No", async () => {
    const user = userEvent.setup()
    const rows = ONE_SESSION_ROWS
    const before = structuredClone(rows)
    const calls = renderChoices(rows)
    const flat = say(m, KIND_NAME.flat)
    await screen.findByRole("table", { name: "Calibration" })

    // The table is one Tab stop, on its current row (the first); Enter runs the row's primary action, Confirm.
    await tabTo(user, rowOf(say(m, KIND_NAME.dark)))
    await user.keyboard("{ArrowDown}")
    expect(rowOf(flat)).toHaveFocus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(calls.onConfirm).toHaveBeenCalledWith([{ sessionId: SUGGESTED, kind: "flat" }]))

    // Shift+F10 opens the row's menu, named after it; No flats runs onNo, and focus returns to the row.
    await user.keyboard("{Shift>}{F10}{/Shift}")
    const menu = await screen.findByRole("menu", { name: flat })
    const no = within(menu).getByRole("menuitem", { name: say(m, NO_KIND_NAME.flat) })
    for (let i = 0; i < 10 && document.activeElement !== no; i++) await user.keyboard("{ArrowDown}")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(calls.onNo).toHaveBeenCalledWith([{ sessionId: SUGGESTED, kind: "flat" }]))
    await waitFor(() => expect(rowOf(flat)).toHaveFocus())

    expect(rows).toEqual(before)
  })

  it("offers Choose ▸ with the row's revision, and opens a row's evidence one level deep", async () => {
    const user = userEvent.setup()
    const rows = ONE_SESSION_ROWS
    const flat = row(rows, SUGGESTED, "flat")
    const calls = renderChoices(rows)
    await screen.findByRole("table", { name: "Calibration" })
    const flatName = say(m, KIND_NAME.flat)

    await user.click(within(rowOf(flatName)).getByRole("button", { name: m.table_row_details({ name: flatName }) }))
    const evidence = await screen.findByRole("table", { name: m.calibration_choices_evidence_of({ name: flatName }) })
    expect(within(evidence).getByRole("columnheader", { name: m.calibration_choices_col_lights() })).toBeInTheDocument()
    expect(within(evidence).getAllByRole("row").length).toBeGreaterThan(1)

    // The suggested source is offered under Choose ▸ too; choosing it passes the row's revision.
    expect(flat.offers.length).toBeGreaterThan(0)
    const offer = flat.offers[0]!
    const label = offer.verdict === "pin" ? say(m, offer.label) : m.calibration_choices_offer_suggested({ source: say(m, offer.label) })
    rowOf(flatName).focus()
    await user.keyboard("{Shift>}{F10}{/Shift}")
    const menu = await screen.findByRole("menu", { name: flatName })
    const choose = within(menu).getByRole("menuitem", { name: m.verb_choose() })
    for (let i = 0; i < 10 && document.activeElement !== choose; i++) await user.keyboard("{ArrowDown}")
    await user.keyboard("{ArrowRight}")
    const item = await screen.findByRole("menuitem", { name: label })
    for (let i = 0; i < 10 && document.activeElement !== item; i++) await user.keyboard("{ArrowDown}")
    await user.keyboard("{Enter}")
    await waitFor(() => expect(calls.onPick).toHaveBeenCalledWith({ sessionId: SUGGESTED, kind: "flat", source: offer.source, expectRevision: flat.revision }))
  })

  it("not changeable: no row actions, the evidence still opens", async () => {
    renderChoices(ONE_SESSION_ROWS, { changeable: false })
    const table = await screen.findByRole("table", { name: "Calibration" })
    expect(within(table).queryByRole("button", { name: m.verb_confirm() })).not.toBeInTheDocument()
    expect(within(table).getAllByRole("button", { name: m.table_row_details({ name: say(m, KIND_NAME.flat) }) }).length).toBe(1)
  })

  it("shows its loading, empty and error states", async () => {
    const onRetry = vi.fn()
    const { unmount } = inRouter(<CalibrationChoices label="Calibration" rows={[]} onConfirm={vi.fn()} onPick={vi.fn()} onNo={vi.fn()} />)
    expect(await screen.findByText(m.calibration_choices_empty())).toBeInTheDocument()
    unmount()
    inRouter(<CalibrationChoices label="Calibration" rows={[]} error={{ message: "Can't read", onRetry }} onConfirm={vi.fn()} onPick={vi.fn()} onNo={vi.fn()} />)
    await userEvent.setup().click(await screen.findByRole("button", { name: m.verb_retry() }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it("boxed: draws no frame of its own inside a flush Box, and its own frame elsewhere", async () => {
    const rows = pinnedRows
    const { unmount } = inRouter(<CalibrationChoices label="Calibration" rows={rows} boxed onConfirm={vi.fn()} onPick={vi.fn()} onNo={vi.fn()} />)
    const boxed = (await screen.findByRole("table", { name: "Calibration" })).parentElement!
    expect(boxed).toHaveClass("border-0", "rounded-none")
    unmount()
    renderChoices(rows)
    const framed = (await screen.findByRole("table", { name: "Calibration" })).parentElement!
    expect(framed).toHaveClass("border", "rounded-md")
    expect(framed).not.toHaveClass("border-0")
  })
})
