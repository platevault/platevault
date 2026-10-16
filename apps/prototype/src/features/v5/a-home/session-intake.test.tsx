import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionReadiness, sessionRigId, sessionUnreviewedFrames } from "@/domain/derive"
import { targetAtPointing } from "@/domain/indexing"
import { createSeed } from "@/domain/seed"
import type { Session } from "@/domain/types"
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

/** The intake on its own route; the Review step's body is the host's to inject, so the tests pass none. */
function renderIntake(sessionId: string, step: string) {
  const root = createRootRoute()
  const intake = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: () => <SessionIntakePage review={() => null} /> })
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
    const value = (label: string) => screen.getAllByRole("term").find((dt) => dt.textContent === label)?.nextElementSibling?.textContent
    expect(value(m.evidence_source_pointing())).toBe(suggested.name)
    expect(value(m.session_chosen_target())).toBe(suggested.name)
    await user.click(confirm)
    await waitFor(() => expect(store.getState().catalog.sessions[session!.id]!.target).toMatchObject({ status: "confirmed", value: suggested.id }))
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
