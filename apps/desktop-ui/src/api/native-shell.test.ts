/**
 * The Quit confirmation names the work a Quit would interrupt (D-W157).
 */
import { afterEach, describe, expect, it } from "vitest"
import { nativeQuitCopy } from "./native-shell"
import { setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"

afterEach(() => {
  setLocale(DEFAULT_LOCALE)
})

describe("nativeQuitCopy", () => {
  it("names each running import, index and Apply", () => {
    expect(nativeQuitCopy(m, { imports: 2, indexes: 1, applies: ["Cygnus"] })).toEqual({
      title: "Quit with 4 tasks running?",
      summary: "Running: 2 imports, 1 index and Apply in Cygnus. If you quit, they are interrupted, and the next launch offers Retry.",
    })
  })

  it("names a single task in the singular", () => {
    expect(nativeQuitCopy(m, { imports: 0, indexes: 0, applies: ["M31"] })).toEqual({
      title: "Quit with 1 task running?",
      summary: "Running: Apply in M31. If you quit, it is interrupted, and the next launch offers Retry.",
    })
  })

  it("asks without naming the work when the host could not read it", () => {
    expect(nativeQuitCopy(m, null)).toEqual({ title: m.menu_quit_confirm_title(), summary: m.menu_quit_confirm_unknown() })
  })

  it("words the list in Portuguese", () => {
    setLocale("pt-BR")
    expect(nativeQuitCopy(m, { imports: 1, indexes: 3, applies: [] })).toEqual({
      title: "Sair com 4 tarefas em execução?",
      summary: "Em execução: 1 importação e 3 indexações. Se você sair, as tarefas são interrompidas, e a próxima abertura oferece Tentar de novo.",
    })
  })
})
