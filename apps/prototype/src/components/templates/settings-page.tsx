/**
 * SettingsPage and ListSection (L3 template; plan §3.4). One child area of
 * the Settings layout (ListDetail + NavList, which owns the page h1).
 *
 * - The title is the area's h2. No description and no return link: the
 *   sections say what the area holds.
 * - Children are SettingsSection (Field rows, SettingsRow) and ListSection
 *   elements, in order. A ListSection is a DataTable with row actions and
 *   one "Add …" in its heading; the table grows with its rows and the pane
 *   scrolls.
 */
import { type ReactNode, useId } from "react"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { DataTable, type DataTableProps } from "@/components/app/data-table"
import type { PageNotice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"

export interface SettingsPageProps {
  title: string
  notice?: PageNotice | null
  /** SettingsSection and ListSection elements. */
  children: ReactNode
}

export function SettingsPage({ title, notice, children }: SettingsPageProps) {
  return (
    <div data-template="settings">
      <PageHeader level={2} title={title} notice={notice} />
      <PageBody className="space-y-6">{children}</PageBody>
    </div>
  )
}

/** The section table: grows with its rows; filters and batch bars belong on a ListPage. */
export type ListSectionTable<T> = DataTableProps<T> & { className?: never; scroll?: never; toolbar?: never; batchActions?: never }

export interface ListSectionProps<T> {
  title: string
  /** The one "Add …" of the section, beside its heading; always a standard (outline) button. */
  add?: Action
  table: ListSectionTable<T>
}

export function ListSection<T>({ title, add, table }: ListSectionProps<T>) {
  const id = useId()
  return (
    <Section level={3} id={id} title={title} actions={add ? <ActionButton action={{ ...add, kind: "standard" }} /> : undefined}>
      <DataTable {...table} scroll="none" />
    </Section>
  )
}
