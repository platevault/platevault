/**
 * Profile parts shared by Prepare and Settings › Applications: capability
 * evidence (D04, PREP-FR-01), the executable state, and the simulated
 * application chooser.
 */
import { useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ApplicationProfile } from "@/domain/types"
import { say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { locateExecutable } from "@/store/actions/settings"
import { T4Badge } from "./badges"
import { MODE_NAME, PRODUCT_KIND_NAME } from "@/domain/labels"

export function CapabilityList({ profile }: { profile: ApplicationProfile }) {
  const m = useMessages()
  const c = profile.capability
  const unsupported: string[] = []
  if (c.correctedMetadata === "none") unsupported.push(m.apps_unsupported_corrected())
  if (c.directSource === "none") unsupported.push(m.apps_unsupported_paths())
  if (c.directSource === "whole-folder") unsupported.push(m.apps_unsupported_file_list())
  if (c.productInputKinds.length === 0) unsupported.push(m.apps_unsupported_products())
  return (
    <div className="space-y-2">
      <KeyValueList
        items={[
          { label: m.apps_evidence(), value: <span className="text-pretty">{say(m, c.evidence)}</span>, source: c.verified ? m.apps_prototype_fixture() : undefined },
          {
            label: m.apps_input_writes(),
            value: <T4Badge value={c.inputWrite === "read-only" ? "write:read-only" : c.inputWrite === "write-prone" ? "write:write-prone" : "write:unknown"} />,
          },
          { label: m.apps_input_modes(), value: c.inputModes.length ? c.inputModes.map((mode) => say(m, MODE_NAME[mode])).join(", ") : m.apps_none_recorded() },
          {
            label: m.apps_direct_source(),
            value: c.directSource === "file-list" ? m.apps_direct_file_list() : c.directSource === "whole-folder" ? m.apps_direct_whole_folders() : m.location_links_none(),
          },
          { label: m.apps_product_inputs(), value: c.productInputKinds.length ? c.productInputKinds.map((k) => say(m, PRODUCT_KIND_NAME[k])).join(", ") : m.apps_none_recorded() },
          { label: m.apps_corrected_values(), value: c.correctedMetadata === "configuration" ? m.apps_corrected_through() : m.apps_corrected_not_through() },
        ]}
      />
      {unsupported.length > 0 ? (
        <p className="text-xs text-pretty text-muted-foreground">{m.apps_unsupported_list({ list: unsupported.join("; ") })}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{m.apps_rename_note()}</p>
      )}
    </div>
  )
}

export function ExecutableState({ profile }: { profile: ApplicationProfile }) {
  const m = useMessages()
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <T4Badge value={`executable:${profile.executableState}`} />
      {profile.executablePath ? <PathText path={profile.executablePath} className="min-w-0" /> : <span className="text-xs text-muted-foreground">{m.apps_not_located()}</span>}
    </span>
  )
}

export interface LocateDialogProps {
  profile: ApplicationProfile | null
  onOpenChange: (open: boolean) => void
  onLocated?: () => void
}

/** Prototype: simulated application chooser listing bundles on the simulated computer. */
export function LocateApplicationDialog({ profile, onOpenChange, onLocated }: LocateDialogProps) {
  const m = useMessages()
  const apps = useStore((s) => s.disk.apps)
  const [path, setPath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const legendId = useId()
  useEffect(() => {
    if (!profile) return
    const match = apps.find((a) => a.present && a.name === (profile.application === "generic" ? "" : profile.name.split(" /")[0]))
    // A recorded path whose bundle is gone is not preselected: confirming it would record the missing path again.
    const recorded = apps.find((a) => a.present && a.path === profile.executablePath)
    setPath(recorded?.path ?? match?.path ?? apps.find((a) => a.present)?.path ?? "")
    setError(null)
  }, [profile])
  if (!profile) return null
  const present = apps.filter((a) => a.present)
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{profile.application === "generic" ? m.apps_locate_any() : m.settings_locate_named({ name: profile.name })}</DialogTitle>
          <DialogDescription>{m.apps_locate_description()}</DialogDescription>
        </DialogHeader>
        <fieldset>
          <legend id={legendId} className="mb-2 text-sm font-medium">
            {m.settings_applications()}
          </legend>
          {present.length === 0 ? (
            <p className="text-sm text-muted-foreground">{m.apps_none_present()}</p>
          ) : (
            <RadioGroup aria-labelledby={legendId} value={path} onValueChange={(value) => setPath(String(value))} className="gap-1.5">
              {present.map((app) => (
                <label key={app.id} className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/60", path === app.path && "border-primary bg-primary/8")}>
                  <RadioGroupItem value={app.path} className="mt-0.5" />
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-medium">{app.name}</span>
                    <PathText path={app.path} className="text-muted-foreground" />
                  </span>
                </label>
              ))}
            </RadioGroup>
          )}
        </fieldset>
        {error ? <ActionError message={error} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {m.verb_cancel()}
          </Button>
          <Button
            disabled={!present.some((a) => a.path === path)}
            onClick={() => {
              const result = locateExecutable(profile.id, path)
              if (!result.ok) return setError(result.message)
              onLocated?.()
              onOpenChange(false)
            }}
          >
            {m.apps_use_this()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
