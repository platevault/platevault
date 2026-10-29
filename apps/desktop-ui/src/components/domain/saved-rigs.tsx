/**
 * What a rig picker shows when the library holds no saved rig: there is
 * nothing to pick, so it says where rigs are added. Settings › Equipment is
 * a link once that route is registered, and plain text until then, so the
 * line never points at a page that is not there.
 */
import { useMessages } from "@/app/preferences"
import { useRoutable } from "@/app/navigation"
import { PlaceLink } from "@/components/app/previews"

const EQUIPMENT_SETTINGS = "/settings/equipment"

/** Inline, so it can stand as a field's empty line (`ChoiceListField` `empty`) or alone in a section. */
export function NoSavedRigs() {
  const m = useMessages()
  const routable = useRoutable()
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1 text-sm text-muted-foreground">
      <span>{m.rigs_none_saved()}</span>
      {routable(EQUIPMENT_SETTINGS) ? <PlaceLink link={{ to: EQUIPMENT_SETTINGS }}>{m.rigs_add_in_settings()}</PlaceLink> : <span>{m.rigs_add_in_settings()}</span>}
    </span>
  )
}
