/**
 * Cross-package foundation contracts that production feature workers consume.
 * These tests cover behavior not already pinned by component and accessibility
 * suites, while the package's own gates remain responsible for locale parity,
 * catalogue completeness and the full I1-I7 ruleset.
 */
import "./jsdom-render"
import "@/index.css"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { ESLint } from "eslint"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { library, type ErrorResponse } from "@/api/ipc"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME, THEMES } from "@/app/themes"
import { setLocale, setSystemThemes, setTheme, useMessages } from "@/app/preferences"
import { ControlsCatalogue } from "@/app/catalogue/controls"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { FormDialog } from "@/components/app/form-dialog"
import { TextField } from "@/components/app/fields"
import { LOCALES, m } from "@/lib/i18n"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

const FONT_SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "Helvetica Neue", sans-serif'

const ACCESS_DENIED: ErrorResponse = { code: "access_denied", identity: null, scope: null, retry: "retry", currentRevision: null, successors: [], window: null, correction: null }

afterEach(() => {
  clearMocks()
  act(() => {
    setTheme(DEFAULT_THEME)
    setSystemThemes(DEFAULT_SYSTEM_THEMES)
    setLocale("en-GB")
    window.localStorage.clear()
  })
})

describe("frontend foundation contracts", () => {
  it("applies the system UI font token to the computed page typography", async () => {
    const themes = await readFile(path.join(PACKAGE_ROOT, "src/themes.css"), "utf8")
    const token = themes.match(/^\s*--font-sans:\s*(.+);$/m)?.[1]?.trim()
    expect(token).toBe(FONT_SANS)

    const css = await readFile(path.join(PACKAGE_ROOT, "src/index.css"), "utf8")
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/s)

    const style = document.createElement("style")
    style.textContent = `:root { --font-sans: ${token}; }`
    document.head.append(style)
    expect(getComputedStyle(document.documentElement).getPropertyValue("--font-sans").replace(/\s+/g, "")).toBe(FONT_SANS.replace(/\s+/g, ""))
    expect(document.body.style.fontFamily || "var(--font-sans)").toBe("var(--font-sans)")
    style.remove()
  })

  it.each(THEMES.map(({ id, scheme }) => [id, scheme] as const))("applies registry theme %s to the document root", (id, scheme) => {
    act(() => setTheme(id))
    const root = document.documentElement
    expect(root.dataset.theme).toBe(id)
    expect(root.classList.contains("dark")).toBe(scheme === "dark")
  })

  it("renders a failed Action from src/api as the library's catalogue message", async () => {
    mockIPC(() => Promise.reject(ACCESS_DENIED))
    const action: Action = {
      id: "save-location",
      label: "Save location",
      kind: "primary",
      run: () => library.libraryUpdateLocation("loc-1", "Captures", 1),
    }
    const user = userEvent.setup()
    render(<ActionButton action={action} />)
    await user.click(screen.getByRole("button", { name: "Save location" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(m.action_failure_access_denied())
  })
  it("composes token-backed fields, localized messages and DialogFooter order, Enter, and focus return", async () => {
    mockIPC(() => Promise.reject(ACCESS_DENIED))
    const user = userEvent.setup()
    function DialogHarness() {
      const messages = useMessages()
      const [name, setName] = useState("M 31")
      const [open, setOpen] = useState(false)
      const action: Action = {
        id: "save",
        label: messages.project_apply(),
        kind: "primary",
        run: () => library.libraryUpdateLocation("loc-1", name, 1),
      }
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>{messages.ds_buttons_title()}</button>
          <FormDialog open={open} onOpenChange={setOpen} title={messages.settings_appearance()} confirm={action}>
            <TextField label={messages.settings_group_general()} value={name} onChange={setName} />
          </FormDialog>
        </>
      )
    }
    render(<DialogHarness />)
    const opener = screen.getByRole("button", { name: m.ds_buttons_title() })
    await user.click(opener)
    const dialog = await screen.findByRole("dialog", { name: m.settings_appearance() })
    const controls = screen.getByRole("textbox", { name: m.settings_group_general() })
    const footer = within(dialog)
    expect(footer.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([m.verb_cancel(), m.project_apply()])
    expect(controls).toHaveClass("border-input")
    await user.type(controls, "{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent(m.action_failure_access_denied())
    expect(screen.getByRole("dialog", { name: m.settings_appearance() })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    await expect.poll(() => screen.queryByRole("dialog")).toBeNull()
    expect(opener).toHaveFocus()
  })

  it.each(LOCALES)("renders the controls catalogue in %s with translated messages", async (locale) => {
    act(() => setLocale(locale))
    const { container } = render(<ControlsCatalogue />)
    const heading = locale === "en-GB" ? "Buttons" : "Botões"
    const startIndexing = locale === "en-GB" ? "Start indexing" : "Iniciar indexação"
    expect(within(container).getByRole("heading", { name: heading })).toBeInTheDocument()
    expect(within(container).getByRole("button", { name: startIndexing })).toBeInTheDocument()
    expect(container).not.toHaveTextContent("ds_buttons_title")
    expect(container).not.toHaveTextContent("setup_start_indexing")
    expect(document.documentElement.lang).toBe(locale)
  })

  it("runs package ESLint I7 and layer rules against every production runtime module", async () => {
    const eslint = new ESLint({
      cwd: PACKAGE_ROOT,
      overrideConfigFile: path.join(PACKAGE_ROOT, "eslint.config.js"),
      overrideConfig: [{ rules: { "no-restricted-imports": ["error", { patterns: [{ group: ["**/prototype/**", "**/simulation/**", "**/simulations/**", "**/fake-disk/**", "**/fakedisk/**", "**/bindings/index"] }] }] } }],
    })
    const results = await eslint.lintFiles(["src/**/*.ts", "src/**/*.tsx"])
    const violations = results.flatMap((result) =>
      result.messages
        .filter((message) => message.ruleId === "composition/imports" || message.ruleId === "no-restricted-imports")
        .map((message) => `${path.relative(PACKAGE_ROOT, result.filePath)}:${message.line}:${message.column} ${message.message}`),
    )
    expect(violations).toEqual([])
  }, 30_000)
})
