import { act, render, screen } from "@testing-library/react"
import { useMemo } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { setLocale, useMessages } from "./preferences"

/** Words its copy once per catalogue, as a page that builds rows or columns in a memo does. */
function MemoisedCopy() {
  const messages = useMessages()
  const label = useMemo(() => messages.verb_cancel(), [messages])
  return <p>{label}</p>
}

describe("useMessages", () => {
  afterEach(() => {
    act(() => setLocale(DEFAULT_LOCALE))
  })

  it("re-words a memo that depends on the catalogue after a language switch", () => {
    render(<MemoisedCopy />)
    expect(screen.getByText(m.verb_cancel({}, { locale: "en-GB" }))).toBeInTheDocument()

    act(() => setLocale("pt-BR"))
    expect(screen.getByText(m.verb_cancel({}, { locale: "pt-BR" }))).toBeInTheDocument()

    act(() => setLocale("en-GB"))
    expect(screen.getByText(m.verb_cancel({}, { locale: "en-GB" }))).toBeInTheDocument()
  })
})
