/**
 * Add or edit a local Target record (LIB-FR-13). Coordinates are optional;
 * entered coordinates are labelled as user-provided, never as observed
 * capture evidence. Edits carry the revision the dialog opened with, so a
 * concurrent change is refused (D08).
 */
import { useEffect, useId, useRef, useState } from "react"
import { ActionError, SaveState } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { normalizeName } from "@/domain/sky"
import type { Target, TargetId } from "@/domain/types"
import { type CommitResult, store } from "@/store/core"
import { createTarget, type TargetInput, updateTarget } from "./actions"
import { findTargetByName } from "./model"

type FieldName = "name" | "coordinates" | "ra" | "dec"

interface FormValues {
  name: string
  aliases: string
  ra: string
  dec: string
  notes: string
}

function valuesOf(target: Target | undefined, name = ""): FormValues {
  return {
    name: target?.name ?? name,
    aliases: target?.aliases.join(", ") ?? "",
    ra: target?.ra?.toString() ?? "",
    dec: target?.dec?.toString() ?? "",
    notes: target?.notes ?? "",
  }
}

function validate(values: FormValues, exceptId: TargetId | undefined): { input: TargetInput | null; errors: Partial<Record<FieldName, string>> } {
  const errors: Partial<Record<FieldName, string>> = {}
  const name = values.name.trim()
  if (!name) errors.name = "Enter a Target name."
  else {
    const clash = findTargetByName(store.getState().catalog, name, exceptId)
    if (clash) errors.name = normalizeName(clash.name) === normalizeName(name) ? `A Target named ${clash.name} already exists.` : `${clash.name} already has the alias “${name}”.`
  }
  const raText = values.ra.trim()
  const decText = values.dec.trim()
  let ra: number | null = null
  let dec: number | null = null
  if (raText || decText) {
    if (!raText || !decText) errors.coordinates = "Enter both RA and Dec, or neither."
    else {
      ra = Number(raText)
      dec = Number(decText)
      if (!Number.isFinite(ra) || ra < 0 || ra >= 360) errors.ra = "RA must be between 0 and 360 degrees."
      if (!Number.isFinite(dec) || dec < -90 || dec > 90) errors.dec = "Dec must be between −90 and +90 degrees."
    }
  }
  if (Object.keys(errors).length > 0) return { input: null, errors }
  const aliases = values.aliases
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean)
  return { input: { name, aliases, ra, dec, notes: values.notes.trim() }, errors }
}

export function TargetRecordDialog({
  open,
  onOpenChange,
  target,
  initialName,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit this Target; omit to add a new one. */
  target?: Target
  initialName?: string
  onCreated?: (targetId: TargetId) => void
}) {
  const [values, setValues] = useState<FormValues>(() => valuesOf(target, initialName))
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({})
  const [commitError, setCommitError] = useState<Extract<CommitResult, { ok: false }> | null>(null)
  const [baseRevision, setBaseRevision] = useState(target?.revision ?? 0)
  const formRef = useRef<HTMLFormElement>(null)
  const ids = { name: useId(), aliases: useId(), ra: useId(), dec: useId(), notes: useId(), coordinates: useId() }

  useEffect(() => {
    if (!open) return
    const current = target ? store.getState().catalog.targets[target.id] : undefined
    setValues(valuesOf(current, initialName))
    setErrors({})
    setCommitError(null)
    setBaseRevision(current?.revision ?? 0)
  }, [open])

  function set(field: keyof FormValues, value: string) {
    setValues((v) => ({ ...v, [field]: value }))
    if (field === "ra" || field === "dec") setErrors((e) => ({ ...e, [field]: undefined, coordinates: undefined }))
    else if (field === "name") setErrors((e) => ({ ...e, name: undefined }))
  }

  function submit() {
    const { input, errors: found } = validate(values, target?.id)
    setErrors(found)
    if (!input) {
      // Move focus to the first field with an error so its message is read.
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid=true]")?.focus())
      return
    }
    if (target) {
      const result = updateTarget(target.id, input, baseRevision)
      if (!result.ok) return setCommitError(result)
      onOpenChange(false)
      return
    }
    const result = createTarget(input)
    if (!result.ok) return setCommitError(result)
    onOpenChange(false)
    if (result.targetId) onCreated?.(result.targetId)
  }

  const invalid = (field: FieldName) => Boolean(errors[field] || (field !== "name" && errors.coordinates))
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{target ? `Edit ${target.name}` : "Add a Target"}</DialogTitle>
          <DialogDescription>
            A local catalog record. It works without a network connection; coordinates you enter are labelled as entered by you.
          </DialogDescription>
        </DialogHeader>
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <FieldGroup className="gap-4">
            <Field data-invalid={Boolean(errors.name) || undefined}>
              <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
              <Input
                id={ids.name}
                value={values.name}
                onChange={(e) => set("name", e.target.value)}
                aria-invalid={Boolean(errors.name) || undefined}
                aria-describedby={errors.name ? `${ids.name}-error` : undefined}
                autoComplete="off"
                placeholder="e.g. NGC 7000"
              />
              <FieldError id={`${ids.name}-error`}>{errors.name}</FieldError>
            </Field>
            <Field>
              <FieldLabel htmlFor={ids.aliases}>Aliases</FieldLabel>
              <Input id={ids.aliases} value={values.aliases} onChange={(e) => set("aliases", e.target.value)} autoComplete="off" aria-describedby={`${ids.aliases}-hint`} />
              <FieldDescription id={`${ids.aliases}-hint`}>Separate aliases with commas, for example North America Nebula, Caldwell 20.</FieldDescription>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={invalid("ra") || undefined}>
                <FieldLabel htmlFor={ids.ra}>RA (degrees)</FieldLabel>
                <Input
                  id={ids.ra}
                  inputMode="decimal"
                  value={values.ra}
                  onChange={(e) => set("ra", e.target.value)}
                  aria-invalid={invalid("ra") || undefined}
                  aria-describedby={[errors.ra ? `${ids.ra}-error` : null, errors.coordinates ? ids.coordinates : null, `${ids.coordinates}-hint`].filter(Boolean).join(" ")}
                  placeholder="e.g. 314.75"
                  className="font-mono"
                />
                <FieldError id={`${ids.ra}-error`}>{errors.ra}</FieldError>
              </Field>
              <Field data-invalid={invalid("dec") || undefined}>
                <FieldLabel htmlFor={ids.dec}>Dec (degrees)</FieldLabel>
                <Input
                  id={ids.dec}
                  inputMode="decimal"
                  value={values.dec}
                  onChange={(e) => set("dec", e.target.value)}
                  aria-invalid={invalid("dec") || undefined}
                  aria-describedby={[errors.dec ? `${ids.dec}-error` : null, errors.coordinates ? ids.coordinates : null, `${ids.coordinates}-hint`].filter(Boolean).join(" ")}
                  placeholder="e.g. 44.53"
                  className="font-mono"
                />
                <FieldError id={`${ids.dec}-error`}>{errors.dec}</FieldError>
              </Field>
            </div>
            <p id={`${ids.coordinates}-hint`} className="-mt-2 text-sm text-muted-foreground">
              Optional. Leave both empty when the position is unknown.
            </p>
            {errors.coordinates ? (
              <p id={ids.coordinates} role="alert" className="-mt-2 text-sm text-destructive">
                {errors.coordinates}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor={ids.notes}>Notes</FieldLabel>
              <Textarea id={ids.notes} value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
            </Field>
            {commitError?.reason === "stale" ? (
              <SaveState
                state="stale"
                message={commitError.message}
                onReview={() => {
                  const current = target ? store.getState().catalog.targets[target.id] : undefined
                  setValues(valuesOf(current))
                  setBaseRevision(current?.revision ?? 0)
                  setCommitError(null)
                }}
              />
            ) : commitError ? (
              <ActionError message={commitError.message} onRetry={submit} />
            ) : null}
          </FieldGroup>
          <DialogFooter className="mt-4">
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">{target ? "Save Target" : "Add Target"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
