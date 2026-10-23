import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { getPreferences, setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE, LOCALE_META, m } from "@/lib/i18n"
import { SetupLanguagePage } from "./setup-language"

/** StepFooter follows links through the router, so the step renders inside one. */
function renderStep() {
  const router = createRouter({ routeTree: createRootRoute({ component: SetupLanguagePage }), history: createMemoryHistory({ initialEntries: ["/setup/language"] }) })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe("Setup › Language", () => {
  it("choosing Português (Brasil) from the select switches the interface at once and saves the preference Appearance reads", async () => {
    const user = userEvent.setup()
    renderStep()
    const englishTitle = (await screen.findByRole("heading", { level: 1 })).textContent
    const select = screen.getByRole("combobox", { name: m.shell_language() })
    expect(select).toHaveTextContent(LOCALE_META["en-GB"].nativeName)
    expect(screen.getByText(`${LOCALE_META["pt-BR"].nativeName}: ${m.locale_machine_generated()}`)).toBeInTheDocument()

    await user.click(select)
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([LOCALE_META["en-GB"].nativeName, LOCALE_META["pt-BR"].nativeName])
    await user.click(screen.getByRole("option", { name: LOCALE_META["pt-BR"].nativeName }))

    expect(getPreferences().locale).toBe("pt-BR")
    expect(window.localStorage.getItem("platevault.locale")).toBe("pt-BR")
    const title = screen.getByRole("heading", { level: 1 })
    expect(title).toHaveTextContent(m.setup_language_title())
    expect(title.textContent).not.toBe(englishTitle)
    expect(screen.getByRole("combobox", { name: m.shell_language() })).toHaveTextContent(LOCALE_META["pt-BR"].nativeName)
  })
})
