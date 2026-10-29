/**
 * The Apply sheet (066 VSEL-FR-14 to 21, 069 PREP-FR-04/08/15/18): one
 * `project_apply_preview` read, held as the reviewed basis while the sheet
 * is open. It lists, in order: what blocks Apply (each with where it is
 * resolved), the facts (input mode, Project folder, entries, footprint), the
 * pending changes it applies, what `View (previous)/` still holds, the copies
 * a tool changed, the files PlateVault didn't place (ticked ones move into
 * the new View), and the new View as a folder tree.
 *
 * Apply sends exactly the reviewed read's revision and basis digest. When a
 * later read differs, the sheet says the Project changed and keeps the
 * reviewed basis until the user asks for the latest, so nothing is applied
 * that the user did not see; the library refuses a stale basis anyway.
 * Starting Apply closes the sheet: the View tab follows the run.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { useState } from "react"
import type { ApplyPreview_Serialize, ForeignFile_Serialize, ViewPlanEntry } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Blocker, Column } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { ActionError, Notice, TableSkeleton } from "@/components/app/feedback"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import { Section } from "@/components/app/page"
import { failureMessage } from "@/components/app/run-result"
import { type ViewFolderNode, ViewFolderTree } from "@/components/domain/view-folder-tree"
import { failureOf } from "@/api/ipc"
import { formatBytes, formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { startApply } from "./apply-run"
import { applyBlocker } from "./apply-words"
import { applyPreviewQuery, inputsQuery, type ProjectHeader } from "./queries"
import { labelOf, useSessionSummaries } from "./sessions"
import { modeText, pathText } from "./words"

/** The sheet's two reads differ in what Apply would do. */
function sameBasis(a: ApplyPreview_Serialize, b: ApplyPreview_Serialize): boolean {
  return a.basisDigest === b.basisDigest && a.desiredRevision === b.desiredRevision
}

export function ApplySheet({ header, onClose }: { header: ProjectHeader; onClose: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  // A fresh read every time the sheet opens: it checks the originals and the folders now.
  const preview = useQuery({ ...applyPreviewQuery(header.id), staleTime: 0, refetchOnMount: "always" })
  const [reviewed, setReviewed] = useState<ApplyPreview_Serialize | null>(null)
  const [ticked, setTicked] = useState<string[]>([])
  // The reviewed basis is the first read that finished after the sheet opened; a cached one never stands in for it.
  if (!reviewed && preview.data && !preview.isFetching) setReviewed(preview.data)
  const shown = reviewed
  const stale = reviewed !== null && preview.data !== undefined && !sameBasis(reviewed, preview.data)
  const label = m.project_apply()
  const blockers = useBlockers(header, shown)
  const apply: Action = {
    id: "apply",
    label,
    kind: "primary",
    unavailable: !reviewed
      ? { action: m.actions_blocked({ action: label }), reason: m.view_tree_loading(), blockers: [] }
      : stale
        ? { action: m.actions_blocked({ action: label }), reason: m.view_sheet_stale(), blockers: [] }
        : blockers.length > 0
          ? { action: m.actions_blocked({ action: label }), reason: m.refusal_blockers({ count: blockers.length }), blockers }
          : undefined,
    run: () => {
      if (!reviewed) return
      startApply(client, {
        projectId: reviewed.projectId,
        desiredRevision: reviewed.desiredRevision,
        basisDigest: reviewed.basisDigest,
        ticked: reviewed.foreign.filter((f) => ticked.includes(pathText(f.path))).map((f) => f.path),
      })
    },
  }
  const error = preview.error ? failureOf(preview.error) : null
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.common_apply_named({ name: header.name })} size="lg" confirm={apply}>
      {stale ? (
        <Notice tone="warning" title={m.view_sheet_stale()}>
          <ActionButton
            action={{
              id: "show-latest",
              label: m.view_sheet_refresh(),
              icon: RefreshCw,
              run: () => {
                setReviewed(preview.data ?? null)
                setTicked([])
              },
            }}
          />
        </Notice>
      ) : null}
      {error ? <ActionError message={failureMessage(m, error)} onRetry={() => void preview.refetch()} /> : null}
      {!shown && !error ? <TableSkeleton rows={4} columns={2} label={m.view_tree_loading()} /> : null}
      {shown ? <SheetBody header={header} preview={shown} blockers={blockers} ticked={ticked} onTick={setTicked} /> : null}
    </FormDialog>
  )
}

function useBlockers(header: ProjectHeader, preview: ApplyPreview_Serialize | null): Blocker[] {
  const m = useMessages()
  const sessionIds = (preview?.blockers ?? []).flatMap((b) => ("sessionId" in b && typeof b.sessionId === "string" ? [b.sessionId] : []))
  const sessions = useSessionSummaries(sessionIds)
  const viewLink = { to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "view" } }
  return (preview?.blockers ?? []).map((b) => applyBlocker(m, b, (id) => labelOf(sessions, id), viewLink))
}

function SheetBody({ header, preview, blockers, ticked, onTick }: { header: ProjectHeader; preview: ApplyPreview_Serialize; blockers: Blocker[]; ticked: string[]; onTick: (ids: string[]) => void }) {
  const m = useMessages()
  const follow = useFollowLink()
  const inputs = useQuery(inputsQuery(header.id))
  const pending = inputs.data?.pending.length ?? 0
  const blockerColumns: Column<Blocker & { id: string }>[] = [
    { id: "blocker", header: m.apply_sheet_blocker(), cell: (b) => b.label, sortValue: (b) => b.label, rowHeader: true, truncate: true },
    { id: "where", header: m.apply_sheet_where(), cell: (b) => b.where ?? "–", sortValue: (b) => b.where ?? "" },
  ]
  const foreignColumns: Column<ForeignFile_Serialize>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (f) => pathText(f.path), sortValue: (f) => pathText(f.path), rowHeader: true, truncate: true },
  ]
  const footprint = preview.footprint
  return (
    <>
      {blockers.length > 0 ? (
        <Section title={m.apply_sheet_blockers({ count: blockers.length })}>
          <BoxTable
            label={m.apply_sheet_blockers({ count: blockers.length })}
            rows={blockers.map((b, i) => ({ ...b, id: String(i) }))}
            columns={blockerColumns}
            getRowId={(b) => b.id}
            rowLabel={(b) => b.label}
            onRowClick={(b) => (b.link ? follow(b.link) : undefined)}
            rowActions={(b) => (b.link ? [{ id: "resolve", label: m.verb_fix(), run: () => follow(b.link!) }] : [])}
          />
        </Section>
      ) : null}
      <KeyValueList
        items={[
          { label: m.project_view_mode(), value: modeText(m, preview.mode) },
          { label: m.view_project_folder(), value: preview.projectFolder ? pathText(preview.projectFolder) : m.apply_refused_no_folder(), mono: preview.projectFolder !== null },
          { label: m.dialog_changes(), value: preview.appliedGeneration === null ? m.project_apply_first() : formatCount(pending) },
          { label: m.view_entries(), value: formatCount(preview.entries.length) },
          { label: m.view_footprint(), value: footprintText(m, footprint) },
          ...(preview.leftovers.length > 0 ? [{ label: m.project_previous_title(), value: m.apply_refused_previous({ count: preview.leftovers.length }) }] : []),
        ]}
      />
      {preview.changedCopies.length > 0 ? (
        <Section title={m.view_changed_copies()}>
          <BoxTable label={m.view_changed_copies()} rows={[...preview.changedCopies]} columns={[{ id: "file", header: m.dialog_col_file(), cell: pathText, sortValue: pathText, rowHeader: true, truncate: true }]} getRowId={pathText} />
        </Section>
      ) : null}
      {preview.foreign.length > 0 ? (
        <Section title={m.project_apply_unplaced()} description={m.apply_sheet_foreign_hint()}>
          <BoxTable
            label={m.project_apply_unplaced()}
            rows={preview.foreign}
            columns={foreignColumns}
            getRowId={(f) => pathText(f.path)}
            selection={{ selected: ticked, onChange: onTick, rowLabel: (f) => pathText(f.path) }}
          />
        </Section>
      ) : null}
      <Section title={m.view_new_view()}>
        <ViewFolderTree tree={folderTree(preview.entries, preview)} mode={preview.mode === "symlinks" ? "symlink" : "copy"} label={m.view_tree_of({ name: header.name })} />
      </Section>
    </>
  )
}

function footprintText(m: Messages, footprint: ApplyPreview_Serialize["footprint"]): string {
  if (footprint.frames === 0) return m.view_footprint_links_only()
  const cloned = footprint.cloned === 0 ? "" : footprint.cloned === footprint.frames ? ` ${m.view_footprint_cloned()}` : ` ${m.view_footprint_some_cloned({ count: footprint.cloned, n: formatCount(footprint.cloned) })}`
  return `${m.view_footprint_copied({ count: footprint.frames, n: formatCount(footprint.frames) })} · ${formatBytes(footprint.bytes)}${cloned}`
}

/** The entries' paths under `View/`: an absolute entry path is cut at the Project folder's `View/`. */
function relativeParts(entry: ViewPlanEntry, preview: ApplyPreview_Serialize): string[] {
  const parts = entry.path.display.split(/[\\/]/).filter((p) => p !== "")
  const root = preview.projectFolder ? preview.projectFolder.display.split(/[\\/]/).filter((p) => p !== "") : []
  const inside = root.length > 0 && root.every((p, i) => parts[i] === p) ? parts.slice(root.length) : parts
  return inside[0] === "View" ? inside.slice(1) : inside
}

/** The new View as folders, each counting the entries directly inside and their bytes (links count 0 B). */
export function folderTree(entries: readonly ViewPlanEntry[], preview: ApplyPreview_Serialize): ViewFolderNode {
  const root: ViewFolderNode = { name: "View", path: "", entries: 0, bytes: 0, children: [] }
  for (const entry of entries) {
    const parts = relativeParts(entry, preview)
    let node = root
    for (const name of parts.slice(0, -1)) {
      const path = node.path === "" ? name : `${node.path}/${name}`
      let child = node.children.find((c) => c.path === path)
      if (!child) {
        child = { name, path, entries: 0, bytes: 0, children: [] }
        node.children.push(child)
      }
      node = child
    }
    node.entries += 1
    node.bytes += entry.placement.kind === "symlink" ? 0 : entry.sizeBytes
  }
  return root
}
