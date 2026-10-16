/**
 * S16 Settings › Naming (slice E; D-W20, STO-IMP-FR-07, STO-IMP-AC-08,
 * P-CAL3; plan §4a, C N1-N3, wmbp9). One folder template per frame type,
 * used by Import and Archive; the master types are the structured
 * calibration storage layout (flats per train, filter and night; darks and
 * dark flats per camera, exposure, gain/offset and temperature; bias per
 * camera and gain/offset). Each type is a text template on its own row with
 * a live preview: the path for a real library item of that type when the
 * library holds one, and the path with every value missing. The Tokens table
 * below lists what a template may use and what each writes when its value
 * is missing. A type without an override uses its default. Templates are
 * checked as typed against the whitelisted tokens and separators
 * (`validateNamingTemplate`), each problem a field error; Save writes the
 * changed ones, and an invalid one is refused inline with nothing saved.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionBar } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { useSaveState } from "@/components/app/feedback"
import { type TemplateToken, type TemplateValues, TokenTemplateField, useTokenColumns } from "@/components/app/fields"
import { SettingsSection } from "@/components/app/settings"
import { ListSection, SettingsPage } from "@/components/templates/settings-page"
import { newestVersion } from "@/domain/calibration"
import { rigName, sessionNamingValues } from "@/domain/derive"
import { DEFAULT_NAMING, NAMING_TOKENS, type NamingValues, namingTemplate, namingValues, resolveNamingTemplate, validateNamingTemplate } from "@/domain/templates"
import type { Catalog, NamingFrameType, NamingToken } from "@/domain/types"
import { fileName, formatNight } from "@/lib/format"
import { type Messages, m, say } from "@/lib/i18n"
import { setNamingOmit, setNamingTemplate } from "@/store/actions/settings"
import { type CommitResult, useStore } from "@/store/core"
import { versionNight } from "./calibration-model"

/** `label` is a catalogue message, worded at render. */
const TYPES: Array<{ type: NamingFrameType; label: () => string; role: "captures" | "calibration" }> = [
  { type: "light", label: m.naming_type_lights, role: "captures" },
  { type: "flat", label: m.naming_type_flats, role: "calibration" },
  { type: "dark", label: m.naming_type_darks, role: "calibration" },
  { type: "bias", label: m.naming_type_bias, role: "calibration" },
  { type: "master-flat", label: m.calibration_caption_flats, role: "calibration" },
  { type: "master-dark", label: m.calibration_caption_darks, role: "calibration" },
  { type: "master-bias", label: m.calibration_caption_bias, role: "calibration" },
  { type: "master-dark-flat", label: m.calibration_caption_dark_flats, role: "calibration" },
]

/** A typical light frame's metadata: the Tokens table's Example column, formatted as every consumer formats it. */
const EXAMPLE = namingValues({
  target: "M 31",
  filter: "Ha",
  night: "2026-10-04",
  frameType: "light",
  camera: "ASI2600MM Pro",
  exposureS: 300,
  gain: 100,
  offset: 50,
  binning: 1,
  ccdTempC: -10,
  train: "RedCat 51",
})

/** Metadata of a real library item of this type, when the library holds one. */
function sampleValues(messages: Messages, catalog: Catalog, type: NamingFrameType): { values: NamingValues; from: string } | null {
  if (type.startsWith("master-")) {
    const kind = type.slice("master-".length)
    const master = Object.values(catalog.masters).find((x) => x.kind === kind)
    const version = master ? newestVersion(master) : undefined
    if (!master || !version) return null
    return {
      from: fileName(version.path),
      values: namingValues({
        target: null,
        filter: master.channel,
        night: versionNight(catalog, version),
        frameType: type,
        camera: master.cameraName,
        exposureS: master.exposureS,
        gain: master.gain,
        offset: master.offset,
        binning: master.binning,
        ccdTempC: master.ccdTempC,
        train: master.opticalTrainId ? rigName(messages, catalog, master.opticalTrainId) : null,
      }),
    }
  }
  const session = Object.values(catalog.sessions).find((s) => s.imageType === type && !s.supersededBy)
  if (!session) return null
  const night = formatNight(session.night)
  return { from: session.channel ? `${night} · ${session.channel}` : night, values: sessionNamingValues(catalog, session, type) }
}

/** The domain's resolution (sanitised values, the token's fallback or nothing once omitted), so the preview reads as Import and Archive will write it. */
const resolve = (template: string, values: TemplateValues, omit: readonly string[]) => resolveNamingTemplate(template, values as NamingValues, omit as readonly NamingToken[]).path

/** Domain errors TokenTemplateField reports itself from the same token whitelist, so the page passes on only the rest. */
const FIELD_OWN_ERRORS = new Set<string>(["domain_naming_unknown_token", "domain_naming_unmatched_brace"])

export function NamingSettingsPage() {
  const messages = useMessages()
  const catalog = useStore((s) => s.catalog)
  const overrides = useStore((s) => s.settings.naming)
  const omit = useStore((s) => s.settings.namingOmit)
  const [drafts, setDrafts] = useState<Partial<Record<NamingFrameType, string>>>({})
  const { save, indicator } = useSaveState()
  // The Omit choice applies to every template at once and saves as it is ticked; the same save state reports it.
  const tokenColumns = useTokenColumns({ omitWhenMissing: omit, onOmitWhenMissingChange: (tokens) => void save(() => setNamingOmit(tokens as NamingToken[])) })

  const tokens: TemplateToken[] = NAMING_TOKENS.map((t) => ({ token: t.token, label: say(messages, t.label), example: EXAMPLE[t.token] ?? t.fallback, fallback: t.fallback }))
  const saved = (type: NamingFrameType) => namingTemplate(overrides, type)
  const text = (type: NamingFrameType) => drafts[type] ?? saved(type)
  /** The domain's checks the field does not make itself: refused characters, `..`, reserved names and a leading `/` (the field names unknown tokens and an unmatched brace). */
  const domainErrors = (type: NamingFrameType) =>
    validateNamingTemplate(text(type))
      .filter((ref) => !("key" in ref && FIELD_OWN_ERRORS.has(ref.key)))
      .map((ref) => say(messages, ref))
  const invalid = (type: NamingFrameType) => validateNamingTemplate(text(type)).length > 0
  const changed = TYPES.filter((t) => text(t.type) !== saved(t.type))
  const refused = changed.filter((t) => invalid(t.type))
  const atDefaults = TYPES.every((t) => text(t.type) === DEFAULT_NAMING[t.type])

  function saveChanged(): CommitResult | void {
    let failure: CommitResult | undefined
    const left: Partial<Record<NamingFrameType, string>> = {}
    for (const { type } of changed) {
      const template = text(type)
      const result = setNamingTemplate(type, template === DEFAULT_NAMING[type] ? null : template)
      if (!result.ok) {
        failure ??= result
        left[type] = template
      }
    }
    setDrafts(left)
    return failure
  }

  const saveLabel = messages.settings_save()
  const noChanges = (action: string) => ({ action: messages.actions_blocked({ action }), reason: messages.naming_no_changes(), blockers: [] })
  const actions: Action[] = [
    {
      id: "naming-defaults",
      label: messages.settings_restore_defaults(),
      unavailable: atDefaults ? { action: messages.actions_blocked({ action: messages.settings_restore_defaults() }), reason: messages.settings_at_defaults(), blockers: [] } : undefined,
      run: () => setDrafts(Object.fromEntries(TYPES.map((t) => [t.type, DEFAULT_NAMING[t.type]]))),
    },
    { id: "naming-discard", label: messages.naming_discard(), unavailable: changed.length === 0 ? noChanges(messages.naming_discard()) : undefined, run: () => setDrafts({}) },
    {
      id: "naming-save",
      label: saveLabel,
      kind: "primary",
      unavailable:
        changed.length === 0
          ? noChanges(saveLabel)
          : refused.length > 0
            ? { action: messages.actions_blocked({ action: saveLabel }), reason: messages.refusal_blockers({ count: refused.length }), blockers: refused.map((t) => ({ label: t.label() })) }
            : undefined,
      // The section's save state reports the outcome, Retry included, so the button reports nothing of its own.
      run: () => {
        save(saveChanged)
      },
    },
  ]

  return (
    <SettingsPage title={messages.settings_naming()}>
      <SettingsSection
        title={messages.naming_folder_templates()}
        actions={
          <>
            {indicator}
            <ActionBar actions={actions} />
          </>
        }
      >
        {TYPES.map((t) => {
          const sample = sampleValues(messages, catalog, t.type)
          const root = Object.values(catalog.locations).find((l) => l.role === t.role)?.path
          return (
            <TokenTemplateField
              key={t.type}
              label={t.label()}
              value={text(t.type)}
              onChange={(next) => setDrafts((current) => ({ ...current, [t.type]: next }))}
              tokens={tokens}
              resolve={resolve}
              prefix={root}
              sample={sample ? { label: messages.naming_preview_library({ from: sample.from }), values: sample.values } : undefined}
              description={text(t.type) === DEFAULT_NAMING[t.type] ? undefined : messages.settings_default_named({ name: DEFAULT_NAMING[t.type] })}
              error={domainErrors(t.type)}
              omitWhenMissing={omit}
              showTokens={false}
            />
          )
        })}
      </SettingsSection>
      <ListSection<TemplateToken> title={messages.fields_tokens()} table={{ label: messages.fields_tokens(), rows: tokens, columns: tokenColumns, getRowId: (t) => t.token }} />
    </SettingsPage>
  )
}
