/**
 * `/views/$viewId/prepare` — Prepare and open (flow E3-E4, F1-F6; J23 S5,
 * S8-S11; J24 S1-S16). Plan → Review preparation (exact list, checks) →
 * ConfirmDialog → operation with per-entry outcomes → Open in, Reveal View.
 * Nothing is written before Prepare View is confirmed.
 */
import { Link } from "@tanstack/react-router"
import { ArrowRight, ChevronRight, FolderOpen } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { KeyValueList, PathText } from "@/components/app/data"
import { ActionError, Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { membershipSummary, sessionLocationIds } from "@/domain/derive"
import { fileAt, filesUnder } from "@/domain/disk"
import type { Preparation, View } from "@/domain/types"
import type { CommitResult } from "@/store/core"
import { formatBytes, formatCount, formatDateTime, formatDuration, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { modifyFileExternally, restoreFileExternally, setFolderAccess } from "@/store/simulation"
import { openApplication, quitApplication, retryPreparation, startPrepare, updateApp, updatePrep, updateWorld } from "./actions"
import type { PreparePayload } from "./operations"
import { T4Badge } from "./badges"
import { ViewNotFound } from "./calibration-area"
import { CRITERION_LABEL, FIELD_LABEL, handoffCountText, KIND_LABEL, METADATA_CHOICE_LABEL, MODE_LABEL, type PreparationPlan, sameInput, sessionLabel, summaryText } from "./domain"
import { usePrepDraft, usePreparationPlan, useRouteView } from "./hooks"
import { ApplicationSection, LocationSection, MetadataSection, ModeSection } from "./prepare-sections"
import { LocateApplicationDialog } from "./profile-parts"
import { PrototypeControls, PrototypeToggle } from "./prototype-controls"

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

function Readiness({ view, plan }: { view: View; plan: PreparationPlan }) {
  const items: Array<{ id: string; ok: boolean; title: string; detail: string; action?: React.ReactNode }> = []
  items.push({
    id: "saved",
    ok: plan.revision !== null,
    title: plan.revision ? `Membership saved (revision ${plan.revision.revision})` : "Save View first",
    detail: plan.revision
      ? `${plural(plan.entries.filter((e) => e.kind === "light").length, "light")} in ${plural(plan.members.length, "session")}.`
      : "Review preparation uses a saved revision. Save the View in its header; your unsaved selection stays as it is.",
    action: plan.revision ? undefined : (
      <Button size="sm" variant="outline" render={<Link to="/views/$viewId/sessions" params={{ viewId: view.id }} />}>
        Open Sessions in this View
      </Button>
    ),
  })
  items.push({
    id: "calibration",
    ok: plan.calibration.blocking.length === 0 && plan.members.length > 0,
    title: plan.calibration.blocking.length === 0 ? "Calibration decided" : `${plural(plan.calibration.blocking.length, "calibration requirement")} not resolved`,
    detail:
      plan.calibration.blocking.length === 0
        ? `${handoffCountText(plan.calibration, plan.calibrationSources.length)} handed off.`
        : plan.calibration.blocking
            .map((r) => `${formatNight(r.member.session.night)} ${r.member.session.channel ?? ""} ${KIND_LABEL[r.kind].toLowerCase()}: ${r.drift ? "drifted" : r.state === "suggested" ? "suggested, not accepted" : r.state}`)
            .join("; "),
    action:
      plan.calibration.blocking.length === 0 ? undefined : (
        <Button size="sm" variant="outline" render={<Link to="/views/$viewId/calibration" params={{ viewId: view.id }} />}>
          Resolve in Calibration
        </Button>
      ),
  })
  return (
    <Section id="prep-ready" title="Before you prepare" level={3}>
      <ul className="divide-y rounded-lg border bg-card">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 text-sm">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <T4Badge value={item.ok ? "check:ok" : "check:blocked"} label={item.ok ? "Ready" : "Blocked"} />
                <span className="font-medium">{item.title}</span>
              </div>
              <p className="text-xs text-pretty text-muted-foreground">{item.detail}</p>
            </div>
            {item.action}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Review preparation (F4)
// ---------------------------------------------------------------------------

function ReviewPanel({ view, plan, confirmed, onConfirmChange, onPrepare, error }: { view: View; plan: PreparationPlan; confirmed: boolean; onConfirmChange: (value: boolean) => void; onPrepare: () => CommitResult | void; error: string | null }) {
  const catalog = useStore((s) => s.catalog)
  const content = plan.revision
  const summary = content ? membershipSummary(catalog, content) : null
  const lights = plan.entries.filter((e) => e.kind === "light").length
  const products = plan.entries.filter((e) => e.kind === "product").length
  const criteria = view.criteria
  const exceptions = plan.calibration.rows.filter((r) => r.state === "exception")
  const blockingChecks = plan.checks.filter((c) => !c.ok && c.blocking)
  const target = criteria?.targetId ? catalog.targets[criteria.targetId]?.name : null
  const project = criteria?.projectId ? catalog.projects[criteria.projectId]?.name : null
  const trains = criteria?.opticalTrainIds.map((id) => catalog.opticalTrains[id]?.name ?? id) ?? []
  const [confirmOpen, setConfirmOpen] = useState(false)
  const entryWord = plan.mode === "direct-source" ? "listed path" : plan.mode === "linked" ? (plan.linkType === "hardlink" ? "hard link" : "symbolic link") : plan.mode === "clone" ? "clone" : "copy"
  const entryWords = plan.mode === "copy" ? "copies" : `${entryWord}s`
  // Opening the review, from any control or on arrival from Calibration, moves focus to it (WCAG 2.4.3).
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.scrollIntoView({ block: "start" })
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return (
    <section aria-labelledby="review-title" className="space-y-4 rounded-lg border-2 border-primary/40 bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="review-title" ref={headingRef} tabIndex={-1} className="text-base font-semibold outline-none">
          Review preparation
        </h3>
        <span className="text-xs text-muted-foreground">Nothing is created until you confirm Prepare View.</span>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <section aria-labelledby="review-selection" className="space-y-2">
            <h4 id="review-selection" className="text-sm font-semibold">Selection</h4>
            <KeyValueList
              items={[
                { label: "Membership", value: content ? `Revision ${content.revision}, saved ${formatDateTime(content.savedAt)} (fixed for this preparation)` : "Not saved" },
                {
                  label: "Lights",
                  value: `${plural(lights, "light")} in ${plural(plan.members.length, "session")}${summary ? ` · ${formatDuration(summary.included.seconds)}` : ""}${products ? ` · ${plural(products, "accepted Result")}` : ""}`,
                },
                ...(summary ? [{ label: "By channel", value: summary.byChannel.map((c) => `${c.channel} ${formatCount(c.included.frames)} / ${formatDuration(c.included.seconds)}`).join(" · ") }] : []),
                { label: "Excluded", value: `${plural(plan.excludedCount, "frame")} excluded from this View; they stay on disk` },
                ...(plan.metadataExcluded.size ? [{ label: "Left out", value: `${plural(plan.metadataExcluded.size, "input")} by your corrected-metadata decision` }] : []),
                ...(content && content.unresolved.length ? [{ label: "Unresolved", value: `${plural(content.unresolved.length, "member")} unavailable; never counted as prepared` }] : []),
              ]}
            />
          </section>
          <section aria-labelledby="review-criteria" className="space-y-2">
            <h4 id="review-criteria" className="text-sm font-semibold">Saved selection criteria</h4>
            {criteria ? (
              <KeyValueList
                items={[
                  { label: "Target", value: target ?? "Any" },
                  { label: "Project", value: project ?? "None" },
                  { label: "Optical trains", value: trains.length ? trains.join(", ") : "Any" },
                  { label: "Channels", value: criteria.channels.length ? criteria.channels.join(", ") : "Any" },
                  { label: "Exposures", value: criteria.exposureS.length ? criteria.exposureS.map((s) => `${s} s`).join(", ") : "Any" },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground">No saved criteria: this membership was chosen by hand.</p>
            )}
            <p className="text-xs text-muted-foreground">Browsing filters from Sessions and Frames are not saved and are not part of the handoff.</p>
          </section>
          <section aria-labelledby="review-sources" className="space-y-2">
            <h4 id="review-sources" className="text-sm font-semibold">Source references</h4>
            <ul className="divide-y border-y text-sm">
              {plan.members.map((m) => {
                const locations = sessionLocationIds(catalog, m.session).map((id) => catalog.locations[id]?.displayName ?? id)
                return (
                  <li key={m.session.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5">
                    <span>
                      {sessionLabel(m.session)} · {plural(m.included.length, "frame")}
                      {m.excluded.length ? <span className="text-muted-foreground"> · {formatCount(m.excluded.length)} excluded</span> : null}
                    </span>
                    <span className="text-xs text-muted-foreground">{locations.join(", ")}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          <section aria-labelledby="review-handoff" className="space-y-2">
            <h4 id="review-handoff" className="text-sm font-semibold">Handoff</h4>
            <KeyValueList
              items={[
                { label: "Application", value: plan.profile ? `${plan.profile.name}${plan.profile.capability.verified ? "" : " (not verified)"}` : "Not chosen" },
                { label: "Mode", value: `${MODE_LABEL[plan.mode]}${plan.linkType ? ` (${plan.linkType === "hardlink" ? "hard links" : "symbolic links"})` : ""}` },
                { label: "View folder", value: plan.viewPath ? <PathText path={`${plan.viewPath}/`} /> : "Not set" },
                { label: "Output", value: plan.outputPath ? <PathText path={`${plan.outputPath}/`} /> : "Not set" },
                {
                  label: "Operations",
                  value:
                    plan.mode === "direct-source"
                      ? "1: write the handoff list with every exact source path; no links or copies"
                      : `${formatCount(plan.operationCount)} operations: create the View and output folders, write ${formatCount(plan.entries.length)} entries and ${formatCount(plan.calibrationEntries.length)} calibration ${entryWords}, and the handoff list`,
                },
                { label: "Footprint", value: `${formatBytes(plan.footprintBytes)}${plan.freeBytes !== null ? ` · ${formatBytes(plan.freeBytes)} free on ${plan.destinationVolume?.name}` : ""}` },
              ]}
            />
          </section>
          <section aria-labelledby="review-calibration" className="space-y-2">
            <h4 id="review-calibration" className="text-sm font-semibold">Calibration</h4>
            {plan.calibrationSources.length === 0 ? (
              <p className="text-sm text-muted-foreground">No calibration input is handed off.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {plan.calibrationSources.map((s) => (
                  <li key={s.id}>
                    {KIND_LABEL[s.kind]}: {s.name}{" "}
                    <span className="text-xs text-muted-foreground">{s.isMaster ? "library master" : `raw set, ${plural(s.frameCount ?? 0, "frame")}; the application builds its own master`}</span>
                  </li>
                ))}
              </ul>
            )}
            {exceptions.map((r) => (
              <p key={r.key} className="rounded-md border border-warning/40 px-3 py-2 text-sm text-pretty">
                <StatusBadge kind="assignment" value="exception" /> {sessionLabel(r.member.session)} {KIND_LABEL[r.kind].toLowerCase()} uses {r.source?.name}:{" "}
                {r.criteria
                  .filter((c) => c.result !== "compatible")
                  .map((c) => `${CRITERION_LABEL[c.name]} ${c.result}`)
                  .join(", ")}
                . Reason: “{r.assignment?.exception?.reason}”
              </p>
            ))}
            {plan.calibration.rows.filter((r) => r.state === "excluded").map((r) => (
              <p key={r.key} className="text-xs text-muted-foreground">
                {sessionLabel(r.member.session)}: handed off without a {KIND_LABEL[r.kind].toLowerCase()}.
              </p>
            ))}
            {plan.calibration.blocking.length > 0 ? (
              <Notice tone="refusal" title={`${plural(plan.calibration.blocking.length, "requirement")} unresolved`} actions={<Button size="sm" variant="outline" render={<Link to="/views/$viewId/calibration" params={{ viewId: view.id }} />}>Resolve in Calibration</Button>}>
                {plan.calibration.blocking
                  .map((r) => {
                    const alternative = r.candidates.find((c) => c.summary.allCompatible && !(r.input && sameInput(c.source.input, r.input)))
                    const status = r.drift
                      ? `drifted: ${r.drift}`
                      : r.state === "suggested"
                        ? "suggestion not accepted"
                        : r.state === "unresolved" && r.source
                          ? `unresolved: ${r.source.name} chosen, ${summaryText(r.criteria).toLowerCase()}${alternative ? `; compatible alternative ${alternative.source.name}` : ""}`
                          : r.state
                    return `${sessionLabel(r.member.session)} ${KIND_LABEL[r.kind].toLowerCase()} (${status})`
                  })
                  .join("; ")}
                . Choose another input, record a scoped exception with a reason, hand off without it, or defer preparation. Unaccepted suggestions are never handed off.
              </Notice>
            ) : null}
          </section>
          {plan.diffs.length ? (
            <section aria-labelledby="review-metadata" className="space-y-1">
              <h4 id="review-metadata" className="text-sm font-semibold">Corrected metadata</h4>
              <ul className="space-y-0.5 text-sm">
                {plan.diffs.map((d) => (
                  <li key={d.key}>
                    {formatNight(d.session.night)} {FIELD_LABEL[d.field].toLowerCase()}: {plan.metadata[d.key] ? METADATA_CHOICE_LABEL[plan.metadata[d.key]!] : "not decided"}
                    {plan.metadata[d.key] === "accept-source" ? <span className="text-muted-foreground"> · effective value {d.sourceValue ?? "absent"} (header), not patched</span> : null}
                    {plan.metadata[d.key] === "patched-copy" ? <span className="text-muted-foreground"> · effective value {d.catalogValue} in isolated entries only</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>

      <section aria-labelledby="review-checks" className="space-y-2">
        <h4 id="review-checks" className="text-sm font-semibold">Checks</h4>
        <ul className="divide-y border-y text-sm">
          {plan.checks.map((check) => (
            <li key={check.id} className="grid grid-cols-[9rem_8.5rem_minmax(0,1fr)] items-start gap-3 px-3 py-1.5">
              <span>{check.label}</span>
              <span>
                <T4Badge value={check.ok ? "check:ok" : check.blocking ? "check:blocked" : "check:warning"} />
              </span>
              <span className="text-xs text-pretty text-muted-foreground [overflow-wrap:anywhere]">{check.detail}</span>
            </li>
          ))}
        </ul>
        {plan.unavailable.length > 0 ? (
          <Notice tone="warning" title={`${plural(plan.unavailable.length, "entry", "entries")} cannot be prepared now`}>
            <ul className="mt-1 space-y-0.5">
              {plan.unavailable.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <PathText path={e.sourcePath} /> <span className="text-xs">{e.availability === "unreadable" ? "read access denied" : e.availability}</span>
                </li>
              ))}
            </ul>
            {plan.unavailable.length > 8 ? <p className="text-xs">and {formatCount(plan.unavailable.length - 8)} more.</p> : null}
            <p className="text-xs">They will be blocked, named with their paths, and never counted as prepared. Per-item mode changes are not offered.</p>
          </Notice>
        ) : null}
      </section>

      <div className="space-y-3 border-t pt-3">
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={confirmed} disabled={!plan.revision} onCheckedChange={(value) => onConfirmChange(Boolean(value))} className="mt-0.5" />
          <span>
            I confirm these {plural(plan.entries.length, "entry", "entries")}
            {plan.revision ? ` (revision ${plan.revision.revision})` : ""} and the saved selection criteria.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!plan.ready || !confirmed} aria-describedby="prepare-reason" onClick={() => setConfirmOpen(true)}>
            Prepare View
          </Button>
          <span id="prepare-reason" className="text-xs text-muted-foreground">
            {blockingChecks.length > 0 ? `Blocked: ${blockingChecks.map((c) => c.label.toLowerCase()).join(", ")}.` : !confirmed ? "Confirm the membership first." : "Ready to prepare."}
          </span>
        </div>
        {error ? <ActionError message={error} /> : null}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Prepare ${view.name}?`}
        description={`${plan.profile?.name ?? "The application"} will receive exactly the reviewed inputs.`}
        changes={
          plan.mode === "direct-source"
            ? [`Create ${plan.viewPath}/ with the handoff list naming ${formatCount(plan.entries.length + plan.calibrationEntries.length)} exact source paths`, `Create the output folder ${plan.outputPath}/`]
            : [
                `Create ${plan.viewPath}/ with ${formatCount(plan.entries.length)} ${entryWords} and ${formatCount(plan.calibrationEntries.length)} calibration ${entryWords}`,
                `Create the output folder ${plan.outputPath}/`,
                ...(plan.patched.size && (plan.mode === "copy" || plan.mode === "clone") ? [`Patch the header of ${formatCount(plan.patched.size)} isolated entries only`] : []),
              ]
        }
        unchanged={["Every source file, its bytes and its hash", "Library quality decisions and View membership", "Existing folders and files at the destination"]}
        confirmLabel={`Prepare ${plural(plan.entries.length, "entry", "entries")}`}
        onConfirm={onPrepare}
      />
    </section>
  )
}

// ---------------------------------------------------------------------------
// Outcome and open (F5, F6)
// ---------------------------------------------------------------------------

function RevealDialog({ prep, open, onOpenChange }: { prep: Preparation; open: boolean; onOpenChange: (open: boolean) => void }) {
  const disk = useStore((s) => s.disk)
  const files = open ? filesUnder(disk, prep.viewPath) : []
  const folders = files.reduce<Record<string, number>>((acc, f) => {
    const rel = f.path.slice(prep.viewPath.length + 1)
    const top = rel.includes("/") ? `${rel.split("/")[0]}/` : rel
    acc[top] = (acc[top] ?? 0) + 1
    return acc
  }, {})
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Reveal View</DialogTitle>
          <DialogDescription>Prototype: simulated Finder window for {prep.viewPath}/</DialogDescription>
        </DialogHeader>
        {files.length === 0 ? (
          <p className="text-sm text-muted-foreground">The View folder is empty or offline.</p>
        ) : (
          <ul className="divide-y rounded-md border text-sm">
            {Object.entries(folders).map(([name, count]) => (
              <li key={name} className="flex justify-between px-3 py-1.5">
                <span className="font-mono text-xs">{name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{name.endsWith("/") ? plural(count, "item") : ""}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 py-1.5">
              <span className="font-mono text-xs">output/</span>
              <span className="text-xs text-muted-foreground">{prep.outputPath.startsWith(prep.viewPath) ? "output location" : `output is at ${prep.outputPath}/`}</span>
            </li>
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Outcome({ view, prep, latestRevision, onReviewAgain }: { view: View; prep: Preparation; latestRevision: number | null; onReviewAgain: () => void }) {
  const op = useStore((s) => (prep.operationId ? s.operations[prep.operationId] : undefined))
  const profile = useStore((s) => s.catalog.profiles[prep.profileId])
  const running = useStore((s) => s.slices.t4.running[view.id])
  // Left by an Open that found entries changed (PREP-FR-10); the next Open re-verifies and clears it.
  const unverified = prep?.unverified ?? null
  const [reveal, setReveal] = useState(false)
  const [locating, setLocating] = useState(false)
  const [message, setMessage] = useState<{ tone: "info" | "refusal" | "warning"; text: string; missing: boolean } | null>(null)
  const [retryError, setRetryError] = useState<string | null>(null)
  const settled = op ? isSettled(op.status) : true
  const prepared = prep.state === "prepared"
  const stale = latestRevision !== null && prep.membershipRevision !== latestRevision
  const appName = profile?.application === "generic" ? "the application" : (profile?.name.split(" /")[0] ?? "the application")
  const blockedEntries = prep.blocked
  const entryKinds = (op?.payload as unknown as PreparePayload | undefined)?.entries ?? {}
  const blockedCalibration = blockedEntries.filter((b) => b.input.kind === "asset" && entryKinds[`a:${b.input.assetId}`]?.kind === "calibration").length
  const preparedCount = prep.preparedAssetIds.length + prep.preparedResultIds.length
  // The entries Retry runs again: blocked or failed ones, and after Cancel every unfinished one.
  const retryCount = op ? op.items.filter((i) => i.status === "blocked" || i.status === "failed" || (op.status === "canceled" && i.status !== "done")).length : 0
  const recoverable = settled && (prep.state === "partial" || prep.state === "failed" || (prep.state === "canceled" && retryCount > 0))

  function open() {
    const outcome = openApplication(view, prep.id)
    if (!outcome.result.ok) return setMessage({ tone: "refusal", text: outcome.result.message, missing: false })
    // A refused re-verification is shown by the persistent Unverified notice below.
    if (outcome.outcome === "unverified") return setMessage(null)
    setMessage({ tone: outcome.outcome === "opened" ? "info" : outcome.outcome === "missing-executable" ? "refusal" : "warning", text: outcome.message, missing: outcome.outcome !== "opened" })
  }

  function retry() {
    const result = retryPreparation(prep.id)
    setRetryError(result.ok ? null : result.message)
  }

  return (
    <Section
      id="prep-outcome"
      title="Preparation"
      level={3}
      description={`${MODE_LABEL[prep.mode]}${prep.linkType ? ` (${prep.linkType === "hardlink" ? "hard links" : "symbolic links"})` : ""} · revision ${prep.membershipRevision} · started ${formatDateTime(prep.createdAt)}`}
      actions={unverified ? <T4Badge value="preparation:unverified" /> : <StatusBadge kind="preparation" value={prep.state} />}
    >
      {stale ? (
        <Notice tone="warning" title="The selection changed after this preparation" actions={<Button size="sm" variant="outline" onClick={onReviewAgain}>Review preparation again</Button>}>
          Prepared for revision {prep.membershipRevision}; the View is at revision {latestRevision}. A new review creates a new preparation. These entries stay unchanged unless you clean them up.
        </Notice>
      ) : null}
      {/* Once prepared, Open in leads; the per-entry outcome follows it as detail. */}
      {op && !(prepared && settled) ? <OperationPanel operationId={op.id} onRetry={recoverable ? undefined : retry} /> : null}
      {retryError ? <ActionError message={retryError} /> : null}
      {recoverable ? (
        <Notice
          tone="warning"
          title={
            prep.state === "partial"
              ? `Partial: ${formatCount(preparedCount)} prepared, ${formatCount(blockedEntries.length - blockedCalibration)} blocked${blockedCalibration ? `, ${plural(blockedCalibration, "calibration file")} blocked` : ""}`
              : prep.state === "canceled"
                ? `Canceled: ${formatCount(preparedCount)} prepared, ${formatCount(retryCount)} not finished`
                : "Failed: nothing was prepared"
          }
          actions={
            <>
              <Button size="sm" onClick={retry} disabled={retryCount === 0}>
                Retry {plural(retryCount, prep.state === "canceled" ? "unfinished entry" : "blocked entry", prep.state === "canceled" ? "unfinished entries" : "blocked entries")}
              </Button>
              <Button size="sm" variant="outline" onClick={onReviewAgain}>
                Review preparation again
              </Button>
            </>
          }
        >
          <p>Open is not offered until every entry is prepared. Retry runs only the recorded blocked entries with fresh snapshots; or keep this partial View unchanged.</p>
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {blockedEntries.map((b) => (
              <li key={`${b.input.kind}-${b.input.kind === "asset" ? b.input.assetId : b.input.resultId}`}>
                <PathText path={b.path} />
                <span className="block text-xs text-pretty">{b.reason}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {prepared && settled ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={open}>Open in {profile?.application === "generic" ? "application" : appName}</Button>
            <Button variant="outline" onClick={() => setReveal(true)}>
              <FolderOpen aria-hidden="true" data-icon="inline-start" />
              Reveal View
            </Button>
          </div>
          <KeyValueList
            items={[
              { label: "View folder", value: <PathText path={`${prep.viewPath}/`} /> },
              { label: "Output", value: <PathText path={`${prep.outputPath}/`} /> },
              {
                label: "Entries",
                value: unverified
                  ? `${formatCount(preparedCount)} of ${formatCount(prep.entryCount)} prepared; ${plural(unverified.changed.length, "entry", "entries")} changed since preparation`
                  : `${formatCount(preparedCount)} of ${formatCount(prep.entryCount)} prepared and verified`,
              },
              { label: "Footprint", value: formatBytes(prep.footprintBytes) },
              {
                label: "Launches",
                value: prep.launches.length
                  ? prep.launches.map((l) => `${formatDateTime(l.at)} ${l.outcome === "opened" ? "opened" : l.outcome === "missing-executable" ? "application missing" : "launch failed"}`).join(" · ")
                  : "Not opened yet",
              },
            ]}
          />
          {unverified ? (
            <Notice tone="refusal" title={`Unverified: ${appName} was not opened`}>
              <p>
                {plural(unverified.changed.length, "prepared entry", "prepared entries")} no longer {unverified.changed.length === 1 ? "matches" : "match"} the preparation snapshot (checked {formatDateTime(unverified.at)}). PlateVault wrote nothing to the sources or the entries. Restore the original bytes and choose Open again, or review preparation again for a new preparation.
              </p>
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {unverified.changed.map((c) => (
                  <li key={c.path}>
                    <PathText path={c.path} />
                    <span className="block text-xs text-pretty">{c.reason}</span>
                  </li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {message ? (
            <Notice
              tone={message.tone}
              title={message.tone === "info" ? `${appName} opened` : message.tone === "refusal" ? "Application not found" : "Launch failed"}
              actions={
                message.missing ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setLocating(true)}>
                      Choose application…
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setReveal(true)}>
                      Reveal View
                    </Button>
                  </>
                ) : null
              }
            >
              {message.text}
            </Notice>
          ) : null}
          {running ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed px-3 py-2 text-sm">
              <span>
                {appName} is open on this View (prototype). Quitting it never marks the View Complete.
              </span>
              <Button size="sm" variant="outline" onClick={() => quitApplication(view)}>
                Quit {appName} (prototype)
              </Button>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Launching is not processing. When processing is done, use{" "}
            <Link to="/views/$viewId/results" params={{ viewId: view.id }} className="text-primary underline-offset-4 hover:underline">
              Results
            </Link>{" "}
            to attach outputs and mark the attempt complete.
          </p>
        </div>
      ) : null}
      {op && prepared && settled ? <OperationPanel operationId={op.id} onRetry={retry} /> : null}
      <RevealDialog prep={prep} open={reveal} onOpenChange={setReveal} />
      {locating && profile ? <LocateApplicationDialog profile={profile} onOpenChange={(o) => !o && setLocating(false)} onLocated={() => setMessage(null)} /> : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Area
// ---------------------------------------------------------------------------

export function ViewPrepareArea() {
  const { viewId, view } = useRouteView()
  const plan = usePreparationPlan(view)
  const draft = usePrepDraft(viewId)
  const preparations = useStore((s) => s.catalog.preparations)
  const operations = useStore((s) => s.operations)
  const world = useStore((s) => s.slices.t4.world)
  const denied = useStore((s) => s.disk.deniedPaths)
  const [error, setError] = useState<string | null>(null)

  const history = useMemo(() => Object.values(preparations).filter((p) => p.viewId === viewId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [preparations, viewId])
  const latest = history[0] ?? null
  const latestOp = latest?.operationId ? operations[latest.operationId] : undefined
  const busy = Boolean(latestOp && !isSettled(latestOp.status))
  const revision = plan?.revision?.revision ?? null
  const confirmed = draft.confirmedRevision !== null && draft.confirmedRevision === revision
  const reviewing = draft.reviewing && !busy
  // Prepared for the current revision: Open in is the next step, so Review preparation steps back.
  const preparedNow = latest?.state === "prepared" && !busy && latest.membershipRevision === revision

  // A confirmation belongs to one revision: a new revision needs a new review.
  useEffect(() => {
    if (draft.confirmedRevision !== null && revision !== null && draft.confirmedRevision !== revision) updatePrep(viewId, { confirmedRevision: null })
  }, [draft.confirmedRevision, revision, viewId])
  // J24 P8: one prepared 26 Sep frame (else the first light frame), changed in place to exercise Open's re-verification.
  const p8Path = latest?.state === "prepared" ? ((plan?.entries.find((e) => e.kind === "light" && e.sourcePath.includes("/2026-09-26/")) ?? plan?.entries.find((e) => e.kind === "light"))?.sourcePath ?? null) : null
  const p8Changed = useStore((s) => (p8Path ? Boolean(fileAt(s.disk, p8Path)?.previousSha256) : false))
  const latestUnverified = latest?.unverified ?? null

  if (!view || !plan) return <ViewNotFound />
  const complete = Boolean(view.completedAt)
  const locked = complete || busy
  const app = world.apps.find((a) => a.path === plan.profile?.executablePath) ?? world.apps.find((a) => plan.profile && a.name === plan.profile.name.split(" /")[0])
  const pausedItem = latestOp?.status === "paused" ? latestOp.items.find((i) => i.phase === "snapshot recorded") : undefined
  const driftItems = latestOp ? latestOp.items.filter((i) => i.status === "blocked" && i.detail?.startsWith("Source drift") && i.path) : []
  const lightPaths = plan.entries.filter((e) => e.kind === "light").map((e) => e.sourcePath)
  const lastThree = lightPaths.slice(-3)
  const threeDenied = lastThree.length > 0 && lastThree.every((p) => denied.includes(p))

  function prepare() {
    if (!view || !plan) return
    const result = startPrepare(view, plan)
    if (!result.ok) {
      setError(result.message)
      return { ok: false as const, reason: "write-failed" as const, message: result.message }
    }
    setError(null)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Prepare and open"
        description="Turn this View's saved membership into one verified input layout for an external application. PlateVault never runs processing."
        meta={latest ? latestUnverified ? <T4Badge value="preparation:unverified" /> : <StatusBadge kind="preparation" value={latest.state} /> : null}
        actions={
          <Button
            variant={preparedNow ? "outline" : "default"}
            disabled={locked || !plan.revision}
            aria-describedby={locked || !plan.revision ? "review-disabled" : undefined}
            onClick={() => updatePrep(viewId, { reviewing: true })}
          >
            Review preparation
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        }
      />
      <PageBody>
        {locked ? (
          <p id="review-disabled" className="text-xs text-muted-foreground">
            {complete ? "This View is Complete. Reopen it in the header before preparing a new revision." : "A preparation is running. Choices are locked until it settles."}
          </p>
        ) : !plan.revision ? (
          <p id="review-disabled" className="text-xs text-muted-foreground">
            Save the View first: Review preparation uses a saved revision.
          </p>
        ) : null}
        {preparedNow ? null : <Readiness view={view} plan={plan} />}
        {latest ? <Outcome view={view} prep={latest} latestRevision={revision} onReviewAgain={() => updatePrep(viewId, { reviewing: true, confirmedRevision: null })} /> : null}
        {preparedNow ? (
          // Prepared: Open in is the next step, so the settings that would start a new preparation stay folded.
          <Collapsible className="rounded-lg border">
            <CollapsibleTrigger render={<Button variant="ghost" className="w-full justify-start rounded-lg [&[data-panel-open]>svg]:rotate-90" />}>
              <ChevronRight aria-hidden="true" data-icon="inline-start" />
              Change preparation settings
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-6 border-t px-4 py-4">
              <p className="text-xs text-pretty text-muted-foreground">Changes apply to a new preparation after Review preparation. The prepared entries above stay as they are.</p>
              <ApplicationSection view={view} plan={plan} locked={locked} />
              <MetadataSection view={view} plan={plan} draft={draft} locked={locked} />
              <ModeSection view={view} plan={plan} draft={draft} locked={locked} />
              <LocationSection view={view} plan={plan} draft={draft} locked={locked} />
            </CollapsibleContent>
          </Collapsible>
        ) : (
          <>
            <ApplicationSection view={view} plan={plan} locked={locked} />
            <MetadataSection view={view} plan={plan} draft={draft} locked={locked} />
            <ModeSection view={view} plan={plan} draft={draft} locked={locked} />
            <LocationSection view={view} plan={plan} draft={draft} locked={locked} />
          </>
        )}
        {reviewing ? (
          <ReviewPanel
            view={view}
            plan={plan}
            confirmed={confirmed}
            onConfirmChange={(value) => updatePrep(viewId, { confirmedRevision: value ? revision : null })}
            onPrepare={prepare}
            error={error}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant={preparedNow ? "outline" : "default"} disabled={locked || !plan.revision} onClick={() => updatePrep(viewId, { reviewing: true })}>
              Review preparation
            </Button>
            <span className="text-xs text-muted-foreground">Shows the exact list, the checks and what changes before anything is written.</span>
          </div>
        )}
        {history.length > 1 ? (
          <Section id="prep-history" title="Earlier preparations" level={3} description="Kept for comparison. Removing their entries goes through Clean up View.">
            <ul className="divide-y rounded-lg border bg-card text-sm">
              {history.slice(1).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block">
                      Revision {p.membershipRevision} · {MODE_LABEL[p.mode]} · {formatDateTime(p.createdAt)}
                    </span>
                    <PathText path={`${p.viewPath}/`} className="text-muted-foreground" />
                  </span>
                  <StatusBadge kind="preparation" value={p.state} />
                </li>
              ))}
            </ul>
            <Button size="sm" variant="outline" render={<Link to="/views/$viewId/cleanup" params={{ viewId }} />}>
              Clean up View
            </Button>
          </Section>
        ) : null}
        <PrototypeControls title="outside changes for this step">
          <PrototypeToggle
            label="Pause the next Prepare after one source snapshot"
            detail="J24 P7: lets you change that source before the entry is written."
            checked={world.pauseAfterSnapshot}
            onChange={(value) => updateWorld((w) => ({ ...w, pauseAfterSnapshot: value }))}
          />
          {pausedItem?.path ? (
            <div className="space-y-1.5 rounded-md border px-3 py-2">
              <p className="text-xs">Paused after the snapshot of:</p>
              <PathText path={pausedItem.path} />
              <Button size="sm" variant="outline" onClick={() => modifyFileExternally(pausedItem.path!)}>
                Overwrite this source with same-size different bytes
              </Button>
            </div>
          ) : null}
          {driftItems.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
              <PathText path={item.path!} className="min-w-0 flex-1" />
              <Button size="sm" variant="outline" onClick={() => restoreFileExternally(item.path!)}>
                Restore original bytes
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={lastThree.length === 0} onClick={() => lastThree.forEach((p) => setFolderAccess(p, !threeDenied))}>
              {threeDenied ? "Restore read access to 3 source frames" : "Deny read access to 3 source frames"}
            </Button>
            <span className="text-xs text-muted-foreground">J24 S15: the last {lastThree.length} light frames of this View.</span>
          </div>
          {p8Path ? (
            <div className="space-y-1.5 rounded-md border px-3 py-2">
              <p className="text-xs text-muted-foreground">J24 P8 (S10a, S11): a prepared frame changed in place, outside PlateVault.</p>
              <PathText path={p8Path} />
              <Button size="sm" variant="outline" onClick={() => (p8Changed ? restoreFileExternally(p8Path) : modifyFileExternally(p8Path))}>
                {p8Changed ? "Restore this frame's original bytes" : "Overwrite this frame with a same-size variant"}
              </Button>
            </div>
          ) : null}
          {app ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => updateApp(app.id, { present: !app.present })}>
                {app.present ? `Move ${app.name} out of ${app.path}` : `Put ${app.name} back at ${app.path}`}
              </Button>
              <Button size="sm" variant="outline" disabled={app.launchFails} onClick={() => updateApp(app.id, { launchFails: true })}>
                {app.launchFails ? "Next launch fails" : "Make the next launch fail"}
              </Button>
            </div>
          ) : null}
        </PrototypeControls>
      </PageBody>
    </div>
  )
}
