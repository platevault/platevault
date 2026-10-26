import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { CHOICE_STATE_NAME, KIND_NAME, NO_KIND_NAME, sourceKey } from "@/domain/calibration"
import { fakeSha256, fileAt, writeFiles } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import { m, say } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { CalibrationChoices, type CalibrationChoiceRow, calibrationChoiceRows, choiceRowId } from "./calibration-choices"

// The sample library's light sessions: a suggested flat, a waiting flat, No darks by the camera's default, and automatic pins.
const SUGGESTED = "ses_1v704nq"
const WAITING = "ses_9ddkg4"
const CAMERA_NO = "ses_573cbz"
const PINNED = "ses_1oeln5l"

let seed: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(Date.parse("2026-10-13T12:00:00Z"))
  seed = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})

/** The table's links go through the router, so it renders inside one. */
function inRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  return render(<RouterProvider router={router} />)
}

const row = (rows: CalibrationChoiceRow[], sessionId: string, kind: CalibrationChoiceRow["kind"]) => rows.find((r) => r.sessionId === sessionId && r.kind === kind)!
const rowOf = (name: string) => screen.getByRole("rowheader", { name }).closest("tr") as HTMLElement

/** Tabs on until `element` has focus: the header's sort buttons come before the table's one row stop. */
async function tabTo(user: ReturnType<typeof userEvent.setup>, element: HTMLElement) {
  for (let i = 0; i < 20 && document.activeElement !== element; i++) await user.tab()
  expect(element).toHaveFocus()
}

function renderChoices(rows: CalibrationChoiceRow[], extra: Partial<Parameters<typeof CalibrationChoices>[0]> = {}) {
  const calls = { onConfirm: vi.fn(() => ({ ok: true }) as const), onPick: vi.fn(() => ({ ok: true }) as const), onNo: vi.fn(() => ({ ok: true }) as const) }
  inRouter(<CalibrationChoices label="Calibration" rows={rows} {...calls} {...extra} />)
  return calls
}

describe("calibrationChoiceRows", () => {
  it("reads each kind's state, source, health and offers from the catalogue, kinds in order", () => {
    const rows = calibrationChoiceRows(seed, [SUGGESTED, WAITING, CAMERA_NO, PINNED])
    expect(rows.map(choiceRowId)).toEqual([SUGGESTED, WAITING, CAMERA_NO, PINNED].flatMap((id) => ["dark", "flat", "bias"].map((kind) => `${id}:${kind}`)))
    expect(row(rows, SUGGESTED, "flat").choice.state).toBe("suggested")
    expect(row(rows, SUGGESTED, "flat").source).not.toBeNull()
    expect(row(rows, WAITING, "flat")).toMatchObject({ choice: { state: "waiting" }, source: null, sourceLink: null })
    expect(row(rows, CAMERA_NO, "dark").choice).toMatchObject({ state: "none", by: "camera-default" })
    expect(row(rows, PINNED, "dark")).toMatchObject({ choice: { state: "pinned", by: "matching" }, health: "ok", sourceLink: { to: "/calibration" } })
    // Choose ▸ never offers the pin the kind already holds.
    const pinned = row(rows, PINNED, "dark")
    if (pinned.choice.state !== "pinned") throw new Error("the sample dark is pinned")
    expect(pinned.offers.map((o) => o.key)).not.toContain(sourceKey(pinned.choice.source))
  })

  it("reads a pinned file that changed as changed; the pin stays", () => {
    const flat = seed.catalog.sessions[PINNED]!.calibration!.flat
    if (flat.state !== "pinned") throw new Error("the sample flat is pinned")
    const file = fileAt(seed.disk, flat.evidence.files[0]!.path)!
    const changed = { ...seed, disk: writeFiles(seed.disk, [{ ...file, sha256: fakeSha256(file.path, 9) }]) }
    expect(row(calibrationChoiceRows(changed, [PINNED]), PINNED, "flat")).toMatchObject({ health: "changed", choice: { state: "pinned" } })
  })
})

describe("CalibrationChoices", () => {
  it("words every state, in one group per session headed by a link to it, in the order given", async () => {
    const rows = calibrationChoiceRows(seed, [SUGGESTED, WAITING, CAMERA_NO, PINNED])
    renderChoices(rows)
    const table = await screen.findByRole("table", { name: "Calibration" })
    const heads = [SUGGESTED, WAITING, CAMERA_NO, PINNED].map((id) => say(m, rows.find((r) => r.sessionId === id)!.session))
    // The group headers: the only links in the body's header cells (a raw flat's source link sits in a data cell).
    const links = [...table.querySelectorAll("tbody th a[href]")].map((a) => a.textContent)
    expect(links).toEqual(heads)
    expect(within(table).getAllByText(say(m, CHOICE_STATE_NAME.suggested)).length).toBeGreaterThan(0)
    expect(within(table).getAllByText(say(m, CHOICE_STATE_NAME.waiting)).length).toBeGreaterThan(0)
    expect(within(table).getAllByText(m.calibration_choice_pinned_auto()).length).toBeGreaterThan(0)
    expect(within(table).getByText(m.calibration_choice_none_camera({ choice: say(m, NO_KIND_NAME.dark) }))).toBeInTheDocument()
    expect(within(table).getAllByText(m.calibration_choices_no_match()).length).toBeGreaterThan(0)
  })

  it("calls the host's callbacks and writes nothing itself: Enter confirms a suggestion, the row menu sets No", async () => {
    const user = userEvent.setup()
    const rows = calibrationChoiceRows(seed, [SUGGESTED])
    const before = structuredClone(seed.catalog.sessions[SUGGESTED]!.calibration)
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

    expect(seed.catalog.sessions[SUGGESTED]!.calibration).toEqual(before)
  })

  it("offers Choose ▸ with the row's revision, and opens a row's evidence one level deep", async () => {
    const user = userEvent.setup()
    const rows = calibrationChoiceRows(seed, [SUGGESTED])
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
    renderChoices(calibrationChoiceRows(seed, [SUGGESTED]), { changeable: false })
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
    const rows = calibrationChoiceRows(seed, [PINNED])
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
