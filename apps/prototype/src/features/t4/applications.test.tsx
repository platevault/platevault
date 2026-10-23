import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { addApplicationProfile } from "@/store/actions/settings"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { SettingsApplicationsPage } from "./applications"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: SettingsApplicationsPage }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

/** The applications table's row headers, in order. */
async function applicationNames(): Promise<string[]> {
  const table = await screen.findByRole("table", { name: m.settings_applications() })
  return within(table)
    .getAllByRole("rowheader")
    .map((cell) => cell.textContent ?? "")
}

describe("Settings › Applications (cmvgf)", () => {
  it("lists the applications PlateVault has a profile for and no generic Open in… row", async () => {
    renderPage()
    expect(await applicationNames()).toEqual(["PixInsight / WBPP", "Siril", "SETI Astro Suite Pro"])
    expect(screen.queryByText("Open in…")).toBeNull()
  })

  it("lists an added application after them, and only an added one can be removed", async () => {
    addApplicationProfile({ name: "Astro Pixel Processor", executablePath: "/Applications/APP.app", launchArgs: "" })
    const user = userEvent.setup()
    renderPage()
    expect((await applicationNames()).at(-1)).toBe("Astro Pixel Processor")
    await user.click(screen.getByRole("button", { name: m.actions_for({ name: "Astro Pixel Processor" }) }))
    expect(await screen.findByRole("menuitem", { name: new RegExp(`^${m.settings_remove()}`) })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await user.click(screen.getByRole("button", { name: m.actions_for({ name: "Siril" }) }))
    await screen.findByRole("menuitem", { name: new RegExp(`^${m.apps_edit_arguments()}`) })
    expect(screen.queryByRole("menuitem", { name: new RegExp(`^${m.settings_remove()}`) })).toBeNull()
  })

  it("an application's details say how it receives corrections, and hold no evidence text", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: m.table_row_details({ name: "PixInsight / WBPP" }) }))
    expect((await screen.findByText(m.session_corrections(), { selector: "dt" })).nextElementSibling?.textContent).toBe(m.apps_corrections_copies())
    expect(screen.queryByText(m.seed_apps_evidence_pixinsight())).toBeNull()
  })

  it("reads corrections through the application's settings when its profile does", async () => {
    const pixinsight = Object.values(store.getState().catalog.profiles).find((p) => p.name === "PixInsight / WBPP")!
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, profiles: { ...s.catalog.profiles, [pixinsight.id]: { ...pixinsight, capability: { ...pixinsight.capability, correctedMetadata: "configuration" } } } } }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: m.table_row_details({ name: "PixInsight / WBPP" }) }))
    expect((await screen.findByText(m.session_corrections(), { selector: "dt" })).nextElementSibling?.textContent).toBe(m.apps_corrections_settings({ name: "PixInsight / WBPP" }))
  })

  it("keeps Arguments out of the default columns and shows each application's launch arguments in its details", async () => {
    addApplicationProfile({ name: "Astro Pixel Processor", executablePath: "/Applications/APP.app", launchArgs: "--batch" })
    const user = userEvent.setup()
    renderPage()
    const table = await screen.findByRole("table", { name: m.settings_applications() })
    expect(within(table).queryByRole("columnheader", { name: m.apps_col_arguments() })).toBeNull()
    await user.click(screen.getByRole("button", { name: m.table_row_details({ name: "Astro Pixel Processor" }) }))
    expect((await screen.findByText(m.apps_launch_arguments(), { selector: "dt" })).nextElementSibling?.textContent).toBe("--batch")
  })

  it("refuses a group keyword a View folder already uses, inline under its field, and Save stays unavailable", async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole("button", { name: `${m.settings_edit()}…` }))
    const dialog = await screen.findByRole("dialog")
    const group = within(dialog).getByRole("textbox", { name: m.apps_keyword_group() })
    await user.clear(group)
    await user.type(group, "NIGHT")
    expect(group).toHaveAttribute("aria-invalid", "true")
    expect(group).toHaveAccessibleDescription(m.settings_keyword_reserved({ name: "NIGHT" }))
    expect(within(dialog).getByRole("textbox", { name: m.apps_keyword_panel() })).not.toHaveAttribute("aria-invalid")
    expect(within(dialog).getByRole("button", { name: m.settings_save() })).toHaveAttribute("aria-disabled", "true")
    expect(store.getState().settings.keywords.group).toBe("GROUP")
  })

  describe("Add application", () => {
    async function openAdd(user: ReturnType<typeof userEvent.setup>) {
      renderPage()
      await user.click(await screen.findByRole("button", { name: `${m.apps_add()}…` }))
      return within(await screen.findByRole("dialog"))
    }
    async function choose(user: ReturnType<typeof userEvent.setup>, dialog: ReturnType<typeof within>, application: string) {
      await user.click(dialog.getByRole("combobox", { name: m.apps_detected() }))
      await user.click(await screen.findByRole("option", { name: application }))
    }

    it("names the application after the chosen one until the user types a name", async () => {
      const user = userEvent.setup()
      const dialog = await openAdd(user)
      const name = dialog.getByRole("textbox", { name: m.apps_name() })
      await choose(user, dialog, "ASTAP")
      expect(name).toHaveValue("ASTAP")
      await choose(user, dialog, "Siril")
      expect(name).toHaveValue("Siril")
      await user.clear(name)
      await user.type(name, "Plate solver")
      await choose(user, dialog, "ASTAP")
      expect(name).toHaveValue("Plate solver")
    })

    it("refuses a name another application has, in any case, under the name field", async () => {
      const user = userEvent.setup()
      const dialog = await openAdd(user)
      await choose(user, dialog, "ASTAP")
      const name = dialog.getByRole("textbox", { name: m.apps_name() })
      await user.clear(name)
      await user.type(name, "siril")
      expect(name).toHaveAttribute("aria-invalid", "true")
      expect(name).toHaveAccessibleDescription(m.apps_refused_name_taken({ name: "Siril" }))
      expect(dialog.getByRole("button", { name: m.apps_add() })).toHaveAttribute("aria-disabled", "true")
    })

    it("refuses an executable another application starts with the same arguments, under the arguments field", async () => {
      const user = userEvent.setup()
      const dialog = await openAdd(user)
      const before = Object.keys(store.getState().catalog.profiles)
      await choose(user, dialog, "PixInsight")
      const args = dialog.getByRole("textbox", { name: m.apps_launch_arguments() })
      expect(args).toHaveAttribute("aria-invalid", "true")
      expect(args).toHaveAccessibleDescription(expect.stringContaining(m.apps_refused_launch_taken({ name: "PixInsight / WBPP" })))
      const add = dialog.getByRole("button", { name: m.apps_add() })
      expect(add).toHaveAttribute("aria-disabled", "true")
      await user.click(add)
      expect(Object.keys(store.getState().catalog.profiles)).toEqual(before)
      await user.type(args, "--batch")
      expect(args).not.toHaveAttribute("aria-invalid")
      expect(dialog.getByRole("button", { name: m.apps_add() })).not.toHaveAttribute("aria-disabled", "true")
    })
  })
})
