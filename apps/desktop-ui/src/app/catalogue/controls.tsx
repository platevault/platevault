/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): the button roles and the
 * other pressable controls. Button variants, a disabled action beside its
 * reason, a busy action with its Spinner (full opacity, not clickable
 * twice), and ToggleGroup and Toggle for view settings. Every visible
 * string comes from the message catalogue.
 */
import { Sparkles } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export function ControlsCatalogue() {
  const m = useMessages()
  const [zoom, setZoom] = useState("fit")
  const [stretch, setStretch] = useState("auto")
  const [starsOn, setStarsOn] = useState(true)
  return (
    <Section title={m.ds_buttons_title()} description={m.ds_buttons_description()}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button>{m.setup_start_indexing()}</Button>
          <Button variant="outline">{m.location_choose_folder_again()}</Button>
          <Button variant="ghost">{m.selection_show()}</Button>
          <Button variant="destructive">{m.ds_send_files_to_trash({ count: 14 })}</Button>
          <Button variant="link">{m.ds_reveal_location()}</Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button disabled aria-describedby="ds-prepare-reason">
            {m.project_apply()}
          </Button>
          <p id="ds-prepare-reason" className="text-xs text-muted-foreground">
            {m.ds_prepare_disabled({ count: 2 })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* Loading is not disabled-looking: full opacity, busy, not clickable twice. */}
          <Button aria-busy="true" aria-disabled="true" className="pointer-events-none">
            <Spinner data-icon="inline-start" aria-hidden="true" />
            {m.status_saving()}
          </Button>
          <p className="text-xs text-muted-foreground">{m.ds_loading_vs_disabled()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup value={[zoom]} onValueChange={(value) => value[0] && setZoom(value[0])} variant="outline" size="sm" spacing={0} aria-label={m.review_zoom()}>
            <ToggleGroupItem value="fit">{m.review_zoom_fit()}</ToggleGroupItem>
            <ToggleGroupItem value="1">1:1</ToggleGroupItem>
            <ToggleGroupItem value="2">2:1</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup value={[stretch]} onValueChange={(value) => value[0] && setStretch(value[0])} variant="outline" size="sm" aria-label={m.review_display_stretch()}>
            <ToggleGroupItem value="linear">{m.review_stretch_linear()}</ToggleGroupItem>
            <ToggleGroupItem value="auto">{m.review_stretch_auto()}</ToggleGroupItem>
            <ToggleGroupItem value="strong">{m.review_stretch_strong()}</ToggleGroupItem>
          </ToggleGroup>
          <Toggle variant="outline" size="sm" pressed={starsOn} onPressedChange={setStarsOn}>
            <Sparkles aria-hidden="true" data-icon="inline-start" />
            {m.review_tab_stars()}
          </Toggle>
        </div>
      </div>
    </Section>
  )
}
