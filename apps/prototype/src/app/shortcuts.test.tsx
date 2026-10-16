import { render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { ShortcutsDialog } from "./shortcuts"
import { closePanel, openPanel } from "./ui-state"

afterEach(() => {
  closePanel()
  setLocale(DEFAULT_LOCALE)
})

/** The keys the `?` dialog lists for the shortcut named `label`. */
function keysOf(label: string): string[] {
  const row = screen.getByRole("rowheader", { name: label }).closest("tr")!
  return Array.from(row.querySelectorAll("[data-slot=kbd]"), (key) => key.textContent ?? "")
}

// P-KBD1: the table keys in the `?` dialog.
describe("ShortcutsDialog", () => {
  it.each(["en-GB", "pt-BR"] as const)("lists the table row keys in %s: ↑ ↓, Home / End, Page Up / Down, Enter and Space", async (locale) => {
    setLocale(locale)
    openPanel("shortcuts")
    render(<ShortcutsDialog />)
    const dialog = await screen.findByRole("dialog", { name: m.shortcuts_title({}, { locale }) })
    expect(dialog).toBeInTheDocument()
    expect(keysOf(m.shortcuts_move_rows({}, { locale }))).toEqual(["↑", "↓"])
    expect(keysOf(m.shortcuts_first_last_row({}, { locale }))).toEqual([m.key_home({}, { locale }), m.key_end({}, { locale })])
    expect(keysOf(m.shortcuts_page_rows({}, { locale }))).toEqual([m.key_page_up({}, { locale }), m.key_page_down({}, { locale })])
    expect(keysOf(m.shortcuts_open_row({}, { locale }))).toEqual(["↩"])
    expect(keysOf(m.shortcuts_select_row({}, { locale }))).toEqual([m.key_space({}, { locale })])
  })
})
