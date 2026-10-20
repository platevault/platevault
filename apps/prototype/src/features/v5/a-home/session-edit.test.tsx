import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { isTrashedSession } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { Session } from "@/domain/types"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SessionPage } from "./session"
import { SessionsPage } from "./sessions"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderAt(path: string) {
  const root = createRootRoute()
  const sessions = createRoute({ getParentRoute: () => root, path: "/sessions", component: SessionsPage, validateSearch: (s: Record<string, unknown>) => s })
  const session = createRoute({ getParentRoute: () => root, path: "/sessions/$sessionId", component: SessionPage })
  const router = createRouter({ routeTree: root.addChildren([sessions, session]), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  return userEvent.setup()
}

const liveSession = (): Session => Object.values(store.getState().catalog.sessions).find((s) => s.imageType === "light" && !s.supersededBy && !isTrashedSession(store.getState().catalog, s))!

async function save(user: ReturnType<typeof userEvent.setup>, name: string, notes: string) {
  const dialog = await screen.findByRole("dialog")
  const nameField = within(dialog).getByRole("textbox", { name: m.session_edit_name() })
  await user.clear(nameField)
  await user.type(nameField, name)
  if (notes) await user.type(within(dialog).getByRole("textbox", { name: m.session_notes() }), notes)
  await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
}

describe("Edit… on a session (D-W76; owner's answer, 2026-10-20)", () => {
  // The dock and the dialogs measure their room; jsdom has no ResizeObserver.
  const original = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => {
    globalThis.ResizeObserver = original
  })

  it("renames the session and adds notes from the Session ▾ menu; the page shows both", async () => {
    const session = liveSession()
    const user = renderAt(`/sessions/${session.id}`)
    await user.click(await screen.findByRole("button", { name: m.session_label() }))
    await user.click(await screen.findByRole("menuitem", { name: `${m.session_edit()}…` }))
    await save(user, "Andromeda core", "Dew on the corrector")
    expect(await screen.findByRole("heading", { level: 1, name: "Andromeda core" })).toBeInTheDocument()
    expect(screen.getByText("Dew on the corrector")).toBeInTheDocument()
    expect(store.getState().catalog.sessions[session.id]).toMatchObject({ name: "Andromeda core", notes: "Dew on the corrector" })
  })

  it("renames the session from its Sessions row menu; the row reads the new name", async () => {
    const user = renderAt("/sessions")
    await screen.findByRole("table")
    const row = await waitFor(() => {
      const first = document.querySelector<HTMLElement>("tbody tr[data-row]")
      expect(first).not.toBeNull()
      return first!
    })
    const sessionId = row.getAttribute("data-row")!
    const session = store.getState().catalog.sessions[sessionId]!
    await user.click(within(row).getByRole("button", { name: new RegExp(sessionLabel(m, session)) }))
    await user.click(await screen.findByRole("menuitem", { name: `${m.session_edit()}…` }))
    await save(user, "Andromeda core", "")
    await waitFor(() => expect(within(document.querySelector<HTMLElement>(`tr[data-row="${sessionId}"]`)!).getByText("Andromeda core")).toBeInTheDocument())
  })
})
