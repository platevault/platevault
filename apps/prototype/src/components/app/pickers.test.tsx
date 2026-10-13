import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useEffect, useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { m } from "@/lib/i18n"
import { type SiteLocation, SiteLocationField } from "./pickers"

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
