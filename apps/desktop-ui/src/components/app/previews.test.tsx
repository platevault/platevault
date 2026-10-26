import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import { Button } from "@/components/ui/button"
import { m } from "@/lib/i18n"
import { BlockersPreview, MasterPreview, type MasterPreviewProps, UsedByPreview } from "./previews"

const OLDER = { id: "mv_older", capturedAt: "2026-05-02T22:10:00.000Z", frameCount: 30, origin: "library" } as const
const NEWER = { id: "mv_newer", capturedAt: "2026-09-14T21:40:00.000Z", frameCount: 40, origin: "stacked" } as const
const DARK = { kind: "dark", cameraName: "ZWO ASI2600MM Pro", gain: 100, offset: 50, ccdTempC: -10, exposureS: 300, versions: [OLDER, NEWER] } as const

/** The previews' links go through the router, so they render inside one. */
function renderInRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

function renderPreview(props: Partial<MasterPreviewProps> = {}) {
  renderInRouter(<MasterPreview label="masterDark_300s.xisf" link={{ to: "/calibration", search: { master: "mst_dark" } }} master={DARK} version={NEWER} age={null} usedBy={2} {...props} />)
}

/** Focus the trigger and wait for its card. */
async function openCard(name: string) {
  const user = userEvent.setup()
  const link = await screen.findByRole("link", { name })
  await user.tab()
  expect(link).toHaveFocus()
  const card = await waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-preview]")
    if (!element) throw new Error("no card yet")
    return element
  })
  return { link, card }
}

describe("MasterPreview", () => {
  it("is a link to the master in the Calibration library", async () => {
    renderPreview()
    expect(await screen.findByRole("link", { name: "masterDark_300s.xisf" })).toHaveAttribute("href", "/calibration?master=mst_dark")
  })

  it("opens its card on keyboard focus, with the record's settings, the master's age and its Used by count", async () => {
    renderPreview({ age: m.flow_master_old({ n: 120 }) })
    const { link, card } = await openCard("masterDark_300s.xisf")
    expect(card.textContent).toContain("ZWO ASI2600MM Pro")
    expect(card.textContent).toContain("100 · 50")
    expect(card.textContent).toContain("-10 °C")
    expect(card.textContent).toContain(m.flow_master_old({ n: 120 }))
    expect(card.textContent).toContain(`${m.calibration_used_by()}${m.about_count_projects({ count: 2, n: "2" })}`)
    // The card holds no controls, so focus stays on the link.
    expect(link).toHaveFocus()
  })

  it("shows the facts of the version it names, not the newest one", async () => {
    renderPreview({ version: OLDER })
    const { card } = await openCard("masterDark_300s.xisf")
    expect(card.textContent).toContain(`${m.calibration_version()}${m.calibration_version_n_of({ n: "1", count: "2" })}`)
    expect(card.textContent).toContain("2 May 2026")
    expect(card.textContent).toContain(`${m.calibration_frames()}30`)
    expect(card.textContent).toContain(`${m.calibration_origin()}${m.calibration_origin_indexed()}`)
    expect(card.textContent).not.toContain("14 Sep 2026")
  })

  it("names a stacked newer version with its own frames", async () => {
    renderPreview()
    const { card } = await openCard("masterDark_300s.xisf")
    expect(card.textContent).toContain(m.calibration_version_n_of({ n: "2", count: "2" }))
    expect(card.textContent).toContain("14 Sep 2026")
    expect(card.textContent).toContain(`${m.calibration_frames()}40`)
    expect(card.textContent).toContain(m.calibration_origin_stacked())
  })

  it("compact, is an icon link named after the master", async () => {
    renderPreview({ compact: true })
    expect(await screen.findByRole("link", { name: `${m.calibration_open_master()}: masterDark_300s.xisf` })).toHaveAttribute("href", "/calibration?master=mst_dark")
  })
})

describe("BlockersPreview", () => {
  it("with columns, lists the blockers as a table of item and where, the place linked (P7)", async () => {
    renderInRouter(
      <BlockersPreview
        action={m.sessions_cant_archive()}
        reason={m.sessions_in_a_project({ count: 1 })}
        blockers={[{ label: "30 Sep OIII", where: "Cygnus HOO", link: { to: "/projects/$projectId", params: { projectId: "prj_cygnus" } } }]}
        columns={{ item: m.session_label(), where: m.project_noun() }}
      >
        <Button disabled focusableWhenDisabled>
          {m.wrapup_archive_title()}
        </Button>
      </BlockersPreview>,
    )
    const user = userEvent.setup()
    const button = await screen.findByRole("button", { name: m.wrapup_archive_title() })
    await user.tab()
    expect(button).toHaveFocus()
    const card = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-preview]")
      if (!element) throw new Error("no card yet")
      return element
    })
    const table = within(card).getByRole("table", { name: `${m.sessions_cant_archive()} · ${m.sessions_in_a_project({ count: 1 })}` })
    for (const header of [m.session_label(), m.project_noun()]) expect(within(table).getByRole("columnheader", { name: new RegExp(header) })).toBeInTheDocument()
    expect(within(table).getByRole("rowheader", { name: "30 Sep OIII" })).toBeInTheDocument()
    expect(within(table).getByRole("link", { name: "Cygnus HOO" })).toHaveAttribute("href", "/projects/prj_cygnus")
  })
})

describe("UsedByPreview", () => {
  it("without a link of its own, links to its first user", async () => {
    const items = [
      { label: "RedCat 51", link: { to: "/settings/equipment", search: { rig: "rig_redcat" } } },
      { label: "Esprit 100", link: { to: "/settings/equipment", search: { rig: "rig_esprit" } } },
    ]
    renderInRouter(<UsedByPreview label="2 rigs" items={items} />)
    expect(await screen.findByRole("link", { name: "2 rigs" })).toHaveAttribute("href", "/settings/equipment?rig=rig_redcat")
  })

  it("reads – with nowhere to link", async () => {
    renderInRouter(
      <p data-testid="cell">
        <UsedByPreview label="0 rigs" items={[]} />
      </p>,
    )
    expect(await screen.findByTestId("cell")).toHaveTextContent(/^–$/)
    expect(screen.queryByRole("link")).not.toBeInTheDocument()
  })
})
