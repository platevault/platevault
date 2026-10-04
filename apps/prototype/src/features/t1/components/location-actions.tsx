/**
 * Recovery actions for a location row: Retry or Rescan (index only that
 * location, J19 S7), Choose folder again (A4 failure branch), and Locate or
 * remap with same-asset proof (D11, LIB-AC-11). Returns handlers, the
 * per-row feedback and the dialogs the page renders once.
 */
import { useState, type ReactNode } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { Button } from "@/components/ui/button"
import type { Location, LocationId, OperationId } from "@/domain/types"
import { plural } from "@/lib/format"
import { store } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { applyRemap, computeRemap, framesInLocation, type RemapProof, repointLocation, validateLocation } from "../lib/locations"

type Feedback =
  | { tone: "refusal"; title: string; message: string; locate?: boolean }
  | { tone: "error"; message: string; retry: () => void }
  | { tone: "done"; message: string }

function listNames(entries: { fileName: string }[]): string {
  const names = entries.slice(0, 3).map((e) => e.fileName)
  return entries.length > 3 ? `${names.join(", ")} and ${entries.length - 3} more` : names.join(", ")
}

export function useLocationActions({ href, onIndexStarted }: { href: string; onIndexStarted?: (operationId: OperationId) => void }) {
  const [picker, setPicker] = useState<{ location: Location; mode: "again" | "locate" } | null>(null)
  const [proof, setProof] = useState<RemapProof | null>(null)
  const [feedback, setFeedback] = useState<{ locationId: LocationId; value: Feedback } | null>(null)

  function index(location: Location) {
    setFeedback(null)
    onIndexStarted?.(startIndexing([location.id]))
  }

  function review(location: Location, path: string) {
    const { catalog, disk } = store.getState()
    const next = computeRemap(catalog, disk, location.id, path)
    if (next.refusal) {
      setFeedback({ locationId: location.id, value: { tone: "refusal", title: "Remap refused", message: next.refusal, locate: true } })
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
      setFeedback({ locationId: location.id, value: { tone: "refusal", title: "Folder not changed", message: errors.path } })
      return
    }
    const attempt = () => {
      const result = repointLocation(location.id, path, href)
      if (!result.ok) {
        setFeedback({ locationId: location.id, value: { tone: "error", message: result.message, retry: attempt } })
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
    if (value.tone === "done")
      return (
        <Notice
          tone="info"
          title="Remap saved"
          actions={
            <Button size="sm" variant="outline" onClick={() => index(location)}>
              Rescan {location.displayName}
            </Button>
          }
        >
          {value.message}
        </Notice>
      )
    return (
      <Notice
        tone="refusal"
        title={value.title}
        actions={
          value.locate ? (
            <Button size="sm" variant="outline" onClick={() => setPicker({ location, mode: "locate" })}>
              Choose another folder
            </Button>
          ) : undefined
        }
      >
        {value.message}
      </Notice>
    )
  }

  const proofLocation = proof ? store.getState().catalog.locations[proof.locationId] : undefined
  const refused = proof ? [...proof.differs, ...proof.notFound] : []
  const dialogs = (
    <>
      <FolderPicker
        open={picker !== null}
        onOpenChange={(open) => !open && setPicker(null)}
        title={picker?.mode === "locate" ? `Locate ${picker.location.displayName}` : `Choose folder again for ${picker?.location.displayName ?? "this location"}`}
        description={
          picker?.mode === "locate"
            ? "Prototype folder chooser. Choose the folder that now holds these frames; frames are matched by content hash, never by name."
            : "Prototype folder chooser. Choosing the same folder retries it, and it reads Access denied until access is restored (Prototype: Simulation controls › Folder access). A different folder replaces this registration's folder."
        }
        initialPath={picker?.location.path}
        chooseVerb={picker?.mode === "locate" ? "Review" : "Choose"}
        onChoose={(path) => picker && chosen(picker.location, picker.mode, path)}
      />
      <ConfirmDialog
        open={proof !== null && proofLocation !== undefined}
        onOpenChange={(open) => !open && setProof(null)}
        title={`Remap ${proofLocation?.displayName ?? "location"} to ${proof?.toPath ?? ""}?`}
        description={
          proof ? (
            <span className="block space-y-1">
              <span className="block">
                Volume evidence: {proof.fromVolume ? `${proof.fromVolume.name} (${proof.fromVolume.volumeUuid})` : "unknown"} →{" "}
                {proof.toVolume ? `${proof.toVolume.name} (${proof.toVolume.volumeUuid})` : "unknown"}.
                {proof.fromVolume && proof.toVolume && proof.fromVolume.name === proof.toVolume.name && proof.fromVolume.volumeUuid !== proof.toVolume.volumeUuid
                  ? " Same name, different volume identity."
                  : ""}
              </span>
              <span className="block tabular-nums">
                Same bytes: {proof.verified.length} · Bytes differ: {proof.differs.length} · Not found: {proof.notFound.length}
              </span>
            </span>
          ) : null
        }
        changes={
          proof
            ? [
                `${plural(proof.verified.length, "frame")} move to ${proof.toPath}, verified by SHA-256`,
                ...(proof.differs.length > 0 ? [`${plural(proof.differs.length, "frame")} refused, bytes differ: ${listNames(proof.differs)}`] : []),
                ...(proof.notFound.length > 0 ? [`${plural(proof.notFound.length, "frame")} not found in the new folder: ${listNames(proof.notFound)}`] : []),
                ...(refused.length > 0 ? ["Refused frames stay in the catalog with their decisions and read Not found in this location"] : []),
                `${proofLocation?.displayName ?? "The location"} points to ${proof.toPath}`,
              ]
            : []
        }
        unchanged={["Frame identities, quality decisions and View membership", "Every file on both volumes; remap changes the catalog only"]}
        confirmLabel={`Remap ${plural(proof?.verified.length ?? 0, "frame")}`}
        onConfirm={() => {
          if (!proof || !proofLocation) return
          const result = applyRemap(proof, href)
          if (result.ok) {
            setFeedback({
              locationId: proof.locationId,
              value: {
                tone: "done",
                message: `${plural(proof.verified.length, "frame")} now point to ${proof.toPath}${refused.length ? `; ${plural(refused.length, "frame")} refused` : ""}. Rescan to read any other files in the folder.`,
              },
            })
            setProof(null)
          }
          return result
        }}
      />
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
