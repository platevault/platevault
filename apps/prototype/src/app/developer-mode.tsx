/**
 * Windows Developer Mode (P-PREP3): symlinks need it on Windows. PlateVault
 * checks it at launch, in setup, in Settings › Applications and at Prepare;
 * these parts show the last check with its two ways forward. Nothing shows
 * off Windows.
 */
import { ExternalLink, RefreshCw } from "lucide-react"
import { Pill } from "@/components/app/pill"
import { Button } from "@/components/ui/button"
import { useStore } from "@/store/core"
import { checkDeveloperMode, openWindowsDeveloperSettings } from "@/store/actions/settings"
import { useMessages } from "./preferences"

/** Open Windows settings and Check again. */
export function DeveloperModeActions() {
  const m = useMessages()
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => openWindowsDeveloperSettings()}>
        <ExternalLink aria-hidden="true" data-icon="inline-start" />
        {m.settings_open_windows_settings()}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => checkDeveloperMode()}>
        <RefreshCw aria-hidden="true" data-icon="inline-start" />
        {m.apps_check_again()}
      </Button>
    </>
  )
}

/** "Windows Developer Mode · Off" with its actions while off; null off Windows. */
export function DeveloperModeStatus({ className }: { className?: string }) {
  const m = useMessages()
  const check = useStore((s) => s.settings.developerModeCheck)
  if (check === "not-windows") return null
  return (
    <div className={className} data-developer-mode={check}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>{m.settings_developer_mode()}</span>
        <Pill tone={check === "on" ? "success" : "warning"}>{check === "on" ? m.settings_developer_mode_on() : m.settings_developer_mode_off()}</Pill>
        {check === "off" ? <DeveloperModeActions /> : null}
      </div>
    </div>
  )
}
