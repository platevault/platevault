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
import { setReviewPrefs, useReviewPrefs } from "./prefs"

export const REVIEW_SHORTCUTS: Array<{ keys: string[][]; label: string }> = [
  { keys: [["←"], ["→"]], label: "Previous or next frame" },
  { keys: [["K"], ["J"]], label: "Previous or next frame" },
  { keys: [["P"]], label: "Mark Picked (library Usable)" },
  { keys: [["X"]], label: "Mark Rejected (library Unusable); in a run, removes it from the draft" },
  { keys: [["U"]], label: "Mark Unreviewed" },
  { keys: [["⇧", "P"], ["⇧", "X"]], label: "Mark and go to the next frame, even with auto-advance off" },
  { keys: [["Z"]], label: "Zoom: Fit or 1:1" },
  { keys: [["F"]], label: "Fullscreen preview (Esc leaves it)" },
  { keys: [["C"]], label: "Compare with a reference frame" },
  { keys: [["G"]], label: "Grid, or back to the previous view" },
  { keys: [["T"]], label: "Table height: about 8 rows, one-line strip, full height" },
  { keys: [["⌥", "1–4"]], label: "Filter: All, Picked, Rejected, Unreviewed" },
  { keys: [[MOD_LABEL, "A"]], label: "Select every frame in the filtered list" },
  { keys: [["Space"]], label: "Add or remove the current frame from the selection" },
  { keys: [["Esc"]], label: "Leave fullscreen, then clear the selection" },
  { keys: [["?"]], label: "Show these shortcuts" },
]

export function ReviewShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const prefs = useReviewPrefs()
  const switchId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review shortcuts</DialogTitle>
          <DialogDescription>The same keys work in the table, filmstrip and grid. A mark applies to every selected frame when more than one is selected. While Review is open, G opens the grid instead of starting a G go-to sequence.</DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="space-y-0.5">
            <Label htmlFor={switchId}>Auto-advance</Label>
            <p className="text-xs text-pretty text-muted-foreground">After P, X or U on one frame, the next frame in list order becomes current. On by default.</p>
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
