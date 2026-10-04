/**
 * Why this match (CAL-FR-03, J23 S2, S4): every criterion for one
 * requirement, split into compatible, incompatible and unknown, plus the
 * values shown but not compared. Stays available after acceptance.
 */
import { Link } from "@tanstack/react-router"
import { Check, CircleHelp, CircleX } from "lucide-react"
import { KeyValueList, PathText } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import type { MatchCriterion } from "@/domain/types"
import { formatDateTime, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { CRITERION_LABEL, KIND_LABEL, lightGeometry, type RequirementRow, sessionLabel } from "./domain"
import { useStore } from "@/store/core"

const GROUPS: Array<{ result: MatchCriterion["result"]; title: string; icon: typeof Check; className: string }> = [
  { result: "compatible", title: "Compatible", icon: Check, className: "text-success" },
  { result: "incompatible", title: "Incompatible", icon: CircleX, className: "text-destructive" },
  { result: "unknown", title: "Unknown", icon: CircleHelp, className: "text-warning" },
]

export function CriteriaList({ criteria, caption }: { criteria: MatchCriterion[]; caption: string }) {
  return (
    <div className="space-y-3">
      {GROUPS.map((group) => {
        const items = criteria.filter((c) => c.result === group.result)
        const Icon = group.icon
        return (
          <section key={group.result} aria-label={`${group.title} criteria`}>
            <h4 className={cn("mb-1 flex items-center gap-1.5 text-xs font-medium", group.className)}>
              <Icon aria-hidden="true" className="size-3.5" />
              {group.title} <span className="text-muted-foreground tabular-nums">({items.length})</span>
            </h4>
            {items.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              <table className="w-full text-sm">
                <caption className="sr-only">
                  {group.title} criteria: {caption}
                </caption>
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th scope="col" className="py-1 pr-3 text-left font-medium">Criterion</th>
                    <th scope="col" className="py-1 pr-3 text-left font-medium">Lights</th>
                    <th scope="col" className="py-1 text-left font-medium">Calibration</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.name} className="border-b last:border-0">
                      <th scope="row" className="py-1 pr-3 text-left font-normal">{CRITERION_LABEL[c.name]}</th>
                      <td className="py-1 pr-3 tabular-nums">{c.lightValue}</td>
                      <td className="py-1 tabular-nums">{c.calibrationValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
}

export interface WhySheetProps {
  row: RequirementRow | null
  viewId: string
  applicationName: string | null
  onOpenChange: (open: boolean) => void
  onAccept: (row: RequirementRow) => void
  onChoose: (row: RequirementRow) => void
  canAccept: boolean
}

export function WhyThisMatchSheet({ row, viewId, applicationName, onOpenChange, onAccept, onChoose, canAccept }: WhySheetProps) {
  const catalog = useStore((s) => s.catalog)
  const open = row !== null
  const source = row?.source ?? row?.closest?.source ?? null
  const light = row ? lightGeometry(catalog, row.member.session) : null
  const kind = row ? KIND_LABEL[row.kind].toLowerCase() : ""
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
        {row ? (
          <>
            <SheetHeader className="border-b">
              <SheetTitle>Why this match</SheetTitle>
              <SheetDescription>
                {KIND_LABEL[row.kind]} for {sessionLabel(row.member.session)} · {plural(row.member.included.length, "frame")}
              </SheetDescription>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StatusBadge kind="assignment" value={row.state} />
                {row.state === "unresolved" ? <span className="text-xs text-muted-foreground">No compatible {kind}; nothing is preselected.</span> : null}
              </div>
            </SheetHeader>
            <div className="space-y-5 px-4 pb-4">
              {source ? (
                <section aria-labelledby="why-input" className="space-y-2">
                  <h3 id="why-input" className="text-sm font-semibold">
                    {row.state === "unresolved" ? "Closest candidate (not preselected)" : row.state === "suggested" ? "Suggested input" : "Input"}
                  </h3>
                  <KeyValueList
                    items={[
                      { label: "Name", value: source.name },
                      { label: "Type", value: source.isMaster ? `${source.imageTypeLabel} (library master)` : `Raw calibration set · ${plural(source.frameCount ?? 0, "frame")}` },
                      { label: "Path", value: <PathText path={source.path} />, mono: false },
                    ]}
                  />
                  <Button variant="link" size="sm" className="h-auto px-0" render={<Link to="/calibration/$calibrationId" params={{ calibrationId: source.id }} search={{ viewId }} />}>
                    Open {source.isMaster ? "master" : "raw set"} evidence
                  </Button>
                </section>
              ) : (
                <Notice tone="warning" title={`No ${kind} candidate in the library`}>
                  No master or raw set of this kind is indexed. Add a calibration location or hand off without a {kind}.
                </Notice>
              )}
              {row.criteria.length > 0 ? (
                <section aria-labelledby="why-criteria" className="space-y-2">
                  <h3 id="why-criteria" className="text-sm font-semibold">
                    Criteria{row.assignment && row.assignment.criteria.length > 0 ? " recorded at acceptance" : ""}
                  </h3>
                  <CriteriaList criteria={row.criteria} caption={`${KIND_LABEL[row.kind]} for ${sessionLabel(row.member.session)}`} />
                </section>
              ) : null}
              {row.kind === "dark" && light && source ? (
                <section aria-labelledby="why-not-compared" className="space-y-1">
                  <h3 id="why-not-compared" className="text-sm font-semibold">Shown, not compared</h3>
                  <KeyValueList
                    items={[
                      {
                        label: "Temperature",
                        value: `Lights ${light.ccdTempC === null ? "not recorded" : `${light.ccdTempC.toFixed(1)} °C (median)`} · ${source.isMaster ? "master" : "darks"} ${source.ccdTempC === null ? "not recorded" : `${source.ccdTempC.toFixed(1)} °C`}`,
                        source: "Header CCD-TEMP",
                      },
                    ]}
                  />
                  <p className="text-xs text-pretty text-muted-foreground">No temperature tolerance is set, so temperature does not decide this match.</p>
                </section>
              ) : null}
              {source && !source.isMaster ? (
                <Notice tone="info" title="Raw calibration set">
                  Handed to {applicationName ?? "the application"}, which builds its own master. PlateVault writes no master file.
                </Notice>
              ) : null}
              {row.assignment?.exception ? (
                <section aria-labelledby="why-exception" className="space-y-1">
                  <h3 id="why-exception" className="text-sm font-semibold">Scoped exception</h3>
                  <KeyValueList
                    items={[
                      { label: "Reason", value: row.assignment.exception.reason },
                      { label: "Recorded", value: formatDateTime(row.assignment.exception.at) },
                      {
                        label: "Criteria kept",
                        value: row.criteria.filter((c) => c.result !== "compatible").map((c) => `${CRITERION_LABEL[c.name]} ${c.result}`).join(", ") || "None",
                      },
                    ]}
                  />
                  <p className="text-xs text-pretty text-muted-foreground">Applies to this View only. The input's own evidence is unchanged everywhere else.</p>
                </section>
              ) : null}
              <Separator />
              <p className="text-xs text-muted-foreground">
                {plural(row.candidates.length, "candidate")} of this kind in the library; generated masters count only after they are added to the calibration library.
              </p>
            </div>
            <SheetFooter className="flex-row flex-wrap border-t">
              {row.state === "suggested" ? (
                <Button disabled={!canAccept} onClick={() => onAccept(row)}>
                  Accept this {kind}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => onChoose(row)}>
                {row.state === "unresolved" ? "Resolve…" : "Choose another input…"}
              </Button>
            </SheetFooter>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
