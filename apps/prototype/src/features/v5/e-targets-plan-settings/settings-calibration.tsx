/**
 * S16 Settings › Calibration (slice E; P-CAL3). Keep raw calibration frames:
 * off by default, so a calibration process moves its raw frames to the OS
 * Trash once their master registers; on, they stay where they are. Stacking
 * hands off to an application profile (Settings › Applications) and the
 * structured storage layout is the master naming templates (Settings ›
 * Naming); both are linked, not repeated.
 */
import { Link } from "@tanstack/react-router"
import { useId, useState } from "react"
import { Box } from "@/components/app/box"
import { PageBody, PageHeader } from "@/components/app/page"
import { Refusal, type RefusalProps } from "@/components/app/refusal"
import { HelpTip } from "@/components/app/tips"
import { Switch } from "@/components/ui/switch"
import { calibrationStorage, stackProfiles } from "@/domain/calibration-process"
import { namingTemplate } from "@/domain/templates"
import type { NamingFrameType } from "@/domain/types"
import { ReturnNotice } from "@/features/t1/settings/settings-layout"
import { setKeepRawCalibration } from "@/store/actions/calibration"
import { useStore } from "@/store/core"

const MASTER_TYPES: NamingFrameType[] = ["master-flat", "master-dark", "master-bias", "master-dark-flat"]

export function CalibrationSettingsPage() {
  const keep = useStore((s) => s.settings.keepRawCalibration)
  const storage = useStore((s) => calibrationStorage(s.catalog))
  const naming = useStore((s) => s.settings.naming)
  const tools = useStore((s) => stackProfiles(s.catalog))
  const [failure, setFailure] = useState<RefusalProps | null>(null)
  const id = useId()

  function toggle(next: boolean) {
    const result = setKeepRawCalibration(next)
    setFailure(result.ok ? null : { action: "Keep raws not saved", reason: result.message, blockers: [] })
  }

  return (
    <div>
      <PageHeader level={2} title="Calibration" />
      <PageBody>
        <ReturnNotice />
        <Box title="Raw frames" id="cal-settings-raws">
          <div className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5">
              <label htmlFor={`${id}-keep`} className="text-sm font-medium">
                Keep raw calibration frames
              </label>
              <HelpTip label="About keeping raw calibration frames">Off: raws go to the OS Trash once their master registers.</HelpTip>
            </span>
            <Switch id={`${id}-keep`} checked={keep} onCheckedChange={(checked) => toggle(checked)} data-keep-raws />
          </div>
          {failure ? <Refusal {...failure} className="mt-2" /> : null}
        </Box>
        <Box title="Masters" id="cal-settings-masters">
          <dl className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Storage</dt>
            <dd className="min-w-0 truncate font-mono text-xs" title={storage?.path}>
              {storage ? storage.path : "–"}
            </dd>
            <dd>
              <Link to="/settings/locations" className="text-link hover:underline">
                Locations
              </Link>
            </dd>
            <dt className="text-muted-foreground">Layout</dt>
            <dd className="min-w-0 space-y-0.5 font-mono text-xs">
              {MASTER_TYPES.map((type) => (
                <div key={type} className="truncate">
                  {namingTemplate(naming, type)}
                </div>
              ))}
            </dd>
            <dd>
              <Link to="/settings/naming" className="text-link hover:underline">
                Naming
              </Link>
            </dd>
            <dt className="text-muted-foreground">Tools</dt>
            <dd>{tools.map((t) => t.name).join(", ") || "–"}</dd>
            <dd>
              <Link to="/settings/applications" className="text-link hover:underline">
                Applications
              </Link>
            </dd>
          </dl>
        </Box>
      </PageBody>
    </div>
  )
}
