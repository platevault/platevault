/**
 * Global keyboard map (foundation-owned). Shortcuts never fire while the
 * user types in a field, single-key shortcuts can be turned off (WCAG 2.1.4),
 * and every action stays reachable without them.
 */
import { useRouter } from "@tanstack/react-router"
import { useEffect, useId } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ALL_NAV_ITEMS } from "./navigation"
import { getPreferences, setSingleKeyShortcuts, usePreferences } from "./preferences"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD_LABEL = isMac ? "⌘" : "Ctrl"

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.getAttribute("role") === "combobox"
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

export const SHORTCUTS: Array<{ keys: string[]; label: string }> = [
  { keys: [MOD_LABEL, "K"], label: "Search or jump to anything" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["/"], label: "Focus the page search or filter" },
  { keys: ["["], label: "Collapse or expand the sidebar" },
  ...ALL_NAV_ITEMS.map((item) => ({ keys: ["G", item.goKey === "," ? "," : item.goKey.toUpperCase()], label: `Go to ${item.label}` })),
  { keys: ["↑", "↓"], label: "Move between table rows" },
  { keys: ["Space"], label: "Toggle the focused checkbox" },
  { keys: ["Esc"], label: "Close a dialog, menu or panel" },
]

export function ShortcutsDialog() {
  const { panel } = useShellUi()
  const { singleKeyShortcuts } = usePreferences()
  const switchId = useId()
  return (
    <Dialog open={panel === "shortcuts"} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts are off while you type in a field.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor={switchId}>Single-key shortcuts</Label>
            <p className="text-xs text-muted-foreground text-pretty">
              ?, /, [ and G sequences. Turn off if you use speech input or press keys by accident; {MOD_LABEL}K and Esc stay on.
            </p>
          </div>
          <Switch id={switchId} checked={singleKeyShortcuts} onCheckedChange={(value) => setSingleKeyShortcuts(value)} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.label} className="contents">
              <dt>{shortcut.label}</dt>
              <dd>
                <KbdGroup>
                  {shortcut.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}
