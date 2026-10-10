/**
 * `/settings/applications` — Applications (PREP-FR-01, PREP-FR-02; J23 S8).
 * One list of profiles: each names its capability claims as label and value
 * rows (the evidence sits in a note), the located executable, and, for the
 * generic Open in…, the launch arguments. A `return` search param links back
 * to the task that sent the user here.
 */
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { ActionError } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApplicationProfile } from "@/domain/types"
import { useStore } from "@/store/core"
import { checkExecutable, setLaunchArgs, updateApp } from "@/store/actions/settings"
import { ProfileBadge } from "./badges"
import { CapabilityNote, capabilityItems, ExecutableState, LocateApplicationDialog } from "./profile-parts"
import { PrototypeControls } from "./prototype-controls"

const ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

/** The launch arguments as one more label and value row of the profile's list. */
function LaunchArguments({ profile }: { profile: ApplicationProfile }) {
  const m = useMessages()
  const [args, setArgs] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const argsId = useId()
  const unchanged = args === null || args === profile.launchArgs
  return (
    <div className="contents">
      <dt className="self-center">
        <Label htmlFor={argsId} className="font-normal text-muted-foreground">
          {m.apps_launch_arguments()}
        </Label>
      </dt>
      <dd className="min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <Input
            id={argsId}
            className="min-w-0 flex-1 font-mono text-xs"
            value={args ?? profile.launchArgs}
            placeholder={m.apps_launch_placeholder({ token: "{viewFolder}" })}
            onChange={(e) => setArgs(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 whitespace-nowrap"
            disabled={unchanged}
            onClick={() => {
              const result = setLaunchArgs(profile.id, args ?? "")
              if (result.ok) {
                setArgs(null)
                setError(null)
              } else setError(result.message)
            }}
          >
            {m.apps_save_arguments()}
          </Button>
        </div>
        {error ? <ActionError message={error} /> : null}
      </dd>
    </div>
  )
}

function ProfileRow({ profile, onLocate }: { profile: ApplicationProfile; onLocate: () => void }) {
  const m = useMessages()
  const generic = profile.application === "generic"
  return (
    <li className="space-y-2 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="truncate text-sm font-semibold">
          {profile.name}
        </h3>
        <CapabilityNote profile={profile} />
        {generic ? <HelpTip>{m.apps_generic_description()}</HelpTip> : null}
        <ProfileBadge profile={profile} />
        <span className="flex-1" />
        {profile.executablePath ? (
          <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={() => checkExecutable(profile.id)}>
            {m.apps_check_again()}
          </Button>
        ) : null}
        <Button size="sm" variant="outline" className="whitespace-nowrap" onClick={onLocate}>
          {profile.executablePath ? m.apps_change() : m.apps_locate()}
        </Button>
      </div>
      {/* Not KeyValueList: its fixed 10rem label column leaves pt-BR's located path too little room at 1024 px. */}
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm">
        {[...capabilityItems(m, profile), { label: m.run_profile_application(), value: <ExecutableState profile={profile} /> }].map((item) => (
          <div key={item.label} className="contents">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className="min-w-0">{item.value}</dd>
          </div>
        ))}
        {generic ? <LaunchArguments profile={profile} /> : null}
      </dl>
    </li>
  )
}

export function SettingsApplicationsPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as { return?: string }
  const profiles = useStore((s) => s.catalog.profiles)
  const apps = useStore((s) => s.disk.apps)
  const [locating, setLocating] = useState<ApplicationProfile | null>(null)
  const list = Object.values(profiles).sort((a, b) => ORDER.indexOf(a.application) - ORDER.indexOf(b.application))
  const back = search.return && search.return.startsWith("/") ? search.return : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title={m.settings_applications()}
        actions={
          back ? (
            <Button variant="outline" render={<Link to={back} />}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              {m.apps_back_to_task()}
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <Box flush>
          <ul className="divide-y divide-separator">
            {list.map((profile) => (
              <ProfileRow key={profile.id} profile={profile} onLocate={() => setLocating(profile)} />
            ))}
          </ul>
        </Box>
        <PrototypeControls title={m.apps_controls_title()}>
          <ul className="divide-y rounded-md border">
            {apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block">{app.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {app.path} · {app.present ? m.apps_present() : m.apps_moved_away()}
                    {app.launchFails ? m.apps_next_launch_fails() : ""}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => updateApp(app.id, { present: !app.present })}>
                    {app.present ? m.apps_move_away() : m.apps_put_back()}
                  </Button>
                  <Button size="sm" variant="outline" disabled={app.launchFails} onClick={() => updateApp(app.id, { launchFails: true })}>
                    {m.apps_fail_next_launch()}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </PrototypeControls>
      </PageBody>
      <LocateApplicationDialog profile={locating} onOpenChange={(open) => !open && setLocating(null)} />
    </div>
  )
}
