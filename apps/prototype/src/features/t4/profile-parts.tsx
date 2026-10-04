/**
 * Profile parts shared by Prepare and Settings › Applications: capability
 * evidence (D04, PREP-FR-01), the executable state, and the simulated
 * application chooser.
 */
import { useEffect, useId, useState } from "react"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ApplicationProfile } from "@/domain/types"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { locateExecutable } from "./actions"
import { T4Badge } from "./badges"
import { MODE_LABEL } from "./domain"

const RESULT_KIND_LABEL: Record<string, string> = {
  "final-image": "final images",
  "linear-integration": "linear integrations",
  "channel-product": "channel products",
  "mosaic-panel": "mosaic panels",
}

export function CapabilityList({ profile }: { profile: ApplicationProfile }) {
  const c = profile.capability
  const unsupported: string[] = []
  if (c.correctedMetadata === "none") unsupported.push("reading corrected values through configuration")
  if (c.directSource === "none") unsupported.push("passing exact source paths")
  if (c.directSource === "whole-folder") unsupported.push("handing off an exact file list (it reads whole folders)")
  if (c.productInputKinds.length === 0) unsupported.push("accepted Results as inputs")
  return (
    <div className="space-y-2">
      <KeyValueList
        items={[
          { label: "Evidence", value: <span className="text-pretty">{c.evidence}</span>, source: c.verified ? "Prototype fixture" : undefined },
          {
            label: "Input writes",
            value: <T4Badge value={c.inputWrite === "read-only" ? "write:read-only" : c.inputWrite === "write-prone" ? "write:write-prone" : "write:unknown"} />,
          },
          { label: "Input modes", value: c.inputModes.length ? c.inputModes.map((m) => MODE_LABEL[m]).join(", ") : "None recorded" },
          { label: "Direct source", value: c.directSource === "file-list" ? "Exact file list" : c.directSource === "whole-folder" ? "Whole folders only" : "Not supported" },
          { label: "Product inputs", value: c.productInputKinds.length ? c.productInputKinds.map((k) => RESULT_KIND_LABEL[k] ?? k).join(", ") : "None recorded" },
          { label: "Corrected values", value: c.correctedMetadata === "configuration" ? "Through configuration" : "Not through configuration" },
        ]}
      />
      {unsupported.length > 0 ? (
        <p className="text-xs text-pretty text-muted-foreground">
          Not supported: {unsupported.join("; ")}. Renaming files never overrides header values.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Renaming files never overrides header values.</p>
      )}
    </div>
  )
}

export function ExecutableState({ profile }: { profile: ApplicationProfile }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      <T4Badge value={`executable:${profile.executableState}`} />
      {profile.executablePath ? <PathText path={profile.executablePath} className="min-w-0" /> : <span className="text-xs text-muted-foreground">No application located</span>}
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
  const apps = useStore((s) => s.slices.t4.world.apps)
  const [path, setPath] = useState("")
  const [error, setError] = useState<string | null>(null)
  const legendId = useId()
  useEffect(() => {
    if (!profile) return
    const match = apps.find((a) => a.present && a.name === (profile.application === "generic" ? "" : profile.name.split(" /")[0]))
    setPath(profile.executablePath ?? match?.path ?? apps.find((a) => a.present)?.path ?? "")
    setError(null)
  }, [profile])
  if (!profile) return null
  const present = apps.filter((a) => a.present)
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Locate {profile.application === "generic" ? "an application" : profile.name}</DialogTitle>
          <DialogDescription>Prototype: simulated application chooser. It lists application bundles on the simulated computer and records the path only; nothing is launched.</DialogDescription>
        </DialogHeader>
        <fieldset>
          <legend id={legendId} className="mb-2 text-sm font-medium">
            Applications
          </legend>
          {present.length === 0 ? (
            <p className="text-sm text-muted-foreground">No application bundle is present. Restore one in this step's prototype controls.</p>
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
            Cancel
          </Button>
          <Button
            disabled={!path}
            onClick={() => {
              const result = locateExecutable(profile.id, path)
              if (!result.ok) return setError(result.message)
              onLocated?.()
              onOpenChange(false)
            }}
          >
            Use this application
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
