import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { NightPicker, type SiteLocation, SiteLocationField, SitePicker } from "./pickers"

// Tiles that fail to load (an outage, a blocked provider) are hard to produce in jsdom, and Leaflet needs a
// layout engine: the map stands in as one that reports itself unavailable as soon as it mounts.
vi.mock("@/components/domain/site-map", () => ({
  SiteMap: function UnavailableMap({ onUnavailable }: { onUnavailable: () => void }) {
    useEffect(() => onUnavailable(), [onUnavailable])
    return null
  },
}))

const UTRECHT: SiteLocation = { latitude: 52.09, longitude: 5.12, elevation: 5 }

function Site({ online, onChange }: { online?: boolean; onChange: (next: SiteLocation) => void }) {
  const [value, setValue] = useState(UTRECHT)
  return (
    <SiteLocationField
      value={value}
      online={online}
      onChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

/** The fields hold the record: edits reach the host, and the other coordinates are untouched. */
async function expectFieldsKeepTheRecord(onChange: ReturnType<typeof vi.fn>) {
  const user = userEvent.setup()
  const latitude = screen.getByRole("spinbutton", { name: m.site_latitude_field() })
  expect(latitude).toHaveValue(52.09)
  expect(screen.getByRole("spinbutton", { name: m.site_longitude_field() })).toHaveValue(5.12)
  expect(screen.getByRole("spinbutton", { name: m.site_elevation_field() })).toHaveValue(5)

  await user.clear(latitude)
  await user.type(latitude, "28.76")
  expect(onChange).toHaveBeenLastCalledWith({ latitude: 28.76, longitude: 5.12, elevation: 5 })
  expect(latitude).toHaveValue(28.76)
}

describe("SiteLocationField", () => {
  it("keeps the fields as the record while offline, with no place search", async () => {
    const onChange = vi.fn()
    render(<Site online={false} onChange={onChange} />)
    expect(screen.getByText(m.picker_map_unavailable())).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: m.picker_place_search() })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.verb_retry() })).toBeDisabled()
    await expectFieldsKeepTheRecord(onChange)
  })

  it("keeps the fields as the record when the map fails to load", async () => {
    const onChange = vi.fn()
    render(<Site online onChange={onChange} />)
    expect(await screen.findByText(m.picker_map_unavailable())).toBeInTheDocument()
    expect(screen.getByRole("button", { name: m.verb_retry() })).toBeEnabled()
    await expectFieldsKeepTheRecord(onChange)
  })
})

describe("SitePicker", () => {
  const SITES = [
    { id: "site_backyard", name: "Backyard" },
    { id: "site_lapalma", name: "La Palma" },
  ]

  function Picker({ onChange }: { onChange: (siteId: string) => void }) {
    const [value, setValue] = useState("site_backyard")
    return (
      <SitePicker
        value={value}
        sites={SITES}
        defaultSiteId="site_backyard"
        onManage={() => {}}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
    )
  }

  it("exposes only its named trigger: the form input holding the site id is hidden from assistive technology", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { container } = render(<Picker onChange={onChange} />)
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(container.querySelector("input[aria-hidden='true']")).toHaveValue("site_backyard")

    const trigger = screen.getByRole("combobox", { name: m.plan_site() })
    expect(trigger).toHaveTextContent("Backyard")

    trigger.focus()
    await user.keyboard("{ArrowDown}")
    expect(await screen.findByRole("listbox")).toBeInTheDocument()
    await user.keyboard("{ArrowDown}{Enter}")
    expect(onChange).toHaveBeenLastCalledWith("site_lapalma")
    expect(screen.getByRole("combobox", { name: m.plan_site() })).toHaveTextContent("La Palma")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
  })
})

describe("NightPicker", () => {
  function Night({ onChange, weekJumps }: { onChange: (night: string) => void; weekJumps?: boolean }) {
    const [night, setNight] = useState("2026-10-20")
    return (
      <NightPicker
        value={night}
        today="2026-10-17"
        weekJumps={weekJumps}
        onChange={(next) => {
          setNight(next)
          onChange(next)
        }}
      />
    )
  }

  it("with weekJumps steps a week with « » and a night with ‹ ›, never before its first night", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Night onChange={onChange} weekJumps />)
    await user.click(screen.getByRole("button", { name: m.picker_week_next() }))
    expect(onChange).toHaveBeenLastCalledWith("2026-10-27")
    await user.click(screen.getByRole("button", { name: m.targets_night_previous() }))
    expect(onChange).toHaveBeenLastCalledWith("2026-10-26")
    await user.click(screen.getByRole("button", { name: m.picker_week_previous() }))
    expect(onChange).toHaveBeenLastCalledWith("2026-10-19")
    // A week back from the 19th clamps to tonight, the earliest night; then « and ‹ are disabled.
    await user.click(screen.getByRole("button", { name: m.picker_week_previous() }))
    expect(onChange).toHaveBeenLastCalledWith("2026-10-17")
    expect(screen.getByRole("button", { name: m.picker_week_previous() })).toBeDisabled()
    expect(screen.getByRole("button", { name: m.targets_night_previous() })).toBeDisabled()
  })

  it("without weekJumps shows night steps only", () => {
    render(<Night onChange={vi.fn()} />)
    expect(screen.getByRole("button", { name: m.targets_night_next() })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: m.picker_week_next() })).not.toBeInTheDocument()
  })
})
