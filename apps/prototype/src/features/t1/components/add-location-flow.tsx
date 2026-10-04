/**
 * Add a location (J19 S2-S4, flow A1-A2): the simulated folder picker first,
 * then a short dialog to confirm the path, display name and role. Registering
 * records access and indexing intent only (LIB-FR-02); nothing is indexed until
 * the user starts indexing.
 */
import { useId, useRef, useState } from "react"
import { ActionError } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { PathText } from "@/components/app/data"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { LocationId, LocationRole } from "@/domain/types"
import { store, useStore } from "@/store/core"
import { type LocationErrors, registerLocation, ROLE_COPY, ROLE_ORDER, suggestDisplayName, validateLocation } from "../lib/locations"
import { FieldMessage, focusFirstInvalid, TextField } from "./form-field"

export interface AddLocationFlowProps {
  /** Role chosen by the button that opened the flow; `null` lets the user pick it. */
  role: LocationRole | null
  /** `true` opens the folder picker. The parent resets it through `onClose`. */
  open: boolean
  onClose: () => void
  onAdded?: (id: LocationId) => void
  /** Route that owns the outcome, recorded in Activity. */
  href: string
  /** Roles offered when `role` is null (onboarding offers only three). */
  roles?: LocationRole[]
}

export function AddLocationFlow({ role, open, onClose, onAdded, href, roles = ROLE_ORDER }: AddLocationFlowProps) {
  const [step, setStep] = useState<"pick" | "details">("pick")
  const [path, setPath] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [chosenRole, setChosenRole] = useState<LocationRole>(role ?? "captures")
  const [errors, setErrors] = useState<LocationErrors>({})
  const [writeError, setWriteError] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  const ids = { name: useId(), role: useId(), path: useId() }
  // Open where the user registered the last folder, as an OS dialog remembers it.
  const lastParent = useStore((s) => {
    const latest = Object.values(s.catalog.locations).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))[0]
    return latest ? latest.path.slice(0, latest.path.lastIndexOf("/")) : null
  })
  const effectiveRole = role ?? chosenRole
  // The picker reports Choose and then closes itself; that close must not end the flow.
  const justChose = useRef(false)

  function close() {
    setStep("pick")
    setPath("")
    setErrors({})
    setWriteError(null)
    onClose()
  }

  function chose(next: string) {
    justChose.current = true
    setPath(next)
    setDisplayName(suggestDisplayName(store.getState().disk, next))
    setErrors({})
    setWriteError(null)
    setStep("details")
  }

  function submit() {
    const draft = { path, displayName, role: effectiveRole }
    const found = validateLocation(store.getState().catalog, draft)
    setErrors(found)
    if (found.path || found.displayName) {
      focusFirstInvalid(form.current)
      return
    }
    const { result, id } = registerLocation(draft, href)
    if (!result.ok || !id) {
      setWriteError(result.ok ? "Location registration was not saved." : result.message)
      return
    }
    close()
    onAdded?.(id)
  }

  const copy = ROLE_COPY[effectiveRole]

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
        title={role ? copy.picker : "Choose a folder"}
        description="Prototype folder chooser: volumes and folders come from the simulated disk. Choosing a folder does not change it."
        initialPath={path || lastParent}
        onChoose={chose}
      />
      <Dialog open={open && step === "details"} onOpenChange={(next) => !next && close()}>
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
              <DialogTitle>Add location</DialogTitle>
              <DialogDescription>Registering records access and indexing intent. Nothing in the folder is copied, renamed, moved or deleted.</DialogDescription>
            </DialogHeader>
            <Field className="gap-1.5" data-invalid={errors.path ? true : undefined}>
              <span id={ids.path} className="text-sm font-medium">
                Folder
              </span>
              <div
                role="group"
                aria-labelledby={ids.path}
                aria-describedby={errors.path ? `${ids.path}-error` : undefined}
                aria-invalid={errors.path ? true : undefined}
                tabIndex={errors.path ? -1 : undefined}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 outline-none aria-invalid:border-destructive"
              >
                <PathText path={path} className="min-w-0 flex-1" />
                <Button type="button" size="sm" variant="ghost" onClick={() => setStep("pick")}>
                  Choose a different folder
                </Button>
              </div>
              <FieldMessage id={`${ids.path}-error`} message={errors.path} />
            </Field>
            <TextField
              id={ids.name}
              label="Display name"
              value={displayName}
              onChange={setDisplayName}
              error={errors.displayName}
              description="Shown in lists and status messages. You can change it later."
              autoFocus
            />
            {role ? null : (
              <Field className="gap-1.5">
                <FieldLabel id={ids.role}>Role</FieldLabel>
                <Select
                  items={roles.map((r) => ({ value: r, label: ROLE_COPY[r].title }))}
                  value={chosenRole}
                  onValueChange={(value) => setChosenRole(value as LocationRole)}
                >
                  <SelectTrigger aria-labelledby={ids.role} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_COPY[r].title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{ROLE_COPY[chosenRole].description}</p>
              </Field>
            )}
            {writeError ? <ActionError message={writeError} onRetry={submit} /> : null}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <Button type="submit">Add {copy.noun} location</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
