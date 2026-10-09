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
import { useMessages } from "@/app/preferences"
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
import { fileName, formatBytes, formatDateTime, formatNight } from "@/lib/format"
import { m } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { chooseMode, chooseProfile, openPreparation, prepareChoices, setOutputParent, simulateObjectCorrection, simulateSourceDrift, startPrepare, updatePrepareChoices } from "./actions"
import { checkLabel, currentPreparation, FIELD_KEYWORD, fieldLabel, metadataChoiceLabel, type MetadataChoice, type ModeOption, type PlanCheck, type PreparePlan, preparePlan, type RunContext, type RunLayout } from "./model"
import { LayoutLine, OptionCard, OutcomeNotice, PrototypeMenu, profileLabel, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

export function PrepareStep({ ctx }: { ctx: RunContext }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run, group } = ctx
  const outcome = useOutcome()
  const choices = prepareChoices(state, run.id)
  const plan = preparePlan(state, run, choices)
  const running = runOperations(state.operations, run.id).find((op) => op.kind === "prepare")
  const locked = plan.checks.find((c) => c.id === "lock")?.detail ?? (running ? m.run_prepare_running({ title: running.title }) : null)
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
              {m.run_read_only_because({ reason: locked })}
            </Pill>
          ) : null}
          {group ? (
            <Pill tone="info" icon={Layers} link={{ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: group.projectId, groupId: group.id, step: "prepare" } }} title={m.run_prepare_shared_title()}>
              {m.run_shared_with({ name: group.name })}
            </Pill>
          ) : null}
        </div>
      ) : null}
      <PreparationOutcome run={run} onOutcome={outcome.act} />
      <ProfileSection profileId={plan.profile?.id ?? null} locked={locked !== null} onPick={(id) => outcome.act(chooseProfile(target, id), { blocked: m.run_profile_blocked() })} />
      <ModeSection modes={plan.modes} mode={plan.mode} linkType={choices.linkType} locked={locked !== null} onMode={(mode) => outcome.act(chooseMode(target, mode), { blocked: m.run_mode_blocked() })} onLinkType={(t) => updatePrepareChoices(run.id, { linkType: t })} />
      <LayoutSection
        layout={plan.layout}
        locked={locked !== null}
        onParent={(path) => outcome.act(setOutputParent(target, path), { blocked: m.run_folder_blocked() })}
        lines={(l) => (
          <>
            <LayoutLine path={`${l.parent.path ?? m.run_layout_output()}/`} note={parentNote(l)} />
            <LayoutLine path={`${ctx.project.name}/`} note={m.run_col_project()} depth={1} />
            {l.groupFolder ? <LayoutLine path={`${fileName(l.groupFolder)}/`} note={l.prepRevision > 1 ? m.run_layout_group_rev({ revision: l.prepRevision }) : m.run_layout_group()} depth={2} /> : null}
            <LayoutLine path={`${fileName(l.folderPath ?? `${run.name}`)}/`} note={l.prepRevision > 1 ? m.run_layout_new_rev({ revision: l.prepRevision }) : m.run_layout_new()} depth={l.groupFolder ? 3 : 2} emphasis />
            <LayoutLine path={`${l.resultsPath ? l.resultsPath.slice((l.projectDir ?? "").length + 1) : m.run_layout_results_folder({ name: run.name })}/`} note={m.run_layout_results_every_revision()} depth={2} />
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
            {m.step_review()}
            <Pill tone="muted">{m.run_frames_count({ count: count("light") })}</Pill>
            {count("calibration") > 0 ? <Pill tone="muted">{m.run_cal_masters_count({ count: count("calibration") })}</Pill> : null}
            {count("product") > 0 ? <Pill tone="muted">{m.run_results_products_count({ count: count("product") })}</Pill> : null}
          </span>
        }
        actions={
          <>
            <PrototypeMenu
              actions={[
                { label: m.run_proto_object_correction(), detail: m.run_proto_object_correction_detail(), run: () => outcome.act(simulateObjectCorrection(run.id), { blocked: m.run_proto_blocked() }) },
                { label: m.run_proto_source_drift(), detail: m.run_proto_source_drift_detail(), run: () => outcome.act(simulateSourceDrift(run.id), { blocked: m.run_proto_blocked() }) },
              ]}
            />
            <Button size="sm" disabled={locked !== null} onClick={() => (plan.ready ? setConfirm(true) : outcome.act(startPrepare(run.id, choices), { blocked: m.run_prepare_blocked() }))}>
              <Play aria-hidden="true" data-icon="inline-start" />
              {m.run_prepare_ellipsis()}
            </Button>
          </>
        }
      >
        <ChecksList checks={plan.checks} />
      </Box>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={plan.layout.prepRevision > 1 ? m.run_prepare_title_rev({ name: run.name, revision: plan.layout.prepRevision }) : m.run_prepare_title({ name: run.name })}
        description={`${profileLabel(state.catalog, plan.profile?.id ?? null)} · ${plan.mode ? MODE_LABEL[plan.mode] : ""}`}
        changes={prepareChanges(plan)}
        confirmLabel={m.run_prepare_confirm({ count: plan.entries.length })}
        onConfirm={() => {
          const r = startPrepare(run.id, choices)
          outcome.act(r, { blocked: m.run_prepare_blocked() })
          return r.result
        }}
      />
    </div>
  )
}

/** The layout preview's note on the output parent: where the folder choice came from. */
function parentNote(l: RunLayout): string {
  if (l.parent.origin === "last-used") return m.run_layout_last_used()
  if (l.parent.origin === "none") return m.run_layout_not_chosen()
  return m.run_layout_output_note()
}

/** Where a Prepare blocker ("Calibration: 1 requirement to review") is resolved: the check it names, by its label. */
export function planBlockerLink(run: Run, blocker: string): StepLink | undefined {
  const label = blocker.slice(0, Math.max(0, blocker.indexOf(":")))
  const named = (id: PlanCheck["id"]) => label.endsWith(checkLabel(id))
  const step = named("calibration") ? "calibrate" : named("membership") || named("products") ? "select" : null
  return step ? (runStepLink(run, step) as StepLink) : undefined
}

export function prepareChanges(plan: PreparePlan): string[] {
  const blocked = plan.entries.filter((e) => e.unavailable)
  return [
    plan.layout.folderPath ? m.run_prepare_creates({ folder: plan.layout.folderPath }) : m.run_prepare_creates_run_folder(),
    plan.mode === "direct-source" ? m.run_prepare_writes_source_list() : m.run_prepare_writes_entries({ count: plan.entries.length - blocked.length, bytes: formatBytes(plan.footprintBytes) }),
    ...(blocked.length > 0 ? [m.run_prepare_inputs_blocked_partial({ count: blocked.length })] : []),
    ...(plan.diffs.length > 0 ? [m.run_prepare_records_decisions({ count: plan.diffs.length })] : []),
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
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const options = profileOptions(catalog).filter((o) => o.value !== NO_PROFILE)
  const profile = profileId ? catalog.profiles[profileId] : undefined
  return (
    <Box
      id="prep-profile"
      level={2}
      title={m.run_profile_application()}
      actions={profile ? <ExecutableState profile={profile} /> : null}
    >
      <fieldset disabled={locked} className="space-y-2">
        <legend className="sr-only">{m.run_check_profile()}</legend>
        <RadioGroup value={profileId ?? ""} onValueChange={(value) => onPick(String(value))} className="grid gap-1.5 lg:grid-cols-2">
          {options.map((o) => {
            const p = catalog.profiles[o.value]!
            return (
              <OptionCard key={p.id} value={p.id} current={profileId ?? ""} disabled={locked}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{o.label}</span>
                  <StatusBadge kind="source" value={p.capability.verified ? "built-in" : "manual"} label={p.capability.verified ? m.run_profile_verified() : m.run_profile_not_verified()} />
                  <Pill tone={p.capability.inputWrite === "read-only" ? "success" : p.capability.inputWrite === "write-prone" ? "warning" : "muted"}>
                    {p.capability.inputWrite === "read-only" ? m.run_profile_read_only() : p.capability.inputWrite === "write-prone" ? m.run_profile_write_prone() : m.run_profile_writes_unknown()}
                  </Pill>
                  <NoteMarker label={m.run_profile_evidence({ name: o.label })}>{p.capability.evidence}</NoteMarker>
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
  const m = useMessages()
  const chosen = mode ? modes.find((o) => o.mode === mode) : undefined
  return (
    <Box
      id="prep-mode"
      level={2}
      title={m.run_check_mode()}
      actions={
        mode === "linked" ? (
          <span className="flex items-center gap-1" role="group" aria-label={m.run_mode_link_type()}>
            <Button size="xs" variant={linkType === "symlink" ? "secondary" : "ghost"} aria-pressed={linkType === "symlink"} disabled={locked} onClick={() => onLinkType("symlink")}>
              {m.run_mode_symbolic_links()}
            </Button>
            <Button size="xs" variant={linkType === "hardlink" ? "secondary" : "ghost"} aria-pressed={linkType === "hardlink"} disabled={locked} onClick={() => onLinkType("hardlink")}>
              {m.run_mode_hard_links()}
            </Button>
            <HelpTip label={m.run_mode_hard_links()}>{m.run_mode_hard_links_help()}</HelpTip>
          </span>
        ) : null
      }
    >
      <div className="space-y-2">
        {chosen && !chosen.allowed ? (
          <Refusal action={m.run_mode_named_blocked({ mode: MODE_LABEL[chosen.mode] })} reason={m.refusal_blockers({ count: chosen.reasons.length })} blockers={chosen.reasons.map((label) => ({ label }))} />
        ) : null}
        <fieldset disabled={locked}>
          <legend className="sr-only">{m.run_check_mode()}</legend>
          <RadioGroup value={mode ?? ""} onValueChange={(value) => onMode(String(value) as InputMode)} className="grid gap-1.5 lg:grid-cols-2">
            {modes.map((option) => (
              <OptionCard key={option.mode} value={option.mode} current={mode ?? ""} disabled={locked || (!option.allowed && option.mode !== mode)}>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{MODE_LABEL[option.mode]}</span>
                  <HelpTip label={`${MODE_LABEL[option.mode]}`}>{option.semantics}</HelpTip>
                  <Pill tone="muted" icon={HardDrive} className="ml-auto">
                    {option.mode === "copy" || option.mode === "clone" ? formatBytes(option.footprintBytes) : formatBytes(0)}
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
  const m = useMessages()
  const [picking, setPicking] = useState(false)
  return (
    <Box
      id="prep-layout"
      level={2}
      title={m.run_check_destination()}
      actions={
        <Button size="xs" variant="outline" disabled={locked} onClick={() => setPicking(true)}>
          <FolderOpen aria-hidden="true" data-icon="inline-start" />
          {layout.parent.path ? m.run_layout_change_folder() : m.import_choose_folder()}
        </Button>
      }
    >
      <ul className="space-y-1" aria-label={m.run_layout_preview()}>
        {lines(layout)}
      </ul>
      <FolderPicker open={picking} onOpenChange={setPicking} title={m.run_layout_output_folder()} initialPath={layout.parent.path} chooseVerb={m.run_layout_use()} onChoose={(path) => onParent(path)} />
    </Box>
  )
}

function choiceHint(choice: Exclude<MetadataChoice, "patched-copy">): string {
  if (choice === "accept-source") return m.run_metadata_hint_accept_source()
  if (choice === "excluded") return m.run_metadata_hint_excluded()
  return m.run_metadata_hint_configuration()
}

export function MetadataSection({ plan, locked, onChoice }: { plan: PreparePlan; locked: boolean; onChoice: (key: string, choice: MetadataChoice) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  if (plan.diffs.length === 0) return null
  const appName = profileLabel(catalog, plan.profile?.id ?? null)
  const isolated = plan.mode === "copy" || plan.mode === "clone"
  return (
    <Box id={`prep-metadata-${plan.run.id}`} level={2} flush title={m.run_check_metadata()}>
      <ul className="divide-y divide-separator">
        {plan.diffs.map((diff) => {
          const choice = plan.metadata[diff.key]
          return (
            <li key={diff.key} className="space-y-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="font-medium">
                  {formatNight(diff.session.night)} {diff.session.channel ?? ""} · {fieldLabel(diff.field)}
                </span>
                <Pill tone="muted">{m.run_frames_count({ count: diff.assetIds.length })}</Pill>
                <span className="font-mono text-[0.75rem] text-muted-foreground">
                  {FIELD_KEYWORD[diff.field]} “{diff.sourceValue ?? m.run_metadata_absent()}” → “{diff.catalogValue}”
                </span>
              </div>
              <fieldset disabled={locked}>
                <legend className="sr-only">{m.run_metadata_legend({ field: fieldLabel(diff.field) })}</legend>
                <RadioGroup value={choice ?? ""} onValueChange={(value) => onChoice(diff.key, String(value) as MetadataChoice)} className="grid gap-1.5 lg:grid-cols-2">
                  {(["patched-copy", "accept-source", "excluded", "configuration"] as MetadataChoice[]).map((option) => {
                    const unsupported = option === "configuration" && plan.profile?.capability.correctedMetadata !== "configuration"
                    const needsIsolated = option === "patched-copy" && !isolated
                    return (
                      <OptionCard key={option} value={option} current={choice ?? ""} disabled={locked || unsupported}>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{metadataChoiceLabel(option)}</span>
                          {unsupported ? (
                            <Pill tone="danger">{m.run_metadata_not_supported({ name: appName })}</Pill>
                          ) : needsIsolated ? (
                            <Pill tone="warning">{m.run_metadata_needs_isolated()}</Pill>
                          ) : (
                            <span className="text-[0.75rem] text-muted-foreground">{option === "patched-copy" ? `${FIELD_KEYWORD[diff.field]} = ${diff.catalogValue}` : choiceHint(option)}</span>
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
  const m = useMessages()
  const state = useStore((s) => s)
  const footprint = runFootprint(state.disk, state.catalog, run.id)
  return (
    <span className="inline-flex items-center gap-1" data-footprint={footprint.preparedBytes}>
      <Pill tone="muted" icon={HardDrive} title={m.run_footprint_title()}>
        {m.run_footprint_prepared({ bytes: footprint.online ? formatBytes(footprint.preparedBytes) : "–" })}
      </Pill>
      {!footprint.online ? <NoteMarker label={m.run_footprint_note_label()}>{m.run_footprint_offline()}</NoteMarker> : null}
    </span>
  )
}

function launchWord(outcome: Preparation["launches"][number]["outcome"]): string {
  if (outcome === "opened") return m.run_launch_opened()
  if (outcome === "missing-executable") return m.run_launch_not_located()
  return m.run_launch_failed()
}

/** The latest preparation of this run: Running, Prepared, Partial (prepared and blocked) or Failed; Open re-verifies. */
export function PreparationOutcome({ run, onOutcome, compact = false }: { run: Run; onOutcome: Act; compact?: boolean }) {
  const m = useMessages()
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
      title={compact ? (prep.prepRevision > 1 ? m.run_named_rev({ name: run.name, revision: prep.prepRevision }) : run.name) : prep.prepRevision > 1 ? m.run_preparation_rev({ revision: prep.prepRevision }) : m.run_preparation()}
      actions={
        <>
          <PrepStateBadge prep={prep} />
          <FootprintPill run={run} />
          {prep.state === "prepared" && !stale ? (
            <Button size="xs" onClick={() => onOutcome(openPreparation(run.id), { blocked: m.run_open_blocked(), success: { title: m.run_opened({ name: run.name }), tone: "info" } })}>
              {generic ? m.verb_open() : m.run_open_in({ app: label.split(" /")[0] ?? label })}
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
          <Pill tone="neutral">{MODE_LABEL[prep.mode]}{prep.linkType ? ` · ${prep.linkType === "symlink" ? m.run_link_symbolic() : m.run_link_hard()}` : ""}</Pill>
          <Pill tone="muted">{m.run_revision_short({ revision: prep.membershipRevision })}</Pill>
          <span>{formatDateTime(prep.createdAt)}</span>
          {lastLaunch ? <Pill tone={lastLaunch.outcome === "opened" ? "success" : "warning"} title={formatDateTime(lastLaunch.at)}>{launchWord(lastLaunch.outcome)}</Pill> : null}
        </div>
        {stale ? <Pill tone="warning">{m.run_membership_changed({ revision: latestRevisionNumber(run) })}</Pill> : null}
        {op && !isSettled(op.status) ? <OperationPanel operationId={op.id} headingLevel={compact ? 4 : 3} /> : null}
        {prep.unverified ? (
          <Refusal
            action={m.run_unverified_since({ date: formatDateTime(prep.unverified.at) })}
            reason={m.run_entries_changed({ count: prep.unverified.changed.length })}
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
  const m = useMessages()
  if (prep.unverified) return <StatusBadge kind="view" value="unverified" />
  if (prep.state === "partial") return <StatusBadge kind="preparation" value="partial" label={m.run_partial_count({ done: prep.preparedAssetIds.length + prep.preparedResultIds.length, total: prep.entryCount })} />
  return <StatusBadge kind="preparation" value={prep.state} />
}

function PreparedLists({ prep }: { prep: Preparation }) {
  const m = useMessages()
  const assets = useStore((s) => s.catalog.assets)
  const results = useStore((s) => s.catalog.results)
  const prepared = [...prep.preparedAssetIds.map((id) => assets[id]?.fileName ?? id), ...prep.preparedResultIds.map((id) => (results[id] ? fileName(results[id]!.path) : id))]
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <details className="rounded-md border px-3 py-1.5 text-[0.75rem]">
        <summary className="cursor-default">
          {m.run_prepared_count({ done: prepared.length, total: prep.entryCount })}
        </summary>
        <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono text-muted-foreground">
          {prepared.length === 0 ? <li>{m.run_none()}</li> : null}
          {prepared.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      </details>
      {prep.blocked.length > 0 ? (
        <details open className="rounded-md border px-3 py-1.5 text-[0.75rem]">
          <summary className="cursor-default">{m.run_blocked_count({ count: prep.blocked.length })}</summary>
          <ul tabIndex={0} aria-label={m.run_blocked_inputs_label({ count: prep.blocked.length })} className="mt-1 max-h-48 space-y-0.5 overflow-y-auto" data-blocked-list>
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
          {m.run_blocked_count({ count: 0 })}
        </Pill>
      )}
    </div>
  )
}
