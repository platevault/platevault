/**
 * S5 Prepare: application profile and input mode (Linked / Copy / Clone /
 * Direct source; write-prone profiles and unsupported links are refused with
 * their blockers), the layout preview `<output>/<Project>/<Run>/` with
 * `<Run> Results/` and `(rev N)` for later revisions, catalog corrections
 * (patch, accept or exclude), the review that runs the preparation as an
 * operation, its outcome (Partial lists what was prepared and what was
 * blocked) with the run's footprint, and Open, which re-verifies first
 * (PREP-FR-03 to PREP-FR-11).
 */
import { FolderOpen, HardDrive, Layers, Lock, Play } from "lucide-react"
import { useState } from "react"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { RadioGroup } from "@/components/ui/radio-group"
import { runOperations, runPreparations, runStepLink, type StepLink } from "@/domain/derive"
import { MODE_LABEL } from "@/domain/labels"
import { runFootprint } from "@/domain/storage"
import type { InputMode, Preparation, Run } from "@/domain/types"
import { ExecutableState } from "@/features/t4/profile-parts"
import { NO_PROFILE, profileOptions } from "@/features/v5/b-projects/start-run"
import { fileName, formatBytes, formatDateTime, formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { chooseMode, chooseProfile, openPreparation, prepareChoices, setOutputParent, simulateObjectCorrection, simulateSourceDrift, startPrepare, updatePrepareChoices } from "./actions"
import { currentPreparation, FIELD_KEYWORD, FIELD_LABEL, METADATA_CHOICE_LABEL, type MetadataChoice, type ModeOption, type PlanCheck, type PreparePlan, preparePlan, type RunContext, type RunLayout } from "./model"
import { LayoutLine, OptionCard, OutcomeNotice, PrototypeMenu, profileLabel, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

export function PrepareStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const { run, group } = ctx
  const outcome = useOutcome()
  const choices = prepareChoices(state, run.id)
  const plan = preparePlan(state, run, choices)
  const running = runOperations(state.operations, run.id).find((op) => op.kind === "prepare")
  const locked = plan.checks.find((c) => c.id === "lock")?.detail ?? (running ? `${running.title} running` : null)
  const [confirm, setConfirm] = useState(false)
  const target = group ? { groupId: group.id } : { runId: run.id }
  const count = (kind: "light" | "calibration" | "product") => plan.entries.filter((e) => e.kind === kind).length
  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} linkFor={(label) => planBlockerLink(run, label)} />
      {locked || group ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {locked ? (
            <Pill tone="muted" icon={Lock}>
              Read-only · {locked}
            </Pill>
          ) : null}
          {group ? (
            <Pill tone="info" icon={Layers} link={{ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: group.projectId, groupId: group.id, step: "prepare" } }} title="Profile, mode and policy shared by every panel">
              Shared · {group.name}
            </Pill>
          ) : null}
        </div>
      ) : null}
      <PreparationOutcome run={run} onOutcome={outcome.act} />
      <ProfileSection profileId={plan.profile?.id ?? null} locked={locked !== null} onPick={(id) => outcome.act(chooseProfile(target, id))} />
      <ModeSection modes={plan.modes} mode={plan.mode} linkType={choices.linkType} locked={locked !== null} onMode={(m) => outcome.act(chooseMode(target, m))} onLinkType={(t) => updatePrepareChoices(run.id, { linkType: t })} />
      <LayoutSection
        layout={plan.layout}
        locked={locked !== null}
        onParent={(path) => outcome.act(setOutputParent(target, path))}
        lines={(l) => (
          <>
            <LayoutLine path={`${l.parent.path ?? "<output>"}/`} note={l.parent.origin === "last-used" ? "Last used" : l.parent.origin === "none" ? "Not chosen" : "Output"} />
            <LayoutLine path={`${ctx.project.name}/`} note="Project" depth={1} />
            {l.groupFolder ? <LayoutLine path={`${fileName(l.groupFolder)}/`} note={l.prepRevision > 1 ? `Group · rev ${l.prepRevision}` : "Group"} depth={2} /> : null}
            <LayoutLine path={`${fileName(l.folderPath ?? `${run.name}`)}/`} note={l.prepRevision > 1 ? `New · rev ${l.prepRevision}` : "New"} depth={l.groupFolder ? 3 : 2} emphasis />
            <LayoutLine path={`${l.resultsPath ? l.resultsPath.slice((l.projectDir ?? "").length + 1) : `${run.name} Results`}/`} note="Results · every revision" depth={2} />
          </>
        )}
      />
      <MetadataSection plan={plan} locked={locked !== null} onChoice={(key, choice) => updatePrepareChoices(run.id, { metadata: { ...choices.metadata, [key]: choice } })} />
      <Box
        id="prep-review"
        level={2}
        flush
        title={
          <span className="flex flex-wrap items-center gap-1.5">
            Review
            <Pill tone="muted">{plural(count("light"), "frame")}</Pill>
            {count("calibration") > 0 ? <Pill tone="muted">{plural(count("calibration"), "master")}</Pill> : null}
            {count("product") > 0 ? <Pill tone="muted">{plural(count("product"), "product")}</Pill> : null}
          </span>
        }
        actions={
          <>
            <PrototypeMenu
              actions={[
                { label: "Record an OBJECT correction", detail: "Adds a catalog correction on the first member session, so the corrected metadata review appears.", run: () => outcome.act(simulateObjectCorrection(run.id)) },
                { label: "Change a prepared source frame", detail: "An outside tool rewrites one source; Open then finds the drift.", run: () => outcome.act(simulateSourceDrift(run.id)) },
              ]}
            />
            <Button size="sm" disabled={locked !== null} onClick={() => (plan.ready ? setConfirm(true) : outcome.act(startPrepare(run.id, choices)))}>
              <Play aria-hidden="true" data-icon="inline-start" />
              Prepare…
            </Button>
          </>
        }
      >
        <ChecksList checks={plan.checks} />
      </Box>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Prepare ${run.name}${plan.layout.prepRevision > 1 ? ` (rev ${plan.layout.prepRevision})` : ""}?`}
        description={`${profileLabel(state.catalog, plan.profile?.id ?? null)} · ${plan.mode ? MODE_LABEL[plan.mode] : ""}`}
        changes={prepareChanges(plan)}
        confirmLabel={`Prepare ${plural(plan.entries.length, "input")}`}
        onConfirm={() => {
          const r = startPrepare(run.id, choices)
          outcome.act(r)
          return r.result
        }}
      />
    </div>
  )
}

/** Where a Prepare blocker ("Calibration: 1 requirement to review") is resolved. */
export function planBlockerLink(run: Run, blocker: string): StepLink | undefined {
  const label = blocker.slice(0, Math.max(0, blocker.indexOf(":")))
  const step = label.endsWith("Calibration") ? "calibrate" : label.endsWith("Saved membership") || label.endsWith("Product inputs") ? "select" : null
  return step ? (runStepLink(run, step) as StepLink) : undefined
}

export function prepareChanges(plan: PreparePlan): string[] {
  const blocked = plan.entries.filter((e) => e.unavailable)
  return [
    `Creates ${plan.layout.folderPath ?? "the run folder"}`,
    plan.mode === "direct-source" ? "Writes a source list" : `Writes ${plural(plan.entries.length - blocked.length, "entry", "entries")} · ${formatBytes(plan.footprintBytes)}`,
    ...(blocked.length > 0 ? [`${plural(blocked.length, "input")} blocked · Partial`] : []),
    ...(plan.diffs.length > 0 ? [`Records ${plural(plan.diffs.length, "metadata decision")}`] : []),
  ]
}

export function ChecksList({ checks }: { checks: PlanCheck[] }) {
  return (
    <ul className="divide-y divide-separator text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5" data-check={c.id} data-ok={c.ok}>
          <span className="w-40 shrink-0">
            {c.ok ? <StatusBadge kind="checklist" value="met" label={c.label} /> : c.blocking ? <StatusBadge kind="checklist" value="missing" label={c.label} /> : <StatusBadge kind="checklist" value="partial" label={c.label} />}
          </span>
          <span className={cn("min-w-0 flex-1 truncate text-[0.75rem]", c.ok ? "text-muted-foreground" : "text-foreground")} title={c.detail}>
            {c.detail}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The application profile picker: the same order and names as Start run's `profileOptions`. */
export function ProfileSection({ profileId, locked, onPick }: { profileId: string | null; locked: boolean; onPick: (id: string) => void }) {
  const catalog = useStore((s) => s.catalog)
  const options = profileOptions(catalog).filter((o) => o.value !== NO_PROFILE)
  const profile = profileId ? catalog.profiles[profileId] : undefined
  return (
    <Box
      id="prep-profile"
      level={2}
      title="Application"
      actions={profile ? <ExecutableState profile={profile} /> : null}
    >
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">Application profile</legend>
        <RadioGroup value={profileId ?? ""} onValueChange={(value) => onPick(String(value))} className="grid gap-1.5 lg:grid-cols-2">
          {options.map((o) => {
            const p = catalog.profiles[o.value]!
            return (
              <OptionCard key={p.id} value={p.id} current={profileId ?? ""} disabled={locked}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{o.label}</span>
                  <StatusBadge kind="source" value={p.capability.verified ? "built-in" : "manual"} label={p.capability.verified ? "Verified" : "Not verified"} />
                  <Pill tone={p.capability.inputWrite === "read-only" ? "success" : p.capability.inputWrite === "write-prone" ? "warning" : "muted"}>
                    {p.capability.inputWrite === "read-only" ? "Read-only" : p.capability.inputWrite === "write-prone" ? "Write-prone" : "Writes unknown"}
                  </Pill>
                  <NoteMarker label={`${o.label} evidence`}>{p.capability.evidence}</NoteMarker>
                </span>
              </OptionCard>
            )
          })}
        </RadioGroup>
      </fieldset>
    </Box>
  )
}

export function ModeSection({ modes, mode, linkType, locked, onMode, onLinkType }: { modes: ModeOption[]; mode: InputMode | null; linkType: "symlink" | "hardlink"; locked: boolean; onMode: (m: InputMode) => void; onLinkType: (t: "symlink" | "hardlink") => void }) {
  const chosen = mode ? modes.find((m) => m.mode === mode) : undefined
  return (
    <Box
      id="prep-mode"
      level={2}
      title="Input mode"
      actions={
        mode === "linked" ? (
          <span className="flex items-center gap-1" role="group" aria-label="Link type">
            <Button size="xs" variant={linkType === "symlink" ? "secondary" : "ghost"} aria-pressed={linkType === "symlink"} disabled={locked} onClick={() => onLinkType("symlink")}>
              Symbolic links
            </Button>
            <Button size="xs" variant={linkType === "hardlink" ? "secondary" : "ghost"} aria-pressed={linkType === "hardlink"} disabled={locked} onClick={() => onLinkType("hardlink")}>
              Hard links
            </Button>
            <HelpTip label="Hard links">Every source and the run folder on one volume.</HelpTip>
          </span>
        ) : null
      }
    >
      <div className="space-y-2">
        {chosen && !chosen.allowed ? (
          <Refusal action={`${MODE_LABEL[chosen.mode]} blocked`} reason={plural(chosen.reasons.length, "blocker")} blockers={chosen.reasons.map((label) => ({ label }))} />
        ) : null}
        <fieldset disabled={locked}>
          <legend className="sr-only">Input mode</legend>
          <RadioGroup value={mode ?? ""} onValueChange={(value) => onMode(String(value) as InputMode)} className="grid gap-1.5 lg:grid-cols-2">
            {modes.map((option) => (
              <OptionCard key={option.mode} value={option.mode} current={mode ?? ""} disabled={locked || (!option.allowed && option.mode !== mode)}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{MODE_LABEL[option.mode]}</span>
                  <HelpTip label={`${MODE_LABEL[option.mode]}`}>{option.semantics}</HelpTip>
                  <Pill tone="muted" icon={HardDrive} className="ml-auto">
                    {option.mode === "copy" || option.mode === "clone" ? formatBytes(option.footprintBytes) : "0 B"}
                  </Pill>
                </span>
                {option.reasons.length > 0 ? (
                  <span className="flex flex-wrap gap-1" data-refusal>
                    {option.reasons.map((r) => (
                      <Pill key={r} tone="danger" title={r}>
                        {r}
                      </Pill>
                    ))}
                  </span>
                ) : null}
              </OptionCard>
            ))}
          </RadioGroup>
        </fieldset>
      </div>
    </Box>
  )
}

export function LayoutSection({ layout, locked, onParent, lines }: { layout: RunLayout; locked: boolean; onParent: (path: string) => void; lines: (layout: RunLayout) => React.ReactNode }) {
  const [picking, setPicking] = useState(false)
  return (
    <Box
      id="prep-layout"
      level={2}
      title="Run folder"
      actions={
        <Button size="xs" variant="outline" disabled={locked} onClick={() => setPicking(true)}>
          <FolderOpen aria-hidden="true" data-icon="inline-start" />
          {layout.parent.path ? "Change folder…" : "Choose folder…"}
        </Button>
      }
    >
      <ul className="space-y-1" aria-label="Layout preview">
        {lines(layout)}
      </ul>
      <FolderPicker open={picking} onOpenChange={setPicking} title="Output folder" initialPath={layout.parent.path} chooseVerb="Use" onChoose={(path) => onParent(path)} />
    </Box>
  )
}

const CHOICE_HINT: Record<MetadataChoice, string> = {
  "patched-copy": "Copy carries the value",
  "accept-source": "Header as is",
  excluded: "Left out",
  configuration: "Via configuration",
}

export function MetadataSection({ plan, locked, onChoice }: { plan: PreparePlan; locked: boolean; onChoice: (key: string, choice: MetadataChoice) => void }) {
  const catalog = useStore((s) => s.catalog)
  if (plan.diffs.length === 0) return null
  const appName = profileLabel(catalog, plan.profile?.id ?? null)
  const isolated = plan.mode === "copy" || plan.mode === "clone"
  return (
    <Box id={`prep-metadata-${plan.run.id}`} level={2} flush title="Corrected metadata">
      <ul className="divide-y divide-separator">
        {plan.diffs.map((diff) => {
          const choice = plan.metadata[diff.key]
          return (
            <li key={diff.key} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">
                  {formatNight(diff.session.night)} {diff.session.channel ?? ""} · {FIELD_LABEL[diff.field]}
                </span>
                <Pill tone="muted">{plural(diff.assetIds.length, "frame")}</Pill>
                <span className="font-mono text-[0.75rem] text-muted-foreground">
                  {FIELD_KEYWORD[diff.field]} “{diff.sourceValue ?? "absent"}” → “{diff.catalogValue}”
                </span>
              </div>
              <fieldset disabled={locked}>
                <legend className="sr-only">How the corrected {FIELD_LABEL[diff.field].toLowerCase()} reaches the application</legend>
                <RadioGroup value={choice ?? ""} onValueChange={(value) => onChoice(diff.key, String(value) as MetadataChoice)} className="grid gap-1.5 lg:grid-cols-2">
                  {(["patched-copy", "accept-source", "excluded", "configuration"] as MetadataChoice[]).map((option) => {
                    const unsupported = option === "configuration" && plan.profile?.capability.correctedMetadata !== "configuration"
                    const needsIsolated = option === "patched-copy" && !isolated
                    return (
                      <OptionCard key={option} value={option} current={choice ?? ""} disabled={locked || unsupported}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{METADATA_CHOICE_LABEL[option]}</span>
                          {unsupported ? (
                            <Pill tone="danger">{appName}: not supported</Pill>
                          ) : needsIsolated ? (
                            <Pill tone="warning">Needs Copy or Clone</Pill>
                          ) : (
                            <span className="text-[0.75rem] text-muted-foreground">{option === "patched-copy" ? `${FIELD_KEYWORD[diff.field]} = ${diff.catalogValue}` : CHOICE_HINT[option]}</span>
                          )}
                        </span>
                      </OptionCard>
                    )
                  })}
                </RadioGroup>
              </fieldset>
            </li>
          )
        })}
      </ul>
    </Box>
  )
}

/** The run's footprint: bytes its prepared folders hold (links count zero), what Clean up frees. */
export function FootprintPill({ run }: { run: Run }) {
  const state = useStore((s) => s)
  const footprint = runFootprint(state.disk, state.catalog, run.id)
  return (
    <span className="inline-flex items-center gap-1" data-footprint={footprint.preparedBytes}>
      <Pill tone="muted" icon={HardDrive} title="Prepared bytes">
        {footprint.online ? formatBytes(footprint.preparedBytes) : "–"} prepared
      </Pill>
      {!footprint.online ? <NoteMarker label="Footprint note">Volume offline · bytes unknown</NoteMarker> : null}
    </span>
  )
}

const LAUNCH_WORD = { opened: "Opened", "missing-executable": "Not located", "launch-failed": "Did not launch" } as const

/** The latest preparation of this run: Running, Prepared, Partial (prepared and blocked) or Failed; Open re-verifies. */
export function PreparationOutcome({ run, onOutcome, compact = false }: { run: Run; onOutcome: Act; compact?: boolean }) {
  const state = useStore((s) => s)
  const preps = runPreparations(state.catalog, run.id)
  const current = currentPreparation(run, preps)
  const latest = preps.at(-1)
  if (!latest) return null
  const prep = current ?? latest
  const op = prep.operationId ? state.operations[prep.operationId] : undefined
  const stale = !current
  const label = profileLabel(state.catalog, prep.profileId)
  const generic = state.catalog.profiles[prep.profileId]?.application === "generic"
  const lastLaunch = prep.launches.at(-1)
  return (
    <Box
      id={`prep-outcome-${run.id}`}
      level={compact ? 3 : 2}
      title={`${compact ? run.name : "Preparation"}${prep.prepRevision > 1 ? ` (rev ${prep.prepRevision})` : ""}`}
      actions={
        <>
          <PrepStateBadge prep={prep} />
          <FootprintPill run={run} />
          {prep.state === "prepared" && !stale ? (
            <Button size="xs" onClick={() => onOutcome(openPreparation(run.id), { title: `Opened ${run.name}`, tone: "info" })}>
              {generic ? "Open" : `Open in ${label.split(" /")[0]}`}
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.75rem] text-muted-foreground">
          <span className="min-w-0 truncate font-mono" title={prep.folderPath}>
            {fileName(prep.folderPath)}/
          </span>
          <Pill tone="neutral">{MODE_LABEL[prep.mode]}{prep.linkType ? ` · ${prep.linkType === "symlink" ? "symbolic" : "hard"}` : ""}</Pill>
          <Pill tone="muted">r{prep.membershipRevision}</Pill>
          <span>{formatDateTime(prep.createdAt)}</span>
          {lastLaunch ? <Pill tone={lastLaunch.outcome === "opened" ? "success" : "warning"} title={formatDateTime(lastLaunch.at)}>{LAUNCH_WORD[lastLaunch.outcome]}</Pill> : null}
        </div>
        {stale ? <Pill tone="warning">Membership changed · prepare r{latestRevisionNumber(run)}</Pill> : null}
        {op && !isSettled(op.status) ? <OperationPanel operationId={op.id} headingLevel={compact ? 4 : 3} /> : null}
        {prep.unverified ? (
          <Refusal
            action={`Unverified since ${formatDateTime(prep.unverified.at)}`}
            reason={plural(prep.unverified.changed.length, "entry", "entries") + " changed"}
            blockers={prep.unverified.changed.slice(0, 8).map((c) => ({ label: `${fileName(c.path)} · ${c.reason}` }))}
          />
        ) : null}
        {prep.state === "partial" || prep.state === "failed" || (prep.state === "prepared" && !compact) ? <PreparedLists prep={prep} /> : null}
      </div>
    </Box>
  )
}

function latestRevisionNumber(run: Run): number {
  return run.revisions.at(-1)?.revision ?? 0
}

export function PrepStateBadge({ prep }: { prep: Preparation }) {
  if (prep.unverified) return <StatusBadge kind="view" value="unverified" />
  if (prep.state === "partial") return <StatusBadge kind="preparation" value="partial" label={`Partial ${prep.preparedAssetIds.length + prep.preparedResultIds.length}/${prep.entryCount}`} />
  return <StatusBadge kind="preparation" value={prep.state} />
}

function PreparedLists({ prep }: { prep: Preparation }) {
  const assets = useStore((s) => s.catalog.assets)
  const results = useStore((s) => s.catalog.results)
  const prepared = [...prep.preparedAssetIds.map((id) => assets[id]?.fileName ?? id), ...prep.preparedResultIds.map((id) => (results[id] ? fileName(results[id]!.path) : id))]
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <details className="rounded-md border px-3 py-1.5 text-[0.75rem]">
        <summary className="cursor-default">
          Prepared · {prepared.length}/{prep.entryCount}
        </summary>
        <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono text-muted-foreground">
          {prepared.length === 0 ? <li>None</li> : null}
          {prepared.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </details>
      {prep.blocked.length > 0 ? (
        <details open className="rounded-md border px-3 py-1.5 text-[0.75rem]">
          <summary className="cursor-default">Blocked · {prep.blocked.length}</summary>
          <ul tabIndex={0} aria-label={`Blocked inputs, ${prep.blocked.length}`} className="mt-1 max-h-48 space-y-0.5 overflow-y-auto" data-blocked-list>
            {prep.blocked.map((b) => (
              <li key={`${b.path}-${b.reason}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{fileName(b.path)}</span>
                <span className="text-muted-foreground">{b.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <Pill tone="muted" className="self-start justify-self-start">
          Blocked · 0
        </Pill>
      )}
    </div>
  )
}
