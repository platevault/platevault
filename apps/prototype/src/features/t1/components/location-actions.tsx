/**
 * Recovery actions for a location: Retry or Rescan (index only that
 * location, J19 S7), Choose folder again (A4 failure branch), and Locate or
 * remap with same-asset proof (D11, LIB-AC-11). Returns handlers, each
 * location's outcome and the dialogs the page renders once.
 *
 * `notify` picks where an outcome shows: "row" keeps it for `feedbackFor`
 * beside the location (setup), "toast" raises it as a toast with its one
 * follow-up (Settings › Locations, whose rows are DataTable rows).
 */
import { type ReactNode, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { ConfirmDialog, type ConfirmGroup } from "@/components/app/confirm-dialog"
import type { Action, FileRow } from "@/components/app/contracts"
import { ActionError, Notice, toast } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import type { Catalog, Location, LocationId, OperationId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { store } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { applyRemap, computeRemap, framesInLocation, type RemapEntry, type RemapProof, repointLocation, validateLocation } from "../lib/locations"

type Feedback =
  | { tone: "refusal"; title: string; message: string; locate?: boolean }
  | { tone: "error"; message: string; retry: () => void }
  | { tone: "done"; message: string }

/** A frame count for a variant message: `count` selects the plural form, `frames` is the formatted number. */
function frames(count: number) {
  return { count, frames: formatCount(count) }
}

/** One remap group's files, as the confirmation lists them: from the old path to the new one. */
function remapRows(catalog: Catalog, entries: RemapEntry[], status?: string): FileRow[] {
  return entries.map((entry) => ({
    file: entry.fileName,
    from: entry.fromPath,
    to: entry.toPath,
    action: "move",
    size: catalog.assets[entry.assetId]?.sizeBytes ?? 0,
    status: status ? { label: status } : undefined,
  }))
}

function remapGroups(m: Messages, catalog: Catalog, proof: RemapProof): ConfirmGroup[] {
  return [
    { label: m.location_remap_same_bytes(frames(proof.verified.length)), rows: remapRows(catalog, proof.verified), defaultOpen: proof.verified.length <= 5 },
    ...(proof.differs.length > 0 ? [{ label: m.location_remap_differ(frames(proof.differs.length)), rows: remapRows(catalog, proof.differs, m.location_remap_refused()) }] : []),
    ...(proof.notFound.length > 0 ? [{ label: m.location_remap_not_found(frames(proof.notFound.length)), rows: remapRows(catalog, proof.notFound, m.location_remap_refused()) }] : []),
  ]
}

export interface LocationActionsOptions {
  href: string
  onIndexStarted?: (operationId: OperationId) => void
  /** Where an outcome shows; default "row" (`feedbackFor`). */
  notify?: "row" | "toast"
}

export function useLocationActions({ href, onIndexStarted, notify = "row" }: LocationActionsOptions) {
  const m = useMessages()
  const [picker, setPicker] = useState<{ location: Location; mode: "again" | "locate" } | null>(null)
  const [proof, setProof] = useState<RemapProof | null>(null)
  const [feedback, setFeedback] = useState<{ locationId: LocationId; value: Feedback } | null>(null)

  function index(location: Location) {
    setFeedback(null)
    // Start first: `onIndexStarted?.(startIndexing(…))` skips the argument when no callback is passed (Settings › Locations).
    const operationId = startIndexing([location.id])
    onIndexStarted?.(operationId)
  }

  /** The follow-up an outcome offers: Choose again after a refused remap, Retry after a failed write, Rescan after a remap. */
  function followUp(location: Location, value: Feedback): Action | undefined {
    if (value.tone === "error") return { id: "retry", label: m.verb_retry(), run: value.retry }
    if (value.tone === "done") return { id: "rescan", label: m.location_rescan(), run: () => index(location) }
    return value.locate ? { id: "choose-again", label: m.location_choose_again(), opensDialog: true, run: () => setPicker({ location, mode: "locate" }) } : undefined
  }

  function report(location: Location, value: Feedback) {
    if (notify === "row") {
      setFeedback({ locationId: location.id, value })
      return
    }
    const message = value.tone === "refusal" ? `${value.title}: ${value.message}` : value.tone === "done" ? `${m.location_remap_saved()}: ${value.message}` : value.message
    toast({ message, action: followUp(location, value) })
  }

  function review(location: Location, path: string) {
    const { catalog, disk } = store.getState()
    const next = computeRemap(catalog, disk, location.id, path)
    if (next.refusal) {
      report(location, { tone: "refusal", title: m.location_remap_refused(), message: next.refusal, locate: true })
      return
    }
    setFeedback(null)
    setProof(next)
  }

  function chosen(location: Location, mode: "again" | "locate", path: string) {
    if (mode === "locate") return review(location, path)
    // Choose folder again: the same folder retries; access comes back only where it was restored.
    if (path === location.path) return index(location)
    const { catalog } = store.getState()
    if (framesInLocation(catalog, location.id) > 0) return review(location, path)
    const errors = validateLocation(catalog, { path, displayName: location.displayName, role: location.role }, location.id)
    if (errors.path) {
      report(location, { tone: "refusal", title: m.location_folder_unchanged(), message: errors.path })
      return
    }
    const attempt = () => {
      const result = repointLocation(location.id, path, href)
      if (!result.ok) {
        report(location, { tone: "error", message: result.message, retry: attempt })
        return
      }
      index({ ...location, path })
    }
    attempt()
  }

  function feedbackFor(location: Location): ReactNode {
    if (!feedback || feedback.locationId !== location.id) return null
    const value = feedback.value
    if (value.tone === "error") return <ActionError message={value.message} onRetry={value.retry} />
    const action = followUp(location, value)
    return (
      <Notice tone={value.tone === "done" ? "info" : "refusal"} title={value.tone === "done" ? m.location_remap_saved() : value.title} actions={action ? <ActionButton action={action} /> : undefined}>
        {value.message}
      </Notice>
    )
  }

  const catalog = store.getState().catalog
  const proofLocation = proof ? catalog.locations[proof.locationId] : undefined
  const refused = proof ? proof.differs.length + proof.notFound.length : 0
  const volumes = proof ? [proof.fromVolume, proof.toVolume].map((volume) => (volume ? `${volume.name} · ${volume.volumeUuid}` : "–")) : []
  const dialogs = (
    <>
      <FolderPicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        title={picker ? (picker.mode === "locate" ? m.settings_locate_named({ name: picker.location.displayName }) : m.location_choose_folder_for({ name: picker.location.displayName })) : m.import_choose_a_folder()}
        initialPath={picker?.location.path}
        chooseVerb={picker?.mode === "locate" ? m.verb_review() : m.verb_choose()}
        onChoose={(path) => picker && chosen(picker.location, picker.mode, path)}
      />
      {proof && proofLocation ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setProof(null)}
          title={m.location_remap_title({ name: proofLocation.displayName, path: proof.toPath })}
          summary={`${m.location_volume_evidence()}: ${m.location_from()} ${volumes[0]} → ${m.location_to()} ${volumes[1]}`}
          groups={remapGroups(m, catalog, proof)}
          confirm={{ label: m.location_remap_confirm(frames(proof.verified.length)) }}
          onConfirm={() => {
            const result = applyRemap(proof, href)
            if (result.ok) {
              const message = refused
                ? m.location_remap_done_refused({ ...frames(proof.verified.length), path: proof.toPath, refused: formatCount(refused) })
                : m.location_remap_done({ ...frames(proof.verified.length), path: proof.toPath })
              report(proofLocation, { tone: "done", message })
              setProof(null)
            }
            return result
          }}
        />
      ) : null}
    </>
  )

  return {
    retry: index,
    chooseAgain: (location: Location) => setPicker({ location, mode: "again" }),
    locate: (location: Location) => setPicker({ location, mode: "locate" }),
    feedbackFor,
    dialogs,
  }
}
