/**
 * Settings › Equipment › Edit filters… (PLAN-EQ-FR-01, PLAN-EQ-FR-02): a
 * rig's filter list, saved whole over the list's revision
 * (`rig_filters_save`). Each filter has a name, the FITS FILTER values it
 * matches (comma-separated) and the bands it passes, at least one.
 *
 * The dialog reads the rig from the current read on every render, so a Save
 * after `conflict` names the revision read again and the user's edits stay;
 * any refusal keeps the dialog and the draft (PLAN-EQ-FR-06). The library
 * checks the rest, such as a FILTER value two filters both match, and its
 * refusal shows in the dialog.
 */
import { useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { type Band, library, type Rig, type RigFilterInput } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton, IconButton } from "@/components/app/actions"
import { Box } from "@/components/app/box"
import { ChoiceListField, FieldGroup, TextField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { settingsWrite } from "./queries"

/** Every band, in `Band` order: the order the library keeps a filter's bands in. */
const BANDS: readonly Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]

interface FilterDraft {
  /** Stable while the dialog is open: the filter's id, or `new-{n}` for one added here. */
  key: string
  id: string | null
  name: string
  /** As typed: comma-separated FILTER values. */
  matchValues: string
  bands: Band[]
  /** False for a filter just added and not yet changed, so it opens without messages. */
  edited: boolean
}

interface FiltersDraft {
  filters: FilterDraft[]
  /** The next `new-{n}` key. */
  next: number
}

function draftOf(rig: Rig): FiltersDraft {
  return {
    filters: rig.filters.filters.map((f) => ({ key: f.id, id: f.id, name: f.name, matchValues: f.matchValues.join(", "), bands: [...f.bands], edited: true })),
    next: 1,
  }
}

function inputOf(draft: FilterDraft): RigFilterInput {
  return {
    id: draft.id,
    name: draft.name.trim(),
    matchValues: draft.matchValues
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    bands: draft.bands,
  }
}

export function RigFiltersDialog({ rig, open, onOpenChange }: { rig: Rig; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set } = useDialogForm<FiltersDraft>(open, () => draftOf(rig))
  const label = m.settings_save()
  const fieldErrors = (draft: FilterDraft) => ({
    name: draft.name.trim() ? undefined : m.settings_name_required(),
    bands: draft.bands.length > 0 ? undefined : m.equipment_pick_band(),
  })
  const errors: FieldErrors<string> = Object.fromEntries(values.filters.flatMap((draft) => Object.entries(fieldErrors(draft)).map(([field, message]) => [`${draft.key}-${field}`, message])))
  const edit = (key: string, patch: Partial<FilterDraft>) => set({ filters: values.filters.map((f) => (f.key === key ? { ...f, ...patch, edited: true } : f)) })
  const add = () => set({ filters: [...values.filters, { key: `new-${values.next}`, id: null, name: "", matchValues: "", bands: [], edited: false }], next: values.next + 1 })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.equipment_filters_title({ name: rig.equipment.name })}
      confirm={{
        id: "save-rig-filters",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => settingsWrite(client, () => library.rigFiltersSave(rig.equipment.id, values.filters.map(inputOf), rig.filters.revision)),
      }}
    >
      <Box title={m.equipment_filters()} count={values.filters.length} actions={<ActionButton action={{ id: "add-filter", label: m.equipment_add_filter(), icon: Plus, run: add }} />}>
        {values.filters.length === 0
          ? m.tonight_no_filters()
          : values.filters.map((draft, index) => {
              const n = String(index + 1)
              const shown: FieldErrors<"name" | "bands"> = draft.edited ? fieldErrors(draft) : {}
              return (
                <FieldGroup
                  key={draft.key}
                  label={m.equipment_filter_numbered({ n })}
                  action={<IconButton label={m.equipment_remove_filter({ n })} icon={X} onClick={() => set({ filters: values.filters.filter((f) => f.key !== draft.key) })} />}
                >
                  <TextField label={m.equipment_name()} value={draft.name} onChange={(name) => edit(draft.key, { name })} error={shown.name} />
                  <TextField label={m.equipment_matches_filter()} description={m.equipment_comma_separated()} value={draft.matchValues} onChange={(matchValues) => edit(draft.key, { matchValues })} />
                  <ChoiceListField<Band> label={m.equipment_bands()} value={draft.bands} options={BANDS.map((band) => ({ value: band, label: band }))} onChange={(bands) => edit(draft.key, { bands })} error={shown.bands} />
                </FieldGroup>
              )
            })}
      </Box>
    </FormDialog>
  )
}
