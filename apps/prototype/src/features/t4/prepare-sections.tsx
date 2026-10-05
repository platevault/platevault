/**
 * Prepare plan sections (flow E3, E4, F1-F3): application profile, corrected
 * metadata, input mode and locations. Every choice is explicit; nothing here
 * writes a file.
 */
import { Link } from "@tanstack/react-router"
import { FolderOpen, RotateCcw } from "lucide-react"
import { useId, useState } from "react"
import { PathText } from "@/components/app/data"
import { ActionError, Notice, UnknownValue } from "@/components/app/feedback"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { FolderPicker } from "@/components/app/folder-picker"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import type { ApplicationProfile, InputMode, View } from "@/domain/types"
import { formatBytes, formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import type { PrepDraft } from "@/store/slices/t4"
import { checkExecutable, chooseProfile, chooseViewParent, setLaunchArgs, updatePrep } from "./actions"
import { ProfileBadge } from "./badges"
import { FIELD_KEYWORD, FIELD_LABEL, METADATA_CHOICE_LABEL, type MetadataChoice, MODE_LABEL, type PreparationPlan, uniqueName } from "./domain"
import { CapabilityList, ExecutableState, LocateApplicationDialog } from "./profile-parts"

const PROFILE_ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

function OptionCard({ value, current, disabled, children }: { value: string; current: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label
      className={cn(
        "flex items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/60",
        value === current && "border-primary bg-primary/8",
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0 flex-1 space-y-1">{children}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Application (E3)
// ---------------------------------------------------------------------------

export function ApplicationSection({ view, plan, locked }: { view: View; plan: PreparationPlan; locked: boolean }) {
  const profiles = useStore((s) => s.catalog.profiles)
  const [locating, setLocating] = useState<ApplicationProfile | null>(null)
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [args, setArgs] = useState<string | null>(null)
  const legendId = useId()
  const argsId = useId()
  const list = Object.values(profiles).sort((a, b) => PROFILE_ORDER.indexOf(a.application) - PROFILE_ORDER.indexOf(b.application))
  const profile = plan.profile

  function pick(id: string) {
    const attempt = () => {
      const result = chooseProfile(view, id)
      setError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  return (
    <Section id="prep-application" title="Application" level={3} description="PlateVault prepares inputs and opens the application; you run processing there.">
      <fieldset disabled={locked} className="space-y-2">
        <legend id={legendId} className="sr-only">
          Application profile
        </legend>
        <RadioGroup aria-labelledby={legendId} value={view.profileId ?? ""} onValueChange={(value) => pick(String(value))} className="grid gap-1.5 lg:grid-cols-2">
          {list.map((p) => (
            <OptionCard key={p.id} value={p.id} current={view.profileId ?? ""} disabled={locked}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <ProfileBadge profile={p} />
              </span>
              <span className="block text-xs text-muted-foreground">
                {p.application === "generic" ? "A configured executable and launch arguments. Not a verified preparation profile." : p.capability.verified ? "Maintained profile with recorded capability evidence." : "No capability evidence recorded yet."}
              </span>
            </OptionCard>
          ))}
        </RadioGroup>
      </fieldset>
      {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}
      {profile ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">{profile.name} capabilities</h4>
            <ProfileBadge profile={profile} />
          </div>
          {profile.application === "generic" ? (
            <Notice tone="warning" title="Not a verified preparation profile">
              Open in… launches the executable you choose with your arguments. PlateVault claims nothing about how it reads inputs, so Linked View and Direct source are refused.
            </Notice>
          ) : null}
          <CapabilityList profile={profile} />
          <div className="space-y-1.5 border-t pt-3">
            <h5 className="text-xs font-medium text-muted-foreground">Executable</h5>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ExecutableState profile={profile} />
              <span className="flex gap-2">
                {profile.executablePath ? (
                  <Button size="sm" variant="ghost" onClick={() => checkExecutable(profile.id)}>
                    Check again
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setLocating(profile)}>
                  {profile.executablePath ? "Change…" : `Locate ${profile.application === "generic" ? "application" : profile.name.split(" /")[0]}…`}
                </Button>
              </span>
            </div>
            {profile.executableState === "missing" ? <p className="text-xs text-destructive">Not found at the located path. Locate it again before opening.</p> : null}
            <p className="text-xs text-muted-foreground">
              Needed to open the application, not to prepare. Also in{" "}
              <Link to="/settings/applications" search={{ return: `/views/${view.id}/prepare` }} className="text-primary underline-offset-4 hover:underline">
                Settings › Applications
              </Link>
              .
            </p>
          </div>
          {profile.application === "generic" ? (
            <div className="space-y-1.5 border-t pt-3">
              <Label htmlFor={argsId}>Launch arguments</Label>
              <div className="flex gap-2">
                <Input
                  id={argsId}
                  className="font-mono text-xs"
                  value={args ?? profile.launchArgs}
                  placeholder={'e.g. --input "{viewFolder}"'}
                  onChange={(event) => setArgs(event.target.value)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={args === null || args === profile.launchArgs}
                  onClick={() => {
                    const result = setLaunchArgs(profile.id, args ?? "")
                    if (result.ok) setArgs(null)
                    else setError({ message: result.message, retry: () => setLaunchArgs(profile.id, args ?? "") })
                  }}
                >
                  Save arguments
                </Button>
                {args === null || args === profile.launchArgs ? <span className="self-center text-xs text-muted-foreground">Edit the arguments to save them.</span> : null}
              </div>
              <p className="text-xs text-muted-foreground">{"{viewFolder}"} is replaced with the prepared View folder.</p>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Choose an application to see its capabilities.</p>
      )}
      <LocateApplicationDialog profile={locating} onOpenChange={(open) => !open && setLocating(null)} />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Corrected metadata (E4)
// ---------------------------------------------------------------------------

export function MetadataSection({ view, plan, draft, locked }: { view: View; plan: PreparationPlan; draft: PrepDraft; locked: boolean }) {
  const appName = plan.profile?.name ?? "the application"
  /** Sentence-initial form. */
  const AppName = plan.profile?.name ?? "The application"
  const isolated = plan.mode === "copy" || plan.mode === "clone"
  return (
    <Section
      id="prep-metadata"
      title="Corrected metadata"
      level={3}
      description={`Catalog values that ${appName} will not read from the files. Originals and links are never patched.`}
    >
      {plan.diffs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No catalog value in this View differs from its source headers.</p>
      ) : (
        <ul className="space-y-3">
          {plan.diffs.map((diff) => {
            const choice = plan.metadata[diff.key] ?? null
            const configSupported = plan.profile?.capability.correctedMetadata === "configuration"
            const effective =
              choice === "patched-copy" && isolated
                ? `Effective value: ${diff.catalogValue} in isolated patched ${plan.mode === "clone" ? "clones" : "copies"}. Originals unchanged.`
                : choice === "patched-copy"
                  ? `Patched copies need Copy or Clone. ${MODE_LABEL[plan.mode]} cannot carry a patched value.`
                  : choice === "configuration"
                    ? `Effective value: ${diff.catalogValue}, through ${appName}'s configuration. Files not patched.`
                    : choice === "accept-source"
                      ? `Effective value: ${diff.sourceValue ?? `absent (no ${FIELD_KEYWORD[diff.field]})`}, the source header. Materialization: not patched. The correction is not delivered.`
                      : choice === "excluded"
                        ? `${plural(diff.assetIds.length, "input")} excluded from this handoff. The frames stay in the View.`
                        : "Choose how this value reaches the application."
            const name = `${formatNight(diff.session.night)} ${diff.session.channel ?? ""}`.trim()
            return (
              <li key={diff.key} className="space-y-2 rounded-lg border bg-card p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {name} · {plural(diff.assetIds.length, "frame")} · {FIELD_LABEL[diff.field]}
                  </span>
                  <span className="text-xs text-muted-foreground">{diff.basis}</span>
                </div>
                <dl className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Catalog value</dt>
                  <dd className="tabular-nums">{diff.catalogValue}</dd>
                  <dt className="text-muted-foreground">{AppName} reads</dt>
                  <dd className="tabular-nums">{diff.sourceValue ?? <UnknownValue label={`Absent (no ${FIELD_KEYWORD[diff.field]})`} />}</dd>
                </dl>
                <fieldset disabled={locked}>
                  <legend className="sr-only">How the corrected {FIELD_LABEL[diff.field].toLowerCase()} for {name} reaches the application</legend>
                  <RadioGroup
                    value={choice ?? ""}
                    onValueChange={(value) => updatePrep(view.id, { metadata: { ...draft.metadata, [diff.key]: String(value) as MetadataChoice } })}
                    className="grid gap-1.5 lg:grid-cols-2"
                  >
                    {(["configuration", "patched-copy", "accept-source", "excluded"] as MetadataChoice[]).map((option) => {
                      const disabled = locked || (option === "configuration" && !configSupported)
                      return (
                        <OptionCard key={option} value={option} current={choice ?? ""} disabled={disabled}>
                          <span className="block font-medium">{METADATA_CHOICE_LABEL[option]}</span>
                          <span className="block text-xs text-pretty text-muted-foreground">
                            {option === "configuration"
                              ? configSupported
                                ? `${AppName} reads the corrected value from its configuration.`
                                : `Not supported: ${appName} cannot read corrected values through configuration.`
                              : option === "patched-copy"
                                ? isolated
                                  ? "Only the isolated entries carry the patched header; original hashes stay identical."
                                  : "Needs Copy or Clone; switch the input mode below."
                                : option === "accept-source"
                                  ? "Hand off the header value as it is, for this handoff only."
                                  : "Leave these inputs out of this handoff. Unknown or omitted inputs never count as prepared."}
                          </span>
                        </OptionCard>
                      )
                    })}
                  </RadioGroup>
                </fieldset>
                <p className={cn("text-xs text-pretty", choice === "patched-copy" && !isolated ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
                  {effective}
                </p>
                {choice === "patched-copy" && !isolated && !locked ? (
                  <Button size="sm" variant="outline" onClick={() => updatePrep(view.id, { mode: "copy" })}>
                    Switch to Copy
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Input mode (F1)
// ---------------------------------------------------------------------------

export function ModeSection({ view, plan, draft, locked }: { view: View; plan: PreparationPlan; draft: PrepDraft; locked: boolean }) {
  const [confirmHardlink, setConfirmHardlink] = useState(false)
  const [confirmDirect, setConfirmDirect] = useState<InputMode | null>(null)
  const legendId = useId()
  const directSourceView = Object.values(useStore((s) => s.catalog.preparations)).some((p) => p.viewId === view.id && p.mode === "direct-source" && p.state === "prepared")
  const destination = plan.destinationVolume?.name ?? "the chosen location"

  function choose(mode: InputMode) {
    // A Direct-source View changes mode only after approval (PREP-AC-06).
    if (directSourceView && mode !== "direct-source" && plan.mode === "direct-source") return setConfirmDirect(mode)
    updatePrep(view.id, { mode })
  }

  return (
    <Section id="prep-mode" title="Input mode" level={3} description={`${MODE_LABEL[plan.suggestedMode]} is suggested for ${plan.profile?.name ?? "this application"}. Refused modes stay listed with the reason.`}>
      <fieldset disabled={locked} className="space-y-2">
        <legend id={legendId} className="sr-only">
          Input mode
        </legend>
        <RadioGroup aria-labelledby={legendId} value={plan.mode} onValueChange={(value) => choose(String(value) as InputMode)} className="grid gap-1.5 lg:grid-cols-2">
          {plan.modes.map((option) => (
            <OptionCard key={option.mode} value={option.mode} current={plan.mode} disabled={locked || (!option.allowed && option.mode !== plan.mode)}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{MODE_LABEL[option.mode]}</span>
                {option.mode === plan.suggestedMode ? <span className="text-xs text-muted-foreground">Suggested</span> : null}
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {option.mode === "clone" ? `≈ ${formatBytes(option.footprintBytes)} until changed` : `${formatBytes(option.footprintBytes)} storage`}
                </span>
              </span>
              <span className="block text-xs text-pretty text-muted-foreground">{option.semantics}</span>
              {option.reasons.length > 0 ? (
                <span className="block text-xs text-pretty text-destructive">
                  {option.mode === plan.mode ? "Blocked: " : "Refused: "}
                  {option.reasons.join(" ")}
                </span>
              ) : null}
            </OptionCard>
          ))}
        </RadioGroup>
      </fieldset>
      {plan.mode === "linked" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <span>
            Link type: <span className="font-medium">{draft.linkType === "symlink" ? "Symbolic link" : "Hard link"}</span>
            <span className="block text-xs text-pretty text-muted-foreground">
              {draft.linkType === "symlink"
                ? "Symbolic links break if an original moves or its volume goes offline. Linked inputs are references, not backups."
                : `Hard links need the originals and the View folder on one volume (${destination}). A writing application alters the source.`}
            </span>
          </span>
          {draft.linkType === "symlink" ? (
            <Button size="sm" variant="outline" disabled={locked} onClick={() => setConfirmHardlink(true)}>
              Use hard links…
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={locked} onClick={() => updatePrep(view.id, { linkType: "symlink" })}>
              Use symbolic links
            </Button>
          )}
        </div>
      ) : null}
      {!plan.modes.find((m) => m.mode === plan.mode)?.allowed ? (
        <Notice tone="refusal" title={`${MODE_LABEL[plan.mode]} cannot be used here`}>
          {plan.modes.find((m) => m.mode === plan.mode)?.reasons.join(" ")}{" "}
          {plan.modes.some((m) => m.allowed)
            ? `Choose ${plan.modes.filter((m) => m.allowed).map((m) => MODE_LABEL[m.mode]).join(" or ")}; nothing is written until you choose.`
            : "No supported mode is available here; choose another location. Nothing is written."}
          <span className="mt-2 flex flex-wrap gap-2">
            {plan.modes
              .filter((m) => m.allowed)
              .map((m) => (
                <Button key={m.mode} size="sm" variant="outline" disabled={locked} onClick={() => choose(m.mode)}>
                  Use {MODE_LABEL[m.mode]} ({m.mode === "clone" ? "≈ " : ""}
                  {formatBytes(m.footprintBytes)})
                </Button>
              ))}
          </span>
        </Notice>
      ) : null}
      <ConfirmDialog
        open={confirmHardlink}
        onOpenChange={setConfirmHardlink}
        title="Use hard links for this View?"
        description="Hard links make each View entry the same file as its original."
        changes={[
          "Change the link type from symbolic links to hard links for this preparation",
          `Eligibility is checked: every source and the View folder must be on ${destination}, which must support hard links, with write permission`,
          "An application that writes into a linked input alters the original file",
        ]}
        unchanged={["No file is created or linked until you confirm Prepare View", "Originals and their hashes"]}
        confirmLabel="Use hard links"
        onConfirm={() => updatePrep(view.id, { linkType: "hardlink" })}
      />
      <ConfirmDialog
        open={confirmDirect !== null}
        onOpenChange={(open) => !open && setConfirmDirect(null)}
        title="Change this Direct-source View's mode?"
        description="The current preparation hands off original paths."
        changes={[`The next preparation uses ${confirmDirect ? MODE_LABEL[confirmDirect] : ""}`]}
        unchanged={["The existing Direct-source preparation and its handoff list", "Originals"]}
        confirmLabel={`Use ${confirmDirect ? MODE_LABEL[confirmDirect] : ""}`}
        onConfirm={() => {
          if (confirmDirect) updatePrep(view.id, { mode: confirmDirect })
        }}
      />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Locations (F2, F3)
// ---------------------------------------------------------------------------

export function LocationSection({ view, plan, draft, locked }: { view: View; plan: PreparationPlan; draft: PrepDraft; locked: boolean }) {
  const disk = useStore((s) => s.disk)
  const preparations = Object.values(useStore((s) => s.catalog.preparations)).filter((p) => p.viewId === view.id)
  const [picker, setPicker] = useState<"view" | "output" | null>(null)
  const [error, setError] = useState<{ message: string; retry: () => void } | null>(null)
  const [name, setName] = useState<string | null>(null)
  const nameId = useId()
  const nameValue = name ?? plan.folderName
  const parentProblem = plan.parent.problem
  const ownPreparation = plan.viewPath ? preparations.find((p) => p.viewPath === plan.viewPath) : undefined
  const collision = plan.viewFolder.exists && plan.viewPath && !ownPreparation
  const nameError = !nameValue.trim() ? "Enter a folder name for the View." : /[/:]/.test(nameValue) ? "A folder name cannot contain / or :." : null

  function commitName(value: string) {
    setName(null)
    updatePrep(view.id, { folderName: value.trim() === plan.suggestedFolderName ? null : value.trim() })
  }

  function chooseParent(path: string) {
    const attempt = () => {
      const result = chooseViewParent(view, path)
      setError(result.ok ? null : { message: result.message, retry: attempt })
    }
    attempt()
  }

  const freeName = plan.parent.path && plan.viewFolder.exists ? uniqueName(disk, plan.parent.path, plan.folderName) : null

  return (
    <Section id="prep-locations" title="Locations" level={3} description="A new View folder under a parent you choose, and an output folder for results.">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-x-4 gap-y-1 text-sm lg:grid-cols-[10rem_minmax(0,1fr)_auto] lg:items-center">
          <span className="text-muted-foreground">View folder parent</span>
          <span className="min-w-0">
            {plan.parent.path ? <PathText path={plan.parent.path} /> : <UnknownValue label="Not set" />}
            {plan.parent.path ? null : <span className="block text-xs text-muted-foreground">No parent is assumed on first use. Choose one.</span>}
            {plan.parent.origin === "last-used" ? <span className="block text-xs text-muted-foreground">Suggested: the last parent you chose</span> : null}
          </span>
          <Button size="sm" variant="outline" disabled={locked} onClick={() => setPicker("view")}>
            <FolderOpen aria-hidden="true" data-icon="inline-start" />
            Choose location…
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>Folder name</Label>
          <Input
            id={nameId}
            className="max-w-md font-mono text-xs"
            value={nameValue}
            disabled={locked}
            aria-invalid={nameError || collision || (ownPreparation && !parentProblem) ? true : undefined}
            aria-describedby={collision ? `${nameId}-hint ${nameId}-collision` : ownPreparation && !parentProblem ? `${nameId}-hint ${nameId}-own` : `${nameId}-hint`}
            onChange={(event) => setName(event.target.value)}
            onBlur={(event) => commitName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitName(event.currentTarget.value)
            }}
          />
          <p id={`${nameId}-hint`} className={cn("text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
            {nameError ?? `Suggested from the View name: ${plan.suggestedFolderName}. An existing folder is never reused or cleared.`}
          </p>
        </div>
        {parentProblem ? (
          <Notice tone={parentProblem.kind === "offline" ? "offline" : "refusal"} title={parentProblem.kind === "offline" ? "Chosen parent unavailable" : "Cannot use this parent"} actions={<Button size="sm" variant="outline" onClick={() => setPicker("view")}>Choose another location…</Button>}>
            {parentProblem.message}
          </Notice>
        ) : ownPreparation ? (
          <div id={`${nameId}-own`}>
            <Notice
              tone="info"
              title={
                ownPreparation.state === "prepared"
                  ? `Prepared here for revision ${ownPreparation.membershipRevision}`
                  : `A ${ownPreparation.state} preparation of revision ${ownPreparation.membershipRevision} is here`
              }
              actions={
                freeName ? (
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => updatePrep(view.id, { folderName: freeName })}>
                    Use {freeName} for a new preparation
                  </Button>
                ) : null
              }
            >
              <PathText path={`${ownPreparation.viewPath}/`} />
              <span className="block text-xs">A new preparation never reuses this folder; it needs a new name or location.</span>
            </Notice>
          </div>
        ) : collision ? (
          <div id={`${nameId}-collision`}>
          <Notice
            tone="refusal"
            title="This folder already exists"
            actions={
              <>
                {freeName ? (
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => updatePrep(view.id, { folderName: freeName })}>
                    Use {freeName}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" disabled={locked} onClick={() => setPicker("view")}>
                  Choose another location…
                </Button>
              </>
            }
          >
            {plan.viewPath} already exists with {plural(plan.viewFolder.items.length, "unrelated item")}
            {plan.viewFolder.items.length ? ` (${plan.viewFolder.items.slice(0, 3).join(", ")}${plan.viewFolder.items.length > 3 ? ", …" : ""})` : ""}. Choose another name or location. Nothing in it was changed.
          </Notice>
          </div>
        ) : plan.viewPath ? (
          <div className="grid gap-x-4 text-sm lg:grid-cols-[10rem_minmax(0,1fr)]">
            <span className="text-muted-foreground">View folder</span>
            <PathText path={`${plan.viewPath}/`} />
          </div>
        ) : null}
        <div className="grid gap-x-4 gap-y-1 border-t pt-3 text-sm lg:grid-cols-[10rem_minmax(0,1fr)_auto] lg:items-center">
          <span className="text-muted-foreground">Output location</span>
          <span className="min-w-0">
            {plan.outputPath ? <PathText path={`${plan.outputPath}/`} /> : <UnknownValue label="Not set: follows the View folder" />}
            <span className="block text-xs text-muted-foreground">
              {plan.outputOverride ? "A View-specific subfolder under the parent you chose." : "Default: output/ inside the View folder."} Recorded on the View for result discovery and cleanup when you prepare.
            </span>
          </span>
          <span className="flex gap-2">
            {draft.outputParent ? (
              <Button size="sm" variant="ghost" disabled={locked} onClick={() => updatePrep(view.id, { outputParent: null })}>
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                Use default
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={locked || !plan.viewPath} onClick={() => setPicker("output")}>
              Change output location…
            </Button>
          </span>
        </div>
        {error ? <ActionError message={error.message} onRetry={error.retry} /> : null}
      </div>
      <FolderPicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        title={picker === "output" ? "Choose an output parent folder" : "Choose a parent for the View folder"}
        description={
          picker === "output"
            ? "Prototype folder chooser. The View folder name is added under the folder you choose, so outputs never mix with another View's."
            : "Prototype folder chooser. PlateVault creates a new View folder inside the folder you choose; nothing is created until you prepare."
        }
        initialPath={picker === "output" ? (draft.outputParent ?? plan.parent.path) : plan.parent.path}
        chooseVerb="Choose"
        onChoose={(path) => {
          if (picker === "output") updatePrep(view.id, { outputParent: path })
          else chooseParent(path)
        }}
      />
    </Section>
  )
}
