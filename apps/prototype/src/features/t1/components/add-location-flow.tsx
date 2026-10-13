/**
 * Add a location (J19 S2-S4, flow A1-A2): the folder chooser first, then a
 * short dialog to confirm the folder, display name and role. Registering
 * records access and indexing intent only (LIB-FR-02); nothing is indexed
 * until the user starts indexing.
 */
import { useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { PathField, SelectField, TextField } from "@/components/app/fields"
import { FolderPicker } from "@/components/app/folder-picker"
import { FormDialog } from "@/components/app/form-dialog"
import type { LocationId, LocationRole } from "@/domain/types"
import { store, useStore } from "@/store/core"
import { registerLocation, ROLE_COPY, ROLE_ORDER, suggestDisplayName, validateLocation } from "../lib/locations"
import { blockedByErrors } from "./form-blockers"

export interface AddLocationFlowProps {
  /** Role chosen by the button that opened the flow; `null` lets the user pick it. */
  role: LocationRole | null
  /** `true` opens the folder chooser. The parent resets it through `onClose`. */
  open: boolean
  onClose: () => void
  onAdded?: (id: LocationId) => void
  /** Route that owns the outcome, recorded in Activity. */
  href: string
  /** Roles offered when `role` is null (onboarding offers only three). */
  roles?: LocationRole[]
}

export function AddLocationFlow({ role, open, onClose, onAdded, href, roles = ROLE_ORDER }: AddLocationFlowProps) {
  const m = useMessages()
  const [step, setStep] = useState<"pick" | "details">("pick")
  const [path, setPath] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [nameTouched, setNameTouched] = useState(false)
  const [chosenRole, setChosenRole] = useState<LocationRole>(role ?? "captures")
  // Open where the user registered the last folder, as an OS dialog remembers it.
  const lastParent = useStore((s) => {
    const latest = Object.values(s.catalog.locations).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))[0]
    return latest ? latest.path.slice(0, latest.path.lastIndexOf("/")) : null
  })
  const effectiveRole = role ?? chosenRole
  // The chooser reports Choose and then closes itself; that close must not end the flow.
  const justChose = useRef(false)

  function close() {
    setStep("pick")
    setPath("")
    setNameTouched(false)
    onClose()
  }

  function pathChanged(next: string) {
    setPath(next)
    if (!nameTouched) setDisplayName(suggestDisplayName(store.getState().disk, next))
  }

  function chose(next: string) {
    justChose.current = true
    pathChanged(next)
    setStep("details")
  }

  const draft = { path, displayName, role: effectiveRole }
  const errors = validateLocation(store.getState().catalog, draft)
  const label = m.storage_add_location()
  const confirm: Action = {
    id: "add-location",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () => {
      const { result, id } = registerLocation(draft, href)
      if (!result.ok) return result
      if (!id) return { ok: false, reason: "write-failed", message: m.location_not_saved() }
      onAdded?.(id)
      return result
    },
  }

  return (
    <>
      <FolderPicker
        open={open && step === "pick"}
        onOpenChange={(next) => {
          if (next) return
          if (justChose.current) {
            justChose.current = false
            return
          }
          // Cancel: back to the details when re-picking, else the flow ends.
          if (path) setStep("details")
          else close()
        }}
        title={role ? ROLE_COPY[effectiveRole].picker : m.import_choose_a_folder()}
        initialPath={path || lastParent}
        onChoose={chose}
      />
      <FormDialog open={open && step === "details"} onOpenChange={(next) => !next && close()} title={label} confirm={confirm}>
        <PathField
          mode="folder"
          label={m.location_folder()}
          value={path || null}
          onChange={pathChanged}
          pickerTitle={ROLE_COPY[effectiveRole].picker}
          initialPath={path || lastParent}
          error={errors.path}
        />
        <TextField
          label={m.location_display_name()}
          value={displayName}
          onChange={(value) => {
            setDisplayName(value)
            setNameTouched(true)
          }}
          error={nameTouched ? errors.displayName : undefined}
          autoFocus
        />
        {role ? null : (
          <SelectField label={m.location_role()} value={chosenRole} options={roles.map((r) => ({ value: r, label: ROLE_COPY[r].title }))} onChange={setChosenRole} />
        )}
      </FormDialog>
    </>
  )
}
