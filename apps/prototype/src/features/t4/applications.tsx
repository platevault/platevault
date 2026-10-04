/**
 * `/settings/applications` — Applications (PREP-FR-01, PREP-FR-02; J23 S8).
 * Profiles with their capability evidence, the located executable, and the
 * generic Open in… with launch arguments. A `return` search param links back
 * to the task that sent the user here.
 */
import { Link, useSearch } from "@tanstack/react-router"
import { ArrowLeft } from "lucide-react"
import { useId, useState } from "react"
import { ActionError, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { ApplicationProfile } from "@/domain/types"
import { useStore } from "@/store/core"
import { checkExecutable, setLaunchArgs, updateApp } from "./actions"
import { ProfileBadge } from "./badges"
import { CapabilityList, ExecutableState, LocateApplicationDialog } from "./profile-parts"
import { PrototypeControls } from "./prototype-controls"

const ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

function ProfileCard({ profile, onLocate }: { profile: ApplicationProfile; onLocate: () => void }) {
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
      {generic ? <p className="text-sm text-pretty text-muted-foreground">Launches any application with your arguments. It is not a verified preparation profile, so only Copy or Clone handoffs are offered.</p> : null}
      <CapabilityList profile={profile} />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <ExecutableState profile={profile} />
        <span className="flex gap-2">
          {profile.executablePath ? (
            <Button size="sm" variant="ghost" onClick={() => checkExecutable(profile.id)}>
              Check again
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={onLocate}>
            {profile.executablePath ? "Change…" : "Locate…"}
          </Button>
        </span>
      </div>
      {generic ? (
        <div className="space-y-1.5">
          <Label htmlFor={argsId}>Launch arguments</Label>
          <div className="flex gap-2">
            <Input id={argsId} className="font-mono text-xs" value={args ?? profile.launchArgs} placeholder={'e.g. --input "{viewFolder}"'} onChange={(e) => setArgs(e.target.value)} />
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
              Save arguments
            </Button>
            {args === null || args === profile.launchArgs ? <span className="self-center text-xs text-muted-foreground">Edit the arguments to save them.</span> : null}
          </div>
          {error ? <ActionError message={error} /> : null}
        </div>
      ) : null}
    </section>
  )
}

export function SettingsApplicationsPage() {
  const search = useSearch({ strict: false }) as { return?: string }
  const profiles = useStore((s) => s.catalog.profiles)
  const apps = useStore((s) => s.slices.t4.world.apps)
  const [locating, setLocating] = useState<ApplicationProfile | null>(null)
  const list = Object.values(profiles).sort((a, b) => ORDER.indexOf(a.application) - ORDER.indexOf(b.application))
  const back = search.return && search.return.startsWith("/") ? search.return : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Applications"
        description="Profiles PlateVault prepares inputs for. Capability claims come from recorded evidence only; PlateVault never runs processing."
        actions={
          back ? (
            <Button variant="outline" render={<Link to={back} />}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back to the task
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <Notice tone="info" title="Prototype: fixture capability evidence">
          Evidence below is fixture data. Real capability probes for PixInsight/WBPP, Siril and SETI Astro Suite Pro are not part of this prototype.
        </Notice>
        <div className="grid gap-4 xl:grid-cols-2">
          {list.map((profile) => (
            <ProfileCard key={profile.id} profile={profile} onLocate={() => setLocating(profile)} />
          ))}
        </div>
        <PrototypeControls title="applications on this computer">
          <ul className="divide-y rounded-md border">
            {apps.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="min-w-0">
                  <span className="block">{app.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">
                    {app.path} · {app.present ? "present" : "moved away"}
                    {app.launchFails ? " · next launch fails" : ""}
                  </span>
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => updateApp(app.id, { present: !app.present })}>
                    {app.present ? "Move away" : "Put back"}
                  </Button>
                  <Button size="sm" variant="outline" disabled={app.launchFails} onClick={() => updateApp(app.id, { launchFails: true })}>
                    Fail next launch
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
