/**
 * Settings › Equipment (J15 S1-S5, D11, seam 3). Optical trains, cameras,
 * telescopes and filters, each with its source (Manual, Detected, Built-in).
 * Creates, edits and removals are durable commits recorded in Activity;
 * blank or invalid input is refused inline before anything is written, and a
 * record in use cannot be removed.
 */
import { Aperture, Camera as CameraIcon, Filter, Plus, Telescope as TelescopeIcon } from "lucide-react"
import { type ReactNode, useEffect, useId, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Camera, Catalog, FilterDef, OpticalTrain, Telescope } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { focusFirstInvalid, parseAliases, parseNumber, TextField } from "../components/form-field"
import { duplicateName, type EquipmentKind, FILTER_CATEGORIES, KIND_COPY, removalRefusal, removeEquipment, saveEquipment, trainUsage } from "../lib/equipment"
import { ReturnNotice } from "./settings-layout"

type AnyRecord = OpticalTrain | Camera | Telescope | FilterDef
type Values = Record<string, string>
type Errors = Record<string, string | undefined>

const NONE = "__none__"

function initialValues(kind: EquipmentKind, record: AnyRecord | null): Values {
  const aliases = record && "aliases" in record ? record.aliases.join(", ") : ""
  switch (kind) {
    case "train": {
      const r = record as OpticalTrain | null
      return { name: r?.name ?? "", cameraId: r?.cameraId ?? NONE, telescopeId: r?.telescopeId ?? NONE, focal: r ? String(r.effectiveFocalLengthMm) : "", notes: r?.notes ?? "" }
    }
    case "camera": {
      const r = record as Camera | null
      return { name: r?.name ?? "", aliases, width: r?.widthPx ? String(r.widthPx) : "", height: r?.heightPx ? String(r.heightPx) : "", pixel: r?.pixelSizeUm ? String(r.pixelSizeUm) : "", color: r?.color ? "yes" : "no" }
    }
    case "telescope": {
      const r = record as Telescope | null
      return { name: r?.name ?? "", aliases, focal: r ? String(r.focalLengthMm) : "", aperture: r?.apertureMm ? String(r.apertureMm) : "" }
    }
    case "filter": {
      const r = record as FilterDef | null
      return { name: r?.name ?? "", aliases, category: r?.category ?? "narrowband" }
    }
  }
}

function positive(value: string, message: string, { optional = false, whole = false } = {}): string | undefined {
  const parsed = parseNumber(value)
  if (parsed === null) return optional ? undefined : message
  if (Number.isNaN(parsed) || parsed <= 0 || (whole && !Number.isInteger(parsed))) return message
  return undefined
}

function validate(catalog: Catalog, kind: EquipmentKind, values: Values, id: string | null): Errors {
  const errors: Errors = {}
  const name = values.name?.trim() ?? ""
  errors.name = name ? duplicateName(catalog, kind, name, id) : "Name: enter a name."
  if (kind === "train") errors.focal = positive(values.focal ?? "", "Effective focal length: enter millimetres greater than 0, for example 250.")
  if (kind === "telescope") {
    errors.focal = positive(values.focal ?? "", "Focal length: enter millimetres greater than 0, for example 250.")
    errors.aperture = positive(values.aperture ?? "", "Aperture: enter millimetres greater than 0, or leave it empty.", { optional: true })
  }
  if (kind === "camera") {
    errors.width = positive(values.width ?? "", "Width: enter a whole number of pixels greater than 0.", { whole: true })
    errors.height = positive(values.height ?? "", "Height: enter a whole number of pixels greater than 0.", { whole: true })
    errors.pixel = positive(values.pixel ?? "", "Pixel size: enter micrometres greater than 0, for example 3.76.")
  }
  return errors
}

function commitValues(kind: EquipmentKind, values: Values, id: string | null) {
  const name = values.name!.trim()
  const aliases = parseAliases(values.aliases ?? "")
  switch (kind) {
    case "train":
      return saveEquipment("train", {
        id,
        name,
        cameraId: values.cameraId === NONE ? null : (values.cameraId ?? null),
        telescopeId: values.telescopeId === NONE ? null : (values.telescopeId ?? null),
        effectiveFocalLengthMm: parseNumber(values.focal ?? "")!,
        notes: values.notes?.trim() ?? "",
      })
    case "camera":
      return saveEquipment("camera", {
        id,
        name,
        aliases,
        widthPx: parseNumber(values.width ?? "")!,
        heightPx: parseNumber(values.height ?? "")!,
        pixelSizeUm: parseNumber(values.pixel ?? "")!,
        color: values.color === "yes",
      })
    case "telescope":
      return saveEquipment("telescope", { id, name, aliases, focalLengthMm: parseNumber(values.focal ?? "")!, apertureMm: parseNumber(values.aperture ?? "") })
    case "filter":
      return saveEquipment("filter", { id, name, aliases, category: (values.category as FilterDef["category"]) ?? "other" })
  }
}

function SelectField({ id, label, value, onChange, items }: { id: string; label: string; value: string; onChange: (value: string) => void; items: Array<{ value: string; label: string }> }) {
  return (
    <Field className="gap-1.5">
      <FieldLabel id={id}>{label}</FieldLabel>
      <Select items={items} value={value} onValueChange={(next) => onChange(String(next))}>
        <SelectTrigger aria-labelledby={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function EquipmentDialog({ editing, onClose }: { editing: { kind: EquipmentKind; record: AnyRecord | null } | null; onClose: () => void }) {
  const kind = editing?.kind ?? "camera"
  const record = editing?.record ?? null
  const [values, setValues] = useState<Values>({})
  const [errors, setErrors] = useState<Errors>({})
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const id = useId()
  const cameras = useStore((s) => Object.values(s.catalog.cameras))
  const telescopes = useStore((s) => Object.values(s.catalog.telescopes))

  useEffect(() => {
    if (!editing) return
    setValues(initialValues(editing.kind, editing.record))
    setErrors({})
    setWriteError(null)
  }, [editing])

  const set = (key: string) => (value: string) => setValues((v) => ({ ...v, [key]: value }))

  function submit() {
    const found = validate(store.getState().catalog, kind, values, record?.id ?? null)
    setErrors(found)
    if (Object.values(found).some(Boolean)) {
      focusFirstInvalid(form.current)
      return
    }
    const result = commitValues(kind, values, record?.id ?? null)
    if (!result.ok) {
      setWriteError(result.message)
      return
    }
    onClose()
  }

  const noun = KIND_COPY[kind].noun
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form
          ref={form}
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>{record ? `Edit ${record.name}` : `Add ${noun}`}</DialogTitle>
            <DialogDescription>
              {record && record.source === "detected"
                ? "Detected from file headers. Saving makes it a Manual record; source headers are never changed."
                : record && record.source === "built-in"
                  ? "Shipped with PlateVault. Saving makes it a Manual record."
                  : "Saved to the catalog. Source headers are never changed."}
            </DialogDescription>
          </DialogHeader>
          <TextField id={`${id}-name`} label="Name" value={values.name ?? ""} onChange={set("name")} error={errors.name} autoFocus />
          {kind !== "train" ? (
            <TextField
              id={`${id}-aliases`}
              label="Aliases"
              value={values.aliases ?? ""}
              onChange={set("aliases")}
              description={kind === "filter" ? "Comma-separated FILTER header values, e.g. H-alpha, Halpha." : `Comma-separated header strings (${kind === "camera" ? "INSTRUME" : "TELESCOP"}), e.g. ZWO ASI2600MM Pro.`}
            />
          ) : null}
          {kind === "train" ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  id={`${id}-camera`}
                  label="Camera"
                  value={values.cameraId ?? NONE}
                  onChange={set("cameraId")}
                  items={[{ value: NONE, label: "None" }, ...cameras.map((c) => ({ value: c.id, label: c.name }))]}
                />
                <SelectField
                  id={`${id}-telescope`}
                  label="Telescope"
                  value={values.telescopeId ?? NONE}
                  onChange={(next) => {
                    const telescope = telescopes.find((t) => t.id === next)
                    setValues((v) => ({ ...v, telescopeId: next, focal: v.focal || (telescope ? String(telescope.focalLengthMm) : "") }))
                  }}
                  items={[{ value: NONE, label: "None" }, ...telescopes.map((t) => ({ value: t.id, label: t.name }))]}
                />
              </div>
              <TextField
                id={`${id}-focal`}
                label="Effective focal length (mm)"
                value={values.focal ?? ""}
                onChange={set("focal")}
                error={errors.focal}
                inputMode="decimal"
                description="Including any reducer or flattener. Used for field of view."
              />
              <Field className="gap-1.5">
                <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
                <Textarea id={`${id}-notes`} value={values.notes ?? ""} onChange={(event) => set("notes")(event.target.value)} rows={2} />
              </Field>
            </>
          ) : null}
          {kind === "camera" ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <TextField id={`${id}-width`} label="Width (px)" value={values.width ?? ""} onChange={set("width")} error={errors.width} inputMode="numeric" />
                <TextField id={`${id}-height`} label="Height (px)" value={values.height ?? ""} onChange={set("height")} error={errors.height} inputMode="numeric" />
                <TextField id={`${id}-pixel`} label="Pixel size (µm)" value={values.pixel ?? ""} onChange={set("pixel")} error={errors.pixel} inputMode="decimal" />
              </div>
              <label htmlFor={`${id}-color`} className="flex items-center gap-2 text-sm">
                <Checkbox id={`${id}-color`} checked={values.color === "yes"} onCheckedChange={(checked) => set("color")(checked ? "yes" : "no")} />
                Colour sensor (one-shot colour)
              </label>
            </>
          ) : null}
          {kind === "telescope" ? (
            <div className="grid grid-cols-2 gap-3">
              <TextField id={`${id}-focal`} label="Focal length (mm)" value={values.focal ?? ""} onChange={set("focal")} error={errors.focal} inputMode="decimal" />
              <TextField id={`${id}-aperture`} label="Aperture (mm, optional)" value={values.aperture ?? ""} onChange={set("aperture")} error={errors.aperture} inputMode="decimal" />
            </div>
          ) : null}
          {kind === "filter" ? (
            <SelectField id={`${id}-category`} label="Category" value={values.category ?? "narrowband"} onChange={set("category")} items={FILTER_CATEGORIES} />
          ) : null}
          {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">{record ? "Save changes" : `Add ${noun}`}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function aliasesCell(aliases: string[]) {
  return aliases.length ? <span className="text-pretty">{aliases.join(", ")}</span> : <span className="text-muted-foreground">None</span>
}

function RowActions({ name, onEdit, onRemove }: { name: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${name}`}>
        Edit
      </Button>
      <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${name}`}>
        Remove
      </Button>
    </div>
  )
}

export function EquipmentPage() {
  const catalog = useStore((s) => s.catalog)
  const [editing, setEditing] = useState<{ kind: EquipmentKind; record: AnyRecord | null } | null>(null)
  const [removing, setRemoving] = useState<{ kind: EquipmentKind; record: AnyRecord } | null>(null)
  const [refusal, setRefusal] = useState<{ kind: EquipmentKind; message: string; trainIds: string[] } | null>(null)

  function askRemove(kind: EquipmentKind, record: AnyRecord) {
    const refused = removalRefusal(store.getState().catalog, kind, record.id)
    if (refused) {
      setRefusal({ kind, ...refused })
      return
    }
    setRefusal(null)
    setRemoving({ kind, record })
  }

  const actionColumn = <T extends AnyRecord>(kind: EquipmentKind): Column<T> => ({
    id: "actions",
    header: "Actions",
    align: "right",
    cell: (record) => <RowActions name={record.name} onEdit={() => setEditing({ kind, record })} onRemove={() => askRemove(kind, record)} />,
  })
  const sourceColumn = <T extends AnyRecord>(): Column<T> => ({ id: "source", header: "Source", cell: (r) => <StatusBadge kind="source" value={r.source} />, sortValue: (r) => r.source })

  const trains = Object.values(catalog.opticalTrains)
  const cameras = Object.values(catalog.cameras)
  const telescopes = Object.values(catalog.telescopes)
  const filters = Object.values(catalog.filters)

  function refusalNotice(kind: EquipmentKind): ReactNode {
    if (!refusal || refusal.kind !== kind) return null
    return (
      <Notice
        tone="refusal"
        title="Not removed"
        actions={refusal.trainIds.map((trainId) => {
          const train = catalog.opticalTrains[trainId]
          return train ? (
            <Button key={trainId} size="sm" variant="outline" onClick={() => setEditing({ kind: "train", record: train })}>
              Edit {train.name}
            </Button>
          ) : null
        })}
      >
        {refusal.message}
      </Notice>
    )
  }

  function addButton(kind: EquipmentKind) {
    return (
      <Button size="sm" variant="outline" onClick={() => setEditing({ kind, record: null })}>
        <Plus aria-hidden="true" data-icon="inline-start" />
        Add {KIND_COPY[kind].noun}
      </Button>
    )
  }

  function empty(kind: EquipmentKind, icon: typeof CameraIcon, description: string) {
    return (
      <EmptyState
        icon={icon}
        title={`No ${KIND_COPY[kind].plural} yet`}
        description={description}
        action={addButton(kind)}
        className="border-0"
      />
    )
  }

  return (
    <div>
      <PageHeader
        level={2}
        title="Equipment"
        description="Detected records come from file headers; Manual records are ones you entered. Associations always show the evidence they used."
      />
      <PageBody>
        <ReturnNotice task="Equipment" />

        <Section title="Optical trains" level={3} id="eq-trains" description="A camera behind a telescope at one effective focal length. Confirm equipment on a session links it to a train." actions={trains.length ? addButton("train") : null}>
          {refusalNotice("train")}
          <DataTable<OpticalTrain>
            label="Optical trains"
            scroll="none"
            rows={trains}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "name", direction: "asc" }}
            empty={empty("train", Aperture, "Indexing creates detected trains from INSTRUME and TELESCOP headers, or add one yourself.")}
            columns={[
              { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, rowHeader: true },
              { id: "camera", header: "Camera", cell: (r) => (r.cameraId ? (catalog.cameras[r.cameraId]?.name ?? <UnknownValue />) : <span className="text-muted-foreground">None</span>) },
              { id: "telescope", header: "Telescope", cell: (r) => (r.telescopeId ? (catalog.telescopes[r.telescopeId]?.name ?? <UnknownValue />) : <span className="text-muted-foreground">None</span>) },
              { id: "focal", header: "Focal length", cell: (r) => `${formatCount(r.effectiveFocalLengthMm)} mm`, sortValue: (r) => r.effectiveFocalLengthMm, align: "right" },
              sourceColumn<OpticalTrain>(),
              {
                id: "used",
                header: "Used by",
                cell: (r) => {
                  const usage = trainUsage(catalog, r.id)
                  const parts = [usage.sessions ? `${usage.sessions} ${usage.sessions === 1 ? "session" : "sessions"}` : null, usage.projects ? `${usage.projects} ${usage.projects === 1 ? "Project" : "Projects"}` : null].filter(Boolean)
                  return parts.length ? parts.join(" · ") : <span className="text-muted-foreground">Not used</span>
                },
              },
              actionColumn<OpticalTrain>("train"),
            ]}
          />
        </Section>

        <Section title="Cameras" level={3} id="eq-cameras" actions={cameras.length ? addButton("camera") : null}>
          {refusalNotice("camera")}
          <DataTable<Camera>
            label="Cameras"
            scroll="none"
            rows={cameras}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "name", direction: "asc" }}
            empty={empty("camera", CameraIcon, "Indexing adds detected cameras from INSTRUME headers, or add one yourself.")}
            columns={[
              { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, rowHeader: true },
              { id: "aliases", header: "Aliases", cell: (r) => aliasesCell(r.aliases), truncate: true },
              {
                id: "sensor",
                header: "Sensor",
                cell: (r) => (r.widthPx && r.pixelSizeUm ? `${formatCount(r.widthPx)} × ${formatCount(r.heightPx)} px · ${r.pixelSizeUm} µm` : <UnknownValue reason="Not recorded in the headers that detected this camera" />),
              },
              { id: "type", header: "Type", cell: (r) => (r.color ? "Colour" : "Mono") },
              sourceColumn<Camera>(),
              actionColumn<Camera>("camera"),
            ]}
          />
        </Section>

        <Section title="Telescopes" level={3} id="eq-telescopes" actions={telescopes.length ? addButton("telescope") : null}>
          {refusalNotice("telescope")}
          <DataTable<Telescope>
            label="Telescopes"
            scroll="none"
            rows={telescopes}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "name", direction: "asc" }}
            empty={empty("telescope", TelescopeIcon, "Indexing adds detected telescopes from TELESCOP and FOCALLEN headers, or add one yourself.")}
            columns={[
              { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, rowHeader: true },
              { id: "aliases", header: "Aliases", cell: (r) => aliasesCell(r.aliases), truncate: true },
              { id: "focal", header: "Focal length", cell: (r) => `${formatCount(r.focalLengthMm)} mm`, sortValue: (r) => r.focalLengthMm, align: "right" },
              { id: "aperture", header: "Aperture", cell: (r) => (r.apertureMm ? `${formatCount(r.apertureMm)} mm` : <UnknownValue label="Not set" />), align: "right" },
              sourceColumn<Telescope>(),
              actionColumn<Telescope>("telescope"),
            ]}
          />
        </Section>

        <Section title="Filters" level={3} id="eq-filters" description="Filter names group sessions by channel. Aliases match the FILTER header." actions={filters.length ? addButton("filter") : null}>
          {refusalNotice("filter")}
          <DataTable<FilterDef>
            label="Filters"
            scroll="none"
            rows={filters}
            getRowId={(r) => r.id}
            initialSort={{ columnId: "name", direction: "asc" }}
            empty={empty("filter", Filter, "Add the filters in your wheel so FILTER headers map to channels.")}
            columns={[
              { id: "name", header: "Name", cell: (r) => r.name, sortValue: (r) => r.name, rowHeader: true },
              { id: "category", header: "Category", cell: (r) => FILTER_CATEGORIES.find((c) => c.value === r.category)?.label ?? r.category, sortValue: (r) => r.category },
              { id: "aliases", header: "Aliases", cell: (r) => aliasesCell(r.aliases), truncate: true },
              sourceColumn<FilterDef>(),
              actionColumn<FilterDef>("filter"),
            ]}
          />
        </Section>
      </PageBody>

      <EquipmentDialog editing={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.record.name ?? ""}?`}
        description={`Removes this ${removing ? KIND_COPY[removing.kind].noun : "record"} from the catalog. Nothing else uses it.`}
        changes={[`Remove the ${removing ? KIND_COPY[removing.kind].noun : "record"} ${removing?.record.name ?? ""}`]}
        unchanged={["Observed header evidence on every session", "Every file on disk"]}
        confirmLabel={`Remove ${removing ? KIND_COPY[removing.kind].noun : "record"}`}
        tone="destructive"
        onConfirm={() => (removing ? removeEquipment(store.getState().catalog, removing.kind, removing.record.id) : undefined)}
      />
    </div>
  )
}
