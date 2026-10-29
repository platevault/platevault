/**
 * The Project's Output tab (070 RES-FR as amended by F4): what its
 * `Output/` folder holds as the library observes it, each file with its
 * kind, channel, mosaic panel, state and origin, and Copy to Output… for a
 * file a tool saved elsewhere. Nothing here is accepted or attached: Output
 * lists actual files, observed by the watcher or copied and verified by
 * PlateVault. Rescan (More) walks `Output/` now.
 *
 * The library reads Output by walking it (`project_output_rescan`); a Project
 * that is not open, or has no processing location yet, has no Output to
 * read, and the tab says so instead of showing an empty list.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, RefreshCw } from "lucide-react"
import { useState } from "react"
import { failureOf, library, type NativePathWire, type OutputKind, type OutputObservation_Serialize } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column } from "@/components/app/contracts"
import { ActionError, Notice, TableSkeleton, toast } from "@/components/app/feedback"
import { TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { failureMessage } from "@/components/app/run-result"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { formatBytes } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import type { ProjectTabProps } from "./project-page"
import { inputsQuery, isLocked, projectWrite } from "./queries"
import { kindText, pathText } from "./words"

export function outputKindText(m: Messages, kind: OutputKind | null): string {
  if (!kind) return "–"
  switch (kind.kind) {
    case "final_image":
      return m.domain_result_final_image()
    case "linear_integration":
      return m.domain_result_linear_integration()
    case "channel_product":
      return m.domain_result_channel_product()
    case "calibration_master":
      return m.output_kind_master({ kind: kindText(m, kind.input) })
    case "other":
      return kind.label
  }
}

function stateText(m: Messages, file: OutputObservation_Serialize): string {
  return file.state === "settling" ? m.output_refused_writing() : file.state === "unreadable" ? m.status_unreadable() : m.output_settled()
}

/**
 * A name relative to `Output/`, in the encoding the library's paths use on
 * this machine (the source's): UTF-8 bytes on Unix, UTF-16 code units on
 * Windows.
 */
export function outputName(name: string, like: NativePathWire): NativePathWire {
  if (like.encoding === "windows-utf16") return { encoding: "windows-utf16", payload: Array.from({ length: name.length }, (_, i) => name.charCodeAt(i)), display: name }
  return { encoding: "unix-bytes", payload: [...new TextEncoder().encode(name)], display: name }
}

export function OutputTab({ header, chrome }: ProjectTabProps) {
  const m = useMessages()
  const client = useQueryClient()
  const locked = isLocked(header.lifecycle)
  const inputs = useQuery(inputsQuery(header.id))
  const hasLocation = inputs.data ? inputs.data.desired.settings.parent !== null : null
  // The rescan stands in for a passive Output read until astro-plan-wre19.7 adds one.
  const output = useQuery({ ...libraryQuery("projectOutputRescan", header.id), enabled: !locked && hasLocation === true })
  const [copying, setCopying] = useState(false)
  const groupName = (id: string | null) => (id ? (inputs.data?.desired.groups.find((g) => g.id === id)?.name ?? m.project_group_missing()) : "–")
  const copyLabel = m.project_copy_to_output()
  const copy: Action = {
    id: "copy-to-output",
    label: copyLabel,
    icon: Copy,
    opensDialog: true,
    unavailable: locked
      ? { action: m.actions_blocked({ action: copyLabel }), reason: m.project_closed(), blockers: [] }
      : hasLocation === false
        ? { action: m.actions_blocked({ action: copyLabel }), reason: m.output_no_folder(), blockers: [{ label: m.project_view_settings(), link: { to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "view" } } }] }
        : undefined,
    run: () => setCopying(true),
  }
  const rescan: Action = { id: "rescan-output", label: m.output_rescan(), icon: RefreshCw, run: async () => void (await output.refetch()) }
  const columns: Column<OutputObservation_Serialize>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (f) => pathText(f.path), sortValue: (f) => pathText(f.path), rowHeader: true, truncate: true },
    { id: "kind", header: m.output_kind_channel(), cell: (f) => [outputKindText(m, f.kind), f.channel].filter(Boolean).join(" · "), sortValue: (f) => outputKindText(m, f.kind) },
    { id: "panel", header: m.common_mosaic_panel(), cell: (f) => groupName(f.panelGroupId), sortValue: (f) => groupName(f.panelGroupId), hideable: true },
    { id: "state", header: m.dialog_col_status(), cell: (f) => stateText(m, f), sortValue: (f) => f.state },
    { id: "origin", header: m.output_origin(), cell: (f) => (f.origin === "copied" ? m.output_origin_copied() : m.output_origin_observed()), sortValue: (f) => f.origin },
    { id: "size", header: m.dialog_col_size(), cell: (f) => formatBytes(f.sizeBytes), sortValue: (f) => f.sizeBytes, align: "right" },
  ]
  let content
  if (locked) content = <Notice tone="info" title={m.output_locked()} />
  else if (hasLocation === false) content = <Notice tone="info" title={m.output_no_folder()} />
  else if (output.error) {
    const failure = failureOf(output.error)
    content = <ActionError message={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} onRetry={() => void output.refetch()} />
  } else if (!output.data) content = <TableSkeleton rows={4} columns={5} label={m.common_loading()} />
  else content = <BoxTable label={m.project_output_of({ name: header.name })} rows={output.data} columns={columns} getRowId={(f) => pathText(f.path)} empty={m.project_output_empty()} />
  const sections: DetailSection[] = [
    { id: "output", title: m.project_tab_output(), count: output.data?.length, actions: [copy], more: locked ? [] : [rescan], flush: output.data !== undefined && !locked, content },
  ]
  return (
    <>
      <DetailPage {...chrome} title={header.name} sections={sections} />
      {copying ? (
        <CopyToOutputDialog
          onClose={() => setCopying(false)}
          run={async (source, name) => {
            const result = await projectWrite(client, () => library.projectCopyToOutput(header.id, source, outputName(name, source)))
            if (result.ok) {
              client.setQueryData(libraryKey("projectOutputRescan", header.id), (was: OutputObservation_Serialize[] | undefined) => [...(was ?? []).filter((f) => pathText(f.path) !== pathText(result.data.path)), result.data])
              toast({ message: m.output_copied({ name }) })
            }
            return result
          }}
        />
      ) : null}
    </>
  )
}

/** Copy to Output…: the file to copy, and its name inside `Output/` (a sub-folder may come first). */
function CopyToOutputDialog({ onClose, run }: { onClose: () => void; run: (source: NativePathWire, name: string) => ReturnType<Action["run"]> }) {
  const m = useMessages()
  const [source, setSource] = useState<NativePathWire | null>(null)
  const [name, setName] = useState("")
  const [pickFailed, setPickFailed] = useState<string | null>(null)
  const choose = async () => {
    const picked = await library.libraryPickFile()
    if (!picked.ok) setPickFailed(failureMessage(m, picked.failure))
    else if (picked.data) {
      setPickFailed(null)
      setSource(picked.data)
      if (name.trim() === "") setName(picked.data.display.split(/[\\/]/).pop() ?? "")
    }
  }
  const label = m.project_copy_to_output()
  const confirm: Action = {
    id: "copy-confirm",
    label,
    kind: "primary",
    unavailable: !source
      ? { action: m.actions_blocked({ action: label }), reason: m.output_choose_file(), blockers: [] }
      : name.trim() === ""
        ? { action: m.actions_blocked({ action: label }), reason: m.output_refused_name(), blockers: [] }
        : undefined,
    run: () => (source ? run(source, name.trim()) : undefined),
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={label} size="md" confirm={confirm}>
      <TextField
        label={m.output_source()}
        value={source ? pathText(source) : ""}
        onChange={() => undefined}
        readOnly
        mono
        error={pickFailed ?? undefined}
        action={<ActionButton action={{ id: "choose", label: m.verb_choose(), opensDialog: true, run: choose }} />}
      />
      <TextField label={m.output_name_in_output()} value={name} onChange={setName} mono description={name.trim() === "" ? undefined : m.output_name_preview({ name: name.trim() })} />
    </FormDialog>
  )
}
