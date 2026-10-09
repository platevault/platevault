/**
 * S5 Prepare: application profile and input mode (Linked / Copy / Clone /
 * Direct source; write-prone profiles and unsupported links are refused with
 * the reason), the layout preview `<output>/<Project>/<Run>/` with
 * `<Run> Results/` and `(rev N)` for later revisions, catalog corrections
 * (patch, accept or exclude), the review that runs the preparation as an
 * operation, its outcome (Partial lists what was prepared and what was
 * blocked), and Open, which re-verifies first (PREP-FR-03 to PREP-FR-11).
 */
import { FolderOpen, Play } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { RadioGroup } from "@/components/ui/radio-group"
import { runOperations, runPreparations } from "@/domain/derive"
import { isSettled } from "@/store/operations"
import { MODE_LABEL } from "@/domain/labels"
import type { InputMode, Preparation, Run } from "@/domain/types"
import { fileName, formatBytes, formatDateTime, formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CapabilityList, ExecutableState } from "@/features/t4/profile-parts"
import { useStore } from "@/store/core"
import { chooseMode, chooseProfile, openPreparation, prepareChoices, setOutputParent, simulateObjectCorrection, simulateSourceDrift, startPrepare, updatePrepareChoices } from "./actions"
import { currentPreparation, FIELD_KEYWORD, FIELD_LABEL, METADATA_CHOICE_LABEL, type MetadataChoice, type ModeOption, type PlanCheck, type PreparePlan, preparePlan, type RunContext, type RunLayout } from "./model"
import { LayoutLine, OptionCard, OutcomeNotice, PrototypeMenu, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

export function PrepareStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const { run, group } = ctx
  const outcome = useOutcome()
  const choices = prepareChoices(state, run.id)
  const plan = preparePlan(state, run, choices)
  const running = runOperations(state.operations, run.id).find((op) => op.kind === "prepare")
  const locked = plan.checks.find((c) => c.id === "lock")?.detail ?? (running ? `${running.title} is running` : null)
  const [confirm, setConfirm] = useState(false)
  const target = group ? { groupId: group.id } : { runId: run.id }
  return (
    <div className="space-y-6">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <PreparationOutcome run={run} onOutcome={outcome.act} />
      {locked ? <Notice tone="info" title="Prepare is read-only now">{locked}</Notice> : null}
      {group ? (
        <Notice tone="info" title={`Setup shared by ${group.name}`}>
          The profile, input mode and calibration policy apply to every panel run. Prepare all on the run group prepares every panel into one group folder.
        </Notice>
      ) : null}
      <ProfileSection profileId={plan.profile?.id ?? null} locked={locked !== null} onPick={(id) => outcome.act(chooseProfile(target, id))} />
      <ModeSection modes={plan.modes} mode={plan.mode} linkType={choices.linkType} locked={locked !== null} profileName={plan.profile?.name ?? null} onMode={(m) => outcome.act(chooseMode(target, m))} onLinkType={(t) => updatePrepareChoices(run.id, { linkType: t })} />
      <LayoutSection
        layout={plan.layout}
        locked={locked !== null}
        onParent={(path) => outcome.act(setOutputParent(target, path))}
        lines={(l) => (
          <>
            <LayoutLine path={`${l.parent.path ?? "<output>"}/`} note={l.parent.origin === "last-used" ? "Last used output folder" : l.parent.origin === "none" ? "Not chosen yet" : "Output folder"} />
            <LayoutLine path={`${ctx.project.name}/`} note="Project" depth={1} />
            {l.groupFolder ? <LayoutLine path={`${fileName(l.groupFolder)}/`} note={l.prepRevision > 1 ? `Group folder, revision ${l.prepRevision}` : "Group folder"} depth={2} /> : null}
            <LayoutLine path={`${fileName(l.folderPath ?? `${run.name}`)}/`} note={`This preparation${l.prepRevision > 1 ? `: revision ${l.prepRevision} beside the earlier folders` : ""}; holds lights/, calibration/ and the handoff list`} depth={l.groupFolder ? 3 : 2} emphasis />
            <LayoutLine path={`${l.resultsPath ? l.resultsPath.slice((l.projectDir ?? "").length + 1) : `${run.name} Results`}/`} note="Results, shared by every revision and outside every prepared folder" depth={2} />
          </>
        )}
      />
      <MetadataSection plan={plan} locked={locked !== null} onChoice={(key, choice) => updatePrepareChoices(run.id, { metadata: { ...choices.metadata, [key]: choice } })} />
      <Section
        title="Review"
        id="prep-review"
        description={`${plural(plan.entries.length, "input")}: ${plan.entries.filter((e) => e.kind === "light").length} frames, ${plan.entries.filter((e) => e.kind === "calibration").length} calibration files, ${plan.entries.filter((e) => e.kind === "product").length} products.`}
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <PrototypeMenu
              actions={[
                { label: "Record an OBJECT correction", detail: "Adds a catalog correction on the first member session, so the corrected metadata review appears.", run: () => outcome.act(simulateObjectCorrection(run.id)) },
                { label: "Change a prepared source frame", detail: "An outside tool rewrites one source; Open then finds the drift.", run: () => outcome.act(simulateSourceDrift(run.id)) },
              ]}
            />
            <Button size="sm" disabled={locked !== null} onClick={() => (plan.ready ? setConfirm(true) : outcome.act(startPrepare(run.id, choices)))}>
              <Play aria-hidden="true" data-icon="inline-start" />
              Review and prepare…
            </Button>
          </div>
        }
      >
        <ChecksList checks={plan.checks} />
      </Section>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Prepare ${run.name}${plan.layout.prepRevision > 1 ? ` (rev ${plan.layout.prepRevision})` : ""}?`}
        description={`${plan.profile?.name ?? "The application"} · ${plan.mode ? MODE_LABEL[plan.mode] : ""}. Preparation runs as an operation you can watch; it ends Prepared, Partial or Failed.`}
        changes={prepareChanges(plan)}
        unchanged={["Original frames are never written, moved or patched", "Earlier prepared folders and the Results folder stay as they are", "Library quality decisions stay"]}
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

export function prepareChanges(plan: PreparePlan): string[] {
  const blocked = plan.entries.filter((e) => e.unavailable)
  return [
    `Creates ${plan.layout.folderPath ?? "the run folder"}`,
    plan.mode === "direct-source" ? "Writes a handoff list of exact source paths; no links or copies" : `Writes ${plural(plan.entries.length - blocked.length, "entry", "entries")} (${plan.mode ? MODE_LABEL[plan.mode] : ""}${plan.mode === "linked" ? `, ${plan.linkType === "hardlink" ? "hard links" : "symbolic links"}` : ""}, ${formatBytes(plan.footprintBytes)})`,
    `Creates ${plan.layout.resultsPath ?? "the Results folder"} if it does not exist`,
    ...(blocked.length > 0 ? [`Lists ${plural(blocked.length, "unreadable input")} as blocked: the outcome is Partial`] : []),
    ...(plan.diffs.length > 0 ? [`Records ${plural(plan.diffs.length, "metadata decision")}`] : []),
  ]
}

export function ChecksList({ checks }: { checks: PlanCheck[] }) {
  return (
    <ul className="divide-y divide-separator rounded-md border text-sm">
      {checks.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-1.5" data-check={c.id} data-ok={c.ok}>
          <span className="w-40 shrink-0">
            {c.ok ? <StatusBadge kind="checklist" value="met" label={c.label} /> : c.blocking ? <StatusBadge kind="checklist" value="missing" label={c.label} /> : <StatusBadge kind="checklist" value="partial" label={c.label} />}
          </span>
          <span className={cn("min-w-0 flex-1 text-[0.75rem] text-pretty", c.ok ? "text-muted-foreground" : "text-foreground")}>{c.detail}</span>
        </li>
      ))}
    </ul>
  )
}

const PROFILE_ORDER = ["pixinsight-wbpp", "siril", "seti-astro", "generic"]

export function ProfileSection({ profileId, locked, onPick }: { profileId: string | null; locked: boolean; onPick: (id: string) => void }) {
  const profiles = useStore((s) => s.catalog.profiles)
  const list = Object.values(profiles).sort((a, b) => PROFILE_ORDER.indexOf(a.application) - PROFILE_ORDER.indexOf(b.application))
  const profile = profileId ? profiles[profileId] : undefined
  return (
    <Section title="Application" id="prep-profile" description="PlateVault prepares the inputs and opens the application; you run processing there.">
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">Application profile</legend>
        <RadioGroup value={profileId ?? ""} onValueChange={(value) => onPick(String(value))} className="grid gap-1.5 lg:grid-cols-2">
          {list.map((p) => (
            <OptionCard key={p.id} value={p.id} current={profileId ?? ""} disabled={locked}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <StatusBadge kind="source" value={p.capability.verified ? "built-in" : "manual"} label={p.capability.verified ? "Verified profile" : "Not verified"} />
              </span>
              <span className="block text-[0.75rem] text-muted-foreground">{p.capability.evidence}</span>
            </OptionCard>
          ))}
        </RadioGroup>
      </fieldset>
      {profile ? (
        <div className="space-y-2 rounded-md border px-3 py-2">
          <CapabilityList profile={profile} />
          <ExecutableState profile={profile} />
        </div>
      ) : null}
    </Section>
  )
}

export function ModeSection({ modes, mode, linkType, locked, profileName, onMode, onLinkType }: { modes: ModeOption[]; mode: InputMode | null; linkType: "symlink" | "hardlink"; locked: boolean; profileName: string | null; onMode: (m: InputMode) => void; onLinkType: (t: "symlink" | "hardlink") => void }) {
  const chosen = mode ? modes.find((m) => m.mode === mode) : undefined
  return (
    <Section title="Input mode" id="prep-mode" description={profileName ? `Refused modes stay listed with the reason for ${profileName}.` : "Choose a profile first; modes are checked against its recorded capability."}>
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">Input mode</legend>
        <RadioGroup value={mode ?? ""} onValueChange={(value) => onMode(String(value) as InputMode)} className="grid gap-1.5 lg:grid-cols-2">
          {modes.map((option) => (
            <OptionCard key={option.mode} value={option.mode} current={mode ?? ""} disabled={locked || (!option.allowed && option.mode !== mode)}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{MODE_LABEL[option.mode]}</span>
                <span className="ml-auto text-[0.75rem] text-muted-foreground tabular-nums">{option.mode === "copy" || option.mode === "clone" ? `${formatBytes(option.footprintBytes)} storage` : "No storage"}</span>
              </span>
              <span className="block text-[0.75rem] text-pretty text-muted-foreground">{option.semantics}</span>
              {option.reasons.length > 0 ? (
                <span className="block text-[0.75rem] text-pretty text-destructive" data-refusal>
                  Refused: {option.reasons.join(" ")}
                </span>
              ) : null}
            </OptionCard>
          ))}
        </RadioGroup>
      </fieldset>
      {mode === "linked" ? (
        <div className="flex flex-wrap items-center gap-2 text-[0.75rem]">
          <span className="text-muted-foreground">Link type:</span>
          <Button size="xs" variant={linkType === "symlink" ? "secondary" : "ghost"} aria-pressed={linkType === "symlink"} disabled={locked} onClick={() => onLinkType("symlink")}>
            Symbolic links
          </Button>
          <Button size="xs" variant={linkType === "hardlink" ? "secondary" : "ghost"} aria-pressed={linkType === "hardlink"} disabled={locked} onClick={() => onLinkType("hardlink")}>
            Hard links
          </Button>
          <span className="text-muted-foreground">Hard links need every source and the run folder on one volume that supports them.</span>
        </div>
      ) : null}
      {chosen && !chosen.allowed ? (
        <Notice tone="refusal" title={`${MODE_LABEL[chosen.mode]} cannot be used here`}>
          {chosen.reasons.join(" ")} {modes.some((m) => m.allowed) ? `Choose ${modes.filter((m) => m.allowed).map((m) => MODE_LABEL[m.mode]).join(" or ")}; nothing is written until you prepare.` : "No supported mode is available here; choose another output folder or profile."}
        </Notice>
      ) : null}
    </Section>
  )
}

export function LayoutSection({ layout, locked, onParent, lines }: { layout: RunLayout; locked: boolean; onParent: (path: string) => void; lines: (layout: RunLayout) => React.ReactNode }) {
  const [picking, setPicking] = useState(false)
  return (
    <Section
      title="Run folder"
      id="prep-layout"
      description="A new folder for every prepared revision; an existing folder is never reused or cleared."
      actions={
        <Button size="sm" variant="outline" disabled={locked} onClick={() => setPicking(true)}>
          <FolderOpen aria-hidden="true" data-icon="inline-start" />
          {layout.parent.path ? "Change output folder…" : "Choose output folder…"}
        </Button>
      }
    >
      <ul className="space-y-1 rounded-md border bg-foreground/[0.02] px-3 py-2" aria-label="Layout preview">
        {lines(layout)}
      </ul>
      <FolderPicker open={picking} onOpenChange={setPicking} title="Choose the output folder" description="Runs prepare to <output>/<Project>/<Run>/. PlateVault remembers the last folder you chose." initialPath={layout.parent.path} chooseVerb="Use" onChoose={(path) => onParent(path)} />
    </Section>
  )
}

export function MetadataSection({ plan, locked, onChoice }: { plan: PreparePlan; locked: boolean; onChoice: (key: string, choice: MetadataChoice) => void }) {
  const appName = plan.profile?.name ?? "the application"
  const isolated = plan.mode === "copy" || plan.mode === "clone"
  return (
    <Section title="Corrected metadata" id="prep-metadata" description={`Catalog values that ${appName} will not read from the files. Originals and links are never patched.`}>
      {plan.diffs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No catalog value of the included frames differs from its source header.</p>
      ) : (
        <ul className="space-y-2">
          {plan.diffs.map((diff) => {
            const choice = plan.metadata[diff.key]
            return (
              <li key={diff.key} className="space-y-2 rounded-md border px-3 py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                  <span className="font-medium">
                    {formatNight(diff.session.night)} {diff.session.channel ?? ""} · {plural(diff.assetIds.length, "frame")} · {FIELD_LABEL[diff.field]}
                  </span>
                  <span className="font-mono text-[0.75rem] text-muted-foreground">
                    {FIELD_KEYWORD[diff.field]}: file “{diff.sourceValue ?? "absent"}” · catalog “{diff.catalogValue}”
                  </span>
                </div>
                <fieldset disabled={locked}>
                  <legend className="sr-only">How the corrected {FIELD_LABEL[diff.field].toLowerCase()} reaches the application</legend>
                  <RadioGroup value={choice ?? ""} onValueChange={(value) => onChoice(diff.key, String(value) as MetadataChoice)} className="grid gap-1.5 lg:grid-cols-2">
                    {(["patched-copy", "accept-source", "excluded", "configuration"] as MetadataChoice[]).map((option) => {
                      const unsupported = option === "configuration" && plan.profile?.capability.correctedMetadata !== "configuration"
                      return (
                        <OptionCard key={option} value={option} current={choice ?? ""} disabled={locked || unsupported}>
                          <span className="block font-medium">{METADATA_CHOICE_LABEL[option]}</span>
                          <span className="block text-[0.75rem] text-pretty text-muted-foreground">
                            {option === "configuration"
                              ? unsupported
                                ? `Refused: ${appName} cannot read corrected values through configuration.`
                                : `${appName} reads the corrected value from its configuration.`
                              : option === "patched-copy"
                                ? isolated
                                  ? `Isolated copies carry ${FIELD_KEYWORD[diff.field]} = ${diff.catalogValue}; the original keeps its bytes.`
                                  : "Needs Copy or Clone: switch the input mode."
                                : option === "accept-source"
                                  ? "Hand off the header as it is, for this preparation only. The correction is not delivered."
                                  : "Leave these frames out of this preparation. They stay in the run."}
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
      )}
    </Section>
  )
}

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
  return (
    <Section
      title={`${compact ? run.name : "Preparation"}${prep.prepRevision > 1 ? ` (rev ${prep.prepRevision})` : ""}`}
      id={`prep-outcome-${run.id}`}
      level={compact ? 3 : 2}
      description={`${prep.folderPath} · ${MODE_LABEL[prep.mode]}${prep.linkType ? ` (${prep.linkType === "symlink" ? "symbolic links" : "hard links"})` : ""} · membership revision ${prep.membershipRevision} · ${formatDateTime(prep.createdAt)}`}
      actions={
        <div className="flex items-center gap-2">
          <PrepStateBadge prep={prep} />
          {prep.state === "prepared" && !stale ? (
            <Button size="sm" onClick={() => onOutcome(openPreparation(run.id), { title: `Opened ${run.name}`, reasons: ["Every entry the application reads was re-verified first."], tone: "info" })}>
              Open in {state.catalog.profiles[prep.profileId]?.name.split(" /")[0] ?? "application"}
            </Button>
          ) : null}
        </div>
      }
    >
      {stale ? <Notice tone="warning" title="The saved membership changed since this preparation">Revision {latestRevisionNumber(run)} needs a new preparation; it goes to a new folder beside this one.</Notice> : null}
      {op && !isSettled(op.status) ? <OperationPanel operationId={op.id} headingLevel={compact ? 4 : 3} /> : null}
      {prep.unverified ? (
        <Notice tone="warning" title={`Unverified since ${formatDateTime(prep.unverified.at)}: ${plural(prep.unverified.changed.length, "entry", "entries")} changed`}>
          <ul className="list-disc space-y-0.5 pl-4">
            {prep.unverified.changed.slice(0, 6).map((c) => (
              <li key={c.path}>
                <span className="font-mono text-xs">{fileName(c.path)}</span>: {c.reason}
              </li>
            ))}
          </ul>
          Open re-verifies again; once the bytes return the run reads Prepared. A reviewed new preparation also replaces them.
        </Notice>
      ) : null}
      {prep.state === "partial" || prep.state === "failed" || (prep.state === "prepared" && !compact) ? <PreparedLists prep={prep} /> : null}
      {prep.launches.length > 0 ? (
        <p className="text-[0.75rem] text-muted-foreground">
          Last Open {formatDateTime(prep.launches.at(-1)!.at)}: {prep.launches.at(-1)!.outcome === "opened" ? "re-verified and launched" : prep.launches.at(-1)!.outcome === "missing-executable" ? "the application is not located" : "the application did not launch"}.
        </p>
      ) : null}
    </Section>
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
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-1">
        <h3 className="text-xs font-medium">
          Prepared · {prepared.length} of {prep.entryCount}
        </h3>
        <details className="rounded-md border px-3 py-1.5 text-[0.75rem]">
          <summary className="cursor-default text-muted-foreground">{prepared.length === 0 ? "Nothing was prepared" : `${plural(prepared.length, "entry", "entries")} in ${fileName(prep.folderPath)}/`}</summary>
          <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono">
            {prepared.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </details>
      </div>
      <div className="space-y-1">
        <h3 className="text-xs font-medium">Blocked · {prep.blocked.length}</h3>
        {prep.blocked.length === 0 ? (
          <p className="text-[0.75rem] text-muted-foreground">No input was blocked.</p>
        ) : (
          <ul tabIndex={0} aria-label={`Blocked inputs, ${prep.blocked.length}`} className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border px-3 py-1.5 text-[0.75rem]" data-blocked-list>
            {prep.blocked.map((b) => (
              <li key={`${b.path}-${b.reason}`} className="flex flex-wrap gap-x-2">
                <span className="font-mono">{fileName(b.path)}</span>
                <span className="text-muted-foreground">{b.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
