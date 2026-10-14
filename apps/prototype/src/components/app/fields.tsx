/**
 * Field family (L2, plan §3.3 P6). Every field keeps a persistent label, an
 * optional description and an error, and wires them to its control: the
 * control is labelled by the label (`aria-labelledby`, plus `htmlFor` where
 * the control is labelable) and described by the description and the error
 * (`aria-describedby`), and an error sets `aria-invalid`. Hosts show errors
 * after a submit attempt and move focus to the first `[aria-invalid="true"]`
 * control. Inside a SettingsSection (settings.tsx) a field renders as a
 * SettingsRow: label column, then the control.
 *
 * Paths are chosen, never typed: PathField opens the OS chooser
 * (folder-picker.tsx simulates it). Token templates are typed and checked
 * against a token whitelist.
 */
import { CircleAlert } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxGroup } from "@/components/ui/checkbox-group"
import { Combobox, ComboboxCollection, ComboboxContent, ComboboxEmpty, ComboboxGroup, ComboboxInput, ComboboxItem, ComboboxLabel, ComboboxList } from "@/components/ui/combobox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { KeyValueList, PathText } from "./data"
import { type Column, DataTable } from "./data-table"
import { FolderPicker, type PathPickerMode } from "./folder-picker"
import { SettingsRow, useInSettingsSection } from "./settings"

// ---------------------------------------------------------------------------
// Field: label, description, error and the control they describe
// ---------------------------------------------------------------------------

/** What a Field hands its control. Spread it onto the control element. */
export interface FieldControlProps {
  id: string
  "aria-labelledby": string
  "aria-describedby": string | undefined
  "aria-invalid": true | undefined
  "aria-required": true | undefined
}

export interface FieldProps {
  label: string
  /** One line under the control (beside the label in a SettingsRow). */
  description?: ReactNode
  /** Names the field and the problem; several messages show one per line. */
  error?: string | readonly string[]
  required?: boolean
  /** The control's id; generated when omitted. A SettingsRow supplies its own. */
  id?: string
  className?: string
  /** Shown after the description and error, inside the field: a preview or a reference table. */
  after?: ReactNode
  /**
   * Cell mode, for a control inside a DataTable row: the label stays the
   * control's accessible name but is visually hidden, no description or error
   * line shows (an error stays `aria-invalid`), and the control takes the
   * in-row height, so the row keeps its height. Ignored in a SettingsSection,
   * whose row labels the control.
   */
  hideLabel?: boolean
  children: (control: FieldControlProps) => ReactNode
}

/** The props every concrete field shares with Field. */
type FieldChrome = Pick<FieldProps, "label" | "description" | "error" | "required" | "id" | "className" | "hideLabel">

const joinIds = (...ids: Array<string | undefined>) => ids.filter(Boolean).join(" ") || undefined

/** One message per problem: a host check and the field's own check may name the same one. */
function toErrors(error: FieldProps["error"]): readonly string[] {
  if (!error) return []
  return typeof error === "string" ? [error] : [...new Set(error.filter(Boolean))]
}

function FieldErrors({ id, errors }: { id: string; errors: readonly string[] }) {
  if (errors.length === 0) return null
  return (
    <div id={id} className="grid gap-0.5">
      {errors.map((message) => (
        <p key={message} className="flex items-start gap-1.5 text-xs text-destructive">
          <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span className="text-pretty">{message}</span>
        </p>
      ))}
    </div>
  )
}

export function Field({ label, description, error, required, id, className, after, hideLabel = false, children }: FieldProps) {
  const inRow = useInSettingsSection()
  const autoId = useId()
  const errors = toErrors(error)
  const control = (controlId: string, labelId: string, descriptionId: string | undefined, errorId: string | undefined): FieldControlProps => ({
    id: controlId,
    "aria-labelledby": labelId,
    "aria-describedby": joinIds(descriptionId, errors.length > 0 ? errorId : undefined),
    "aria-invalid": errors.length > 0 ? true : undefined,
    "aria-required": required ? true : undefined,
  })

  if (inRow) {
    return (
      <SettingsRow label={label} help={description}>
        {(row) => (
          <>
            {/* The row's label sits on a control-height line; a short control (a switch) is centred on the same line. */}
            <div className="flex min-h-8 min-w-0 items-center">{children(control(row.controlId, row.labelId, row.helpId, `${row.controlId}-error`))}</div>
            <FieldErrors id={`${row.controlId}-error`} errors={errors} />
            {after}
          </>
        )}
      </SettingsRow>
    )
  }

  const base = id ?? autoId
  const labelId = `${base}-label`
  const descriptionId = description ? `${base}-description` : undefined
  const errorId = `${base}-error`
  if (hideLabel) {
    // The in-row control height stands in for the input height inside the cell.
    return (
      <div className={cn("grid min-w-0 [--control-h-md:var(--control-h-sm)]", className)} data-invalid={errors.length > 0 ? true : undefined}>
        <Label id={labelId} htmlFor={base} className="sr-only">
          {label}
        </Label>
        {children(control(base, labelId, undefined, undefined))}
      </div>
    )
  }
  return (
    <div className={cn("grid min-w-0 content-start gap-1.5", className)} data-invalid={errors.length > 0 ? true : undefined}>
      <Label id={labelId} htmlFor={base} className="leading-snug">
        {label}
      </Label>
      {children(control(base, labelId, descriptionId, errorId))}
      {description ? (
        <p id={descriptionId} className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
      ) : null}
      <FieldErrors id={errorId} errors={errors} />
      {after}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Text, number, select, combobox, segmented, switch
// ---------------------------------------------------------------------------

export interface FieldOption<V extends string = string> {
  value: V
  label: string
  disabled?: boolean
}

export interface TextFieldProps extends FieldChrome {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputMode?: "text" | "decimal" | "numeric"
  /** Monospace for paths, templates and identifiers. */
  mono?: boolean
  autoFocus?: boolean
  readOnly?: boolean
  disabled?: boolean
  /** A control that acts on this field (e.g. a submit button), laid out beside the input so their edges align. */
  action?: ReactNode
}

export function TextField({ value, onChange, placeholder, inputMode, mono, autoFocus, readOnly, disabled, action, ...chrome }: TextFieldProps) {
  return (
    <Field {...chrome}>
      {(control) => {
        const input = (
          <Input
            {...control}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            inputMode={inputMode}
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            readOnly={readOnly}
            disabled={disabled}
            className={cn(mono && "font-mono text-xs md:text-xs", inputMode && inputMode !== "text" && "tabular-nums")}
          />
        )
        return action ? (
          <div className="flex items-center gap-2">
            {input}
            {action}
          </div>
        ) : (
          input
        )
      }}
    </Field>
  )
}

export interface TextAreaFieldProps extends FieldChrome {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** Visible lines; default 3. */
  rows?: number
  autoFocus?: boolean
  readOnly?: boolean
  disabled?: boolean
}

/** Free text over several lines (a Project's notes): the TextField chrome around a text area. */
export function TextAreaField({ value, onChange, placeholder, rows = 3, autoFocus, readOnly, disabled, ...chrome }: TextAreaFieldProps) {
  return (
    <Field {...chrome}>
      {(control) => (
        <Textarea {...control} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows={rows} autoFocus={autoFocus} readOnly={readOnly} disabled={disabled} />
      )}
    </Field>
  )
}

export interface FieldGroupProps {
  /** Names the group, as its legend: "Ha goal". */
  label: string
  /** One control that ends the line, such as a Remove IconButton; its name includes the group's ("Remove Ha goal"), so each group's is unique. */
  action?: ReactNode
  /** A few short fields (NumberField, SelectField) that sit side by side and wrap. */
  children: ReactNode
}

/** A few short fields that belong together, named as one group: a fieldset whose legend is the label. Groups that follow each other keep a gap. Not inside a SettingsSection, where every field is its own row. */
export function FieldGroup({ label, action, children }: FieldGroupProps) {
  return (
    <fieldset className="min-w-0 space-y-1.5 [fieldset+&]:mt-3">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <div className="contents *:w-32">{children}</div>
        {action ? <div className="ml-auto">{action}</div> : null}
      </div>
    </fieldset>
  )
}

export interface NumberFieldProps extends FieldChrome {
  /** `null` when the input is empty. */
  value: number | null
  onChange: (value: number | null) => void
  /** Shown after the label: "Exposure (s)". */
  unit?: string
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}

export function NumberField({ value, onChange, unit, min, max, step, disabled, label, ...chrome }: NumberFieldProps) {
  const m = useMessages()
  return (
    <Field {...chrome} label={unit ? m.fields_label_unit({ label, unit }) : label}>
      {(control) => (
        <Input
          {...control}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value === "" ? null : Number(event.target.value))}
          className="tabular-nums"
        />
      )}
    </Field>
  )
}

export interface SelectFieldProps<V extends string> extends FieldChrome {
  value: V
  options: readonly FieldOption<V>[]
  onChange: (value: V) => void
  disabled?: boolean
}

/** One choice from a short fixed list. Use a sentinel value such as "any" for "no choice". */
export function SelectField<V extends string>({ value, options, onChange, disabled, ...chrome }: SelectFieldProps<V>) {
  return (
    <Field {...chrome}>
      {(control) => (
        <Select items={options} value={value} onValueChange={(next) => next !== null && onChange(next as V)} disabled={disabled}>
          <SelectTrigger {...control} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </Field>
  )
}

export interface ComboboxGroupOptions<V extends string> {
  /** Group heading in the list, e.g. "Recommended". */
  label: string
  items: readonly FieldOption<V>[]
}

export interface ComboboxFieldProps<V extends string> extends FieldChrome {
  value: V | null
  onChange: (value: V | null) => void
  groups: readonly ComboboxGroupOptions<V>[]
  placeholder?: string
  disabled?: boolean
}

/** One choice from a long or grouped list, filtered by typing. */
export function ComboboxField<V extends string>({ value, onChange, groups, placeholder, disabled, ...chrome }: ComboboxFieldProps<V>) {
  const m = useMessages()
  const items = groups.map((group) => ({ value: group.label, items: group.items }))
  const selected = groups.flatMap((group) => group.items).find((item) => item.value === value) ?? null
  return (
    <Field {...chrome}>
      {(control) => (
        <Combobox
          items={items}
          value={selected}
          onValueChange={(next: FieldOption<V> | null) => onChange(next?.value ?? null)}
          isItemEqualToValue={(item: FieldOption<V>, current: FieldOption<V>) => item.value === current.value}
          disabled={disabled}
        >
          <ComboboxInput {...control} placeholder={placeholder} disabled={disabled} className="w-full" />
          <ComboboxContent>
            <ComboboxEmpty>{m.fields_no_match()}</ComboboxEmpty>
            <ComboboxList>
              {(group: (typeof items)[number]) => (
                <ComboboxGroup key={group.value} items={[...group.items]}>
                  <ComboboxLabel>{group.value}</ComboboxLabel>
                  <ComboboxCollection>
                    {(item: FieldOption<V>) => (
                      <ComboboxItem key={item.value} value={item} disabled={item.disabled}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxCollection>
                </ComboboxGroup>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      )}
    </Field>
  )
}

export interface SegmentedFieldProps<V extends string> extends FieldChrome {
  value: V
  options: readonly FieldOption<V>[]
  onChange: (value: V) => void
  disabled?: boolean
}

/**
 * Two to four mutually exclusive options shown side by side ("Mono · OSC", "Symlinks · Copies").
 * In a box too narrow for one line the options wrap onto further lines inside it, never past its edge.
 */
export function SegmentedField<V extends string>({ value, options, onChange, disabled, ...chrome }: SegmentedFieldProps<V>) {
  return (
    <Field {...chrome}>
      {(control) => (
        <ToggleGroup
          id={control.id}
          aria-labelledby={control["aria-labelledby"]}
          aria-describedby={control["aria-describedby"]}
          variant="outline"
          spacing={0}
          value={[value]}
          // Pressing the chosen option again would clear it; a segmented field always has one value.
          onValueChange={(next: unknown[]) => typeof next[0] === "string" && onChange(next[0] as V)}
          disabled={disabled}
          className="max-w-full flex-wrap gap-y-1"
        >
          {options.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )}
    </Field>
  )
}

export interface SwitchFieldProps {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  className?: string
}

/** An on/off setting that applies at once: label and description first, the switch at the end of the line. */
export function SwitchField({ label, description, checked, onChange, disabled, id, className }: SwitchFieldProps) {
  const inRow = useInSettingsSection()
  const autoId = useId()
  const control = (props: FieldControlProps) => <Switch {...props} checked={checked} onCheckedChange={(next) => onChange(next)} disabled={disabled} />
  if (inRow) return <Field label={label} description={description}>{control}</Field>
  const base = id ?? autoId
  const descriptionId = description ? `${base}-description` : undefined
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="grid min-w-0 gap-1">
        <Label id={`${base}-label`} htmlFor={base} className="leading-snug">
          {label}
        </Label>
        {description ? (
          <p id={descriptionId} className="text-xs text-pretty text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {control({ id: base, "aria-labelledby": `${base}-label`, "aria-describedby": descriptionId, "aria-invalid": undefined, "aria-required": undefined })}
    </div>
  )
}

export interface ChoiceListFieldProps<V extends string> extends FieldChrome {
  /** The options picked, in any order; `onChange` returns them in option order. */
  value: readonly V[]
  options: readonly FieldOption<V>[]
  onChange: (value: V[]) => void
  disabled?: boolean
  /** Shown instead of the checkboxes when there is no option. */
  empty?: ReactNode
}

/**
 * Any number of choices from a short list: one checkbox per option, named
 * together as one group by the field's label (`role="group"` with
 * `aria-labelledby`), e.g. the bands a filter passes or the filters a rig
 * carries. Picking none is a valid value; a host that needs one says so
 * through `error`.
 */
export function ChoiceListField<V extends string>({ value, options, onChange, disabled, empty, ...chrome }: ChoiceListFieldProps<V>) {
  return (
    <Field {...chrome}>
      {(control) =>
        options.length === 0 && empty ? (
          <p id={control.id} className="text-sm text-muted-foreground">
            {empty}
          </p>
        ) : (
          <CheckboxGroup
            {...control}
            role="group"
            value={[...value]}
            onValueChange={(next) => onChange(options.filter((option) => next.includes(option.value)).map((option) => option.value))}
            disabled={disabled}
            className="min-h-8 items-center"
          >
            {options.map((option) => (
              <label key={option.value} className="inline-flex items-center gap-1.5 text-sm">
                <Checkbox value={option.value} disabled={option.disabled} />
                {option.label}
              </label>
            ))}
          </CheckboxGroup>
        )
      }
    </Field>
  )
}

// ---------------------------------------------------------------------------
// PathField: a path chosen with the OS chooser
// ---------------------------------------------------------------------------

export interface PathFieldProps extends FieldChrome {
  /** What the chooser returns: a folder, a file or an application. */
  mode: PathPickerMode
  value: string | null
  onChange: (path: string) => void
  /** File extensions the chooser lists in "file" mode, e.g. `[".fits", ".xisf"]`. */
  filters?: readonly string[]
  /** Chooser title; the field's label when omitted ("Capture folder"). */
  pickerTitle?: string
  /** Verb of the chooser's primary button; the chosen name follows. */
  chooseVerb?: string
  /** Where the chooser opens when there is no value yet. */
  initialPath?: string | null
  disabled?: boolean
}

/** The chosen path as text plus "Choose…", which opens the OS chooser. Never a text box (DESIGN.md:180). */
export function PathField({ mode, value, onChange, filters, pickerTitle, chooseVerb, initialPath, disabled, ...chrome }: PathFieldProps) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const valueId = useId()
  const empty = { folder: m.fields_path_none_folder, file: m.fields_path_none_file, executable: m.fields_path_none_executable }[mode]
  // A file or an application opens the chooser in the folder that holds it.
  const openAt = value ? (mode === "folder" ? value : value.slice(0, value.lastIndexOf("/"))) : initialPath
  return (
    <>
      <Field {...chrome}>
        {(control) => (
          <div className="flex min-h-8 w-full min-w-0 items-center gap-2">
            <div id={valueId} className="min-w-0 flex-1">
              {value ? <PathText path={value} /> : <span className="text-sm text-muted-foreground">{empty()}</span>}
            </div>
            <Button
              type="button"
              variant="outline"
              id={control.id}
              // Read as "Capture folder, Choose…", then the current path.
              aria-labelledby={`${control["aria-labelledby"]} ${control.id}`}
              aria-describedby={joinIds(valueId, control["aria-describedby"])}
              aria-invalid={control["aria-invalid"]}
              disabled={disabled}
              onClick={() => setOpen(true)}
            >
              {m.fields_choose_ellipsis()}
            </Button>
          </div>
        )}
      </Field>
      <FolderPicker open={open} onOpenChange={setOpen} title={pickerTitle ?? chrome.label} mode={mode} filters={filters} initialPath={openAt} chooseVerb={chooseVerb} onChoose={onChange} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Token templates and launch arguments
// ---------------------------------------------------------------------------

const TOKEN = /\{([^{}]*)\}/g

/** Problems with the `{token}`s in a template: names outside `allowed` (with braces, in order) and an unmatched brace. */
export function templateTokenProblems(template: string, allowed: readonly string[]): { unknown: string[]; unmatched: boolean } {
  const known = new Set(allowed)
  const unknown = new Set<string>()
  for (const match of template.matchAll(TOKEN)) if (!known.has(match[1]!)) unknown.add(match[0])
  return { unknown: [...unknown], unmatched: /[{}]/.test(template.replace(TOKEN, "")) }
}

function useTokenErrors(template: string, allowed: readonly string[], error: FieldProps["error"]): string[] {
  const m = useMessages()
  const problems = templateTokenProblems(template, allowed)
  return [...problems.unknown.map((token) => m.domain_naming_unknown_token({ token })), ...(problems.unmatched ? [m.fields_token_unmatched()] : []), ...toErrors(error)]
}

export interface TemplateToken {
  /** The name inside the braces: "target" for `{target}`. */
  token: string
  /** What the token reads, e.g. "Observing night". */
  label: string
  /** A typical value, used by the preview when no sample is given. */
  example: string
  /** Written when the value is missing, unless the token is omitted. */
  fallback: string
}

export type TemplateValues = Readonly<Record<string, string | null | undefined>>

/**
 * A template with its tokens replaced: the value, else the fallback, else
 * nothing for a token in `omit`. Folders a removed token leaves empty
 * collapse. Unknown tokens stay as typed, so the preview shows them.
 */
export function resolveTokenTemplate(template: string, tokens: readonly TemplateToken[], values: TemplateValues, omit: readonly string[] = []): string {
  const resolved = template.replace(TOKEN, (whole, name: string) => {
    const token = tokens.find((t) => t.token === name)
    if (!token) return whole
    const value = values[name]
    if (value !== null && value !== undefined && value !== "") return value
    return omit.includes(name) ? "" : token.fallback
  })
  return resolved.replace(/\/{2,}/g, "/").replace(/^\//, "")
}

export interface TokenTableOptions {
  /** Tokens left out when their value is missing, instead of writing the fallback. */
  omitWhenMissing?: readonly string[]
  /** Adds an Omit checkbox per token to the table. */
  onOmitWhenMissingChange?: (tokens: string[]) => void
}

export interface TokenTableProps extends TokenTableOptions {
  /** The token whitelist, in table order. */
  tokens: readonly TemplateToken[]
}

/**
 * The columns of a token table: each token with its name, a typical value
 * and what it writes when the value is missing (its fallback, or nothing
 * once omitted). A page with several templates over one token set shows the
 * table once, as a ListSection, beside fields that pass `showTokens={false}`.
 */
export function useTokenColumns({ omitWhenMissing = [], onOmitWhenMissingChange }: TokenTableOptions): Column<TemplateToken>[] {
  const m = useMessages()
  return [
    { id: "token", header: m.fields_token_col_token(), rowHeader: true, cell: (t) => <span className="font-mono text-xs">{`{${t.token}}`}</span>, sortValue: (t) => t.token },
    { id: "name", header: m.fields_token_col_name(), cell: (t) => t.label, sortValue: (t) => t.label },
    { id: "example", header: m.fields_token_col_example(), cell: (t) => <span className="font-mono text-xs">{t.example}</span>, sortValue: (t) => t.example },
    {
      id: "missing",
      header: m.fields_token_col_missing(),
      sortValue: (t) => (omitWhenMissing.includes(t.token) ? "" : t.fallback),
      cell: (t) => {
        const omitted = omitWhenMissing.includes(t.token)
        return (
          <span className="flex items-center justify-between gap-3">
            {omitted ? <span className="text-muted-foreground">{m.fields_token_omitted()}</span> : <span className="font-mono text-xs">{t.fallback}</span>}
            {onOmitWhenMissingChange ? (
              <label className="inline-flex shrink-0 items-center gap-1.5 text-xs">
                <Checkbox checked={omitted} onCheckedChange={(checked) => onOmitWhenMissingChange(checked ? [...omitWhenMissing, t.token] : omitWhenMissing.filter((x) => x !== t.token))} />
                {m.fields_token_omit()}
                {/* The label names its row's token for assistive technology: "Omit {target}". */}
                <span className="sr-only">{` {${t.token}}`}</span>
              </label>
            ) : null}
          </span>
        )
      },
    },
  ]
}

/** The token table on its own: one per page whose template fields pass `showTokens={false}`. */
export function TokenTable({ tokens, ...options }: TokenTableProps) {
  const m = useMessages()
  const columns = useTokenColumns(options)
  return <DataTable label={m.fields_tokens()} rows={[...tokens]} columns={columns} getRowId={(t) => t.token} scroll="none" />
}

export interface TokenTemplateFieldProps extends FieldChrome, TokenTableProps {
  value: string
  onChange: (value: string) => void
  /** Shown before the preview path, e.g. the library root. */
  prefix?: string
  /** Real values for the first preview line, e.g. a library item; the tokens' examples otherwise. */
  sample?: { label: string; values: TemplateValues }
  /** Resolves the preview; `resolveTokenTemplate` by default. */
  resolve?: (template: string, values: TemplateValues, omit: readonly string[]) => string
  /** The field's own token table, on by default; off where the page shows one TokenTable for several fields. */
  showTokens?: boolean
}

/**
 * A `{token}` template typed as text: unknown tokens and stray braces are
 * inline errors, a live preview shows the result with the values available
 * and with them missing, and a table lists the tokens with their example and
 * what happens when the value is missing.
 */
export function TokenTemplateField({ value, onChange, tokens, omitWhenMissing = [], onOmitWhenMissingChange, prefix, sample, resolve, showTokens = true, error, ...chrome }: TokenTemplateFieldProps) {
  const m = useMessages()
  const previewId = useId()
  const errors = useTokenErrors(
    value,
    tokens.map((t) => t.token),
    error,
  )
  const run = resolve ?? ((template: string, values: TemplateValues, omit: readonly string[]) => resolveTokenTemplate(template, tokens, values, omit))
  const examples = Object.fromEntries(tokens.map((t) => [t.token, t.example]))
  const shown = (path: string) => (
    <>
      {prefix ? <span className="text-muted-foreground">{prefix.endsWith("/") ? prefix : `${prefix}/`}</span> : null}
      {path}
    </>
  )
  return (
    <Field
      {...chrome}
      error={errors}
      after={
        <div className="grid gap-3 pt-1">
          <div role="group" aria-labelledby={previewId} className="grid gap-1.5">
            <p id={previewId} className="text-sm font-medium">
              {m.fields_template_preview()}
            </p>
            <KeyValueList
              items={[
                { label: sample?.label ?? m.fields_token_col_example(), value: shown(run(value, sample?.values ?? examples, omitWhenMissing)), mono: true },
                { label: m.fields_token_col_missing(), value: shown(run(value, {}, omitWhenMissing)), mono: true },
              ]}
            />
          </div>
          {showTokens ? <TokenTable tokens={tokens} omitWhenMissing={omitWhenMissing} onOmitWhenMissingChange={onOmitWhenMissingChange} /> : null}
        </div>
      }
    >
      {(control) => <Input {...control} value={value} onChange={(event) => onChange(event.target.value)} autoComplete="off" spellCheck={false} className="font-mono text-xs md:text-xs" />}
    </Field>
  )
}

export interface ArgumentsFieldProps extends FieldChrome {
  value: string
  onChange: (value: string) => void
  /** Token names the arguments may use, e.g. `["folder", "file"]`. */
  tokens: readonly string[]
  placeholder?: string
  disabled?: boolean
}

/** Launch arguments: literal text plus a closed set of `{token}`s, listed under the input; any other token is an inline error. */
export function ArgumentsField({ value, onChange, tokens, placeholder, disabled, description, error, ...chrome }: ArgumentsFieldProps) {
  const m = useMessages()
  const errors = useTokenErrors(value, tokens, error)
  const list = m.fields_tokens_list({ tokens: tokens.map((t) => `{${t}}`).join(" ") })
  return (
    <Field
      {...chrome}
      error={errors}
      description={
        description ? (
          <>
            <span className="block">{description}</span>
            <span className="block font-mono">{list}</span>
          </>
        ) : (
          <span className="font-mono">{list}</span>
        )
      }
    >
      {(control) => (
        <Input {...control} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} disabled={disabled} autoComplete="off" spellCheck={false} className="font-mono text-xs md:text-xs" />
      )}
    </Field>
  )
}
