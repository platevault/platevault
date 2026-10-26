/**
 * Catalogue entry (§3.3 P14, §8.3): the command palette with a go-to group,
 * an available action and an unavailable one, and its two triggers.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { CommandPalette, type PaletteGroup, PaletteTrigger } from "@/components/app/palette"
import { PALETTE_SHORTCUT } from "./fixtures/keys"
import { ComponentSection, Specimen } from "./specimen"

export function PaletteCatalogue() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const groups: PaletteGroup[] = [
    { value: "go-to", label: m.palette_group_go_to(), items: [{ id: "nav:/", label: m.nav_home(), group: m.palette_group_go_to(), to: "/" }] },
    {
      value: "actions",
      label: m.palette_group_actions(),
      items: [
        { id: "act:shortcuts", label: m.shortcuts_show(), group: m.palette_group_actions(), shortcut: "?", run: () => undefined },
        { id: "act:blocked", label: m.newproject_open_ellipsis(), group: m.palette_group_actions(), unavailable: m.onboarding_check_project() },
      ],
    },
  ]
  return (
    <ComponentSection components={["CommandPalette", "PaletteTrigger"]} description={m.catalogue_palette_desc()}>
      <Specimen caption={m.catalogue_frame_wide()}>
        <PaletteTrigger label={m.shell_search_or_jump_ellipsis()} shortcut={PALETTE_SHORTCUT} onOpen={() => setOpen(true)} />
      </Specimen>
      <Specimen caption={m.catalogue_frame_narrow()}>
        <PaletteTrigger compact label={m.shell_search_or_jump_ellipsis()} shortcut={PALETTE_SHORTCUT} onOpen={() => setOpen(true)} />
      </Specimen>
      <CommandPalette open={open} onOpenChange={setOpen} groups={groups} onRun={() => setOpen(false)} />
    </ComponentSection>
  )
}
