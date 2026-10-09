/**
 * S16 Settings › Goal templates (slice E): built-in templates plus user
 * templates the user can create, edit and delete (D-W30, D-W47,
 * PRJ-FR-12). Foundation placeholder; slice E replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { formatHours } from "@/domain/derive"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import { useStore } from "@/store/core"

export function GoalTemplatesSettingsPage() {
  const user = useStore((s) => Object.values(s.catalog.goalTemplates))
  return (
    <PlaceholderPage
      screen={{ ...SCREENS.S16, title: "Goal templates", route: "/settings/goal-templates" }}
      level={2}
      facts={[...BUILT_IN_GOAL_TEMPLATES, ...user].map((t) => ({
        label: t.name,
        value: `${t.source === "built-in" ? "Built-in" : "Yours"} · ${t.values.map((v) => `${v.channel} ${v.integrationS ? formatHours(v.integrationS) : `${v.frameCount} frames`}`).join(", ")}`,
      }))}
    />
  )
}
