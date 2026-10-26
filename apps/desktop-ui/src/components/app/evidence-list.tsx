/**
 * EvidenceList (L2): the evidence used for an association (LIB-FR-05) as a
 * sortable DataTable: Source · Evidence · Value · Result. It opens in the
 * order given (observed values first); each header sorts. The value cell may
 * break inside a word so the table reflows at narrow widths (WCAG 1.4.10);
 * header keywords stay whole, and a container narrower than the shortest
 * columns scrolls the table frame, not the page.
 */
import { Check, CircleHelp, X } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { type MessageRef, type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { Column } from "./contracts"
import { DataTable } from "./data-table"

/** Where a piece of evidence comes from. */
export type EvidenceSource = "header" | "pointing" | "equipment-record" | "user" | "resolver" | "catalog"

/** One piece of evidence for an association. */
export interface Evidence {
  source: EvidenceSource
  /** A FITS keyword (`verbatim`) or a catalogue label; worded at render. */
  label: MessageRef
  value: MessageRef
  /** true agrees with the association, false conflicts, null is unknown. */
  agrees: boolean | null
}

/** Conflicts sort first, then unknown, then agreeing evidence. */
const AGREEMENT = {
  conflicts: { icon: X, word: (m: Messages) => m.evidence_conflicts(), className: "text-destructive", order: 0 },
  unknown: { icon: CircleHelp, word: (m: Messages) => m.status_unknown(), className: "text-muted-foreground", order: 1 },
  agrees: { icon: Check, word: (m: Messages) => m.evidence_agrees(), className: "text-success", order: 2 },
} as const

function agreementOf(item: Evidence) {
  return AGREEMENT[item.agrees === true ? "agrees" : item.agrees === false ? "conflicts" : "unknown"]
}

function sourceName(m: Messages, source: Evidence["source"]): string {
  const name: Record<Evidence["source"], () => string> = {
    header: m.evidence_source_header,
    pointing: m.evidence_source_pointing,
    "equipment-record": m.evidence_source_equipment_record,
    user: m.evidence_source_user,
    resolver: m.evidence_source_resolver,
    catalog: m.evidence_source_catalog,
  }
  return name[source]()
}

export function EvidenceList({ evidence, caption }: { evidence: Evidence[]; caption: string }) {
  const m = useMessages()
  const label = (item: Evidence) => say(m, item.label)
  const columns: Column<Evidence>[] = [
    { id: "source", header: m.evidence_column_source(), cell: (item) => <span className="text-muted-foreground">{sourceName(m, item.source)}</span>, sortValue: (item) => sourceName(m, item.source) },
    { id: "evidence", header: m.evidence_column_evidence(), cell: (item) => <span className="font-mono text-xs">{label(item)}</span>, sortValue: label, rowHeader: true },
    { id: "value", header: m.evidence_column_value(), cell: (item) => <span className="[overflow-wrap:anywhere] whitespace-normal">{say(m, item.value)}</span>, sortValue: (item) => say(m, item.value) },
    {
      id: "result",
      header: m.evidence_column_result(),
      cell: (item) => {
        const agreement = agreementOf(item)
        const Icon = agreement.icon
        return (
          <span className={cn("inline-flex items-center gap-1", agreement.className)}>
            <Icon aria-hidden="true" className="size-3.5" />
            {agreement.word(m)}
          </span>
        )
      },
      sortValue: (item) => agreementOf(item).order,
    },
  ]
  return <DataTable label={caption} rows={evidence} columns={columns} getRowId={(item) => `${item.source}-${label(item)}`} scroll="none" />
}
