/**
 * Windows Developer Mode (P-PREP3): symlinks need it on Windows. PlateVault
 * checks it at launch, in setup, in Settings › Applications and at Prepare;
 * these parts show the last check with its two ways forward. Nothing shows
 * off Windows.
 */
import { ExternalLink, RefreshCw } from "lucide-react"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { SettingsRow } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status"
import { useStore } from "@/store/core"
import { checkDeveloperMode, openWindowsDeveloperSettings } from "@/store/actions/settings"
import { useMessages } from "./preferences"

/** Open Windows settings and Check again. */
export function DeveloperModeActions() {
  const m = useMessages()
  const open: Action = { id: "open-windows-settings", label: m.settings_open_windows_settings(), icon: ExternalLink, run: () => openWindowsDeveloperSettings() }
  const recheck: Action = { id: "check-developer-mode", label: m.apps_check_again(), icon: RefreshCw, run: () => checkDeveloperMode() }
  return (
    <>
      <ActionButton action={open} />
      <ActionButton action={recheck} />
    </>
  )
}

/** "Windows Developer Mode · Off" as a settings row, with its actions while off; null off Windows. */
export function DeveloperModeStatus() {
  const m = useMessages()
  const check = useStore((s) => s.settings.developerModeCheck)
  if (check === "not-windows") return null
  return (
    <SettingsRow label={m.settings_developer_mode()}>
      <StatusBadge kind="developerMode" value={check} />
      {check === "off" ? <DeveloperModeActions /> : null}
    </SettingsRow>
  )
}
