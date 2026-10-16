import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { sessionNamingValues } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import { DEFAULT_NAMING, NAMING_SEPARATORS, resolveNamingTemplate } from "@/domain/templates"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { NamingSettingsPage } from "./settings-naming"

// The token table's pinned first column measures its header; jsdom has no ResizeObserver.
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

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const root = createRootRoute()
  const page = createRoute({ getParentRoute: () => root, path: "/settings/naming", component: NamingSettingsPage })
  const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ["/settings/naming"] }) })
  render(<RouterProvider router={router} />)
}

/** user-event reads `{` and `[` as key descriptors; doubled, each types itself. */
const literally = (text: string) => text.replace(/[{[]/g, (c) => c + c)

async function retype(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, literally(text))
}

/** A kind's text input and its two preview lines: the library item (or the tokens' examples) and every value missing. */
async function kind(label: string) {
  const field = await screen.findByRole("textbox", { name: label })
  const row = field.closest<HTMLElement>("[data-settings-row]")!
  const [available, missing] = within(within(row).getByRole("group", { name: m.fields_template_preview() })).getAllByRole("definition")
  return { field, available: available!, missing: missing! }
}

const saveButton = () => screen.getByRole("button", { name: m.settings_save() })

describe("Settings › Naming: one text input per kind with a live preview (wmbp9)", () => {
  it("shows a text input per kind, each previewing its template with a library item's values and with every value missing", async () => {
    renderPage()
    for (const label of [m.naming_type_lights(), m.naming_type_flats(), m.naming_type_darks(), m.naming_type_bias(), m.calibration_caption_flats(), m.calibration_caption_darks(), m.calibration_caption_bias(), m.calibration_caption_dark_flats()]) {
      expect((await kind(label)).field).toBeInTheDocument()
    }
    const lights = await kind(m.naming_type_lights())
    expect(lights.field).toHaveValue(DEFAULT_NAMING.light)
    expect(lights.missing.textContent).toMatch(/Unclassified\/nofilter\/undated\/light\/$/)
  })

  it("updates both preview lines as the template is typed", async () => {
    const user = userEvent.setup()
    renderPage()
    const lights = await kind(m.naming_type_lights())
    await retype(user, lights.field, "{target}/{camera}_{filter}/light/")

    const catalog = store.getState().catalog
    const session = Object.values(catalog.sessions).find((s) => s.imageType === "light" && !s.supersededBy)!
    const expected = resolveNamingTemplate("{target}/{camera}_{filter}/light/", sessionNamingValues(catalog, session, "light")).path
    expect(lights.available.textContent!.endsWith(expected)).toBe(true)
    expect(lights.missing.textContent).toMatch(/Unclassified\/unknown-camera_nofilter\/light\/$/)
  })
})

describe("Settings › Naming: validation against whitelisted tokens and separators (wmbp9)", () => {
  it("shows an unknown token and a refused character as field errors and refuses Save until they are gone", async () => {
    const user = userEvent.setup()
    renderPage()
    const lights = await kind(m.naming_type_lights())
    await retype(user, lights.field, "{target}/a:b/{bogus}/light/")

    expect(lights.field).toHaveAttribute("aria-invalid", "true")
    expect(lights.field).toHaveAccessibleDescription(expect.stringContaining(m.domain_naming_unknown_token({ token: "{bogus}" })))
    expect(lights.field).toHaveAccessibleDescription(expect.stringContaining(m.domain_naming_disallowed_characters({ characters: ":", separators: NAMING_SEPARATORS.join(" ") })))
    expect(saveButton()).toHaveAttribute("aria-disabled", "true")

    await retype(user, lights.field, "{target}/a-b/{filter}/light/")
    expect(lights.field).not.toHaveAttribute("aria-invalid")
    expect(saveButton()).not.toHaveAttribute("aria-disabled", "true")
  })

  it("names an unmatched brace once, though the field and the domain both find it", async () => {
    const user = userEvent.setup()
    renderPage()
    const lights = await kind(m.naming_type_lights())
    await retype(user, lights.field, "{target/light/")

    expect(lights.field).toHaveAttribute("aria-invalid", "true")
    expect(screen.getAllByText(m.fields_token_unmatched())).toHaveLength(1)
    expect(screen.queryByText(m.domain_naming_unmatched_brace())).not.toBeInTheDocument()
    expect(saveButton()).toHaveAttribute("aria-disabled", "true")
  })

  it("saves a valid template, and only the changed kind", async () => {
    const user = userEvent.setup()
    renderPage()
    const lights = await kind(m.naming_type_lights())
    await retype(user, lights.field, "{target}/{date}/light/")
    await user.click(saveButton())

    await waitFor(() => expect(store.getState().settings.naming).toEqual({ light: "{target}/{date}/light/" }))
  })
})

describe("Settings › Naming: the token table and Omit when unavailable (wmbp9)", () => {
  it("lists each token with what it writes when available and when missing", async () => {
    renderPage()
    const table = await screen.findByRole("table", { name: m.fields_tokens() })
    const filter = within(table).getByRole("rowheader", { name: "{filter}" }).closest("tr")!
    expect(within(filter).getByText("Ha")).toBeInTheDocument()
    expect(within(filter).getByText("nofilter")).toBeInTheDocument()
  })

  it("Omit drops a missing token from every preview and saves at once; unticking restores its fallback", async () => {
    const user = userEvent.setup()
    renderPage()
    const table = await screen.findByRole("table", { name: m.fields_tokens() })
    const filterRow = () => within(table).getByRole("rowheader", { name: "{filter}" }).closest("tr")!
    // Its label reads "Omit {filter}" in a browser; jsdom names no checkbox from a wrapping label.
    const omit = within(filterRow()).getByRole("checkbox")
    expect(filterRow()).toHaveTextContent(`${m.fields_token_omit()} {filter}`)
    await user.click(omit)

    await waitFor(() => expect(store.getState().settings.namingOmit).toEqual(["filter"]))
    expect(within(filterRow()).getByText(m.fields_token_omitted())).toBeInTheDocument()
    expect((await kind(m.naming_type_lights())).missing.textContent).toMatch(/Unclassified\/undated\/light\/$/)
    expect((await kind(m.calibration_caption_flats())).missing.textContent).toMatch(/Flats\/unknown-train\/undated\/$/)

    await user.click(omit)
    await waitFor(() => expect(store.getState().settings.namingOmit).toEqual([]))
    expect((await kind(m.naming_type_lights())).missing.textContent).toMatch(/Unclassified\/nofilter\/undated\/light\/$/)
  })
})
