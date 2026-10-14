/**
 * Confirmation for irreversible or scope-changing actions (L2;
 * design/R9-COMPOSITION-PLAN.md P8). Always an AlertDialog.
 *
 * The dialog names the exact scope: the title is the verb and object ("Move
 * 14 files to Trash?"), an optional summary line gives the totals, and each
 * group of files folds out to the files themselves: File · From · To ·
 * Size · Status, where Status carries a per-file refusal ("Read-only",
 * "Linked by NGC 7000 OIII deep ▸"). Description prose is not required.
 *
 * The footer is the shared DialogFooter (Cancel, then the action). Initial
 * focus goes to Cancel when the action is destructive, so Enter on open
 * never runs it, and to the action otherwise. A returned failure keeps the
 * dialog open with the error and Retry; a promise shows the action busy.
 *
 * Takes a ConfirmSpec as it is: `<ConfirmDialog {...spec} onConfirm />`.
 */
import { Link } from "@tanstack/react-router"
import { ArrowRight, ChevronRight, Lock } from "lucide-react"
import { type ReactElement, type ReactNode, useRef } from "react"
import { useMessages } from "@/app/preferences"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { formatBytes } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import type { Action, Column, ConfirmSpec, FileRow } from "./contracts"
import { DataTable } from "./data-table"
import { ActionError } from "./feedback"
import { DIALOG_DEFAULT_ATTR, type DialogCommit, type DialogCommitOptions, DialogFooter, useDialogCommit } from "./form-dialog"

/** One group of files that fold out: "Unusable frames · 12 files · 1.2 GB". */
export type ConfirmGroup = NonNullable<ConfirmSpec["groups"]>[number]

interface ConfirmDialogBaseProps extends DialogCommitOptions {
  /** Element that opens the dialog; omit when controlling `open`. */
  trigger?: ReactElementLike
  /** Verb plus object: "Move 14 files to Trash?". */
  title: string
  /** Totals on one line: "1.2 GB · 2 locations". */
  summary?: string
  /** The files the action touches, one fold-out per group. */
  groups?: ConfirmGroup[]
  /** Runs the action. A failure keeps the dialog open with the error and Retry; a promise shows it busy until it settles. */
  onConfirm: DialogCommit
  /** @deprecated Pass `summary`, or nothing: the title and the groups name the scope. W4 removes this prop. */
  description?: ReactNode
  /** @deprecated Pass `groups`, so the dialog lists the exact files. W4 removes this prop. */
  changes?: string[]
  /** @deprecated List what stays only when it is not obvious, inside `summary`. W4 removes this prop. */
  unchanged?: string[]
}

export type ConfirmDialogProps = ConfirmDialogBaseProps &
  (
    | {
        /** The action: its label repeats the verb ("Move to Trash"); `kind: "destructive"` makes it red and puts initial focus on Cancel. */
        confirm: ConfirmSpec["confirm"]
        confirmLabel?: undefined
        tone?: undefined
      }
    | {
        confirm?: undefined
        /** @deprecated Pass `confirm={{ label }}`. W4 removes this prop. */
        confirmLabel: string
        /** @deprecated Pass `confirm={{ label, kind }}`. W4 removes this prop. */
        tone?: "default" | "destructive"
      }
  )

type ReactElementLike = ReactElement<Record<string, unknown>>

interface Shown {
  title: string
  summary: ReactNode
  groups: ConfirmGroup[]
  changes: string[]
  unchanged: string[]
  label: string
  destructive: boolean
}

export function ConfirmDialog({
  trigger,
  title,
  summary,
  groups,
  onConfirm,
  description,
  changes,
  unchanged,
  confirm,
  confirmLabel,
  tone,
  ...options
}: ConfirmDialogProps) {
  const m = useMessages()
  const popup = useRef<HTMLDivElement>(null)
  const { isOpen, setOpen, commit, busy, error, finalFocus } = useDialogCommit(options)
  // Confirming usually changes the state the copy is derived from. Keep showing what was
  // confirmed while the dialog animates closed, never a re-derived empty scope.
  const live: Shown = {
    title,
    summary: summary ?? description,
    groups: groups ?? [],
    changes: changes ?? [],
    unchanged: unchanged ?? [],
    label: confirm?.label ?? confirmLabel ?? "",
    destructive: (confirm?.kind ?? tone) === "destructive",
  }
  const frozen = useRef(live)
  if (isOpen) frozen.current = live
  const shown = isOpen ? live : frozen.current
  const action: Action = { id: "confirm", label: shown.label, kind: shown.destructive ? "destructive" : "primary", run: onConfirm }
  const hasScope = shown.groups.length > 0 || shown.changes.length > 0 || shown.unchanged.length > 0

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent
        ref={popup}
        width={shown.groups.length > 0 ? "lg" : "md"}
        initialFocus={() => popup.current?.querySelector<HTMLElement>(`[${DIALOG_DEFAULT_ATTR}]`) ?? true}
        finalFocus={finalFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{shown.title}</AlertDialogTitle>
          {shown.summary ? <AlertDialogDescription>{shown.summary}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        {hasScope || error ? (
          <div className="min-w-0 space-y-2 text-sm">
            {hasScope ? (
              <div className="divide-y divide-separator overflow-hidden rounded-[0.3125rem] border border-separator bg-background">
                {shown.groups.length > 0 || shown.changes.length > 0 ? (
                  <section aria-label={m.dialog_changes()} className="py-2">
                    <h3 className="mb-1 px-3 text-xs font-medium text-muted-foreground">{m.dialog_changes()}</h3>
                    {shown.groups.length > 0 ? (
                      <ul className="divide-y divide-separator">
                        {shown.groups.map((group) => (
                          <li key={group.label}>
                            <FileGroup group={group} onNavigate={() => setOpen(false)} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {shown.changes.length > 0 ? <ChangeList items={shown.changes} destructive={shown.destructive} /> : null}
                  </section>
                ) : null}
                {shown.unchanged.length > 0 ? <UnchangedList items={shown.unchanged} /> : null}
              </div>
            ) : null}
            {error ? <ActionError message={error} /> : null}
          </div>
        ) : null}
        <DialogFooter confirm={action} onConfirm={() => commit(onConfirm)} busy={busy} failed={error !== null} />
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** A group's line, with its files folding out under it; a group without files only states its count. */
function FileGroup({ group, onNavigate }: { group: ConfirmGroup; onNavigate: () => void }) {
  const m = useMessages()
  const size = formatBytes(group.rows.reduce((total, row) => total + row.size, 0))
  const line = m.dialog_group({ label: group.label, count: group.rows.length, size })
  // Lines up with the labels of the groups that fold out, which follow a chevron.
  if (group.rows.length === 0) return <p className="py-1 pr-3 pl-6.5 text-muted-foreground">{line}</p>
  return (
    <Collapsible defaultOpen={group.defaultOpen ?? false}>
      {/* The outline sits inside: the scope box clips anything outside its rounded border. */}
      <CollapsibleTrigger
        render={<Button variant="ghost" size="sm" className="group/file-group w-full justify-start rounded-none px-2 font-normal outline-offset-[-2px]" />}
      >
        <ChevronRight aria-hidden="true" data-icon="inline-start" className="transition-transform group-data-[panel-open]/file-group:rotate-90" />
        {line}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2 pb-2">
        <FileTable group={group} onNavigate={onNavigate} />
      </CollapsibleContent>
    </Collapsible>
  )
}

interface IndexedRow extends FileRow {
  key: string
}

/** Where a file goes when the row names no destination; a kept file stays in its folder. */
function actionWord(m: Messages, action: FileRow["action"]): string {
  switch (action) {
    case "trash":
      return m.dialog_to_trash()
    case "unlink":
      return m.dialog_to_unlink()
    case "move":
      return m.dialog_to_move()
    case "copy":
      return m.dialog_to_copy()
    case "keep":
      return m.dialog_to_keep()
  }
}

function FileTable({ group, onNavigate }: { group: ConfirmGroup; onNavigate: () => void }) {
  const m = useMessages()
  const rows: IndexedRow[] = group.rows.map((row, index) => ({ ...row, key: String(index) }))
  const destination = (row: FileRow) => row.to ?? actionWord(m, row.action)
  // Narrower than a page table's 18rem cut, so File · From · To · Size · Status fit the 42rem dialog; a cut path shows in full on hover (T2).
  const columns: Column<IndexedRow>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (row) => row.file, sortValue: (row) => row.file, rowHeader: true, truncate: true, className: "max-w-48" },
    { id: "from", header: m.dialog_col_from(), cell: (row) => row.from, sortValue: (row) => row.from, truncate: true, className: "max-w-40" },
    { id: "to", header: m.dialog_col_to(), cell: destination, sortValue: destination, truncate: true, className: "max-w-40" },
    { id: "size", header: m.dialog_col_size(), cell: (row) => formatBytes(row.size), sortValue: (row) => row.size, align: "right" },
  ]
  if (rows.some((row) => row.status)) {
    columns.push({
      id: "status",
      header: m.dialog_col_status(),
      cell: (row) => (row.status ? <FileStatus status={row.status} onNavigate={onNavigate} /> : null),
      sortValue: (row) => row.status?.label ?? null,
    })
  }
  return <DataTable label={group.label} rows={rows} columns={columns} getRowId={(row) => row.key} scroll="none" />
}

/** A per-file refusal or note; with a link it opens the place that resolves it and closes the dialog. */
function FileStatus({ status, onNavigate }: { status: NonNullable<FileRow["status"]>; onNavigate: () => void }) {
  const { link } = status
  if (!link) return <span className="text-muted-foreground">{status.label}</span>
  return (
    <Button
      variant="link"
      size="xs"
      className="min-h-0 px-0"
      render={<Link to={link.to as never} params={link.params as never} search={link.search as never} />}
      onClick={onNavigate}
    >
      {status.label}
      <ChevronRight aria-hidden="true" data-icon="inline-end" />
    </Button>
  )
}

/** The deprecated `changes` lines. */
function ChangeList({ items, destructive }: { items: string[]; destructive: boolean }) {
  return (
    <ul className="space-y-0.5 px-3">
      {items.map((change) => (
        <li key={change} className="flex gap-2">
          <ArrowRight aria-hidden="true" className={destructive ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-link"} />
          <span>{change}</span>
        </li>
      ))}
    </ul>
  )
}

/** The deprecated `unchanged` lines. */
function UnchangedList({ items }: { items: string[] }) {
  const m = useMessages()
  return (
    <section aria-label={m.confirm_unchanged()} className="bg-muted/40 px-3 py-2">
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{m.confirm_unchanged()}</h3>
      <ul className="space-y-0.5 text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
