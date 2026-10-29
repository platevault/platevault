/**
 * S13 Import (`/import?step=source|review|run&import=`; STO-IMP-FR-01 to
 * STO-IMP-FR-10) as a StepPage: Source → Review → Import, in order.
 *
 * - Source: a removable device, a saved source or a chosen folder
 *   (import-source.tsx); `?location=` starts from a Captures location's
 *   folder (Home's Import). Proceed previews it (`import_preview`, which
 *   writes nothing) and opens Review on the new import.
 * - Review: the preview at its revision (import-review.tsx). Proceed is
 *   Import N frames, confirmed with Copy or Move (`import_start` at the
 *   revision shown).
 * - Import: progress and outcomes from `import_status` (import-run.tsx).
 *
 * Where the import stands comes from its durable status, never from local
 * state: the current step is Review while it is previewed, Import once it
 * started, so reopening the page, a restart, or Home's Retry all land where
 * the import is. A `conflict` (the preview changed since it was shown)
 * refuses the start beside the footer; the import reads again and the
 * chosen mode stays.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Import } from "lucide-react"
import { useState } from "react"
import { failureOf, type ImportMode, type ImportOperation_Serialize, library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Action, FlowStep, StepFlow } from "@/components/app/contracts"
import { DetailSkeleton, EmptyState } from "@/components/app/feedback"
import { StepPage } from "@/components/templates/step-page"
import type { Messages } from "@/lib/i18n"
import { readError } from "./parts"
import { importQuery, importWrite, locationsQuery } from "./queries"
import { ReviewStep, startAction } from "./import-review"
import { RunStep } from "./import-run"
import { type ChosenSource, folderSource, SourceStep } from "./import-source"

const STEPS = ["source", "review", "run"] as const
type ImportStep = (typeof STEPS)[number]

type Search = { step?: string; import?: string; location?: string }

function stepLabel(m: Messages, step: ImportStep): string {
  return step === "source" ? m.import_step_source() : step === "review" ? m.import_preview() : m.import_flow_title()
}

export function ImportPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as Search
  const importId = search.import ?? null
  // While it runs, the import's durable status is re-read; it settles from that read alone.
  const op = useQuery({ ...importQuery(importId ?? ""), enabled: importId !== null, refetchInterval: (query) => (query.state.data?.state === "running" ? 1000 : false) })
  const failure = failureOf(op.error)
  if (importId !== null && failure?.source === "library" && failure.error.code === "not_found") {
    return <EmptyState icon={Import} title={m.import_missing()} titleAs="h1" action={null} />
  }
  if (importId !== null && op.error) return <EmptyState icon={Import} title={readError(m, op.error)} titleAs="h1" action={null} />
  if (importId !== null && !op.data) return <DetailSkeleton label={m.common_loading()} />
  return <ImportFlow key={importId ?? "new"} search={search} op={op.data ?? null} />
}

function ImportFlow({ search, op }: { search: Search; op: ImportOperation_Serialize | null }) {
  const m = useMessages()
  const client = useQueryClient()
  const navigate = useNavigate()
  const locations = useQuery({ ...locationsQuery(), enabled: search.location !== undefined && op === null })
  const [picked, setPicked] = useState<ChosenSource | null>(null)
  const [mode, setMode] = useState<ImportMode>(op?.mode ?? "copy")
  const fromLocation = locations.data?.find((s) => s.location.id === search.location)?.location
  const chosen = picked ?? (fromLocation ? { ...folderSource(fromLocation.path), label: fromLocation.name } : null)

  const current: ImportStep = op === null ? "source" : op.state === "previewed" ? "review" : "run"
  const viewing: ImportStep = STEPS.find((s) => s === search.step && STEPS.indexOf(s) <= STEPS.indexOf(current)) ?? current
  const link = (step: ImportStep, id: string | null = op?.id ?? null) => ({ to: "/import", search: { step, ...(id ? { import: id } : {}) } })

  const previewLabel = m.import_preview()
  const preview: Action = {
    id: "preview",
    label: previewLabel,
    unavailable: !chosen
      ? { action: m.actions_blocked({ action: previewLabel }), reason: m.import_choose_source(), blockers: [] }
      : chosen.offline
        ? { action: m.actions_blocked({ action: previewLabel }), reason: m.import_source_offline(), blockers: [] }
        : undefined,
    run: async () => {
      if (!chosen) return
      const result = await library.importPreview(chosen.spec)
      if (result.ok) {
        client.setQueryData(importQuery(result.data.id).queryKey, result.data)
        void navigate(link("review", result.data.id))
      }
      return result
    },
  }
  const start = op
    ? startAction(m, op, mode, async () => {
        const result = await importWrite(client, op.id, () => library.importStart(op.id, op.revision, mode))
        if (result.ok) void navigate(link("run"))
        return result
      })
    : null
  const state = (step: ImportStep): FlowStep["state"] => {
    if (op?.state === "settled") return "finished"
    const at = STEPS.indexOf(step)
    const now = STEPS.indexOf(current)
    return at < now ? "finished" : at === now ? "current" : "todo"
  }
  const flow: StepFlow = {
    steps: STEPS.map((step) => ({ id: step, label: stepLabel(m, step), state: state(step) })),
    current,
    ordered: true,
    proceed: current === "source" ? preview : current === "review" ? start : null,
    next: null,
    linkFor: (step) => link(step as ImportStep),
  }
  const body =
    viewing === "source" ? (
      <SourceStep chosen={chosen} onChoose={setPicked} editable={current === "source"} />
    ) : viewing === "review" && op ? (
      <ReviewStep op={op} mode={mode} onMode={setMode} editable={current === "review"} />
    ) : op ? (
      <RunStep op={op} />
    ) : null
  return <StepPage title={m.import_flow_title()} flow={flow} viewing={viewing} stepsLabel={m.import_steps()} step={body} />
}
