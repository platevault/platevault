/**
 * S5 Calibrate (§5.4, P-CAL3, CAL-FR-08): one DataTable, a row per light
 * session × calibration kind. The Master cell picks the master: the
 * compatible ones first in the matching rule's order, then the other
 * masters (an exception), then No calibration, which asks for no reason
 * (user item 147). The match columns stay visible (user items 151-155).
 * Auto-assign is the run's policy (D-W55): compatible masters are assigned
 * without a click. Batch: No calibration, or one master for every selected
 * row it fits. Proceed records the automatic choices (§5.4).
 */
import { useNavigate } from "@tanstack/react-router"
import { RotateCcw, Sparkles } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { ComboboxField, type ComboboxGroupOptions, SwitchField } from "@/components/app/fields"
import { Refusal, refusalFrom } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import { type Candidate, CRITERION_NAME, calibrationPlan, KIND_NAME, type RequirementRow, sessionIdsOf } from "@/domain/calibration"
import { runSetup, workingContent } from "@/domain/derive"
import type { MatchCriterionName } from "@/domain/types"
import { formatNight } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { type CommitResult, useStore } from "@/store/core"
import { acceptCalibration, calibrationException, clearCalibration, setCalibrationPolicy } from "./actions"
import { type RunContext, runLock, stackOffers } from "./model"

/** The Master cell's value for No calibration: never a master id. */
const NO_CALIBRATION = "\u0000none"

/** The criteria a master is matched on that the table shows as columns (user items 151-155). */
const MATCH_COLUMNS: MatchCriterionName[] = ["exposure", "gain", "offset", "temperature", "binning"]

/** "18 Sep · Ha", or "2 Sep – 5 Sep · L, R, G, B" for a dark or bias shared across channels. */
export function coveredSessions(m: Messages, row: RequirementRow): string {
  const nights = [...new Set(row.members.map((x) => x.session.night))].sort()
  const night = nights.length > 1 ? `${formatNight(nights[0]!)} – ${formatNight(nights.at(-1)!)}` : formatNight(nights[0]!)
  const channels = [...new Set(row.members.map((x) => x.session.channel ?? m.palette_session_no_filter()))]
  return `${night} · ${channels.join(", ")}`
}

function candidateLabel(c: Candidate): string {
  return c.source.night ? `${c.source.name} · ${formatNight(c.source.night)}` : c.source.name
}

export function CalibrateStep({ ctx, editable }: { ctx: RunContext; editable: boolean }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { run } = ctx
  const [failure, setFailure] = useState<CommitResult | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const setup = runSetup(state.catalog, run)
  const plan = calibrationPlan(state.catalog, state.disk, run, setup.calibrationPolicy, workingContent(run))
  const changeable = editable && runLock(run) === null
  const act = (result: CommitResult) => {
    setFailure(result.ok ? null : result)
    return result
  }
  const rowName = (r: RequirementRow) => `${say(m, KIND_NAME[r.kind])} · ${coveredSessions(m, r)}`

  const choose = (r: RequirementRow, value: string | null): CommitResult => {
    if (value === null) return clearCalibration(run.id, sessionIdsOf(r), r.kind)
    if (value === NO_CALIBRATION) return calibrationException(run.id, sessionIdsOf(r), r.kind, null, [])
    const c = r.candidates.find((x) => x.source.id === value)
    if (!c) return { ok: true }
    return c.summary.allCompatible ? acceptCalibration(run.id, sessionIdsOf(r), r.kind, c.source, c.criteria) : calibrationException(run.id, sessionIdsOf(r), r.kind, c.source, c.criteria)
  }
  const masterGroups = (r: RequirementRow): ComboboxGroupOptions<string>[] => {
    const compatible = r.candidates.filter((c) => c.summary.allCompatible)
    const other = r.candidates.filter((c) => !c.summary.allCompatible)
    return [
      ...(compatible.length > 0 ? [{ label: m.run_cal_recommended(), items: compatible.map((c) => ({ value: c.source.id, label: candidateLabel(c) })) }] : []),
      ...(other.length > 0 ? [{ label: m.run_cal_other_masters(), items: other.map((c) => ({ value: c.source.id, label: `${candidateLabel(c)} · ${m.status_incompatible()}` })) }] : []),
      { label: m.run_cal_without_master(), items: [{ value: NO_CALIBRATION, label: m.run_cal_no_calibration() }] },
    ]
  }
  const valueOf = (r: RequirementRow): string | null => (r.state === "exception" && r.input === null ? NO_CALIBRATION : (r.input?.masterId ?? null))

  const rowActions = (r: RequirementRow): MenuItem[] => [
    ...(changeable && r.assignment ? [{ id: "automatic", label: m.run_cal_use_automatic(), icon: RotateCcw, run: () => clearCalibration(run.id, sessionIdsOf(r), r.kind) }] : []),
    ...stackOffers(state, r).map(
      (o): Action => ({
        id: `stack-${o.view.process.id}`,
        label: m.run_cal_stack_from({ name: say(m, o.view.name) }),
        icon: Sparkles,
        run: () => void navigate({ to: "/calibration/processes/$processId/$step", params: { processId: o.view.process.id, step: "stack" } }),
      }),
    ),
  ]
  const batchActions = (ids: string[]): Action[] => {
    const rows = plan.rows.filter((r) => ids.includes(r.key))
    if (!changeable || rows.length === 0) return []
    const sameKind = rows.every((r) => r.kind === rows[0]!.kind)
    // One master for every selected row it fits (Assign ▾): the compatible masters all the rows share.
    const shared = sameKind ? rows[0]!.candidates.filter((c) => c.summary.allCompatible && rows.every((r) => r.candidates.some((x) => x.source.id === c.source.id && x.summary.allCompatible))) : []
    const each = (pick: (r: RequirementRow) => CommitResult) => () => rows.map(pick).find((x) => !x.ok) ?? { ok: true as const }
    return [
      ...shared.map((c): Action => ({ id: `assign-${c.source.id}`, label: m.run_use_named({ name: candidateLabel(c) }), run: each((r) => choose(r, c.source.id)) })),
      { id: "no-calibration", label: m.run_cal_no_calibration(), run: each((r) => choose(r, NO_CALIBRATION)) },
    ]
  }

  const criterion = (r: RequirementRow, name: MatchCriterionName) => r.criteria.find((c) => c.name === name)
  const columns: Column<RequirementRow>[] = [
    { id: "session", header: m.run_cal_col_light_session(), rowHeader: true, cell: (r) => coveredSessions(m, r), sortValue: (r) => r.member.session.night },
    { id: "kind", header: m.run_col_kind(), cell: (r) => say(m, KIND_NAME[r.kind]), sortValue: (r) => r.kind },
    {
      id: "master",
      header: m.run_cal_col_master(),
      cell: (r) => (
        <ComboboxField
          hideLabel
          label={m.run_cal_master_for({ name: rowName(r) })}
          value={valueOf(r)}
          groups={masterGroups(r)}
          placeholder={m.run_cal_no_master()}
          disabled={!changeable}
          onChange={(value) => act(choose(r, value))}
        />
      ),
      sortValue: (r) => r.source?.name ?? "",
    },
    ...MATCH_COLUMNS.map(
      (name): Column<RequirementRow> => ({
        id: name,
        header: say(m, CRITERION_NAME[name]),
        cell: (r) => {
          const c = criterion(r, name)
          return c ? <StatusBadge kind="match" value={c.result} label={say(m, c.calibrationValue)} /> : "–"
        },
        sortValue: (r) => {
          const c = criterion(r, name)
          return c ? say(m, c.calibrationValue) : null
        },
      }),
    ),
    { id: "state", header: m.run_col_state(), cell: (r) => <RowState row={r} />, sortValue: (r) => (r.drift ? "0" : r.state) },
  ]

  const refusal = refusalFrom(failure, m.run_cal_assign_blocked())
  return (
    <>
      <SwitchField
        label={m.run_cal_auto_assign()}
        description={run.groupId ? m.run_cal_policy_shared() : undefined}
        checked={setup.calibrationPolicy === "automatic"}
        disabled={!changeable}
        onChange={(checked) => act(setCalibrationPolicy(run.id, checked ? "automatic" : "off"))}
      />
      {refusal ? <Refusal {...refusal} /> : null}
      <DataTable
        label={m.run_cal_requirements_label()}
        rows={plan.rows}
        columns={columns}
        getRowId={(r) => r.key}
        scroll="none"
        groups={{ key: (r) => r.groupKey, label: (key, rows) => `${(plan.groups.find((g) => g.key === key)?.parts ?? []).map((p) => say(m, p)).join(" · ")} · ${m.run_cal_requirements({ count: rows.length })}` }}
        selection={changeable ? { selected, onChange: setSelected, rowLabel: rowName } : undefined}
        batchActions={changeable ? batchActions : undefined}
        rowLabel={rowName}
        rowActions={rowActions}
        empty={<EmptyState icon={Sparkles} title={m.run_cal_no_sessions_saved()} action={null} />}
      />
    </>
  )
}

/** A row's state: drift first, then a better match on offer, else the assignment state. */
function RowState({ row }: { row: RequirementRow }) {
  const m = useMessages()
  if (row.drift) return <StatusBadge kind="content" value="drifted" label={m.status_drifted()} />
  if (row.better) return <StatusBadge kind="assignment" value="suggested" label={m.run_cal_better_match()} />
  if (row.state === "exception" && row.input === null) return <StatusBadge kind="assignment" value="exception" label={m.run_cal_no_calibration()} />
  if (row.state === "automatic") return <StatusBadge kind="assignment" value="accepted" label={m.run_cal_automatic()} />
  return <StatusBadge kind="assignment" value={row.state} />
}
