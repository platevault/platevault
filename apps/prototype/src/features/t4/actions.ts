/**
 * T4 writers (T4-owned). Durable catalog changes go through `commit()` with
 * the View's revision expected (D08); plan choices go to the T4 slice.
 * Nothing here touches the simulated disk except the approved operations.
 */
import { filesUnder } from "@/domain/disk"
import { stableHash } from "@/domain/indexing"
import type { CalibrationAssignment, CalibrationInput, CalibrationMaster, Catalog, Location, MatchCriterion, MetadataDecision, Preparation, PreparationId, ProfileId, View, ViewId } from "@/domain/types"
import { formatCount, plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, type PrototypeState, recordActivity, store, updateSlice, withCatalog } from "@/store/core"
import { isSettled, startOperation } from "@/store/operations"
import { emptyPrepDraft, type PrepDraft, type SimulatedApp } from "@/store/slices/t4"
import { assignmentId, basisFiles, entryPath, inputDrift, inputKey, type PreparationPlan, type RequirementRow, savedMembership, sourceFor } from "./domain"
import { ADOPT_PHASES, type AdoptPayload, type PrepareEntry, type PreparePayload, type UnavailableInput, verifyPreparedEntries } from "./operations"

// ---------------------------------------------------------------------------
// Slice helpers
// ---------------------------------------------------------------------------

export function updatePrep(viewId: ViewId, patch: Partial<PrepDraft>) {
  updateSlice("t4", (slice) => ({ ...slice, prep: { ...slice.prep, [viewId]: { ...(slice.prep[viewId] ?? emptyPrepDraft()), ...patch } } }))
}

export function updateWorld(update: (world: PrototypeState["slices"]["t4"]["world"]) => PrototypeState["slices"]["t4"]["world"]) {
  updateSlice("t4", (slice) => ({ ...slice, world: update(slice.world) }))
}

export function updateApp(id: string, patch: Partial<SimulatedApp>) {
  updateWorld((world) => ({ ...world, apps: world.apps.map((app) => (app.id === id ? { ...app, ...patch } : app)) }))
}

function viewCommit(view: View, label: string, update: (view: View) => View, href: string): CommitResult {
  return commit(
    label,
    (s) =>
      withCatalog(s, (catalog) => {
        const current = catalog.views[view.id]
        return current ? { ...catalog, views: { ...catalog.views, [view.id]: update(current) } } : catalog
      }),
    { expect: { collection: "views", id: view.id, revision: view.revision }, href },
  )
}

// ---------------------------------------------------------------------------
// Calibration assignments (CAL-FR-02, CAL-FR-05, CAL-FR-08)
// ---------------------------------------------------------------------------

export interface AssignmentDecision {
  state: CalibrationAssignment["state"]
  input: CalibrationInput | null
  criteria: MatchCriterion[]
  reason?: string
}

/**
 * Store the decisions and, beside each, its D19 basis in the T4 slice: when
 * it was made, the View revision it is saved as, and for an accepted input or
 * an exception the SHA-256 of every file it hands off (CAL-FR-08). An input
 * whose bytes no longer match their basis cannot be accepted.
 */
function commitAssignments(view: View, label: string, decisions: Array<{ row: RequirementRow; decision: AssignmentDecision | null }>): CommitResult {
  const { catalog, disk } = store.getState()
  if (catalog.views[view.id]?.completedAt) {
    return { ok: false, reason: "write-failed", message: `${label} was refused: ${view.name} is Complete, so its calibration decisions are read-only. Reopen the View to change them.` }
  }
  for (const { decision } of decisions) {
    if (!decision?.input || (decision.state !== "accepted" && decision.state !== "exception")) continue
    const drift = inputDrift(catalog, disk, decision.input)
    if (drift) {
      const name = sourceFor(catalog, decision.input)?.name ?? "This input"
      const message = `${label} was refused: ${name}. ${drift} Restore its bytes, or choose another input.`
      recordActivity({ kind: "write-refused", title: `${label} refused`, detail: message, operationId: null, href: `/views/${view.id}/calibration` })
      return { ok: false, reason: "write-failed", message }
    }
  }
  const at = nowIso()
  const membershipRevision = savedMembership(view)?.revision ?? null
  return commit(
    label,
    (s) => {
      const current = s.catalog.views[view.id]
      if (!current) return s
      let calibration = [...current.calibration]
      const bases = { ...s.slices.t4.decisions }
      for (const { row, decision } of decisions) {
        const id = assignmentId(view.id, row.member.session.id, row.kind)
        calibration = calibration.filter((a) => !(a.lightSessionId === row.member.session.id && a.kind === row.kind))
        delete bases[id]
        if (!decision) continue
        calibration.push({
          id,
          lightSessionId: row.member.session.id,
          kind: row.kind,
          input: decision.input,
          state: decision.state,
          criteria: decision.criteria,
          exception: decision.reason ? { reason: decision.reason, at } : null,
        })
        const handedOff = decision.input && (decision.state === "accepted" || decision.state === "exception") ? decision.input : null
        bases[id] = {
          input: handedOff ? inputKey(handedOff) : null,
          viewRevision: current.revision + 1,
          membershipRevision,
          at,
          files: handedOff ? basisFiles(s.catalog, s.disk, handedOff) : [],
        }
      }
      const next = withCatalog(s, (c) => ({ ...c, views: { ...c.views, [view.id]: { ...current, calibration } } }))
      return { ...next, slices: { ...next.slices, t4: { ...next.slices.t4, decisions: bases } } }
    },
    { expect: { collection: "views", id: view.id, revision: view.revision }, href: `/views/${view.id}/calibration` },
  )
}

/**
 * Accept exactly the given rows' suggestions: a suggested row's preselection,
 * or a decided row's newly adopted master (J26 S9). The evidence shown is the evidence stored.
 */
export function acceptSuggestions(view: View, rows: RequirementRow[]): CommitResult {
  const decisions = rows.flatMap((row) => {
    const offer = row.state === "suggested" ? row.suggestion : row.pending
    return offer ? [{ row, decision: { state: "accepted" as const, input: offer.source.input, criteria: offer.criteria } }] : []
  })
  return commitAssignments(view, `Accept ${plural(decisions.length, "calibration suggestion")}`, decisions)
}

export function decideRow(view: View, row: RequirementRow, decision: AssignmentDecision | null, label: string): CommitResult {
  return commitAssignments(view, label, [{ row, decision }])
}

// ---------------------------------------------------------------------------
// Profiles and executables (PREP-FR-01, PREP-FR-02, PREP-FR-10)
// ---------------------------------------------------------------------------

export function chooseProfile(view: View, profileId: ProfileId): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  return viewCommit(view, `Choose ${profile?.name ?? "application"}`, (v) => ({ ...v, profileId }), `/views/${view.id}/prepare`)
}

function patchProfile(profileId: ProfileId, label: string, patch: (catalog: Catalog) => Partial<Catalog["profiles"][string]>): CommitResult {
  return commit(label, (s) =>
    withCatalog(s, (catalog) => {
      const profile = catalog.profiles[profileId]
      return profile ? { ...catalog, profiles: { ...catalog.profiles, [profileId]: { ...profile, ...patch(catalog) } } } : catalog
    }),
    { href: "/settings/applications" },
  )
}

/** Executable state as PlateVault observes it on the simulated computer. */
export function observeExecutable(path: string | null): "not-configured" | "found" | "missing" {
  if (!path) return "not-configured"
  return store.getState().slices.t4.world.apps.some((app) => app.present && app.path === path) ? "found" : "missing"
}

export function locateExecutable(profileId: ProfileId, path: string): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  return patchProfile(profileId, `Locate ${profile?.name ?? "application"}`, () => ({ executablePath: path, executableState: observeExecutable(path) }))
}

export function checkExecutable(profileId: ProfileId): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  if (!profile) return { ok: true }
  return patchProfile(profileId, `Check ${profile.name}`, () => ({ executableState: observeExecutable(profile.executablePath) }))
}

export function setLaunchArgs(profileId: ProfileId, launchArgs: string): CommitResult {
  return patchProfile(profileId, "Launch arguments", () => ({ launchArgs }))
}

export type OpenOutcome = {
  outcome: "opened" | "missing-executable" | "launch-failed" | "unverified" | "unavailable"
  message: string
  result: CommitResult
  /** Set when the outcome is "unavailable": every input the application cannot read now, none omitted. */
  unavailable?: UnavailableInput[]
}

const UNAVAILABLE_LABEL: Record<UnavailableInput["availability"], string> = { offline: "Offline", unreadable: "Unreadable", retired: "Retired" }

/** "Opening is refused: 214 inputs are unavailable (214 Offline on Archive)." plus how to recover. */
function unavailableText(appName: string, inputs: UnavailableInput[], changed: number): string {
  const groups = new Map<string, number>()
  for (const input of inputs) {
    const where = input.location ?? input.volume
    const key = `${UNAVAILABLE_LABEL[input.availability]}${where ? ` ${input.availability === "offline" ? "on" : "in"} ${where}` : ""}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  const parts = [...groups].map(([key, count]) => `${formatCount(count)} ${key}`)
  const volumes = [...new Set(inputs.flatMap((i) => (i.availability === "offline" && i.volume ? [i.volume] : [])))]
  const others = inputs.filter((i) => i.otherVerifiedCopy).length
  const lines = [
    `Opening is refused: ${plural(inputs.length, "input")} ${inputs.length === 1 ? "is" : "are"} unavailable (${parts.join("; ")}). ${appName} was not opened and no input was left out of the handoff.`,
  ]
  if (volumes.length) lines.push(`Reconnect ${volumes.join(" and ")}, then open again.`)
  if (inputs.some((i) => i.availability === "retired")) lines.push("A copy in a retired location is never an input.")
  lines.push(
    others === 0
      ? "No other verified location holds these inputs, so a new review lists them as unavailable."
      : others === inputs.length
        ? "Another verified location holds each of them; review preparation again to prepare from it."
        : `Another verified location holds ${formatCount(others)} of them; review preparation again to prepare those from it.`,
  )
  if (changed) lines.push(`${plural(changed, "readable entry", "readable entries")} also changed since preparation and the View reads Unverified until their bytes return.`)
  return lines.join(" ")
}

/**
 * Simulated launch. Every prepared entry is re-verified against its
 * preparation snapshot first; a changed entry refuses the launch and writes
 * nothing (PREP-FR-10, PREP-AC-15). An input that cannot be read now refuses
 * the whole launch rather than being omitted (STO-FR-08, D19). Launching is
 * not processing; closing never marks Complete.
 */
export function openApplication(view: View, preparationId: PreparationId): OpenOutcome {
  const state = store.getState()
  const prep = state.catalog.preparations[preparationId]
  const profile = prep ? state.catalog.profiles[prep.profileId] : undefined
  if (!prep || !profile) return { outcome: "missing-executable", message: "No preparation to open.", result: { ok: true } }
  const app = state.slices.t4.world.apps.find((a) => a.path === profile.executablePath)
  const appName = profile.application === "generic" ? (app?.name ?? "the application") : profile.name
  let outcome: Preparation["launches"][number]["outcome"]
  let message: string
  if (!profile.executablePath || !app?.present) {
    outcome = "missing-executable"
    message = profile.executablePath
      ? `${appName} was not found at ${profile.executablePath}. Choose application or reveal the View folder; the preparation is unchanged.`
      : `No application is located for ${profile.name}. Choose application or reveal the View folder; the preparation is unchanged.`
  } else {
    const { unavailable, changed } = verifyPreparedEntries(state, prep)
    if (changed.length > 0) {
      // Durable, so every surface reads the View as Unverified (viewStatus) until an Open re-verifies it.
      commit(
        `Open in ${appName} refused`,
        (s) => withCatalog(s, (c) => (c.preparations[preparationId] ? { ...c, preparations: { ...c.preparations, [preparationId]: { ...c.preparations[preparationId]!, unverified: { at: nowIso(), changed } } } } : c)),
        { href: `/views/${view.id}/prepare` },
      )
    }
    if (unavailable.length > 0) {
      // Availability is read live, so nothing durable is written: reconnecting and opening again re-verifies.
      const text = unavailableText(appName, unavailable, changed.length)
      recordActivity({ kind: "operation", title: `Open in ${appName} refused`, detail: text, operationId: null, href: `/views/${view.id}/prepare` })
      return { outcome: "unavailable", message: text, result: { ok: true }, unavailable }
    }
    if (changed.length > 0) {
      const text = `${appName} was not opened: ${plural(changed.length, "prepared entry", "prepared entries")} no longer ${changed.length === 1 ? "matches" : "match"} the preparation snapshot. PlateVault wrote nothing to the sources or the entries.`
      recordActivity({ kind: "operation", title: `Open in ${appName} refused`, detail: text, operationId: null, href: `/views/${view.id}/prepare` })
      return { outcome: "unverified", message: text, result: { ok: true } }
    }
    if (app.launchFails) {
      outcome = "launch-failed"
      message = `${appName} did not start (prototype: simulated launch failure). The View, its preparation and your decisions are unchanged; try again or reveal the View folder.`
      updateApp(app.id, { launchFails: false })
    } else {
      outcome = "opened"
      message = `Opened ${appName} on ${prep.viewPath} (prototype: simulated launch). Launching is not processing; closing ${appName} never marks this View Complete.`
    }
  }
  const at = nowIso()
  const result = commit(
    `Open in ${appName}`,
    (s) =>
      withCatalog(s, (catalog) => {
        const current = catalog.preparations[preparationId]
        const currentProfile = catalog.profiles[profile.id]
        if (!current || !currentProfile) return catalog
        const executableState = outcome === "opened" ? "found" : outcome === "launch-failed" ? "launch-fails" : profile.executablePath ? "missing" : "not-configured"
        return {
          ...catalog,
          preparations: { ...catalog.preparations, [preparationId]: { ...current, launches: [...current.launches, { at, outcome }], unverified: outcome === "missing-executable" ? current.unverified : null } },
          profiles: { ...catalog.profiles, [profile.id]: { ...currentProfile, executableState } },
        }
      }),
    { href: `/views/${view.id}/prepare` },
  )
  if (result.ok && outcome === "opened") updateSlice("t4", (slice) => ({ ...slice, running: { ...slice.running, [view.id]: { profileId: profile.id, at } } }))
  if (result.ok) recordActivity({ kind: "operation", title: outcome === "opened" ? `Opened ${appName}` : `Open in ${appName} did not start`, detail: message, operationId: null, href: `/views/${view.id}/prepare` })
  return { outcome, message, result }
}

/** Simulated quit of the external application: recorded, and the View stays as it was. */
export function quitApplication(view: View) {
  const running = store.getState().slices.t4.running[view.id]
  if (!running) return
  const name = store.getState().catalog.profiles[running.profileId]?.name ?? "The application"
  updateSlice("t4", (slice) => ({ ...slice, running: { ...slice.running, [view.id]: null } }))
  recordActivity({ kind: "operation", title: `${name} quit`, detail: `${name} closed outside PlateVault. ${view.name} is not marked Complete.`, operationId: null, href: `/views/${view.id}/prepare` })
}

// ---------------------------------------------------------------------------
// Locations (PREP-FR-06, PREP-FR-07)
// ---------------------------------------------------------------------------

export function chooseViewParent(view: View, parent: string): CommitResult {
  const result = viewCommit(view, "View location", (v) => ({ ...v, locationParent: parent }), `/views/${view.id}/prepare`)
  if (result.ok) store.setState((s) => ({ ...s, settings: { ...s.settings, lastViewParent: parent } }))
  return result
}

// ---------------------------------------------------------------------------
// Prepare (PREP-FR-09)
// ---------------------------------------------------------------------------

export type StartResult = { ok: true; operationId: string } | { ok: false; message: string }

export function startPrepare(view: View, plan: PreparationPlan): StartResult {
  const state = store.getState()
  if (view.completedAt) return { ok: false, message: `${view.name} is Complete. Reopen it before preparing a new revision.` }
  const running = Object.values(state.operations).find((op) => op.kind === "prepare" && op.scope.viewIds?.includes(view.id) && !isSettled(op.status))
  if (running) return { ok: false, message: "A preparation of this View is still running. Wait for it to settle, or cancel it." }
  if (!plan.ready || !plan.revision || !plan.profile || !plan.viewPath || !plan.outputPath) return { ok: false, message: "Review preparation found blocking checks. Resolve them and review again." }
  const viewPath = plan.viewPath
  const outputPath = plan.outputPath
  const entries: Record<string, PrepareEntry> = {}
  for (const entry of [...plan.entries, ...plan.calibrationEntries]) {
    entries[entry.id] = {
      kind: entry.kind,
      assetId: entry.assetId,
      resultId: entry.resultId,
      sourcePath: entry.sourcePath,
      destPath: plan.mode === "direct-source" ? entry.sourcePath : entryPath(viewPath, entry),
      fileName: entry.fileName,
      patches: entry.assetId && plan.mode !== "linked" && plan.mode !== "direct-source" ? (plan.patched.get(entry.assetId) ?? []) : [],
    }
  }
  const metadataDecisions: MetadataDecision[] = plan.diffs.flatMap((diff) =>
    diff.assetIds.map((assetId) => ({ assetId, field: diff.field, observed: diff.sourceValue, corrected: diff.catalogValue, decision: plan.metadata[diff.key] ?? "accept-source" })),
  )
  const preparationId = `prep_${stableHash(`${view.id}|${plan.revision.revision}|${nowIso()}`)}`
  const at = nowIso()
  const result = commit(
    "Prepare View",
    (s) =>
      withCatalog(
        { ...s, settings: { ...s.settings, lastViewParent: plan.parent.path } },
        (catalog) => {
          const current = catalog.views[view.id]!
          return {
            ...catalog,
            views: { ...catalog.views, [view.id]: { ...current, locationParent: plan.parent.path, outputPath } },
            preparations: {
              ...catalog.preparations,
              [preparationId]: {
                id: preparationId,
                viewId: view.id,
                membershipRevision: plan.revision!.revision,
                profileId: plan.profile!.id,
                mode: plan.mode,
                linkType: plan.linkType,
                viewPath,
                outputPath,
                entryCount: plan.entries.length,
                footprintBytes: plan.footprintBytes,
                state: "running",
                operationId: null,
                preparedAssetIds: [],
                preparedResultIds: [],
                blocked: [],
                metadataDecisions,
                launches: [],
                createdAt: at,
                settledAt: null,
              },
            },
          }
        },
      ),
    { expect: { collection: "views", id: view.id, revision: view.revision }, href: `/views/${view.id}/prepare` },
  )
  if (!result.ok) return { ok: false, message: result.message }
  const payload: PreparePayload = {
    preparationId,
    viewId: view.id,
    mode: plan.mode,
    linkType: plan.linkType,
    viewPath,
    outputPath,
    entries,
    snapshots: {},
    expected: {},
    written: {},
    calibrationPrepared: [],
  }
  const items = Object.entries(entries).map(([id, entry]) => ({
    id,
    label: entry.kind === "calibration" ? `Calibration: ${entry.fileName}` : entry.fileName,
    path: entry.sourcePath,
    status: "pending" as const,
    phase: null,
    detail: null,
  }))
  const operationId = startOperation({
    kind: "prepare",
    title: `Preparing ${view.name}`,
    scope: { viewIds: [view.id] },
    total: items.length,
    unit: "entries",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canPause: true,
    canCancel: true,
  })
  attachOperation(preparationId, operationId)
  updatePrep(view.id, { reviewing: false })
  return { ok: true, operationId }
}

function attachOperation(preparationId: PreparationId, operationId: string) {
  store.setState((s) => {
    const prep = s.catalog.preparations[preparationId]
    if (!prep) return s
    return { ...s, catalog: { ...s.catalog, preparations: { ...s.catalog.preparations, [preparationId]: { ...prep, operationId, state: "running" } } } }
  })
}

/** Retry the journaled blocked entries only; completion is never inferred from files present (D09). */
export function retryPreparation(preparationId: PreparationId): StartResult {
  const state = store.getState()
  const prep = state.catalog.preparations[preparationId]
  const previous = prep?.operationId ? state.operations[prep.operationId] : undefined
  if (!prep || !previous) return { ok: false, message: "This preparation has no recorded items to retry." }
  if (!isSettled(previous.status)) return { ok: false, message: "This preparation is still running." }
  const before = previous.payload as unknown as PreparePayload
  // A canceled run retries every entry it did not finish, as well as the blocked ones.
  const retryIds = previous.items.filter((item) => item.status === "blocked" || item.status === "failed" || (previous.status === "canceled" && item.status !== "done")).map((item) => item.id)
  if (retryIds.length === 0) return { ok: false, message: "No blocked entries are recorded for this preparation." }
  const entries: Record<string, PrepareEntry> = {}
  for (const id of retryIds) if (before.entries[id]) entries[id] = before.entries[id]!
  // Entries prepared earlier stay recorded with their snapshots, so Open can re-verify them; only the journaled items run again.
  const payload: PreparePayload = { ...before, entries: { ...before.entries }, snapshots: { ...before.snapshots }, expected: { ...before.expected }, written: { ...before.written } }
  const items = retryIds.map((id) => ({ id, label: previous.items.find((i) => i.id === id)?.label ?? id, path: entries[id]?.sourcePath ?? null, status: "pending" as const, phase: null, detail: null }))
  const view = state.catalog.views[prep.viewId]
  const operationId = startOperation({
    kind: "prepare",
    title: `Retrying ${plural(retryIds.length, "blocked entry", "blocked entries")} of ${view?.name ?? "this View"}`,
    scope: { viewIds: [prep.viewId] },
    total: items.length,
    unit: "entries",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canPause: true,
    canCancel: true,
  })
  attachOperation(preparationId, operationId)
  return { ok: true, operationId }
}

/**
 * Keep each Preparation's state in step with its operation after Pause,
 * Cancel and restart (the foundation runner settles those without the
 * handler). Runs from the T4 shell overlay.
 */
export function reconcilePreparations(state: PrototypeState): PrototypeState {
  let catalog: Catalog | null = null
  for (const prep of Object.values(state.catalog.preparations)) {
    if (prep.state !== "running" && prep.state !== "paused") continue
    const op = prep.operationId ? state.operations[prep.operationId] : undefined
    if (!op) continue
    const next =
      op.status === "canceled" ? "canceled" : op.status === "paused" || op.status === "interrupted" ? "paused" : op.status === "running" ? "running" : op.status === "failed" ? "failed" : null
    if (!next || next === prep.state) continue
    catalog ??= { ...state.catalog, preparations: { ...state.catalog.preparations } }
    catalog.preparations[prep.id] = { ...prep, state: next, settledAt: next === "canceled" || next === "failed" ? (op.settledAt ?? nowIso()) : prep.settledAt }
  }
  return catalog ? { ...state, catalog } : state
}

// ---------------------------------------------------------------------------
// Generated masters (CAL-FR-06, H4)
// ---------------------------------------------------------------------------

function trainForHeader(catalog: Catalog, instrument: string | null, telescope: string | null): string | null {
  if (!instrument || !telescope) return null
  const camera = Object.values(catalog.cameras).find((c) => c.name === instrument || c.aliases.includes(instrument))
  const scope = Object.values(catalog.telescopes).find((t) => t.name === telescope || t.aliases.includes(telescope))
  if (!camera || !scope) return null
  return Object.values(catalog.opticalTrains).find((t) => t.cameraId === camera.id && t.telescopeId === scope.id)?.id ?? null
}

/**
 * Detect generated masters in recorded output locations. Detection only
 * records a candidate; it never makes a master reusable (CAL-AC-04).
 */
export function detectCandidates(state: PrototypeState): { state: PrototypeState; found: number } {
  const known = new Set<string>()
  for (const master of Object.values(state.catalog.masters)) known.add(master.origin.sourcePath)
  const added: Record<string, CalibrationMaster> = {}
  for (const prep of Object.values(state.catalog.preparations)) {
    for (const file of filesUnder(state.disk, prep.outputPath)) {
      const header = file.header
      if (!header?.imageType.startsWith("master-") || known.has(file.path)) continue
      known.add(file.path)
      const id = `mst_${stableHash(file.path)}`
      if (state.catalog.masters[id]) continue
      added[id] = {
        id,
        kind: header.imageType.slice("master-".length) as CalibrationMaster["kind"],
        path: file.path,
        cameraName: header.instrument,
        widthPx: header.widthPx,
        heightPx: header.heightPx,
        binning: header.binning,
        gain: header.gain,
        offset: header.offset,
        exposureS: header.imageType === "master-dark" ? header.exposureS : null,
        channel: header.filter,
        opticalTrainId: header.imageType === "master-flat" ? trainForHeader(state.catalog, header.instrument, header.telescope) : null,
        ccdTempC: header.ccdTempC,
        frameCount: null,
        createdAt: file.modifiedAt,
        state: "candidate",
        origin: { kind: "generated", viewId: prep.viewId, sourcePath: file.path },
        adoption: null,
      }
    }
  }
  const found = Object.keys(added).length
  if (found === 0) return { state, found }
  return { state: { ...state, catalog: { ...state.catalog, masters: { ...state.catalog.masters, ...added } } }, found }
}

// ---------------------------------------------------------------------------
// Adoption (CAL-FR-07, D05)
// ---------------------------------------------------------------------------

export function calibrationLocationFor(locations: Record<string, Location>, folder: string): Location | null {
  return Object.values(locations).find((l) => l.role === "calibration" && (folder === l.path || folder.startsWith(`${l.path}/`))) ?? null
}

export function startAdoption(masterId: string): StartResult {
  const state = store.getState()
  const master = state.catalog.masters[masterId]
  const draft = state.slices.t4.adoption[masterId]
  if (!master || master.state !== "candidate") return { ok: false, message: "Only a detected candidate can be added to the calibration library." }
  if (!draft?.destinationFolder || !draft.reviewedSha256) return { ok: false, message: "Review the adoption first: choose a destination folder." }
  const location = calibrationLocationFor(state.catalog.locations, draft.destinationFolder)
  if (!location) return { ok: false, message: "Choose a folder inside a Calibration location so the master stays in the library." }
  const running = Object.values(state.operations).find((op) => op.kind === "adopt-master" && !isSettled(op.status) && (op.payload as unknown as AdoptPayload).masterId === masterId)
  if (running) return { ok: false, message: "This candidate is already being adopted." }
  const destinationPath = `${draft.destinationFolder}/${draft.fileName.trim()}`
  const payload: AdoptPayload = {
    masterId,
    reviewedSha256: draft.reviewedSha256,
    sourcePath: master.origin.sourcePath,
    destinationPath,
    locationId: location.id,
    partialPath: `${destinationPath}.platevault-partial`,
    copyWritten: false,
    pauseBeforeRegister: state.slices.t4.world.pauseBeforeRegister,
  }
  if (payload.pauseBeforeRegister) updateWorld((world) => ({ ...world, pauseBeforeRegister: false }))
  const operationId = startOperation({
    kind: "adopt-master",
    title: `Adopting ${draft.fileName.trim()}`,
    scope: { locationIds: [location.id] },
    total: ADOPT_PHASES.length,
    unit: "steps",
    items: ADOPT_PHASES.map((phase) => ({ id: phase.id, label: phase.label, path: phase.id === "copy" ? master.origin.sourcePath : phase.id === "register" ? destinationPath : null, status: "pending" as const, phase: null, detail: null })),
    payload: payload as unknown as Record<string, unknown>,
    canPause: false,
    canCancel: true,
  })
  updateSlice("t4", (slice) => ({ ...slice, adoption: { ...slice.adoption, [masterId]: { ...draft, operationId } } }))
  return { ok: true, operationId }
}
