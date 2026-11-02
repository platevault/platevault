/**
 * Import's run step (STO-IMP-FR-04, STO-IMP-FR-06): the import's progress,
 * per-item outcomes and exact summary, always as `import_status` reads
 * them. The reply to Import or Retry is never taken as the outcome: the
 * import runs in the background, so this step re-reads its durable status
 * while it runs, and after a restart it reads the same status again and
 * shows where the import stands.
 *
 * An interrupted import (its source or a destination went away) keeps its
 * verified items; Retry resumes the recorded work once the source is back.
 */
import { useQueryClient } from "@tanstack/react-query"
import { type ImportItem, type ImportOperation_Serialize, library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionBar } from "@/components/app/actions"
import type { Column } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { fileName, formatCount } from "@/lib/format"
import { importPercent } from "./ingestions"
import { importWrite } from "./queries"
import { phaseText, reasonText } from "./words"

/** The phases an approved item passes through once Import starts. */
const APPROVED: ReadonlySet<ImportItem["phase"]> = new Set(["pending", "landed", "copied", "moved", "source_kept", "failed", "uncertain"])

function itemStatus(phase: ImportItem["phase"]): "pending" | "running" | "done" | "failed" | "uncertain" {
  switch (phase) {
    case "pending":
      return "pending"
    case "landed":
      return "running"
    case "failed":
      return "failed"
    case "uncertain":
      return "uncertain"
    default:
      return "done"
  }
}

export function RunStep({ op }: { op: ImportOperation_Serialize }) {
  const m = useMessages()
  const client = useQueryClient()
  const follow = useFollowLink()
  const s = op.summary
  const items = op.items.filter((i) => APPROVED.has(i.phase))
  const columns: Column<ImportItem>[] = [
    { id: "file", header: m.session_column_file(), rowHeader: true, truncate: true, sortValue: (i) => i.relativePath.display, cell: (i) => fileName(i.relativePath.display) },
    { id: "state", header: m.import_column_state(), sortValue: (i) => i.phase, cell: (i) => <StatusBadge kind="item" value={itemStatus(i.phase)} label={phaseText(m, i.phase)} /> },
    { id: "reason", header: m.import_column_reason(), truncate: true, sortValue: (i) => i.reason?.code ?? null, cell: (i) => (i.reason ? reasonText(m, i.reason.code) : "") },
  ]
  const state = op.state === "running" ? "running" : op.state === "interrupted" ? "interrupted" : s.failed + s.failedVerification + s.uncertain > 0 ? "partial" : "succeeded"
  return (
    <>
      {op.state === "interrupted" ? (
        <Notice
          tone="offline"
          title={m.import_interrupted()}
          actions={<ActionBar actions={[{ id: "retry", label: m.verb_retry(), unavailable: op.sourceAvailability === "available" ? undefined : { action: m.actions_blocked({ action: m.verb_retry() }), reason: m.import_source_offline(), blockers: [] }, run: () => importWrite(client, op.id, () => library.importRetry(op.id)) }]} />}
        >
          {m.import_interrupted_detail()}
        </Notice>
      ) : null}
      <Section title={m.import_flow_title()} actions={op.state === "settled" ? <ActionBar actions={[{ id: "show-sessions", label: m.import_show_in_sessions(), run: () => follow({ to: "/sessions" }) }]} /> : undefined}>
        <KeyValueList
          columns={2}
          items={[
            { label: m.home_column_status(), value: <StatusBadge kind="operation" value={state} /> },
            ...(op.state === "running" ? [{ label: m.home_column_progress(), value: m.home_percent({ percent: importPercent(op.summary) }) }] : []),
            { label: m.import_imported(), value: formatCount(s.imported) },
            { label: m.import_duplicates(), value: formatCount(s.duplicates) },
            { label: m.import_type_unclassified(), value: formatCount(s.unclassified) },
            { label: m.import_phase_settling(), value: formatCount(s.settling) },
            { label: m.import_held(), value: formatCount(s.blocked) },
            { label: m.status_pending(), value: formatCount(s.pending) },
            { label: m.status_failed(), value: formatCount(s.failed) },
            { label: m.import_failed_verification(), value: formatCount(s.failedVerification) },
            ...(op.mode === "move" ? [{ label: m.import_sources_trashed(), value: formatCount(s.sourcesTrashed) }, { label: m.import_sources_kept(), value: formatCount(s.sourcesKept) }] : []),
            ...(s.uncertain > 0 ? [{ label: m.status_uncertain(), value: formatCount(s.uncertain) }] : []),
          ]}
        />
      </Section>
      <Section title={m.import_column_files()}>
        <DataTable label={m.import_column_files()} rows={items} columns={columns} getRowId={(i) => String(i.seq)} scroll="frame" empty={m.import_nothing_to_import()} />
      </Section>
    </>
  )
}
