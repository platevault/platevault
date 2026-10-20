import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionReadiness, sessionRigId, sessionUnreviewedFrames } from "@/domain/derive"
import { targetAtPointing } from "@/domain/indexing"
import { sessionLongLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { Session } from "@/domain/types"
import { AddFilterToRigDialog } from "@/features/v5/e-targets-plan-settings/settings-equipment"
import { m } from "@/lib/i18n"
import { filedUnclassified } from "@/store/actions/library"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SessionIntakePage } from "./session-intake"

let demo: PrototypeState

beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

/** The intake on its own route, injected as the route does: the Review step's body is the host's, so the tests pass none; Add {value} to {rig} is Settings › Equipment's dialog. */
function renderIntake(sessionId: string, step: string) {
  const root = createRootRoute()
  const intake = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: () => <SessionIntakePage review={() => null} addFilter={AddFilterToRigDialog} /> })
  const router = createRouter({ routeTree: root.addChildren([intake]), history: createMemoryHistory({ initialEntries: [`/sessions/${sessionId}?step=${step}`] }) })
  render(<RouterProvider router={router} />)
  return router
}

function lightSessions(): Session[] {
  return Object.values(store.getState().catalog.sessions).filter((s) => s.imageType === "light" && !s.supersededBy)
}

function proceedButton(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-step-footer] [data-action="intake-proceed"]')!
}

describe("Session intake gates (U11 sessionIntake)", () => {
  it("Target gates Proceed on the picker's choice; Proceed confirms it and opens the next open step", async () => {
    const state = store.getState()
    const pointed = (s: Session) => s.target.value !== null || (s.pointing !== null && targetAtPointing(state.catalog, s.pointing.ra, s.pointing.dec) !== null)
    const session = lightSessions().find((s) => sessionReadiness(state.catalog, s) === "needs-target" && !filedUnclassified(state, s) && !pointed(s))
    expect(session, "the demo seed holds a session that needs a Target and has no suggestion").toBeDefined()
    const target = Object.values(state.catalog.targets).sort((a, b) => a.name.localeCompare(b.name))[0]!
    const user = userEvent.setup()
    const router = renderIntake(session!.id, "target")
    await waitFor(() => expect(proceedButton()).toBeTruthy())
    expect(proceedButton()).toHaveAttribute("aria-disabled", "true")
    await user.type(screen.getByRole("combobox", { name: m.session_choose_a_target() }), target.name)
    await user.click(await screen.findByRole("option", { name: new RegExp(target.name) }))
    await waitFor(() => expect(proceedButton()).not.toHaveAttribute("aria-disabled", "true"))
    await user.click(proceedButton())
    await waitFor(() => expect(store.getState().catalog.sessions[session!.id]!.target).toMatchObject({ status: "confirmed", value: target.id }))
    // U11's `next`: the first later step not yet finished (Rig, or Review once the rig is settled).
    await waitFor(() => expect(router.state.location.search).toMatchObject({ step: sessionRigId(session!) ? "review" : "rig" }))
  })

  it("suggests the Target a demo session's pointing falls in, and Confirm Target settles it (astro-plan-tcdx0)", async () => {
    const state = store.getState()
    const suggestion = (s: Session) => (s.pointing ? targetAtPointing(state.catalog, s.pointing.ra, s.pointing.dec) : null)
    const session = lightSessions().find((s) => s.target.status !== "confirmed" && suggestion(s) !== null)
    expect(session, "the demo seed holds a session with no confirmed Target whose pointing suggests one").toBeDefined()
    const suggested = suggestion(session!)!
    expect(state.catalog.targets[suggested.id]?.name, "the suggestion is a catalogue Target in the library").toBe(suggested.name)
    const user = userEvent.setup()
    renderIntake(session!.id, "target")
    // Its rig is confirmed and its frames wait for review, so Target is an earlier step: its change is the step's own Confirm Target (F8).
    const confirm = await screen.findByRole("button", { name: m.session_confirm_target() })
    // The Target box lists its sources and marks the winner, here the pointing; no agreement column (SD4).
    const sources = screen.getByRole("table", { name: m.session_target_sources({ name: sessionLongLabel(m, session!) }) })
    const row = (source: string) => within(sources).getByRole("rowheader", { name: source }).closest("tr")!
    expect(row(m.evidence_source_pointing())).toHaveTextContent(suggested.name)
    expect(within(row(m.evidence_source_pointing())).getByText(m.session_source_used())).toBeInTheDocument()
    expect(within(sources).queryByRole("columnheader", { name: new RegExp(m.evidence_column_result()) })).toBeNull()
    expect(within(sources).queryByText(m.evidence_agrees())).toBeNull()
    await user.click(confirm)
    await waitFor(() => expect(store.getState().catalog.sessions[session!.id]!.target).toMatchObject({ status: "confirmed", value: suggested.id }))
    // Confirmed, the user's choice wins.
    await waitFor(() => expect(within(row(m.evidence_source_user())).getByText(m.session_source_used())).toBeInTheDocument())
    expect(within(row(m.evidence_source_pointing())).queryByText(m.session_source_used())).toBeNull()
  })

  it("Finish review stays unavailable while a frame is Unreviewed, and writes nothing", async () => {
    const state = store.getState()
    const session = lightSessions().find((s) => sessionReadiness(state.catalog, s) === "needs-review")
    expect(session, "the demo seed holds a session with Unreviewed frames").toBeDefined()
    const unreviewed = sessionUnreviewedFrames(state.catalog, session!)
    const user = userEvent.setup()
    renderIntake(session!.id, "review")
    await waitFor(() => expect(proceedButton()).toBeTruthy())
    const finish = proceedButton()
    expect(finish).toHaveTextContent(m.stepflow_finish_review())
    expect(finish).toHaveAttribute("aria-disabled", "true")
    await user.click(finish)
    expect(sessionUnreviewedFrames(store.getState().catalog, store.getState().catalog.sessions[session!.id]!)).toBe(unreviewed)
  })
})

describe("Rig step: Add {value} to {rig} for an unknown FILTER value (D-W127, PLAN-EQ-FR-04)", () => {
  /** A demo light session on a confirmed rig, its rig then read as `status`, given the FILTER value `Halpha`, which no seed filter matches. */
  function withHalpha(status: "confirmed" | "associated"): Session {
    const session = lightSessions().find((s) => s.equipment.status === "confirmed" && s.equipment.value !== null)
    expect(session, "the demo seed holds a light session whose rig is confirmed").toBeDefined()
    const state = store.getState()
    const edited: Session = { ...session!, channel: "Halpha", equipment: { ...session!.equipment, status } }
    store.replace({ ...state, catalog: { ...state.catalog, sessions: { ...state.catalog.sessions, [edited.id]: edited } } })
    return edited
  }

  it("on the confirmed rig, shows Halpha as unknown; Add Halpha to the rig opens the band form with Ha guessed and puts the filter on that rig", async () => {
    const session = withHalpha("confirmed")
    const rig = store.getState().catalog.opticalTrains[session.equipment.value!]!
    const user = userEvent.setup()
    renderIntake(session.id, "rig")
    expect(await screen.findByText(m.session_unknown_filter({ value: "Halpha" }))).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: `${m.equipment_add_value_to_rig({ value: "Halpha", rig: rig.name })}…` }))
    const dialog = await screen.findByRole("dialog", { name: m.equipment_add_value_to_rig({ value: "Halpha", rig: rig.name }) })
    expect(within(dialog).getByRole("textbox", { name: m.equipment_name() })).toHaveValue("Halpha")
    const bands = within(dialog).getByRole("group", { name: m.equipment_bands() })
    expect(within(bands).getByRole("checkbox", { name: "Ha" })).toBeChecked()
    expect(within(bands).getByRole("checkbox", { name: "OIII" })).not.toBeChecked()
    await user.click(within(dialog).getByRole("button", { name: m.equipment_add_filter() }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // The prompt that opened the dialog is gone, so focus lands on the Rig heading rather than the page body.
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: m.sessions_column_rig() })).toHaveFocus())
    const { catalog } = store.getState()
    const added = catalog.opticalTrains[rig.id]!.filterIds.map((id) => catalog.filters[id]!).find((f) => f.name === "Halpha")
    expect(added).toMatchObject({ bands: ["Ha"], matches: ["Halpha"] })
    // The value is no longer unknown: the plain value, and no prompt. The header stays as read.
    expect(screen.queryByText(m.session_unknown_filter({ value: "Halpha" }))).toBeNull()
    expect(screen.queryByRole("button", { name: new RegExp(m.equipment_add_value_to_rig({ value: "Halpha", rig: rig.name })) })).toBeNull()
    expect(screen.getByText("Halpha")).toBeInTheDocument()
    expect(catalog.sessions[session.id]!.channel).toBe("Halpha")
  })

  it("before the rig is confirmed, shows the observed value with no prompt naming a rig (J15 S4b)", async () => {
    const session = withHalpha("associated")
    const rig = store.getState().catalog.opticalTrains[session.equipment.value!]!
    renderIntake(session.id, "rig")
    expect(await screen.findByText("Halpha")).toBeInTheDocument()
    expect(screen.queryByText(m.session_unknown_filter({ value: "Halpha" }))).toBeNull()
    expect(screen.queryByRole("button", { name: new RegExp(m.equipment_add_value_to_rig({ value: "Halpha", rig: rig.name })) })).toBeNull()
  })
})
