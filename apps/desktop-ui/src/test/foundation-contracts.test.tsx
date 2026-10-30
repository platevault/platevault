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
import { THEMES, DEFAULT_SYSTEM_THEMES, DEFAULT_THEME } from "@/app/themes"
import { setLocale, setSystemThemes, setTheme, useMessages } from "@/app/preferences"
import { ControlsCatalogue } from "@/app/catalogue/controls"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { FormDialog } from "@/components/app/form-dialog"
import { TextField } from "@/components/app/fields"
import { LOCALES, m } from "@/lib/i18n"

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const FONT_SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, "Helvetica Neue", sans-serif'
const ACCESS_DENIED: ErrorResponse = { code: "access_denied", identity: null, scope: null, retry: "retry", currentRevision: null, successors: [], window: null, correction: null, field: null }

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
  it("pins the ADR-0009 system UI font stack in the theme token and body rule", async () => {
    const systemTokens = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "tokens/sys.json"), "utf8")) as {
      sys: { font: { sans: { $value: string[] } } }
    }
    const fontValue = systemTokens.sys.font.sans.$value.join(", ")
    const themes = await readFile(path.join(PACKAGE_ROOT, "src/themes.css"), "utf8")
    const token = themes.match(/^\s*--font-sans:\s*(.+);$/m)?.[1]?.trim()
    expect(token).toBe(FONT_SANS)
    expect(token?.replace(/\s+/g, "").replaceAll('"', "")).toBe(fontValue.replace(/\s+/g, ""))

    const css = await readFile(path.join(PACKAGE_ROOT, "src/index.css"), "utf8")
    expect(css).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/s)
  })

  it.each(THEMES.map(({ id, scheme }) => [id, scheme] as const))("applies registry theme %s to the document root", async (id, scheme) => {
    act(() => setTheme(id))
    const root = document.documentElement
    expect(root.dataset.theme).toBe(id)
    expect(root.classList.contains("dark")).toBe(scheme === "dark")

    const themes = await readFile(path.join(PACKAGE_ROOT, "src/themes.css"), "utf8")
    const block = themes.match(new RegExp(`\\[data-theme="${id}"\\]\\s*\\{([^}]*)\\}`))?.[1]
    expect(block).toBeDefined()
    expect(block).toMatch(new RegExp(`color-scheme:\\s*${scheme};`))
  })

  it("renders a failed Action from src/api as the library's catalogue message", async () => {
    mockIPC((command) => {
      expect(command).toBe("library_update_location")
      return Promise.reject(ACCESS_DENIED)
    })
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

  it("composes an Action form dialog with footer order, keyboard submit, failure draft retention and focus return", async () => {
    mockIPC((command) => {
      expect(command).toBe("library_update_location")
      return Promise.reject(ACCESS_DENIED)
    })
    const user = userEvent.setup()
    function DialogHarness() {
      const messages = useMessages()
      const [name, setName] = useState("M 31")
      const [open, setOpen] = useState(false)
      const action: Action = {
        id: "save",
        label: messages.settings_save(),
        kind: "primary",
        run: () => library.libraryUpdateLocation("loc-1", name, 1),
      }
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>{messages.location_not_saved()}</button>
          <FormDialog open={open} onOpenChange={setOpen} title={messages.settings_edit_title({ name: "M 31" })} confirm={action}>
            <TextField label={messages.location_display_name()} value={name} onChange={setName} />
          </FormDialog>
        </>
      )
    }
    render(<DialogHarness />)
    const opener = screen.getByRole("button", { name: m.location_not_saved() })
    await user.click(opener)
    const dialog = await screen.findByRole("dialog", { name: m.settings_edit_title({ name: "M 31" }) })
    const field = within(dialog).getByRole("textbox", { name: m.location_display_name() })
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([m.verb_cancel(), m.settings_save()])
    await user.clear(field)
    await user.type(field, "Renamed M31")
    await user.type(field, "{Enter}")
    expect(await screen.findByRole("alert")).toHaveTextContent(m.action_failure_access_denied())
    expect(field).toHaveValue("Renamed M31")
    expect(screen.getByRole("dialog", { name: m.settings_edit_title({ name: "M 31" }) })).toBeInTheDocument()
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
    expect(document.documentElement.lang).toBe(locale)
  })

  it("runs package ESLint import gates on src modules and boundary controls", async () => {
    const eslint = new ESLint({ cwd: PACKAGE_ROOT, overrideConfigFile: path.join(PACKAGE_ROOT, "eslint.config.js") })
    const results = await eslint.lintFiles(["src/**/*.ts", "src/**/*.tsx"])
    const treeMessages = results.flatMap((result) => result.messages)
    expect(treeMessages.filter((message) => message.fatal)).toEqual([])
    expect(treeMessages.filter((message) => message.ruleId === "composition/imports")).toEqual([])

    const lintText = async (source: string, filePath: string) => {
      const [result] = await eslint.lintText(source, { filePath })
      expect(result?.messages.filter((message) => message.fatal)).toEqual([])
      return result?.messages.map((message) => message.ruleId)
    }
    expect(await lintText('import * as legacy from "../../../../desktop/src/bindings/index"', "src/features/library/page.tsx")).toContain("composition/imports")
    expect(await lintText('import { mockIPC } from "@tauri-apps/api/mocks"', "src/features/library/page.tsx")).toContain("composition/imports")
    expect(await lintText('import * as generated from "../../../desktop/src/bindings/library-index"', "src/api/ipc.ts")).toEqual([])
  }, 30_000)
})
