/**
 * Global keyboard map (foundation-owned). Shortcuts never fire while the
 * user types in a field, single-key shortcuts can be turned off (WCAG 2.1.4),
 * and every action stays reachable without them.
 *
 * - `useGlobalShortcuts`: the app's keys. ⌘↩ runs the Proceed of the step
 *   page on screen (plan §3.3 P11: the toolbar's Next became this shortcut),
 *   and ⌃1–⌃9 open that page's steps.
 * - `ShortcutsTable`: every shortcut in one DataTable, for Settings › Help
 *   and the `?` dialog. Other surfaces add their own group (`extra`).
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
import { ALL_NAV_ITEMS } from "./navigation"
import { getPreferences, setSingleKeyShortcuts, useMessages, usePreferences } from "./preferences"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
/** The modifier's key-cap legend, printed on the key and the same in every shipped locale. */
export const MOD_LABEL = isMac ? "⌘" : "Ctrl"
/** The command palette's chord, as printed on the keys. */
export const PALETTE_SHORTCUT = `${MOD_LABEL} K`
/** Proceed on the step page on screen, as printed on the keys. */
export const PROCEED_SHORTCUT = `${MOD_LABEL} ↩`

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox"
}

/** Whether a modal surface (a dialog, the palette, the walk) holds the keyboard: the page's shortcuts then wait. */
function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null
}

/**
 * The Proceed of the step page on screen: the last action of a StepFooter on
 * its current step (Skip comes before it). Null on any other page, on a step
 * that is not the current one, and once the flow is finished.
 */
export function proceedOnScreen(): HTMLElement | null {
  const footer = document.querySelector<HTMLElement>('#main [data-template="step"] [data-step-footer="current"]')
  return [...(footer?.querySelectorAll<HTMLElement>("[data-action]") ?? [])].at(-1) ?? null
}

/**
 * ⌘↩: runs Proceed as a click on it would. A Proceed whose gate is unmet is
 * focusable but disabled, so the shortcut moves focus to it instead and its
 * BlockersPreview names what is missing.
 */
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
      if (!getPreferences().singleKeyShortcuts) return
      if (goPending) {
        goPending = false
        window.clearTimeout(goTimer)
        const item = ALL_NAV_ITEMS.find((i) => i.goKey === event.key.toLowerCase())
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
        }, 1200)
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

/** One shortcut: what it does, and its chords as printed on the caps; a row with two chords takes either ("←" or "K"). */
export interface Shortcut {
  keys: string[][]
  label: string
}

/** A surface's own shortcuts (the review workspace), listed after the app's. */
export interface ShortcutGroup {
  id: string
  label: string
  rows: Shortcut[]
}

/** The app's shortcuts, in the chosen language. */
function appShortcuts(m: Messages): Shortcut[] {
  return [
    { keys: [[MOD_LABEL, "K"]], label: m.shortcuts_search() },
    { keys: [[MOD_LABEL, "↩"]], label: m.shortcuts_proceed() },
    { keys: [["⌃", "1–9"]], label: m.shortcuts_go_to_step() },
    { keys: [["?"]], label: m.shortcuts_show() },
    { keys: [["/"]], label: m.shortcuts_focus_search() },
    { keys: [["["]], label: m.shortcuts_toggle_sidebar() },
    { keys: [["⇧", "F10"]], label: m.shortcuts_context_menu() },
    ...ALL_NAV_ITEMS.map((item) => ({ keys: [["G", item.goKey === "," ? "," : item.goKey.toUpperCase()]], label: m.shortcuts_go_to({ name: item.label }) })),
    { keys: [["↑"], ["↓"]], label: m.shortcuts_move_rows() },
    { keys: [[m.key_home()], [m.key_end()]], label: m.shortcuts_first_last_row() },
    { keys: [[m.key_page_up()], [m.key_page_down()]], label: m.shortcuts_page_rows() },
    { keys: [["↩"]], label: m.shortcuts_open_row() },
    { keys: [[m.key_space()]], label: m.shortcuts_select_row() },
    { keys: [[m.key_escape()]], label: m.shortcuts_close() },
  ]
}

/** The key glyphs of Review's hotkeys, as the review toolbar, its menus and Help show them. Key names, not words: never translated. */
export const REVIEW_KEY = {
  next: "J",
  previous: "K",
  pick: "P",
  reject: "X",
  unreviewed: "U",
  zoom: "Z",
  fullscreen: "F",
  compare: "C",
  grid: "G",
  height: "T",
  inspector: "I",
  selectAll: "A",
  finish: "↵",
  shortcuts: "?",
} as const

/** The review workspace's shortcuts, for Settings › Help (`ShortcutsTable extra`). */
export function reviewShortcuts(m: Messages): ShortcutGroup {
  return {
    id: "review",
    label: m.review_shortcuts_title(),
    rows: [
      { keys: [["←"], ["→"], [REVIEW_KEY.previous], [REVIEW_KEY.next]], label: m.review_key_prev_next() },
      { keys: [[REVIEW_KEY.pick]], label: m.review_key_pick() },
      { keys: [[REVIEW_KEY.reject]], label: m.review_key_reject() },
      { keys: [[REVIEW_KEY.unreviewed]], label: m.status_unreviewed() },
      { keys: [["⇧", REVIEW_KEY.pick], ["⇧", REVIEW_KEY.reject]], label: m.review_key_mark_next() },
      { keys: [[REVIEW_KEY.zoom]], label: m.review_key_zoom() },
      { keys: [[REVIEW_KEY.fullscreen]], label: m.review_key_fullscreen() },
      { keys: [[REVIEW_KEY.compare]], label: m.review_compare() },
      { keys: [[MOD_LABEL, REVIEW_KEY.inspector]], label: m.review_corner_inspector() },
      { keys: [[REVIEW_KEY.inspector]], label: m.review_frame_inspector() },
      { keys: [[REVIEW_KEY.grid]], label: m.review_key_grid() },
      { keys: [[REVIEW_KEY.height]], label: m.review_table_height() },
      { keys: [["⌥", "1–4"]], label: m.review_key_filter() },
      { keys: [[MOD_LABEL, REVIEW_KEY.selectAll]], label: m.review_select_all_shown() },
      { keys: [[m.key_space()]], label: m.review_key_toggle_selection() },
      { keys: [[m.key_escape()]], label: m.review_key_escape() },
      { keys: [[REVIEW_KEY.shortcuts]], label: m.review_key_shortcuts() },
    ],
  }
}

interface ShortcutRow extends Shortcut {
  id: string
  group: string
}

/** Every shortcut in one table: the app's, then each `extra` group under its own heading. */
export function ShortcutsTable({ extra = [] }: { extra?: ShortcutGroup[] }) {
  const m = useMessages()
  const groups: ShortcutGroup[] = [{ id: "app", label: m.shortcuts_group_app(), rows: appShortcuts(m) }, ...extra]
  const rows: ShortcutRow[] = groups.flatMap((group) => group.rows.map((row, index) => ({ ...row, id: `${group.id}:${index}`, group: group.id })))
  const labels = new Map(groups.map((group) => [group.id, group.label]))
  const order = groups.map((group) => group.id)
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
  return (
    <DataTable
      label={m.shortcuts_title()}
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      scroll="none"
      groups={extra.length > 0 ? { key: (row) => row.group, label: (id) => labels.get(id) ?? id, compare: (a, b) => order.indexOf(a) - order.indexOf(b) } : undefined}
    />
  )
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
