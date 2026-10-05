/**
 * Project editors shared by New Project and the Project page: Target
 * picker with framing provenance, mosaic panels, checklist items and the
 * explicit session-linkage picker (PRJ-FR-01-04, D10, D12). Each editor is
 * controlled: it reports a new value and never writes the catalog itself.
 */
import { Link } from "@tanstack/react-router"
import { Layers, Pencil, X } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState, UnknownValue } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { captureSite } from "@/domain/derive"
import { stableHash } from "@/domain/indexing"
import type { CalibrationKind, Catalog, ChecklistItem, MosaicPanel, OpticalTrainId, SessionId, TargetId } from "@/domain/types"
import { formatDec, formatDegrees, formatDuration, formatRa } from "@/lib/format"
import { useStore } from "@/store/core"
import { checklistCriterion, currentSessions, knownChannels, sessionRow, type SessionRow } from "./model"
import { AssociationBadge } from "./parts"

/** Select with a visible label above it. */
export function LabeledSelect({
  label,
  value,
  items,
  onChange,
  placeholder,
  invalid,
  describedBy,
  className = "w-56",
}: {
  label: string
  value: string | null
  items: ReadonlyArray<{ value: string; label: string; disabled?: boolean }>
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  className?: string
}) {
  const id = useId()
  return (
    // Flex gap, not space-y: space-y adds a bottom margin to the trigger before Select's hidden input.
    <div className="flex flex-col gap-1.5">
      <Label id={id}>{label}</Label>
      <Select items={items} value={value} onValueChange={(next) => onChange(next as string)}>
        <SelectTrigger aria-labelledby={id} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={className}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * An editor's report of a change it asked for: `false` when the change was not
 * saved, so the editor keeps the user's input. New Project drafts always apply.
 */
type Applied = boolean | void

/**
 * Remove a row, then keep focus in the list (WCAG 2.4.3): the neighbouring
 * Remove, or else the editor's first add control. Nothing moves when the
 * removal was not saved.
 */
export function removeKeepingFocus(button: HTMLElement, remove: () => Applied) {
  const row = button.closest("li")
  const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>("[data-remove]")
  const editor = button.closest("[data-editor]") ?? button.closest("section")
  if (remove() === false) return
  // After React commits the removal; the neighbour's node is kept by its key.
  requestAnimationFrame(() => {
    const target = neighbour?.isConnected ? neighbour : editor?.querySelector<HTMLElement>("[data-editor-add] :is(button, input, [role=combobox])")
    target?.focus()
  })
}

/** In a sub-form, Enter runs the sub-form's own Add instead of submitting the page form (WCAG 3.2.2). */
function enterAdds(add: () => void) {
  return (event: KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) return
    event.preventDefault()
    add()
  }
}

/** A removable row in an editor list; the remove button names the row. `actions` sit before Remove; `detail` spans the row below. */
function RemovableRow({
  children,
  label,
  onRemove,
  disabledReason,
  actions,
  detail,
}: {
  children: ReactNode
  label: string
  onRemove: () => Applied
  disabledReason?: string
  actions?: ReactNode
  detail?: ReactNode
}) {
  const reasonId = useId()
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
      <div className="min-w-0">{children}</div>
      <span className="flex items-center gap-2">
        {actions}
        {disabledReason ? (
          <span id={reasonId} className="text-xs text-muted-foreground">
            {disabledReason}
          </span>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-remove=""
          onClick={(event) => removeKeepingFocus(event.currentTarget, onRemove)}
          disabled={Boolean(disabledReason)}
          focusableWhenDisabled
          aria-describedby={disabledReason ? reasonId : undefined}
        >
          <X aria-hidden="true" data-icon="inline-start" />
          Remove<span className="sr-only"> {label}</span>
        </Button>
      </span>
      {detail ? <div className="basis-full">{detail}</div> : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Targets and framing
// ---------------------------------------------------------------------------

export function TargetsEditor({
  targetIds,
  onChange,
  error,
  errorId,
  lockedReason,
}: {
  targetIds: TargetId[]
  /** `clear` empties the add control; the caller runs it when a later Retry saves the change. */
  onChange: (ids: TargetId[], clear?: () => void) => Applied
  error?: string
  errorId?: string
  /** Why no Target can be removed, e.g. it is the Project's last Target or panel. */
  lockedReason?: string
}) {
  const targets = useStore((s) => s.catalog.targets)
  const [adding, setAdding] = useState<string | null>(null)
  const addReasonId = useId()
  const remaining = Object.values(targets)
    .filter((t) => !targetIds.includes(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  const framingTarget = targetIds.map((id) => targets[id]).find((t) => t && t.ra !== null && t.dec !== null)
  const SOURCE = { catalog: "catalog coordinates", user: "coordinates entered by you", resolver: "resolver coordinates", unknown: "" } as const
  return (
    <div className="space-y-3" data-editor="">
      {targetIds.length > 0 ? (
        <ul className="divide-y rounded-lg border px-3">
          {targetIds.map((id) => (
            <RemovableRow key={id} label={targets[id]?.name ?? id} onRemove={() => onChange(targetIds.filter((t) => t !== id))} disabledReason={lockedReason}>
              <Link to="/targets/$targetId" params={{ targetId: id }} className="font-medium underline-offset-2 hover:underline">
                {targets[id]?.name ?? "Removed Target"}
              </Link>
            </RemovableRow>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No Target yet. Add one, or add a mosaic panel below.</p>
      )}
      {remaining.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2" data-editor-add="">
          <LabeledSelect label="Add a Target" value={adding} items={remaining} onChange={setAdding} placeholder="Choose a Target" />
          <Button
            type="button"
            variant="outline"
            disabled={!adding}
            focusableWhenDisabled
            aria-describedby={adding ? undefined : addReasonId}
            onClick={() => {
              if (!adding) return
              const clear = () => setAdding(null)
              if (onChange([...targetIds, adding], clear) !== false) clear()
            }}
          >
            Add Target
          </Button>
          {adding ? null : (
            <span id={addReasonId} className="pb-2.5 text-xs text-muted-foreground">
              Choose a Target to add it
            </span>
          )}
        </div>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="text-sm">
        <span className="text-muted-foreground">Framing: </span>
        {framingTarget ? (
          <>
            RA {formatRa(framingTarget.ra!)} · Dec {formatDec(framingTarget.dec!)}
            {framingTarget.sizeDeg ? ` · ${formatDegrees(framingTarget.sizeDeg.width)} × ${formatDegrees(framingTarget.sizeDeg.height)}` : ""}
            <span className="text-muted-foreground">
              {" "}
              · Source: {framingTarget.name} {SOURCE[framingTarget.coordinateSource]}
            </span>
          </>
        ) : (
          <UnknownValue label="Position unknown" reason="No chosen Target has coordinates. Panels can still define the framing." />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mosaic panels (D12)
// ---------------------------------------------------------------------------

interface PanelForm {
  name: string
  ra: string
  dec: string
  width: string
  height: string
  rotation: string
}

const EMPTY_PANEL: PanelForm = { name: "", ra: "", dec: "", width: "", height: "", rotation: "0" }

export function PanelsEditor({
  panels,
  onChange,
  checklist,
  lockedReason,
}: {
  panels: MosaicPanel[]
  /** `clear` empties the add form; the caller runs it when a later Retry saves the change. */
  onChange: (panels: MosaicPanel[], clear?: () => void) => Applied
  checklist: ChecklistItem[]
  /** Why no panel can be removed, e.g. it is the Project's last Target or panel. */
  lockedReason?: string
}) {
  const [form, setForm] = useState<PanelForm>(EMPTY_PANEL)
  const [errors, setErrors] = useState<Partial<Record<keyof PanelForm, string>>>({})
  const ids = { name: useId(), ra: useId(), dec: useId(), width: useId(), height: useId(), rotation: useId() }

  function add() {
    const found: Partial<Record<keyof PanelForm, string>> = {}
    const ra = Number(form.ra)
    const dec = Number(form.dec)
    const width = Number(form.width)
    const height = Number(form.height)
    const rotation = Number(form.rotation || "0")
    if (!form.name.trim()) found.name = "Enter a panel name."
    if (form.ra.trim() === "" || !Number.isFinite(ra) || ra < 0 || ra >= 360) found.ra = "Panel RA must be between 0 and 360 degrees."
    if (form.dec.trim() === "" || !Number.isFinite(dec) || dec < -90 || dec > 90) found.dec = "Panel Dec must be between −90 and +90 degrees."
    if (!Number.isFinite(width) || width <= 0) found.width = "Width must be more than 0 degrees."
    if (!Number.isFinite(height) || height <= 0) found.height = "Height must be more than 0 degrees."
    if (!Number.isFinite(rotation)) found.rotation = "Rotation must be a number of degrees."
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const panel = { id: `pnl_${stableHash(`${form.name}|${Date.now()}`)}`, name: form.name.trim(), ra, dec, widthDeg: width, heightDeg: height, rotationDeg: rotation }
    const clear = () => setForm(EMPTY_PANEL)
    if (onChange([...panels, panel], clear) !== false) clear()
  }

  const field = (key: keyof PanelForm, label: string, mono = true) => (
    <Field data-invalid={Boolean(errors[key]) || undefined} className="w-auto">
      <FieldLabel htmlFor={ids[key]}>{label}</FieldLabel>
      <Input
        id={ids[key]}
        value={form[key]}
        inputMode={key === "name" ? undefined : "decimal"}
        onChange={(e) => {
          const value = e.target.value
          setForm((f) => ({ ...f, [key]: value }))
          setErrors((er) => ({ ...er, [key]: undefined }))
        }}
        aria-invalid={Boolean(errors[key]) || undefined}
        aria-describedby={errors[key] ? `${ids[key]}-error` : undefined}
        className={mono ? "w-24 font-mono" : "w-40"}
      />
      <FieldError id={`${ids[key]}-error`}>{errors[key]}</FieldError>
    </Field>
  )

  return (
    <div className="space-y-3" data-editor="">
      {panels.length > 0 ? (
        <ul className="divide-y rounded-lg border px-3">
          {panels.map((p) => {
            const used = checklist.some((item) => item.kind === "panel-coverage" && item.panelId === p.id)
            return (
              <RemovableRow
                key={p.id}
                label={p.name}
                onRemove={() => onChange(panels.filter((x) => x.id !== p.id))}
                disabledReason={used ? "Remove its Panel coverage item first" : lockedReason}
              >
                <span className="font-medium">{p.name}</span>{" "}
                <span className="text-muted-foreground tabular-nums">
                  RA {formatRa(p.ra)} · Dec {formatDec(p.dec)} · {formatDegrees(p.widthDeg)} × {formatDegrees(p.heightDeg)} · rotation {formatDegrees(p.rotationDeg)}
                </span>
              </RemovableRow>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No panels. Add panels for a mosaic; each one is a user-defined footprint.</p>
      )}
      <fieldset className="space-y-2" data-editor-add="" onKeyDown={enterAdds(add)}>
        <legend className="text-sm font-medium">Add a panel</legend>
        <div className="flex flex-wrap items-start gap-2">
          {field("name", "Panel name", false)}
          {field("ra", "RA (°)")}
          {field("dec", "Dec (°)")}
          {field("width", "Width (°)")}
          {field("height", "Height (°)")}
          {field("rotation", "Rotation (°)")}
          <Button type="button" variant="outline" onClick={add} className="mt-6">
            Add panel
          </Button>
        </div>
      </fieldset>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checklist (PRJ-FR-03)
// ---------------------------------------------------------------------------

type ChecklistKind = ChecklistItem["kind"]

const KIND_ITEMS: Array<{ value: ChecklistKind; label: string }> = [
  { value: "integration", label: "Integration per channel" },
  { value: "frame-count", label: "Frame count per channel" },
  { value: "exposure", label: "Exposure preference" },
  { value: "panel-coverage", label: "Panel coverage" },
  { value: "equipment", label: "Equipment" },
  { value: "calibration", label: "Missing calibration" },
]

const CALIBRATION_ITEMS: Array<{ value: CalibrationKind; label: string }> = [
  { value: "flat", label: "Flat" },
  { value: "dark", label: "Dark" },
  { value: "bias", label: "Bias" },
  { value: "dark-flat", label: "Dark flat" },
]

const ANY = "any"

export function ChecklistEditor({
  checklist,
  onChange,
  panels,
}: {
  checklist: ChecklistItem[]
  onChange: (items: ChecklistItem[]) => Applied
  panels: MosaicPanel[]
}) {
  const catalog = useStore((s) => s.catalog)
  return (
    <div className="space-y-3" data-editor="">
      {checklist.length > 0 ? (
        <ul className="divide-y rounded-lg border px-3">
          {checklist.map((item) => (
            <ChecklistEditorRow
              key={item.id}
              item={item}
              criterion={checklistCriterion(catalog, { panels }, item)}
              catalog={catalog}
              panels={panels}
              onRemove={() => onChange(checklist.filter((i) => i.id !== item.id))}
              onEdit={(next) => onChange(checklist.map((i) => (i.id === next.id ? next : i)))}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No checklist items. The checklist is optional; an unmet item never blocks a View.</p>
      )}
      <AddChecklistItem catalog={catalog} panels={panels} onAdd={(item) => onChange([...checklist, item])} />
    </div>
  )
}

/**
 * A checklist row's Edit toggles the criterion form, prefilled, below the row;
 * Save item keeps the item's id, and Save or Cancel returns focus to Edit (WCAG 2.4.3).
 */
export function useChecklistItemEdit() {
  const [editing, setEditing] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  function close() {
    editRef.current?.focus()
    setEditing(false)
  }
  return { editing, editRef, close, toggle: () => (editing ? close() : setEditing(true)) }
}

function ChecklistEditorRow({
  item,
  criterion,
  catalog,
  panels,
  onRemove,
  onEdit,
}: {
  item: ChecklistItem
  criterion: string
  catalog: Catalog
  panels: MosaicPanel[]
  onRemove: () => Applied
  onEdit: (item: ChecklistItem) => Applied
}) {
  const edit = useChecklistItemEdit()
  return (
    <RemovableRow
      label={criterion}
      onRemove={onRemove}
      actions={
        <Button type="button" size="sm" variant="ghost" ref={edit.editRef} aria-expanded={edit.editing} onClick={edit.toggle}>
          <Pencil aria-hidden="true" data-icon="inline-start" />
          Edit<span className="sr-only"> {criterion}</span>
        </Button>
      }
      detail={
        edit.editing ? (
          <div className="mb-1.5 rounded-lg border p-3">
            <AddChecklistItem
              catalog={catalog}
              panels={panels}
              item={item}
              onCancel={edit.close}
              onAdd={(next) => {
                const applied = onEdit(next)
                if (applied !== false) edit.close()
                return applied
              }}
            />
          </div>
        ) : null
      }
    >
      {criterion}
    </RemovableRow>
  )
}

/** Amount field text for an item being edited; integration goals are shown in hours. */
function amountText(item: ChecklistItem | undefined): string {
  if (item?.kind === "integration") return String(Math.round(item.goalS / 36) / 100)
  if (item?.kind === "frame-count") return String(item.goalFrames)
  if (item?.kind === "exposure") return String(item.exposureS)
  return ""
}

/**
 * Form for one checklist item; Add item stays disabled, with its reason, until the criterion is complete.
 * Given `item`, it edits that item instead: prefilled, Save item keeps its id, and Cancel discards the change.
 */
export function AddChecklistItem({
  catalog,
  panels,
  onAdd,
  item: editing,
  onCancel,
}: {
  catalog: Catalog
  panels: MosaicPanel[]
  /** `clear` empties the form; the caller runs it when a later Retry saves the item. */
  onAdd: (item: ChecklistItem, clear: () => void) => Applied
  item?: ChecklistItem
  onCancel?: () => void
}) {
  const [kind, setKind] = useState<ChecklistKind>(editing?.kind ?? "integration")
  const [channel, setChannel] = useState<string | null>(editing && "channel" in editing ? editing.channel : null)
  const [amount, setAmount] = useState(() => amountText(editing))
  const [panelId, setPanelId] = useState<string | null>(editing?.kind === "panel-coverage" ? editing.panelId : null)
  const [trainId, setTrainId] = useState<OpticalTrainId | null>(editing?.kind === "equipment" ? editing.opticalTrainId : null)
  const [calibrationKind, setCalibrationKind] = useState<CalibrationKind>(editing?.kind === "calibration" ? editing.calibrationKind : "flat")
  const fieldsetRef = useRef<HTMLFieldSetElement>(null)
  const editOnOpen = useRef(Boolean(editing))
  // Opening an edit moves focus into the form, to its first control.
  useEffect(() => {
    if (editOnOpen.current) fieldsetRef.current?.querySelector<HTMLElement>("button, input, [role='combobox']")?.focus()
  }, [])
  const [amountError, setAmountError] = useState<string | null>(null)
  const amountId = useId()
  const reasonId = useId()
  const channels = knownChannels(catalog).map((c) => ({ value: c, label: c }))
  const trains = Object.values(catalog.opticalTrains).map((t) => ({ value: t.id, label: t.name }))
  const kinds = KIND_ITEMS.map((k) => ({ ...k, disabled: k.value === "panel-coverage" && panels.length === 0 }))

  const needsChannel = kind === "integration" || kind === "frame-count"
  const needsAmount = kind === "integration" || kind === "frame-count" || kind === "exposure"
  const amountLabel = kind === "integration" ? "Hours" : kind === "frame-count" ? "Frames" : "Seconds"
  const missing =
    needsChannel && (!channel || channel === ANY)
      ? "Choose a channel"
      : needsAmount && amount.trim() === ""
        ? `Enter ${amountLabel.toLowerCase()}`
        : kind === "panel-coverage" && !panelId
          ? panels.length === 0
            ? "Add a panel first"
            : "Choose a panel"
          : kind === "equipment" && !trainId
            ? "Choose an optical train"
            : null

  function add() {
    if (missing) return
    const value = Number(amount)
    if (needsAmount && (!Number.isFinite(value) || value <= 0 || (kind === "frame-count" && !Number.isInteger(value)))) {
      setAmountError(kind === "frame-count" ? "Enter a whole number of frames greater than 0." : `Enter ${amountLabel.toLowerCase()} greater than 0.`)
      return
    }
    const id = editing?.id ?? `chk_${stableHash(`${kind}|${channel}|${amount}|${Date.now()}`)}`
    const channelOrAny = channel && channel !== ANY ? channel : null
    const item: ChecklistItem =
      kind === "integration"
        ? { id, kind, channel: channel!, goalS: Math.round(value * 3600) }
        : kind === "frame-count"
          ? { id, kind, channel: channel!, goalFrames: value }
          : kind === "exposure"
            ? { id, kind, channel: channelOrAny, exposureS: value }
            : kind === "panel-coverage"
              ? { id, kind, panelId: panelId! }
              : kind === "equipment"
                ? { id, kind, opticalTrainId: trainId! }
                : { id, kind, calibrationKind, channel: calibrationKind === "flat" ? channelOrAny : null }
    const clear = () => {
      setAmount("")
      setAmountError(null)
    }
    if (onAdd(item, clear) !== false) clear()
  }

  return (
    <fieldset ref={fieldsetRef} className="space-y-2" data-editor-add={editing ? undefined : ""} onKeyDown={enterAdds(add)}>
      <legend className="text-sm font-medium">{editing ? "Edit checklist item" : "Add a checklist item"}</legend>
      <div className="flex flex-wrap items-start gap-2">
        <LabeledSelect
          label="Kind"
          value={kind}
          items={kinds}
          onChange={(value) => {
            // A new kind starts clean: a channel or amount picked for another kind never carries over silently.
            setKind(value as ChecklistKind)
            setChannel(null)
            setAmount("")
            setAmountError(null)
          }}
        />
        {needsChannel ? <LabeledSelect label="Channel" value={channel === ANY ? null : channel} items={channels} onChange={setChannel} placeholder="Choose a channel" className="w-44" /> : null}
        {kind === "exposure" || (kind === "calibration" && calibrationKind === "flat") ? (
          <LabeledSelect label="Channel" value={channel ?? ANY} items={[{ value: ANY, label: "Any channel" }, ...channels]} onChange={setChannel} className="w-44" />
        ) : null}
        {kind === "calibration" ? (
          <LabeledSelect label="Calibration" value={calibrationKind} items={CALIBRATION_ITEMS} onChange={(v) => setCalibrationKind(v as CalibrationKind)} className="w-36" />
        ) : null}
        {kind === "panel-coverage" ? (
          <LabeledSelect label="Panel" value={panelId} items={panels.map((p) => ({ value: p.id, label: p.name }))} onChange={setPanelId} placeholder="Choose a panel" />
        ) : null}
        {kind === "equipment" ? <LabeledSelect label="Optical train" value={trainId} items={trains} onChange={setTrainId} placeholder="Choose an optical train" className="w-72" /> : null}
        {needsAmount ? (
          <Field data-invalid={Boolean(amountError) || undefined} className="w-auto gap-1.5">
            <FieldLabel htmlFor={amountId} className="leading-none">
              {amountLabel}
            </FieldLabel>
            <Input
              id={amountId}
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value)
                setAmountError(null)
              }}
              aria-invalid={Boolean(amountError) || undefined}
              aria-describedby={amountError ? `${amountId}-error` : undefined}
              className="w-24 font-mono"
              placeholder={kind === "integration" ? "e.g. 10" : kind === "frame-count" ? "e.g. 120" : "e.g. 300"}
            />
            <FieldError id={`${amountId}-error`}>{amountError}</FieldError>
          </Field>
        ) : null}
        <div className="mt-6 flex items-center gap-2">
          <Button type="button" variant="outline" onClick={add} disabled={Boolean(missing)} focusableWhenDisabled aria-describedby={missing ? reasonId : undefined}>
            {editing ? "Save item" : "Add item"}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          {missing ? (
            <span id={reasonId} className="text-xs text-muted-foreground">
              {missing} to {editing ? "save" : "add"} this item
            </span>
          ) : null}
        </div>
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Explicit session linkage (D12, PRJ-FR-08)
// ---------------------------------------------------------------------------

interface PickerRow extends SessionRow {
  site: string | null
}

/**
 * Candidate light sessions for explicit linkage. Sessions associated with the
 * Project's Targets come first; nothing is preselected by proximity or a
 * shared OBJECT label (J20 S3 negative).
 */
export function SessionLinkPicker({ selected, onChange, targetIds }: { selected: SessionId[]; onChange: (ids: SessionId[]) => void; targetIds: TargetId[] }) {
  const rows = useStore((s) =>
    currentSessions(s.catalog, "light").map((session): PickerRow => ({ ...sessionRow(s, session), site: captureSite(s.catalog, session)?.name ?? null })),
  )
  const [showAll, setShowAll] = useState(targetIds.length === 0)
  const switchId = useId()
  const forTargets = rows.filter((r) => r.session.target.value && targetIds.includes(r.session.target.value))
  const shown = showAll ? rows : forTargets
  const hidden = selected.filter((id) => !shown.some((r) => r.session.id === id)).length
  const columns: Column<PickerRow>[] = [
    { id: "session", header: "Session", rowHeader: true, sortValue: (r) => `${r.session.night}|${r.label}`, cell: (r) => r.label },
    {
      id: "target",
      header: "Target",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
          {r.targetName ?? null}
          <AssociationBadge association={r.session.target} />
        </span>
      ),
    },
    { id: "equipment", header: "Equipment", className: "whitespace-normal", cell: (r) => r.trainName ?? <UnknownValue /> },
    { id: "integration", header: "Integration", align: "right", sortValue: (r) => r.breakdown.captured.seconds, cell: (r) => formatDuration(r.breakdown.captured.seconds) },
    { id: "site", header: "Capture site", cell: (r) => r.site ?? <UnknownValue reason="No saved site matches the header coordinates." /> },
  ]
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm tabular-nums" aria-live="polite">
          {selected.length} linked{hidden > 0 ? <span className="text-muted-foreground"> · {hidden} not shown by the current filter</span> : null}
        </p>
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={showAll} onCheckedChange={(value) => setShowAll(value)} />
          <Label htmlFor={switchId}>Show all sessions</Label>
        </div>
      </div>
      <DataTable
        label="Sessions to link"
        rows={shown}
        columns={columns}
        getRowId={(r) => r.session.id}
        selection={{ selected, onChange, rowLabel: (r) => r.label }}
        initialSort={{ columnId: "session", direction: "desc" }}
        className="max-h-80"
        empty={
          <EmptyState
            icon={Layers}
            title="No session is associated with these Targets"
            description="Sessions are linked only when you choose them. Show every light session to pick from the whole library."
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => setShowAll(true)}>
                Show all sessions
              </Button>
            }
          />
        }
      />
    </div>
  )
}
