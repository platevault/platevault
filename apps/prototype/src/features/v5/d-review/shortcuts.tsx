/**
 * Review shortcuts sheet (D-W14, D-W22, D-W40, D-W53, PIX-FR-13). Opened from
 * the review toolbar and by ? while a review is open; it links to the app's
 * full shortcuts sheet. The hotkeys act the same in the table, filmstrip and
 * grid, never fire while a field has focus, and follow the app's
 * single-key shortcuts setting (WCAG 2.1.4).
 */
import { useId } from "react"
import { useMessages } from "@/app/preferences"
import { MOD_LABEL } from "@/app/shortcuts"
import { openPanel } from "@/app/ui-state"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { HelpTip } from "@/components/app/tips"
import type { Messages } from "@/lib/i18n"
import { setReviewPrefs, useReviewPrefs } from "./prefs"

/** The key glyphs of Review's hotkeys, as the toolbar, menus and this sheet show them. Key names, not words: never translated. */
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
  shortcuts: "?",
} as const

function reviewShortcuts(m: Messages): Array<{ keys: string[][]; label: string }> {
  return [
    { keys: [["←"], ["→"]], label: m.review_key_prev_next() },
    { keys: [[REVIEW_KEY.previous], [REVIEW_KEY.next]], label: m.review_key_prev_next() },
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
  ]
}

export function ReviewShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const prefs = useReviewPrefs()
  const switchId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.review_shortcuts_title()}</DialogTitle>
          <DialogDescription>{m.review_shortcuts_description()}</DialogDescription>
        </DialogHeader>
        <div className="flex items-start justify-between gap-4 rounded-md border px-3 py-2.5">
          <div className="flex items-center gap-1">
            <Label htmlFor={switchId}>{m.review_auto_advance()}</Label>
            <HelpTip label={m.review_auto_advance_help()}>{m.review_auto_advance_tip()}</HelpTip>
          </div>
          <Switch id={switchId} checked={prefs.autoAdvance} onCheckedChange={(on) => setReviewPrefs({ autoAdvance: on })} />
        </div>
        <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
          {reviewShortcuts(m).map((s) => (
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
            {m.review_all_shortcuts()}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{m.review_done()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
