import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, render, screen } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { createSeed } from "@/domain/seed"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { emptyImportDraft } from "@/store/slices/a"
import { ImportPage } from "./import"
import { destinationLocations } from "./import-model"

describe("Import: a language switch re-words the plan (I18N.md)", () => {
  // The step page measures its room; jsdom has no ResizeObserver.
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
  afterEach(() => {
    setLocale(DEFAULT_LOCALE)
  })

  it("words the Captures destination's problem in pt-BR once the language changes on the page", async () => {
    const state: PrototypeState = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
    // The ASIAIR card's lights go to a Captures location the app may not write to.
    const captures = destinationLocations(state.catalog, "captures").find((l) => state.disk.volumes[l.volumeId]?.mounted && state.disk.volumes[l.volumeId]?.writable)!
    state.disk = { ...state.disk, readOnlyPaths: [...state.disk.readOnlyPaths, captures.path] }
    state.slices = { ...state.slices, a: { ...state.slices.a, importDraft: { ...emptyImportDraft(), source: { kind: "saved", id: "src_asiair" }, capturesLocationId: captures.id } } }
    store.replace(state)
    const root = createRootRoute()
    const page = createRoute({ getParentRoute: () => root, path: "/import", component: ImportPage, validateSearch: (search: Record<string, unknown>) => search })
    render(<RouterProvider router={createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/import?step=preview"] }) })} />)

    // The destination field and the blocked Proceed both name it.
    const problem = (locale: "en-GB" | "pt-BR") => m.import_no_write_permission({ name: captures.displayName }, { locale })
    expect(await screen.findAllByText(problem("en-GB"))).not.toHaveLength(0)
    act(() => setLocale("pt-BR"))
    expect(await screen.findAllByText(problem("pt-BR"))).not.toHaveLength(0)
    expect(screen.queryAllByText(problem("en-GB"))).toHaveLength(0)
  })
})
