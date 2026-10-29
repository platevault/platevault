/**
 * The global keyboard map (shell-owned; spec 063 FR-037, FR-042). No
 * shortcut fires while the user types in a field, single-key shortcuts can
 * be turned off (WCAG 2.1.4), and every action stays reachable without them.
 *
 * - `useGlobalShortcuts`: ⌘K / Ctrl+K opens the palette in every state. With
 *   single-key shortcuts on, `G` then a page's key opens it, `[` toggles the
 *   sidebar, `?` opens the keyboard help and `/` focuses the page's search.
 *   ⌘↩ runs the Proceed of the step page on screen, and ⌃1–⌃9 open its steps.
 *   None but ⌘K acts while a modal surface (a dialog, the palette) is open.
 *   A go-to key works once its page's route is registered (navigation.ts).
 * - `ShortcutsTable`: every shortcut in one DataTable, for the `?` dialog and
 *   Settings › Help.
 * - `SingleKeyShortcutsField`: the WCAG 2.1.4 switch.
 */
import { useRouter } from "@tanstack/react-router"
import { useEffect } from "react"
import type { Column } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { SwitchField } from "@/components/app/fields"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import type { Messages } from "@/lib/i18n"
import { ALL_NAV_ITEMS, isRoutable, type NavItem, useRoutable } from "./navigation"
import { getPreferences, setSingleKeyShortcuts, useMessages, usePreferences } from "./preferences"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
/** The modifier's key-cap legend, printed on the key and the same in every shipped locale. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl"
/** The command palette's chord, as printed on the keys. */
export const PALETTE_SHORTCUT = `${MOD_LABEL} K`

/** How long the `G` of a go-to sequence waits for its second key. */
const GO_TO_WAIT_MS = 1200

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox"
}

/** Whether a modal surface (a dialog, the palette) holds the keyboard: the page's shortcuts then wait. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/**
 * The Proceed of the step page on screen: the last action of a StepFooter on
 * its current step (Skip comes before it). Null on any other page.
 */
function proceedOnScreen(): HTMLElement | null {
  const footer = document.querySelector<HTMLElement>('#main [data-template="step"] [data-step-footer="current"]')
  return [...(footer?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].at(-1) ?? null
}

/** ⌘↩ runs Proceed as a click would; a Proceed whose gate is unmet takes focus instead, so its blockers preview says what is missing. */
function runProceed(): boolean {
  const proceed = proceedOnScreen()
  if (!proceed) return false
  proceed.focus()
  if (!proceed.matches(":disabled, [aria-disabled='true'], [data-disabled]")) proceed.click()
  return true
}

/** ⌃n: the n-th step of the step page on screen. */
function openStep(n: number): boolean {
  const step = document.querySelectorAll<HTMLElement>('#main [data-template="step"] [data-step-strip] [data-step]')[n - 1]
  if (!step || (step.tagName !== "A" && step.tagName !== "BUTTON")) return false
  step.click()
  return true
}

/** The source-list row a `G` sequence's second key opens, if its page is registered. */
function goToTarget(key: string, routesByPath: Record<string, unknown>): NavItem | undefined {
  return ALL_NAV_ITEMS.find((item) => item.goKey === key.toLowerCase() && isRoutable(routesByPath, item.to))
}

/** Installs the global shortcuts. Mount once, in the root layout. */
export function useGlobalShortcuts() {
  const router = useRouter()
  useEffect(() => {
    let goPending = false
    let goTimer: number | undefined
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        openPanel("palette")
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        if (!modalOpen() && runProceed()) event.preventDefault()
        return
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey && /^[1-9]$/.test(event.key)) {
        if (!modalOpen() && openStep(Number(event.key))) event.preventDefault()
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return
      // A dialog, menu or the palette holds the keyboard: the page's single keys wait, as ⌘↩ does.
      if (!getPreferences().singleKeyShortcuts || modalOpen()) return
      if (goPending) {
        goPending = false
        window.clearTimeout(goTimer)
        const item = goToTarget(event.key, router.routesByPath)
        if (item) {
          event.preventDefault()
          router.history.push(item.to)
        }
        return
      }
      if (event.key === "g") {
        goPending = true
        goTimer = window.setTimeout(() => {
          goPending = false
        }, GO_TO_WAIT_MS)
        return
      }
      if (event.key === "?") {
        event.preventDefault()
        openPanel("shortcuts")
        return
      }
      if (event.key === "[") {
        event.preventDefault()
        toggleSidebar()
        return
      }
      if (event.key === "/") {
        const search = document.querySelector<HTMLElement>("[data-page-search]")
        if (search) {
          event.preventDefault()
          search.focus()
        }
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.clearTimeout(goTimer)
    }
  }, [router])
}

/** One shortcut: what it does, and its chords as printed on the caps; a row with two chords takes either. */
export interface Shortcut {
  keys: string[][]
  label: string
}

/** The app's shortcuts in the chosen language; a go-to key is listed once its page is registered. */
function appShortcuts(m: Messages, routable: (to: string) => boolean): Shortcut[] {
  return [
    { keys: [[MOD_LABEL, "K"]], label: m.shortcuts_search() },
    { keys: [[MOD_LABEL, "↩"]], label: m.shortcuts_proceed() },
    { keys: [["⌃", "1-9"]], label: m.shortcuts_go_to_step() },
    { keys: [["?"]], label: m.shortcuts_show() },
    { keys: [["/"]], label: m.shortcuts_focus_search() },
    { keys: [["["]], label: m.shortcuts_toggle_sidebar() },
    { keys: [["⇧", "F10"]], label: m.shortcuts_context_menu() },
    ...ALL_NAV_ITEMS.filter((item) => routable(item.to)).map((item) => ({ keys: [["G", item.goKey.toUpperCase()]], label: m.shortcuts_go_to({ name: item.label }) })),
    { keys: [["↑"], ["↓"]], label: m.shortcuts_move_rows() },
    { keys: [[m.key_home()], [m.key_end()]], label: m.shortcuts_first_last_row() },
    { keys: [[m.key_page_up()], [m.key_page_down()]], label: m.shortcuts_page_rows() },
    { keys: [["↩"]], label: m.shortcuts_open_row() },
    { keys: [[m.key_space()]], label: m.shortcuts_select_row() },
    { keys: [[m.key_escape()]], label: m.shortcuts_close() },
  ]
}

interface ShortcutRow extends Shortcut {
  id: string
}

/** Every app shortcut in one table. */
export function ShortcutsTable() {
  const m = useMessages()
  const routable = useRoutable()
  const rows: ShortcutRow[] = appShortcuts(m, routable).map((row, index) => ({ ...row, id: `app:${index}` }))
  const columns: Column<ShortcutRow>[] = [
    { id: "action", header: m.shortcuts_col_action(), rowHeader: true, sortValue: (row) => row.label, cell: (row) => row.label },
    {
      id: "keys",
      header: m.shortcuts_col_keys(),
      static: true,
      cell: (row) => (
        <KbdGroup>
          {row.keys.flatMap((chord, index) => [index > 0 ? "/" : null, ...chord.map((key) => <Kbd key={`${index}:${key}`}>{key}</Kbd>)])}
        </KbdGroup>
      ),
    },
  ]
  return <DataTable label={m.shortcuts_title()} rows={rows} columns={columns} getRowId={(row) => row.id} scroll="none" />
}

/** Single-key shortcuts on or off (WCAG 2.1.4); ⌘K and Escape stay on. */
export function SingleKeyShortcutsField() {
  const m = useMessages()
  const { singleKeyShortcuts } = usePreferences()
  return (
    <SwitchField
      label={m.shortcuts_single_key()}
      description={m.shortcuts_single_key_hint({ mod: MOD_LABEL, escape: m.key_escape() })}
      checked={singleKeyShortcuts}
      onChange={(value) => setSingleKeyShortcuts(value)}
    />
  )
}

/** The `?` dialog: the switch and the table Settings › Help shows. */
export function ShortcutsDialog() {
  const m = useMessages()
  const { panel } = useShellUi()
  return (
    <Dialog open={panel === "shortcuts"} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{m.shortcuts_title()}</DialogTitle>
        </DialogHeader>
        <SingleKeyShortcutsField />
        <ShortcutsTable />
      </DialogContent>
    </Dialog>
  )
}
