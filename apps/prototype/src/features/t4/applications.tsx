/**
 * `/settings/applications` — Applications (PREP-FR-01, PREP-FR-02; J23 S8).
 * Profiles with their capability evidence, the located executable, and the
 * generic Open in… with launch arguments. A `return` search param links back
 * to the task that sent the user here.
 */
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApplicationProfile } from "@/domain/types"
import { useStore } from "@/store/core"
import { checkExecutable, setLaunchArgs, updateApp } from "@/store/actions/settings"
import { ProfileBadge } from "./badges"
import { CapabilityList, ExecutableState, LocateApplicationDialog } from "./profile-parts"
import { PrototypeControls } from "./prototype-controls"

const ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

function ProfileCard({ profile, onLocate }: { profile: ApplicationProfile; onLocate: () => void }) {
  const m = useMessages()
  const [args, setArgs] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const argsId = useId()
  const generic = profile.application === "generic"
  return (
    <section aria-labelledby={`${profile.id}-title`} className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${profile.id}-title`} className="text-sm font-semibold">
            {profile.name}
          </h3>
          <ProfileBadge profile={profile} />
        </div>
      </div>
      {generic ? <p className="text-sm text-pretty text-muted-foreground">{m.apps_generic_description()}</p> : null}
      <CapabilityList profile={profile} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <ExecutableState profile={profile} />
        <span className="flex gap-2">
          {profile.executablePath ? (
            <Button size="sm" variant="ghost" onClick={() => checkExecutable(profile.id)}>
              {m.apps_check_again()}
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onLocate}>
            {profile.executablePath ? m.apps_change() : m.apps_locate()}
          </Button>
        </span>
      </div>
      {generic ? (
        <div className="space-y-1.5">
          <Label htmlFor={argsId}>{m.apps_launch_arguments()}</Label>
          <div className="flex gap-2">
            <Input
              id={argsId}
              className="font-mono text-xs"
              value={args ?? profile.launchArgs}
              placeholder={m.apps_launch_placeholder({ token: "{viewFolder}" })}
              onChange={(e) => setArgs(e.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={args === null || args === profile.launchArgs}
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
            {args === null || args === profile.launchArgs ? <span className="self-center text-xs text-muted-foreground">{m.apps_edit_to_save()}</span> : null}
          </div>
          {error ? <ActionError message={error} /> : null}
        </div>
      ) : null}
    </section>
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
        description={m.apps_description()}
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
        <Notice tone="info" title={m.apps_fixture_title()}>
          {m.apps_fixture_body()}
        </Notice>
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} onLocate={() => setLocating(profile)} />
          ))}
        </div>
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
