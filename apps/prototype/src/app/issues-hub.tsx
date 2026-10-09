/**
 * The Issues hub (foundation-owned): a toolbar button with a count badge,
 * tinted by the worst severity, opening a panel that lists every issue
 * grouped, each with its one action. `IssuePill` renders one issue as a
 * clickable pill, so Home's top line shows the same issues.
 */
import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, Info, type LucideIcon, OctagonX, TriangleAlert } from "lucide-react"
import { useState } from "react"
import { CountBadge, Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ISSUE_GROUP_LABEL, ISSUE_GROUPS, type Issue, type IssueSeverity } from "@/domain/issues"
import { cn } from "@/lib/utils"
import { useIssues } from "@/store/issues"
import { type Translate, useT } from "./preferences"

const SEVERITY_TONE: Record<IssueSeverity, Tone> = { danger: "danger", warning: "warning", info: "info" }
const SEVERITY_ICON: Record<IssueSeverity, LucideIcon> = { danger: OctagonX, warning: TriangleAlert, info: Info }
const SEVERITY_TEXT: Record<IssueSeverity, string> = { danger: "text-destructive", warning: "text-warning", info: "text-info" }

/** The issue's terse label in the chosen language: "2 need a Target". */
export function issueText(t: Translate, issue: Issue): string {
  return t(issue.label, { n: issue.count, name: issue.name ?? "" })
}

/** One issue as a clickable pill (Home's top line). */
export function IssuePill({ issue }: { issue: Issue }) {
  const t = useT()
  return (
    <Pill tone={SEVERITY_TONE[issue.severity]} icon={SEVERITY_ICON[issue.severity]} link={issue.action.link} title={`${issueText(t, issue)} · ${t(issue.action.label)}`}>
      {issueText(t, issue)}
    </Pill>
  )
}

export function IssuesButton() {
  const t = useT()
  const { issues, worst } = useIssues()
  const [open, setOpen] = useState(false)
  const Icon = worst ? CircleAlert : CircleCheck
  const label = issues.length === 0 ? t("No issues") : t("{n} issues", { n: issues.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" className={cn("shrink-0 gap-1 px-1.5", worst ? SEVERITY_TEXT[worst] : "text-muted-foreground")} aria-label={`${t("Issues")}: ${label}`} title={t("Issues")} data-issues={worst ?? "none"} />}
      >
        <Icon aria-hidden="true" />
        {issues.length > 0 ? <CountBadge count={issues.length} tone={worst ? SEVERITY_TONE[worst] : "neutral"} /> : null}
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-[min(32rem,var(--available-height))] w-88 gap-0 overflow-y-auto p-0" aria-label={t("Issues")}>
        <div data-chrome className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="flex-1 text-sm font-semibold">{t("Issues")}</h2>
          <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
        </div>
        {issues.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">{t("No issues")}</p>
        ) : (
          ISSUE_GROUPS.map((group) => {
            const rows = issues.filter((i) => i.group === group)
            if (rows.length === 0) return null
            return (
              <section key={group} aria-label={t(ISSUE_GROUP_LABEL[group])} className="border-b border-border py-1 last:border-0">
                <h3 data-chrome className="px-3 py-1 text-[0.6875rem] font-semibold text-muted-foreground">
                  {t(ISSUE_GROUP_LABEL[group])}
                </h3>
                <ul>
                  {rows.map((issue) => {
                    const Glyph = SEVERITY_ICON[issue.severity]
                    return (
                      <li key={issue.id} className="flex min-h-(--row-h) items-center gap-2 px-3 py-0.5 text-sm" data-issue={issue.id}>
                        <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", SEVERITY_TEXT[issue.severity])} />
                        <span className="min-w-0 flex-1 truncate" title={issueText(t, issue)}>
                          {issueText(t, issue)}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="shrink-0 text-link"
                          render={<Link to={issue.action.link.to as never} params={issue.action.link.params as never} search={issue.action.link.search as never} />}
                          onClick={() => setOpen(false)}
                        >
                          {t(issue.action.label)}
                          <span className="sr-only">: {issueText(t, issue)}</span>
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
