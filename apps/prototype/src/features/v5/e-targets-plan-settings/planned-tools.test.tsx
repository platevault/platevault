import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it } from "vitest"
import { createSeed } from "@/domain/seed"
import { m } from "@/lib/i18n"
import { SCHEMA_VERSION, store, withCatalog } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ReminderScheduler, RemindersDialog } from "./planned-tools"

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderInRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

async function openDialog() {
  renderInRouter(<RemindersDialog open onOpenChange={() => {}} />)
  return screen.findByRole("dialog")
}

/** Custom lead time: `amount` in `unit`. */
async function typeCustom(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, amount: string, unit: string) {
  await user.click(within(dialog).getByRole("combobox", { name: m.plan_reminder_lead() }))
  await user.click(await screen.findByRole("option", { name: m.plan_lead_custom() }))
  await user.click(within(dialog).getByRole("combobox", { name: m.plan_lead_unit() }))
  await user.click(await screen.findByRole("option", { name: unit }))
  const field = within(dialog).getByRole("spinbutton", { name: m.plan_lead_amount() })
  await user.clear(field)
  await user.type(field, amount)
}

describe("Reminders dialog (D-W88, PLAN-AC-13)", () => {
  it("starts from the 12 h default and offers no preset of 30 minutes or less", async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()
    const lead = within(dialog).getByRole("combobox", { name: m.plan_reminder_lead() })
    expect(lead).toHaveTextContent("12 h before")
    await user.click(lead)
    const options = (await screen.findAllByRole("option")).map((o) => o.textContent)
    expect(options).toEqual(["1 h before", "2 h before", "4 h before", "12 h before", "1 day before", "Custom"])
  })

  it("says reminders arrive only while PlateVault is open", async () => {
    const dialog = await openDialog()
    expect(within(dialog).getByText(m.plan_reminders_while_open())).toBeInTheDocument()
  })

  it("shows an inline error for 30 minutes and cannot save it", async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()
    await user.click(within(dialog).getByRole("switch", { name: m.plan_reminders() }))
    await typeCustom(user, dialog, "30", m.plan_lead_unit_minutes())
    expect(within(dialog).getByText(m.plan_lead_out_of_range())).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
    expect(store.getState().catalog.reminders.enabled).toBe(false)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("saves a typed lead time over 30 minutes", async () => {
    const user = userEvent.setup()
    const dialog = await openDialog()
    await user.click(within(dialog).getByRole("switch", { name: m.plan_reminders() }))
    await typeCustom(user, dialog, "45", m.plan_lead_unit_minutes())
    expect(within(dialog).queryByText(m.plan_lead_out_of_range())).toBeNull()
    await user.click(within(dialog).getByRole("button", { name: m.settings_save() }))
    await waitFor(() => expect(store.getState().catalog.reminders).toMatchObject({ enabled: true, leadTimeMin: 45, siteId: "site_backyard" }))
  })
})

describe("ReminderScheduler", () => {
  it("runs the start-up check when PlateVault starts", () => {
    store.setState((s) => withCatalog(s, (c) => ({ ...c, reminders: { ...c.reminders, enabled: true, siteId: "site_backyard", permission: "granted", checkedAt: null } })))
    render(<ReminderScheduler />)
    expect(store.getState().catalog.reminders.checkedAt).not.toBeNull()
  })
})
