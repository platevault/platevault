/**
 * S4 New Project (slice B): name, subjects (search across My targets, the
 * catalogues and SIMBAD), rigs and a goal template whose values are copied in
 * (D-W30, D-W47, D-W9, D-W37). The sheet host is mounted once at the app
 * root; `openSheet({ kind: "new-project", fromSessionId })` opens it,
 * prefilled from a session when given (`prefillFromSession`).
 * Foundation placeholder; slice B replaces this file.
 */
import { PlaceholderSheet } from "@/app/placeholder-sheet"
import { SCREENS } from "@/app/screens"
import { useShellUi } from "@/app/ui-state"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"

export function NewProjectSheet() {
  const { sheet } = useShellUi()
  return (
    <PlaceholderSheet
      open={sheet?.kind === "new-project"}
      screen={SCREENS.S4}
      facts={[
        { label: "Templates", value: BUILT_IN_GOAL_TEMPLATES.map((t) => t.name).join(" / ") },
        ...(sheet?.kind === "new-project" && sheet.fromSessionId ? [{ label: "Prefill", value: `From session ${sheet.fromSessionId}` }] : []),
      ]}
    />
  )
}
