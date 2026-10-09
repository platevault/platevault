/**
 * Review shortcuts sheet (D-W14, D-W22, D-W40, D-W53, PIX-FR-13). Opened from
 * the review toolbar and by ? while a review is open; it links to the app's
 * full shortcuts sheet. The hotkeys act the same in the table, filmstrip and
 * grid, never fire while a field has focus, and follow the app's
 * single-key shortcuts setting (WCAG 2.1.4).
 */
import { useId } from "react"
import { MOD_LABEL } from "@/app/shortcuts"
import { openPanel } from "@/app/ui-state"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { HelpTip } from "@/components/app/tips"
import { setReviewPrefs, useReviewPrefs } from "./prefs"

export const REVIEW_SHORTCUTS: Array<{ keys: string[][]; label: string }> = [
  { keys: [["←"], ["→"]], label: "Previous or next frame" },
  { keys: [["K"], ["J"]], label: "Previous or next frame" },
  { keys: [["P"]], label: "Pick" },
  { keys: [["X"]], label: "Reject" },
  { keys: [["U"]], label: "Unreviewed" },
  { keys: [["⇧", "P"], ["⇧", "X"]], label: "Mark and go to next" },
  { keys: [["Z"]], label: "Zoom: Fit or 1:1" },
  { keys: [["F"]], label: "Fullscreen" },
  { keys: [["C"]], label: "Compare" },
  { keys: [[MOD_LABEL, "I"]], label: "Corner inspector" },
  { keys: [["I"]], label: "Frame inspector" },
  { keys: [["G"]], label: "Grid, or back" },
  { keys: [["T"]], label: "Table height" },
  { keys: [["⌥", "1–4"]], label: "Filter: All, Picked, Rejected, Unreviewed" },
  { keys: [[MOD_LABEL, "A"]], label: "Select all shown" },
  { keys: [["Space"]], label: "Toggle selection" },
  { keys: [["Esc"]], label: "Leave fullscreen, then clear selection" },
  { keys: [["?"]], label: "Shortcuts" },
]

export function ReviewShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const prefs = useReviewPrefs()
  const switchId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review shortcuts</DialogTitle>
          <DialogDescription>Table, filmstrip and grid. A mark applies to the whole selection.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={switchId}>Auto-advance</Label>
            <HelpTip label="Auto-advance help">After P, X or U, the next frame becomes current.</HelpTip>
          </div>
          <Switch id={switchId} checked={prefs.autoAdvance} onCheckedChange={(on) => setReviewPrefs({ autoAdvance: on })} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          {REVIEW_SHORTCUTS.map((s) => (
            <div key={`${s.label}-${s.keys.flat().join("")}`} className="contents">
              <dt className="text-pretty">{s.label}</dt>
              <dd className="flex items-center gap-1.5">
                {s.keys.map((combo) => (
                  <KbdGroup key={combo.join("")}>
                    {combo.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </KbdGroup>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false)
              openPanel("shortcuts")
            }}
          >
            All app shortcuts
          </Button>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
