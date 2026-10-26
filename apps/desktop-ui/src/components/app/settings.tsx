/**
 * Settings layout kit (L2, plan §3.3 P6; the original's SettingsKit): a
 * `SettingsSection` holds one bordered list of rows, and a `SettingsRow`
 * puts its label (and an optional help line) in a fixed column beside the
 * control. A Field from fields.tsx placed directly in a SettingsSection
 * renders as a row by itself, so a section mixes fields and plain rows:
 *
 *   <SettingsSection title="Keyboard">
 *     <SwitchField label="Single-key shortcuts" checked={…} onChange={…} />
 *     <SettingsRow label="First-run setup"><Button …>Restart setup</Button></SettingsRow>
 *   </SettingsSection>
 *
 * Help is visible text tied to the control with `aria-describedby`, never a
 * tooltip (§6.2).
 */
import { createContext, type ReactNode, useContext, useId } from "react"
import { Label } from "@/components/ui/label"
import { Section } from "./page"

const InSettingsSection = createContext(false)

/** True inside a SettingsSection: a Field renders itself as a SettingsRow there. */
export function useInSettingsSection(): boolean {
  return useContext(InSettingsSection)
}

export interface SettingsSectionProps {
  title: string
  /** Section-level buttons beside the heading, e.g. "Add camera…" or "Restore defaults". */
  actions?: ReactNode
  /** Heading level; Settings sections sit under the page's h2, so h3 by default. */
  level?: 2 | 3
  children: ReactNode
}

export function SettingsSection({ title, actions, level = 3, children }: SettingsSectionProps) {
  const id = useId()
  return (
    <Section title={title} actions={actions} level={level} id={id}>
      {/* The rows lay out by this list's width, not the window's: label beside control from 28rem (@md), stacked below, so a narrow pane never squeezes the control to nothing. */}
      <div className="@container divide-y divide-border rounded-md border border-border">
        <InSettingsSection.Provider value>{children}</InSettingsSection.Provider>
      </div>
    </Section>
  )
}

/** Ids a row hands to the control it labels. */
export interface SettingsRowIds {
  controlId: string
  labelId: string
  helpId: string | undefined
}

export interface SettingsRowProps {
  label: string
  /** One line under the label; the control or row is described by it. */
  help?: ReactNode
  /**
   * The row's content: buttons or a value. Pass a function to label one
   * control with the row's `<label>` (the Field family does this); plain
   * content makes the row a group named by its label instead.
   */
  children: ReactNode | ((ids: SettingsRowIds) => ReactNode)
}

export function SettingsRow({ label, help, children }: SettingsRowProps) {
  const base = useId()
  const ids: SettingsRowIds = { controlId: `${base}control`, labelId: `${base}label`, helpId: help ? `${base}help` : undefined }
  const labelsControl = typeof children === "function"
  return (
    <div
      role={labelsControl ? undefined : "group"}
      aria-labelledby={labelsControl ? undefined : ids.labelId}
      aria-describedby={labelsControl ? undefined : ids.helpId}
      data-settings-row
      className="flex flex-col gap-2 px-3 py-2.5 @md:flex-row @md:items-start @md:gap-4"
    >
      <div className="grid min-w-0 content-start gap-1 @md:w-48 @md:shrink-0 @md:pt-1.5">
        {labelsControl ? (
          <Label id={ids.labelId} htmlFor={ids.controlId} className="leading-snug">
            {label}
          </Label>
        ) : (
          <span id={ids.labelId} className="text-sm leading-snug font-medium">
            {label}
          </span>
        )}
        {help ? (
          <p id={ids.helpId} className="text-xs text-pretty text-muted-foreground">
            {help}
          </p>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-xl flex-1 flex-col gap-1.5">{typeof children === "function" ? children(ids) : <div className="flex min-h-8 flex-wrap items-center gap-2">{children}</div>}</div>
    </div>
  )
}