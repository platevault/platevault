/**
 * S16 Settings › Naming (slice E; D-W20, STO-IMP-FR-07, STO-IMP-AC-08,
 * P-CAL3). One folder template per frame type, used by Import and Archive;
 * the master types are the structured calibration storage layout (flats per
 * train, filter and night; darks and dark flats per camera, exposure,
 * gain/offset and temperature; bias per camera and gain/offset). Every token
 * has a fallback; a type without an override uses its default. The chip
 * editor and the text field edit the same template; the live preview
 * resolves it against a real library item of that type and against missing
 * metadata, naming every fallback it used. Invalid templates are refused
 * inline and nothing is saved.
 */
import { ArrowLeft, ArrowRight, Plus, RotateCcw, X } from "lucide-react"
import { type KeyboardEvent, useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { rigName, sessionNamingValues } from "@/domain/derive"
import { DEFAULT_NAMING, NAMING_TOKENS, type NamingValues, namingTemplate, namingValues, resolveNamingTemplate, validateNamingTemplate } from "@/domain/templates"
import type { Catalog, NamingFrameType, NamingToken } from "@/domain/types"
import { TextField } from "@/features/t1/components/form-field"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { setNamingTemplate } from "@/store/actions/settings"
import { useStore } from "@/store/core"
import { masterNight } from "./calibration-model"

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

type Chip = { kind: "token"; token: NamingToken } | { kind: "sep" } | { kind: "text"; value: string }

const KNOWN = new Set(NAMING_TOKENS.map((t) => t.token as string))

/** Template text → chips. Unknown `{x}` stays literal text so validation still names it. */
function toChips(template: string): Chip[] {
  const chips: Chip[] = []
  for (const part of template.split(/(\{[^}]*\}|\/)/)) {
    if (!part) continue
    if (part === "/") chips.push({ kind: "sep" })
    else if (/^\{[^}]*\}$/.test(part) && KNOWN.has(part.slice(1, -1))) chips.push({ kind: "token", token: part.slice(1, -1) as NamingToken })
    else chips.push({ kind: "text", value: part })
  }
  return chips
}

function fromChips(chips: Chip[]): string {
  return chips.map((c) => (c.kind === "sep" ? "/" : c.kind === "token" ? `{${c.token}}` : c.value)).join("")
}

const tokenLabel = (token: NamingToken) => NAMING_TOKENS.find((t) => t.token === token)!.label

/** Metadata of a real library item of this type, when the library holds one. */
function sampleValues(catalog: Catalog, type: NamingFrameType): { values: NamingValues; from: string } | null {
  if (type.startsWith("master-")) {
    const kind = type.slice("master-".length)
    const master = Object.values(catalog.masters).find((m) => m.kind === kind)
    if (!master) return null
    return {
      from: master.path.split("/").pop() ?? "master",
      values: namingValues({
        target: null,
        filter: master.channel,
        night: masterNight(catalog, master),
        frameType: type,
        camera: master.cameraName,
        exposureS: master.exposureS,
        gain: master.gain,
        offset: master.offset,
        binning: master.binning,
        ccdTempC: master.ccdTempC,
        train: master.opticalTrainId ? rigName(catalog, master.opticalTrainId) : null,
      }),
    }
  }
  const session = Object.values(catalog.sessions).find((s) => s.imageType === type && !s.supersededBy)
  if (!session) return null
  return { from: `${session.night}${session.channel ? ` · ${session.channel}` : ""}`, values: sessionNamingValues(catalog, session, type) }
}

function Preview({ label, root, template, values }: { label: string; root: string; template: string; values: NamingValues }) {
  const m = useMessages()
  const { path, fallbacks } = resolveNamingTemplate(template, values)
  return (
    <div className="space-y-1">
      <div className="text-[0.75rem] text-muted-foreground">{label}</div>
      <div className="font-mono text-xs [overflow-wrap:anywhere]">
        <span className="text-muted-foreground">{root}/</span>
        {path}
      </div>
      <div className="flex flex-wrap gap-1" aria-label={m.naming_fallbacks()}>
        {fallbacks.length === 0 ? (
          <Pill tone="success">{m.naming_no_fallbacks()}</Pill>
        ) : (
          fallbacks.map((t) => (
            <Pill key={t} tone="warning">
              {`{${t}} → ${NAMING_TOKENS.find((x) => x.token === t)!.fallback}`}
            </Pill>
          ))
        )}
      </div>
    </div>
  )
}

function Editor({ type }: { type: (typeof TYPES)[number] }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const overrides = useStore((s) => s.settings.naming)
  const saved = namingTemplate(overrides, type.type)
  const [text, setText] = useState(saved)
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null)
  const [literal, setLiteral] = useState("")
  const [focusIndex, setFocusIndex] = useState<number | null>(null)
  const ids = { text: useId(), literal: useId(), chips: useId() }
  useEffect(() => {
    setText(saved)
    setFailure(null)
  }, [saved])
  useEffect(() => {
    if (focusIndex === null) return
    document.querySelector<HTMLElement>(`[data-chip-index="${focusIndex}"]`)?.focus()
  }, [focusIndex, text])

  const chips = toChips(text)
  const errors = validateNamingTemplate(text)
  const dirty = text !== saved
  const custom = overrides[type.type] !== undefined
  const root = Object.values(catalog.locations).find((l) => l.role === type.role)?.path ?? `<${type.role === "captures" ? m.status_role_captures() : m.status_role_calibration()}>`
  const sample = sampleValues(catalog, type.type)
  const setChips = (next: Chip[]) => setText(fromChips(next))

  function move(index: number, by: -1 | 1) {
    const to = index + by
    if (to < 0 || to >= chips.length) return
    const next = [...chips]
    ;[next[index], next[to]] = [next[to]!, next[index]!]
    setChips(next)
    setFocusIndex(to)
  }

  function remove(index: number) {
    setChips(chips.filter((_, i) => i !== index))
    setFocusIndex(chips.length > 1 ? Math.min(index, chips.length - 2) : null)
  }

  function onChipKey(event: KeyboardEvent, index: number) {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault()
      remove(index)
    } else if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault()
      move(index, event.key === "ArrowLeft" ? -1 : 1)
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault()
      setFocusIndex(Math.max(0, Math.min(chips.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1))))
    }
  }

  function save(template: string | null) {
    const attempt = () => {
      const result = setNamingTemplate(type.type, template)
      setFailure(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <h3 className="text-sm font-semibold">{type.label()}</h3>
        <Pill tone={custom ? "info" : "muted"}>{custom ? m.naming_custom() : m.settings_default()}</Pill>
        <div className="flex-1" />
        {custom ? (
          <Button size="sm" variant="ghost" onClick={() => save(null)}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {m.naming_restore_default()}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={!dirty} onClick={() => setText(saved)}>
          {m.naming_discard()}
        </Button>
        <Button size="sm" disabled={!dirty || errors.length > 0} onClick={() => save(text)}>
          {m.settings_save()}
        </Button>
      </div>

      <div className="space-y-1.5">
        <div id={ids.chips} className="inline-flex items-center gap-1.5 text-sm font-medium">
          {m.template_column_template()}
          <HelpTip label={m.naming_tokens_about()}>
            <ul className="space-y-0.5 font-mono">
              {NAMING_TOKENS.map((t) => (
                <li key={t.token}>{`{${t.token}} → ${t.fallback}`}</li>
              ))}
            </ul>
          </HelpTip>
        </div>
        <ul aria-labelledby={ids.chips} aria-describedby={`${ids.chips}-hint`} className="flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1.5">
          {chips.length === 0 ? <li className="text-xs text-muted-foreground">{m.naming_empty()}</li> : null}
          {chips.map((chip, index) => {
            const text = chip.kind === "token" ? `{${chip.token}}` : chip.kind === "sep" ? "/" : chip.value
            return (
              // A chip is a focusable list item named from its visible text first ("{date}, Observing night token");
              // the keyboard hint describes it, and Delete removes it (the × is a pointer shortcut only).
              <li
                key={index}
                tabIndex={0}
                data-chip-index={index}
                aria-label={
                  chip.kind === "token"
                    ? m.naming_chip_token({ text, label: tokenLabel(chip.token) })
                    : chip.kind === "sep"
                      ? m.naming_chip_separator()
                      : m.naming_chip_text({ text })
                }
                aria-describedby={`${ids.chips}-hint`}
                onKeyDown={(event) => onChipKey(event, index)}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-[4px] pr-0.5 pl-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  chip.kind === "token" ? "bg-primary/20 text-foreground" : chip.kind === "sep" ? "px-1.5 text-muted-foreground" : "border border-separator font-mono",
                )}
              >
                {text}
                <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => remove(index)} className="inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
        <p id={`${ids.chips}-hint`} className="sr-only">
          {m.naming_chip_hint()}
        </p>
        {focusIndex !== null && chips[focusIndex] ? (
          <span className="inline-flex gap-1 align-middle">
            <Button size="icon-xs" variant="ghost" aria-label={m.naming_move_left()} onClick={() => move(focusIndex, -1)}>
              <ArrowLeft aria-hidden="true" />
            </Button>
            <Button size="icon-xs" variant="ghost" aria-label={m.naming_move_right()} onClick={() => move(focusIndex, 1)}>
              <ArrowRight aria-hidden="true" />
            </Button>
          </span>
        ) : null}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={m.naming_insert_token()}>
          {NAMING_TOKENS.map((t) => (
            <Button
              key={t.token}
              size="xs"
              variant="outline"
              title={m.naming_token_title({ label: t.label, fallback: t.fallback })}
              onClick={() => setChips([...chips, { kind: "token", token: t.token }])}
            >
              <Plus aria-hidden="true" data-icon="inline-start" />
              {`{${t.token}}`}
            </Button>
          ))}
          <Button size="xs" variant="outline" onClick={() => setChips([...chips, { kind: "sep" }])}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            {m.naming_add_folder()}
          </Button>
          <form
            className="inline-flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault()
              if (!literal) return
              setChips([...chips, { kind: "text", value: literal.replace(/\//g, "-") }])
              setLiteral("")
            }}
          >
            <Input
              aria-label={m.naming_text_to_insert()}
              placeholder={m.naming_text_placeholder()}
              value={literal}
              onChange={(event) => setLiteral(event.target.value)}
              className="h-6 w-28 font-mono text-xs"
            />
            <Button type="submit" size="xs" variant="outline" disabled={!literal}>
              {m.naming_add_text()}
            </Button>
          </form>
        </div>
      </div>

      <TextField
        id={ids.text}
        label={m.naming_as_text()}
        mono
        value={text}
        onChange={setText}
        description={m.settings_default_named({ name: DEFAULT_NAMING[type.type] })}
        error={errors.length > 0 ? m.naming_not_saved({ errors: errors.join(", ") }) : undefined}
      />
      {failure ? <ActionError message={failure.message} onRetry={failure.retry} /> : null}

      <section aria-labelledby={`naming-preview-${type.type}-title`} className="space-y-2">
        <h3 id={`naming-preview-${type.type}-title`} className="inline-flex items-center gap-1.5 text-sm font-semibold">
          {m.naming_preview()} {dirty ? <Pill tone="warning">{m.naming_unsaved()}</Pill> : null}
        </h3>
        <div className="space-y-3 rounded-md border px-3 py-2" aria-live="polite">
          {sample ? <Preview label={m.naming_preview_library({ from: sample.from })} root={root} template={text} values={sample.values} /> : null}
          <Preview label={m.naming_preview_no_metadata()} root={root} template={text} values={{ frame_type: type.type }} />
        </div>
      </section>
    </div>
  )
}

export function NamingSettingsPage() {
  const m = useMessages()
  const overrides = useStore((s) => s.settings.naming)
  const [active, setActive] = useState<NamingFrameType>("light")
  const type = TYPES.find((t) => t.type === active)!
  return (
    <div>
      <PageHeader level={2} title={m.settings_naming()} />
      <PageBody>
        <ReturnNotice />
        <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-5">
          <ul aria-label={m.naming_frame_types()} className="space-y-px" data-chrome>
            {TYPES.map((t) => (
              <li key={t.type}>
                <button
                  type="button"
                  aria-current={t.type === active ? "true" : undefined}
                  onClick={() => setActive(t.type)}
                  className={cn("flex w-full flex-col items-start rounded-[0.3125rem] px-2 py-1 text-left hover:bg-foreground/[0.06]", t.type === active && "bg-selected text-selected-foreground hover:bg-selected")}
                >
                  <span className="text-sm">{t.label()}</span>
                  <span className={cn("w-full truncate font-mono text-[0.6875rem]", t.type === active ? "text-selected-foreground" : "text-muted-foreground")}>{namingTemplate(overrides, t.type)}</span>
                </button>
              </li>
            ))}
          </ul>
          <Editor key={type.type} type={type} />
        </div>
      </PageBody>
    </div>
  )
}
