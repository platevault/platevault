import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { TargetLookupPage } from "./target-lookup-page"

beforeEach(() => {
  store.replace({ ...createSeed("empty"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: TargetLookupPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

/** The Online lookup section: its switch, and its save state beside the heading. */
async function onlineSection() {
  const heading = await screen.findByRole("heading", { name: m.settings_lookup_online_title() })
  return within(heading.closest("section")!)
}

describe("Settings › Target lookup: Online lookup saves through its store action", () => {
  it("commits the switch and reads Saved", async () => {
    const user = userEvent.setup()
    const before = store.getState().settings.targetLookup.enabled
    renderPage()
    const section = await onlineSection()
    await user.click(section.getByRole("switch", { name: m.settings_lookup_online() }))
    expect(store.getState().settings.targetLookup.enabled).toBe(!before)
    expect(section.getByText(m.status_saved())).toBeInTheDocument()
  })

  it("keeps a failed write Not saved, and Retry commits it", async () => {
    const user = userEvent.setup()
    const before = store.getState().settings.targetLookup.enabled
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextCatalogWrite: true } }))
    renderPage()
    const section = await onlineSection()
    await user.click(section.getByRole("switch", { name: m.settings_lookup_online() }))
    expect(store.getState().settings.targetLookup.enabled).toBe(before)
    expect(section.getByText(m.status_not_saved())).toBeInTheDocument()
    await user.click(section.getByRole("button", { name: m.verb_retry() }))
    expect(store.getState().settings.targetLookup.enabled).toBe(!before)
    expect(section.getByText(m.status_saved())).toBeInTheDocument()
  })
})
