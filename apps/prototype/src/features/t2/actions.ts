/**
 * T2 catalog writes. Every durable change goes through `commit()` (D08):
 * edits to a Session, Target or Project carry `expect` with the revision the
 * user started from, so a stale edit is refused instead of merged. Success
 * records an Activity "saved" event; failures are recorded by `commit()`.
 * Nothing here touches the simulated disk: corrections change the catalog
 * only, never source headers (LIB-FR-05, LIB-FR-12, PRJ-FR-05).
 */
import { stableHash } from "@/domain/indexing"
import { SKY_OBJECTS, normalizeName } from "@/domain/sky"
import type {
  AppSettings,
  Asset,
  AssetId,
  CatalogCorrection,
  Evidence,
  OpticalTrainId,
  Project,
  QualityValue,
  Session,
  SessionId,
  Target,
  TargetId,
} from "@/domain/types"
import { formatDateTime, plural } from "@/lib/format"
import { type CommitResult, commit, nowIso, recordActivity, store, withCatalog } from "@/store/core"
import { setFault } from "@/store/simulation"
import type { ProjectDraft } from "@/store/slices/t2"
import { groupingRevision, sessionLabel } from "./model"

function recordSaved(title: string, detail: string, href: string) {
  recordActivity({ kind: "saved", title, detail, operationId: null, href })
}

const MISSING: CommitResult = {
  ok: false,
  reason: "stale",
  message: "This record no longer exists in the catalog. Reload the page to see the current library.",
}

function correctionId(seed: string): string {
  return `cor_${stableHash(`${seed}|${nowIso()}|${Math.random()}`)}`
}

// ---------------------------------------------------------------------------
// Associations: Confirm Target, Confirm equipment (LIB-FR-05, D11)
// ---------------------------------------------------------------------------

/** Observed evidence stays as read; the confirmation is a separate user row. */
function confirmedEvidence(evidence: Evidence[], label: string, value: string): Evidence[] {
  return [...evidence.filter((e) => e.source !== "user"), { source: "user", label, value, agrees: true }]
}

export function confirmTarget(sessionId: SessionId, targetId: TargetId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const target = catalog.targets[targetId]
  if (!session || !target) return MISSING
  const label = sessionLabel(catalog, session)
  const href = `/sessions/${sessionId}`
  const at = nowIso()
  const result = commit(
    `Target for ${label}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.sessions[sessionId]!
        const previous = current.target.value ? (c.targets[current.target.value]?.name ?? null) : null
        const correction: CatalogCorrection[] =
          current.target.value === targetId
            ? []
            : [{ id: correctionId(sessionId), field: "target", observedValue: previous, correctedValue: target.name, at, revision: groupingRevision(c, current) }]
        const next: Session = {
          ...current,
          target: { value: targetId, status: "confirmed", evidence: confirmedEvidence(current.target.evidence, "Confirm Target", target.name), confirmedAt: at },
          corrections: [...current.corrections, ...correction],
        }
        return { ...c, sessions: { ...c.sessions, [sessionId]: next } }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`Target confirmed: ${label}`, `${target.name}. Catalog only; source headers unchanged.`, href)
  return result
}

export function confirmEquipment(sessionId: SessionId, trainId: OpticalTrainId, expectRevision: number): CommitResult {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  const train = catalog.opticalTrains[trainId]
  if (!session || !train) return MISSING
  const label = sessionLabel(catalog, session)
  const href = `/sessions/${sessionId}`
  const at = nowIso()
  const result = commit(
    `Equipment for ${label}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.sessions[sessionId]!
        const previous = current.equipment.value ? (c.opticalTrains[current.equipment.value]?.name ?? null) : null
        const correction: CatalogCorrection[] =
          current.equipment.value === trainId
            ? []
            : [{ id: correctionId(sessionId), field: "equipment", observedValue: previous, correctedValue: train.name, at, revision: groupingRevision(c, current) }]
        const next: Session = {
          ...current,
          equipment: { value: trainId, status: "confirmed", evidence: confirmedEvidence(current.equipment.evidence, "Confirm equipment", train.name), confirmedAt: at },
          corrections: [...current.corrections, ...correction],
        }
        const record = c.opticalTrains[trainId]!
        // Confirm equipment promotes a train detected from headers to a manual record (D11, seam 3).
        const opticalTrains = record.source === "detected" ? { ...c.opticalTrains, [trainId]: { ...record, source: "manual" as const } } : c.opticalTrains
        return { ...c, opticalTrains, sessions: { ...c.sessions, [sessionId]: next } }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`Equipment confirmed: ${label}`, `${train.name}. Catalog only; source headers unchanged.`, href)
  return result
}

export interface BulkOutcome {
  confirmed: SessionId[]
  /** The session that stopped the run, with the refusal; null when every session saved. */
  failure: { sessionId: SessionId; result: Exclude<CommitResult, { ok: true }> } | null
  remaining: SessionId[]
}

/** One commit per session, in order; the first failure stops the run so nothing is reported saved that was not. */
export function confirmMany(
  sessionIds: SessionId[],
  revisions: Record<SessionId, number>,
  confirm: (sessionId: SessionId, expectRevision: number) => CommitResult,
): BulkOutcome {
  const confirmed: SessionId[] = []
  for (const [index, sessionId] of sessionIds.entries()) {
    const result = confirm(sessionId, revisions[sessionId] ?? store.getState().catalog.sessions[sessionId]?.revision ?? 0)
    if (!result.ok) return { confirmed, failure: { sessionId, result }, remaining: sessionIds.slice(index) }
    confirmed.push(sessionId)
  }
  return { confirmed, failure: null, remaining: [] }
}

// ---------------------------------------------------------------------------
// Grouping corrections (D15, LIB-AC-10, LIB-FR-12)
// ---------------------------------------------------------------------------

/** Session identity fields, mirroring the indexer's grouping key: metadata only, never location. */
function groupingKey(s: Pick<Session, "imageType" | "night" | "cameraName" | "telescopeName" | "channel" | "exposureS" | "binning" | "gain" | "offset">): string {
  return [s.imageType, s.night, s.cameraName ?? "", s.telescopeName ?? "", s.channel ?? "", s.exposureS, s.binning, s.gain ?? "", s.offset ?? ""].join("|")
}

export interface FilterCorrectionPreview {
  /** An existing current session the corrected frames join. */
  joins: Session | null
  frames: number
  /** Grouping revision the correction creates (not the record revision). */
  revision: number
  projectNames: string[]
  /** Views whose saved or draft membership includes these frames; membership stays unchanged. */
  viewNames: string[]
  observedFilter: string | null
}

export function previewFilterCorrection(sessionId: SessionId, filter: string): FilterCorrectionPreview | null {
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!session) return null
  const key = groupingKey({ ...session, channel: filter })
  const joins = Object.values(catalog.sessions).find((s) => s.id !== sessionId && !s.supersededBy && groupingKey(s) === key) ?? null
  const assetIds = new Set(session.assetIds)
  const viewNames = Object.values(catalog.views)
    .filter((v) => [...v.revisions.flatMap((r) => r.included), ...(v.draft?.included ?? [])].some((id) => assetIds.has(id)))
    .map((v) => v.name)
  return {
    joins,
    frames: session.assetIds.length,
    revision: Math.max(groupingRevision(catalog, session), joins ? groupingRevision(catalog, joins) : 0) + 1,
    projectNames: Object.values(catalog.projects)
      .filter((p) => p.linkedSessionIds.includes(sessionId))
      .map((p) => p.name),
    viewNames,
    observedFilter: catalog.assets[session.assetIds[0] ?? ""]?.observed.filter ?? null,
  }
}

/**
 * Correct a session's filter in the catalog. Creates a new grouping revision:
 * a new session holds the frames (merged with an existing session that has
 * the corrected values), the replaced sessions stay inspectable with
 * `supersededBy`, frame identities and View membership are unchanged, and
 * Projects that linked a replaced session link the new one.
 */
export function correctFilter(sessionId: SessionId, filter: string, expectRevision: number): CommitResult & { newSessionId?: SessionId } {
  const preview = previewFilterCorrection(sessionId, filter)
  const { catalog } = store.getState()
  const session = catalog.sessions[sessionId]
  if (!preview || !session) return MISSING
  const label = sessionLabel(catalog, session)
  const at = nowIso()
  const newSessionId = `ses_${stableHash(`${sessionId}|${preview.joins?.id ?? ""}|${filter}|r${preview.revision}`)}`
  const result = commit(
    `Filter correction for ${label}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.sessions[sessionId]!
        const joined = preview.joins ? c.sessions[preview.joins.id] : undefined
        const assetIds = [...(joined?.assetIds ?? []), ...current.assetIds].sort((a, b) =>
          (c.assets[a]?.observed.dateObs ?? "").localeCompare(c.assets[b]?.observed.dateObs ?? ""),
        )
        const scopes = [current.scope, joined?.scope]
        const correction: CatalogCorrection = {
          id: correctionId(sessionId),
          field: "filter",
          observedValue: preview.observedFilter,
          correctedValue: filter,
          at,
          revision: preview.revision,
        }
        const replacement: Session = {
          ...current,
          id: newSessionId,
          // A new record: its grouping revision derives from previousSessionIds.
          revision: 1,
          channel: filter,
          assetIds,
          startedAt: joined && joined.startedAt < current.startedAt ? joined.startedAt : current.startedAt,
          endedAt: joined && joined.endedAt > current.endedAt ? joined.endedAt : current.endedAt,
          corrections: [...(joined?.corrections ?? []), ...current.corrections, correction],
          previousSessionIds: [current.id, ...(joined ? [joined.id] : [])],
          supersededBy: null,
          scope: scopes.includes("incomplete") ? "incomplete" : scopes.includes("provisional") ? "provisional" : "complete",
        }
        const sessions = { ...c.sessions, [newSessionId]: replacement, [current.id]: { ...current, supersededBy: newSessionId } }
        if (joined) sessions[joined.id] = { ...joined, supersededBy: newSessionId }
        const assets = { ...c.assets }
        for (const id of assetIds) {
          const asset = assets[id]
          if (asset) assets[id] = { ...asset, sessionId: newSessionId }
        }
        const replaced = [current.id, joined?.id].filter(Boolean)
        const projects = Object.fromEntries(
          Object.entries(c.projects).map(([id, p]) => {
            if (!p.linkedSessionIds.some((s) => replaced.includes(s))) return [id, p]
            const linked = [...new Set(p.linkedSessionIds.map((s) => (replaced.includes(s) ? newSessionId : s)))]
            return [id, { ...p, linkedSessionIds: linked }]
          }),
        )
        return { ...c, sessions, assets, projects }
      }),
    { expect: { collection: "sessions", id: sessionId, revision: expectRevision }, href: `/sessions/${sessionId}` },
  )
  if (!result.ok) return result
  recordSaved(
    `Filter corrected: ${label}`,
    `Grouping revision ${preview.revision}: ${plural(preview.frames, "frame")} now read ${filter}${preview.joins ? `, joined with ${sessionLabel(store.getState().catalog, preview.joins)}` : ""}. Source headers, frame identities and View membership are unchanged.`,
    `/sessions/${newSessionId}`,
  )
  return { ok: true, newSessionId }
}

// ---------------------------------------------------------------------------
// Library quality (LIB-FR-09; library scope)
// ---------------------------------------------------------------------------

/** A decision binds the current bytes; it clears Changed content and pending verification. */
export function setLibraryQuality(assetIds: AssetId[], value: QualityValue, href: string): CommitResult {
  const at = nowIso()
  const word = { usable: "Usable", unusable: "Unusable", unreviewed: "Unreviewed" }[value]
  const result = commit(`Library quality for ${plural(assetIds.length, "frame")}`, (state) =>
    withCatalog(state, (c) => {
      const assets = { ...c.assets }
      for (const id of assetIds) {
        const asset: Asset | undefined = assets[id]
        if (!asset) continue
        assets[id] = {
          ...asset,
          quality: value === "unreviewed" ? { value, decidedAt: null, basisSha256: null } : { value, decidedAt: at, basisSha256: asset.sha256 },
        }
      }
      return { ...c, assets }
    }),
    { href },
  )
  if (result.ok) recordSaved(`${plural(assetIds.length, "frame")} marked ${word}`, "Library scope. View membership, Project rejections and files on disk are unchanged.", href)
  return result
}

// ---------------------------------------------------------------------------
// Targets: local records and enrichment (LIB-FR-13, LIB-AC-12, D18)
// ---------------------------------------------------------------------------

export interface TargetInput {
  name: string
  aliases: string[]
  ra: number | null
  dec: number | null
  notes: string
}

export function createTarget(input: TargetInput): CommitResult & { targetId?: TargetId } {
  const at = nowIso()
  const targetId = `tgt_${stableHash(`${input.name}|${at}`)}`
  const target: Target = {
    id: targetId,
    name: input.name,
    aliases: input.aliases,
    ra: input.ra,
    dec: input.dec,
    sizeDeg: null,
    coordinateSource: input.ra === null ? "unknown" : "user",
    resolver: null,
    notes: input.notes,
    createdAt: at,
    revision: 1,
  }
  const href = `/targets/${targetId}`
  const result = commit(`Target ${input.name}`, (state) => withCatalog(state, (c) => ({ ...c, targets: { ...c.targets, [targetId]: target } })), { href })
  if (!result.ok) return result
  recordSaved(`Target added: ${input.name}`, input.ra === null ? "Local record without coordinates." : "Local record with user coordinates.", href)
  return { ok: true, targetId }
}

export function updateTarget(targetId: TargetId, input: TargetInput, expectRevision: number): CommitResult {
  const href = `/targets/${targetId}`
  const result = commit(
    `Target ${input.name}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.targets[targetId]!
        const moved = current.ra !== input.ra || current.dec !== input.dec
        const next: Target = {
          ...current,
          name: input.name,
          aliases: input.aliases,
          ra: input.ra,
          dec: input.dec,
          notes: input.notes,
          coordinateSource: moved ? (input.ra === null ? "unknown" : "user") : current.coordinateSource,
          resolver: moved ? null : current.resolver,
        }
        return { ...c, targets: { ...c.targets, [targetId]: next } }
      }),
    { expect: { collection: "targets", id: targetId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`Target updated: ${input.name}`, "Catalog record only. Session evidence is unchanged.", href)
  return result
}

export const PROVIDER_LABEL: Record<AppSettings["targetLookup"]["provider"], string> = {
  "cds-sesame": "CDS Sesame",
  simbad: "SIMBAD",
}

export interface EnrichmentProposal {
  provider: string
  fetchedAt: string
  ra: number
  dec: number
  aliases: string[]
  objectType: string
  sizeDeg: { width: number; height: number }
}

export type LookupOutcome =
  | { kind: "found"; proposal: EnrichmentProposal }
  | { kind: "no-match"; message: string }
  | { kind: "failed"; message: string }

/** Simulated resolver latency, so the loading state is observable. The caller waits this long before resolving. */
export const LOOKUP_DELAY_MS = 700

/**
 * Prototype resolver: answers from the bundled reference catalog, honouring
 * the "fail the next Target resolver lookup" fault. A failure is recorded in
 * Activity and changes nothing (D18).
 */
export function resolveTargetLookup(targetId: TargetId): LookupOutcome {
  const { catalog, settings, faults } = store.getState()
  const target = catalog.targets[targetId]
  const provider = PROVIDER_LABEL[settings.targetLookup.provider]
  if (!target) return { kind: "no-match", message: "This Target no longer exists in the catalog." }
  if (faults.failNextResolverLookup) {
    setFault("failNextResolverLookup", false)
    const message = `${provider} did not respond. ${target.name} and its sessions stay usable; nothing was changed.`
    // A failed lookup, not a refusal: no enrichment was saved (Activity "Not saved").
    recordActivity({ kind: "write-failed", title: `${target.name} lookup failed`, detail: message, operationId: null, href: `/targets/${targetId}` })
    return { kind: "failed", message }
  }
  const names = [target.name, ...target.aliases].map(normalizeName)
  const match = SKY_OBJECTS.find((o) => [o.name, ...o.aliases].some((n) => names.includes(normalizeName(n))))
  if (!match) return { kind: "no-match", message: `${provider} has no object named ${target.name}. The local record stays as it is.` }
  return {
    kind: "found",
    proposal: {
      provider,
      fetchedAt: nowIso(),
      ra: match.ra,
      dec: match.dec,
      aliases: [match.name, ...match.aliases].filter((a) => !target.aliases.includes(a) && a !== target.name),
      objectType: match.objectType,
      sizeDeg: { width: match.widthDeg, height: match.heightDeg },
    },
  }
}

export function acceptEnrichment(targetId: TargetId, proposal: EnrichmentProposal, expectRevision: number): CommitResult {
  const href = `/targets/${targetId}`
  const name = store.getState().catalog.targets[targetId]?.name ?? "Target"
  const result = commit(
    `Enrichment for ${name}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.targets[targetId]!
        const next: Target = {
          ...current,
          ra: proposal.ra,
          dec: proposal.dec,
          sizeDeg: proposal.sizeDeg,
          aliases: [...current.aliases, ...proposal.aliases],
          coordinateSource: "resolver",
          resolver: { provider: proposal.provider, fetchedAt: proposal.fetchedAt, objectType: proposal.objectType },
        }
        return { ...c, targets: { ...c.targets, [targetId]: next } }
      }),
    { expect: { collection: "targets", id: targetId, revision: expectRevision }, href },
  )
  if (result.ok) {
    recordSaved(`Target enriched: ${name}`, `${proposal.provider}, fetched ${formatDateTime(proposal.fetchedAt)}. Capture metadata unchanged.`, href)
  }
  return result
}

// ---------------------------------------------------------------------------
// Projects (PRJ-FR-01-08): catalog goals and associations only
// ---------------------------------------------------------------------------

function framingFor(targetIds: TargetId[]): Project["framing"] {
  const target = targetIds.map((id) => store.getState().catalog.targets[id]).find((t) => t && t.ra !== null && t.dec !== null)
  if (!target) return null
  return { ra: target.ra!, dec: target.dec!, rotationDeg: null, widthDeg: target.sizeDeg?.width ?? 1, heightDeg: target.sizeDeg?.height ?? 1, source: "target" }
}

export function createProject(draft: ProjectDraft): CommitResult & { projectId?: string } {
  const at = nowIso()
  const projectId = `prj_${stableHash(`${draft.name}|${at}`)}`
  const project: Project = {
    id: projectId,
    name: draft.name.trim(),
    notes: draft.notes.trim(),
    targetIds: draft.targetIds,
    framing: framingFor(draft.targetIds),
    panels: draft.panels,
    equipmentId: draft.equipmentId,
    linkedSessionIds: draft.linkedSessionIds,
    checklist: draft.checklist,
    rejections: {},
    createdAt: at,
    revision: 1,
  }
  const href = `/projects/${projectId}`
  const result = commit(`Project ${project.name}`, (state) => withCatalog(state, (c) => ({ ...c, projects: { ...c.projects, [projectId]: project } })), { href })
  if (!result.ok) return result
  recordSaved(
    `Project created: ${project.name}`,
    `${plural(project.linkedSessionIds.length, "linked session")}, ${plural(project.checklist.length, "checklist item")}. No file, View or quality decision changed.`,
    href,
  )
  return { ok: true, projectId }
}

export type ProjectPatch = Partial<Pick<Project, "name" | "notes" | "targetIds" | "panels" | "equipmentId" | "linkedSessionIds" | "checklist">>

/** Edit a Project. Recomputes framing when its Targets change; never touches files, quality or View membership (PRJ-FR-08). */
export function updateProject(projectId: string, patch: ProjectPatch, expectRevision: number, what: string): CommitResult {
  const href = `/projects/${projectId}`
  const name = store.getState().catalog.projects[projectId]?.name ?? "Project"
  const result = commit(
    `Change to ${what} for ${name}`,
    (state) =>
      withCatalog(state, (c) => {
        const current = c.projects[projectId]!
        const next: Project = { ...current, ...patch }
        if (patch.targetIds && current.framing?.source !== "user") next.framing = framingFor(patch.targetIds)
        return { ...c, projects: { ...c.projects, [projectId]: next } }
      }),
    { expect: { collection: "projects", id: projectId, revision: expectRevision }, href },
  )
  if (result.ok) recordSaved(`${what} saved: ${patch.name ?? name}`, "Catalog goals and associations only. Files, quality decisions and View membership are unchanged.", href)
  return result
}
