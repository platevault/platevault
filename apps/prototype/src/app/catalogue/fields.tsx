/**
 * Catalogue entry: the Field family and the Settings kit
 * (components/app/fields.tsx, settings.tsx, folder-picker.tsx modes). Field
 * content uses catalogue copy; the section titles and captions are reviewer
 * notes. Every variant and the applicable states: default, filled, help,
 * error, disabled, read-only, empty, selected and the in-row layout.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ArgumentsField, ComboboxField, NumberField, PathField, SegmentedField, SelectField, SwitchField, type TemplateToken, TextField, TokenTemplateField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import { Button } from "@/components/ui/button"
import { NAMING_TOKENS } from "@/domain/templates"
import { say } from "@/lib/i18n"
import { ComponentSection } from "./specimen"

/** Typical values for the naming tokens (sample data, as in a library item). */
const EXAMPLES: Record<string, string> = {
  target: "M 31",
  filter: "Ha",
  date: "2026-10-11",
  frame_type: "light",
  train: "RedCat 51",
  camera: "ASI2600MM",
  exposure: "300s",
  gain: "100",
  offset: "50",
  binning: "1x1",
  set_temp: "-10C",
}

function Caption({ children }: { children: string }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function TextFields() {
  const m = useMessages()
  const [name, setName] = useState("Backyard")
  const [empty, setEmpty] = useState("")
  return (
    <ComponentSection components={["TextField"]} level={3}>
      <Caption>{m.catalogue_fields_text_caption()}</Caption>
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <TextField label={m.site_name()} value={name} onChange={setName} description={m.settings_default_named({ name: "Backyard" })} />
        <TextField label={m.site_name()} value={empty} onChange={setEmpty} required error={empty ? undefined : m.settings_name_required()} />
        <TextField label={m.settings_lookup_query()} value="NGC 7000" onChange={() => {}} readOnly />
        <TextField label={m.settings_lookup_query()} value="" onChange={() => {}} placeholder={m.target_find_placeholder()} disabled />
        <TextField label={m.settings_lookup_query()} value={name} onChange={setName} action={<Button variant="outline">{m.verb_add()}</Button>} />
      </div>
    </ComponentSection>
  )
}

function NumberAndChoiceFields() {
  const m = useMessages()
  const [exposure, setExposure] = useState<number | null>(300)
  const [gain, setGain] = useState<number | null>(null)
  const [filter, setFilter] = useState("ha")
  const [camera, setCamera] = useState<string | null>(null)
  const [kind, setKind] = useState<"mono" | "osc">("mono")
  const [mode, setMode] = useState<"symlink" | "copy">("symlink")
  // eslint-disable-next-line alm/no-user-string -- filter names
  const filters = [{ value: "ha", label: "Ha" }, { value: "oiii", label: "OIII" }, { value: "sii", label: "SII" }, { value: "l", label: "L", disabled: true }]
  return (
    <ComponentSection components={["NumberField", "SelectField", "ComboboxField", "SegmentedField"]} level={3}>
      <Caption>{m.catalogue_fields_choice_caption()}</Caption>
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <NumberField label={m.domain_criterion_exposure()} unit="s" min={0} step={1} value={exposure} onChange={setExposure} />
        <NumberField label={m.domain_criterion_gain()} value={gain} onChange={setGain} error={gain === null ? m.settings_name_required() : undefined} />
        <SelectField label={m.session_filter()} value={filter} options={filters} onChange={setFilter} />
        <SelectField label={m.session_filter()} value={filter} options={filters} onChange={setFilter} disabled />
        <ComboboxField
          label={m.session_camera()}
          value={camera}
          onChange={setCamera}
          placeholder={m.target_find_placeholder()}
          groups={[
            // eslint-disable-next-line alm/no-user-string -- camera model names
            { label: m.equipment_mono(), items: [{ value: "asi2600mm", label: "ASI2600MM Pro" }, { value: "asi1600mm", label: "ASI1600MM" }] },
            // eslint-disable-next-line alm/no-user-string -- camera model name
            { label: m.equipment_osc(), items: [{ value: "asi2600mc", label: "ASI2600MC Pro" }] },
          ]}
        />
        <SegmentedField
          label={m.equipment_camera()}
          value={kind}
          onChange={setKind}
          options={[
            { value: "mono", label: m.equipment_mono() },
            { value: "osc", label: m.equipment_osc_colour() },
          ]}
        />
        <SegmentedField
          label={m.run_check_mode()}
          value={mode}
          onChange={setMode}
          options={[
            { value: "symlink", label: m.domain_mode_symlink() },
            { value: "copy", label: m.domain_mode_copy(), disabled: true },
          ]}
        />
      </div>
      <Caption>{m.catalogue_fields_segmented_narrow()}</Caption>
      <div className="w-28 rounded-md border border-dashed p-2" data-specimen="segmented-narrow">
        <SegmentedField
          label={m.session_filter()}
          value={filter}
          onChange={setFilter}
          options={filters}
        />
      </div>
    </ComponentSection>
  )
}

function SwitchAndPathFields() {
  const m = useMessages()
  const [on, setOn] = useState(true)
  const [folder, setFolder] = useState<string | null>("/Volumes/Astro/Captures")
  const [file, setFile] = useState<string | null>(null)
  const [app, setApp] = useState<string | null>("/Applications/Siril.app")
  return (
    <ComponentSection components={["SwitchField", "PathField"]} level={3}>
      <Caption>{m.catalogue_fields_switch_caption()}</Caption>
      <div className="grid max-w-3xl grid-cols-2 gap-4">
        <SwitchField label={m.shortcuts_single_key()} checked={on} onChange={setOn} />
        <SwitchField label={m.shortcuts_single_key()} checked={false} onChange={() => {}} disabled />
        <PathField label={m.status_role_captures()} mode="folder" value={folder} onChange={setFolder} />
        <PathField label={m.run_profile_application()} mode="executable" value={app} onChange={setApp} />
        <PathField label={m.import_type_light()} mode="file" filters={[".fits", ".fit", ".xisf"]} initialPath="/Volumes/Astro/Captures" value={file} onChange={setFile} error={file ? undefined : m.settings_name_required()} />
        <PathField label={m.run_layout_output_folder()} mode="folder" value={folder} onChange={setFolder} disabled />
      </div>
    </ComponentSection>
  )
}

function TemplateFields() {
  const m = useMessages()
  const tokens: TemplateToken[] = NAMING_TOKENS.map((t) => ({ token: t.token, label: say(m, t.label), example: EXAMPLES[t.token] ?? t.fallback, fallback: t.fallback }))
  const [template, setTemplate] = useState("{target}/{filter}/{date}/light/")
  const [omit, setOmit] = useState<string[]>(["filter"])
  const [broken, setBroken] = useState("{target}/{night}/{filter")
  const [args, setArgs] = useState('-script="{file}" --dir {folder}')
  const [badArgs, setBadArgs] = useState("--open {project}")
  return (
    <ComponentSection components={["TokenTemplateField", "ArgumentsField"]} level={3}>
      <Caption>{m.catalogue_fields_template_caption()}</Caption>
      <div className="grid max-w-3xl gap-6">
        <TokenTemplateField label={m.naming_as_text()} value={template} onChange={setTemplate} tokens={tokens} omitWhenMissing={omit} onOmitWhenMissingChange={setOmit} prefix="/Volumes/Astro/Captures" description={m.settings_default_named({ name: "{target}/{filter}/{date}/light/" })} />
        <TokenTemplateField label={m.naming_as_text()} value={broken} onChange={setBroken} tokens={tokens} />
        <div className="grid grid-cols-2 gap-4">
          <ArgumentsField label={m.apps_launch_arguments()} value={args} onChange={setArgs} tokens={["folder", "file"]} />
          <ArgumentsField label={m.apps_launch_arguments()} value={badArgs} onChange={setBadArgs} tokens={["folder", "file"]} />
        </div>
      </div>
    </ComponentSection>
  )
}

function SettingsKit() {
  const m = useMessages()
  const [on, setOn] = useState(true)
  const [filter, setFilter] = useState("ha")
  const [folder, setFolder] = useState<string | null>("/Volumes/Astro/Captures")
  return (
    <div className="max-w-3xl">
      <SettingsSection title={m.settings_keyboard()} actions={<Button variant="outline">{m.settings_restore_defaults()}</Button>}>
        <SwitchField label={m.shortcuts_single_key()} checked={on} onChange={setOn} />
        <SelectField
          label={m.session_filter()}
          value={filter}
          onChange={setFilter}
          // eslint-disable-next-line alm/no-user-string -- filter names
          options={[{ value: "ha", label: "Ha" }, { value: "oiii", label: "OIII" }]}
        />
        <PathField label={m.status_role_captures()} mode="folder" value={folder} onChange={setFolder} />
        <SettingsRow label={m.about_first_run_setup()}>
          <Button variant="outline">{m.about_restart_setup()}</Button>
        </SettingsRow>
        <SettingsRow label={m.onboarding_walk_name()} help={m.settings_default_named({ name: m.shortcuts_single_key() })}>
          <Button variant="outline">{m.onboarding_restart_walk()}</Button>
        </SettingsRow>
      </SettingsSection>
    </div>
  )
}

export function FieldsCatalogue() {
  const m = useMessages()
  return (
    // eslint-disable-next-line alm/no-user-string -- the description names the source files
    <Section title={m.catalogue_fields_title()} description="components/app/fields.tsx · settings.tsx · folder-picker.tsx">
      <TextFields />
      <NumberAndChoiceFields />
      <SwitchAndPathFields />
      <TemplateFields />
      <ComponentSection components={["SettingsSection", "SettingsRow"]} level={3}>
        <Caption>{m.catalogue_fields_settings_caption()}</Caption>
        <SettingsKit />
      </ComponentSection>
    </Section>
  )
}
