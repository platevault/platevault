import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { createSeed } from "@/domain/seed"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ControlsCatalogue } from "./catalogue/controls"
import { FeedbackCatalogue } from "./catalogue/feedback"

// The page's tables measure their room and keep rows in view; jsdom has neither ResizeObserver nor scrollIntoView.
const original = { resizeObserver: globalThis.ResizeObserver, scrollIntoView: Element.prototype.scrollIntoView }
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = () => {}
})
afterAll(() => {
  globalThis.ResizeObserver = original.resizeObserver
  Element.prototype.scrollIntoView = original.scrollIntoView
})
beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})
afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe("Design system page copy (F4: no Run)", () => {
  it.each(["en-GB", "pt-BR"] as const)("shows the disabled Apply and the Developer Mode warning in F4 words in %s", async (locale) => {
    setLocale(locale)
    const router = createRouter({ routeTree: createRootRoute({ component: () => <><ControlsCatalogue /><FeedbackCatalogue /></> }), history: createMemoryHistory({ initialEntries: ["/"] }) })
    render(<RouterProvider router={router} />)
    expect(await screen.findByRole("button", { name: m.project_apply({}, { locale }) })).toBeDisabled()
    // Standing state, not a refusal: a status notice whose recovery is Use copies.
    expect(screen.getByText(m.view_developer_mode_off({}, { locale })).closest("[role=status]")).not.toBeNull()
    expect(screen.getByRole("button", { name: m.project_use_copies({}, { locale }) })).toBeInTheDocument()
    const runEra = locale === "en-GB" ? /Use copies for this run|Can't prepare|Prepare View/ : /Usar cópias nesta execução|Não é possível preparar|Preparar visualização/
    expect(screen.queryByText(runEra)).toBeNull()
  })
})
