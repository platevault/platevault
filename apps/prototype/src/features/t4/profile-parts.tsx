/**
 * A profile's executable as Prepare shows it: what PlateVault detects there,
 * then the located path. Settings › Applications shows the same two facts
 * as table columns.
 */
import { useMessages } from "@/app/preferences"
import { PathText } from "@/components/app/data"
import { StatusBadge } from "@/components/app/status"
import type { ApplicationProfile } from "@/domain/types"

export function ExecutableState({ profile }: { profile: ApplicationProfile }) {
  const m = useMessages()
  return (
    <>
      <StatusBadge kind="executable" value={profile.executableState} />
      {profile.executablePath ? <PathText path={profile.executablePath} /> : m.apps_not_located()}
    </>
  )
}
