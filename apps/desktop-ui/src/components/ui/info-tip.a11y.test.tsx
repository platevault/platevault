/**
 * InfoTip's accessibility contract (docs/adr/0002-lock-and-infotip-stay-separate.md):
 * a focusable role=note named "<label>: <tip>", label defaulting to "More
 * information", with the name in place before the popup ever opens.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { InfoTip } from "./info-tip"

const TIP = "A dark matches lights whose sensor temperature is within this many degrees."

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe("InfoTip", () => {
  it('is a note named "More information: <tip>" while the popup is closed, with no describedby', () => {
    render(<InfoTip tip={TIP} />)
    const note = screen.getByRole("note", { name: `${m.info_tip_more_information()}: ${TIP}` })
    expect(note).not.toHaveAttribute("aria-describedby")
    expect(screen.queryByText(TIP)).toBeNull()
  })

  it("puts its own label before the tip", () => {
    render(<InfoTip tip={TIP} label="About the tolerance" />)
    expect(screen.getByRole("note", { name: `About the tolerance: ${TIP}` })).toBeInTheDocument()
  })

  it("names its default label in the current locale", () => {
    setLocale("pt-BR")
    render(<InfoTip tip={TIP} />)
    expect(screen.getByRole("note", { name: `${m.info_tip_more_information({}, { locale: "pt-BR" })}: ${TIP}` })).toBeInTheDocument()
  })

  it("is a tab stop, and focus reveals the tip", async () => {
    const user = userEvent.setup()
    render(<InfoTip tip={TIP} />)
    await user.tab()
    expect(screen.getByRole("note")).toHaveFocus()
    expect(await screen.findByText(TIP)).toBeVisible()
  })
})
