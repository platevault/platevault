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
  it("choosing Português (Brasil) switches the interface at once and saves the preference Appearance reads", async () => {
    renderStep()
    const englishTitle = (await screen.findByRole("heading", { level: 1 })).textContent

    await userEvent.click(screen.getByRole("button", { name: LOCALE_META["pt-BR"].nativeName }))

    expect(getPreferences().locale).toBe("pt-BR")
    expect(window.localStorage.getItem("platevault.locale")).toBe("pt-BR")
    const title = screen.getByRole("heading", { level: 1 })
    expect(title).toHaveTextContent(m.setup_language_title())
    expect(title.textContent).not.toBe(englishTitle)
    expect(screen.getByRole("button", { name: LOCALE_META["pt-BR"].nativeName })).toHaveAttribute("aria-pressed", "true")
  })
})
