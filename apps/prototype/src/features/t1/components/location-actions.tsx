/**
 * Recovery actions for a location row: Retry or Rescan (index only that
 * location, J19 S7), Choose folder again (A4 failure branch), and Locate or
 * remap with same-asset proof (D11, LIB-AC-11). Returns handlers, the
 * per-row feedback and the dialogs the page renders once.
 */
import { useState, type ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, Notice } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { Pill } from "@/components/app/pill"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import type { Location, LocationId, OperationId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { store } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { applyRemap, computeRemap, framesInLocation, type RemapProof, repointLocation, validateLocation } from "../lib/locations"

type Feedback =
  | { tone: "refusal"; title: string; message: string; locate?: boolean }
  | { tone: "error"; message: string; retry: () => void }
  | { tone: "done"; message: string }

function listNames(m: Messages, entries: { fileName: string }[]): string {
  const names = entries
    .slice(0, 3)
    .map((e) => e.fileName)
    .join(", ")
  return entries.length > 3 ? m.location_names_more({ names, count: entries.length - 3 }) : names
}

/** A frame count for a variant message: `count` selects the plural form, `frames` is the formatted number. */
function frames(count: number) {
  return { count, frames: formatCount(count) }
}

export function useLocationActions({ href, onIndexStarted }: { href: string; onIndexStarted?: (operationId: OperationId) => void }) {
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

  function review(location: Location, path: string) {
    const { catalog, disk } = store.getState()
    const next = computeRemap(catalog, disk, location.id, path)
    if (next.refusal) {
      setFeedback({ locationId: location.id, value: { tone: "refusal", title: m.location_remap_refused(), message: next.refusal, locate: true } })
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
      setFeedback({ locationId: location.id, value: { tone: "refusal", title: m.location_folder_unchanged(), message: errors.path } })
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
          title={m.location_remap_saved()}
          actions={
            <Button size="sm" variant="outline" onClick={() => index(location)}>
              {m.location_rescan()}
              <span className="sr-only"> {location.displayName}</span>
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
              {m.location_choose_again()}
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
        title={picker ? (picker.mode === "locate" ? m.settings_locate_named({ name: picker.location.displayName }) : m.location_choose_folder_for({ name: picker.location.displayName })) : m.import_choose_a_folder()}
        initialPath={picker?.location.path}
        chooseVerb={picker?.mode === "locate" ? m.verb_review() : m.verb_choose()}
        onChoose={(path) => picker && chosen(picker.location, picker.mode, path)}
      />
      <ConfirmDialog
        open={proof !== null && proofLocation !== undefined}
        onOpenChange={(open) => !open && setProof(null)}
        title={m.location_remap_title({ name: proofLocation?.displayName ?? "", path: proof?.toPath ?? "" })}
        description={
          proof ? (
            <span className="flex flex-wrap items-center gap-1 tabular-nums">
              <Pill tone="success">{m.location_remap_same_bytes(frames(proof.verified.length))}</Pill>
              {proof.differs.length > 0 ? <Pill tone="danger">{m.location_remap_differ(frames(proof.differs.length))}</Pill> : null}
              {proof.notFound.length > 0 ? <Pill tone="warning">{m.location_remap_not_found(frames(proof.notFound.length))}</Pill> : null}
              <NoteMarker
                label={m.location_volume_evidence()}
                rows={[
                  { label: m.location_from(), value: proof.fromVolume ? `${proof.fromVolume.name} · ${proof.fromVolume.volumeUuid}` : "–" },
                  { label: m.location_to(), value: proof.toVolume ? `${proof.toVolume.name} · ${proof.toVolume.volumeUuid}` : "–" },
                ]}
              />
            </span>
          ) : null
        }
        changes={
          proof
            ? [
                m.location_remap_change_move({ ...frames(proof.verified.length), path: proof.toPath }),
                ...(proof.differs.length > 0 ? [m.location_remap_change_differ({ ...frames(proof.differs.length), names: listNames(m, proof.differs) })] : []),
                ...(proof.notFound.length > 0 ? [m.location_remap_change_not_found({ ...frames(proof.notFound.length), names: listNames(m, proof.notFound) })] : []),
                ...(refused.length > 0 ? [m.location_remap_change_refused_note()] : []),
                m.location_remap_change_points({ name: proofLocation?.displayName ?? "", path: proof.toPath }),
              ]
            : []
        }
        confirmLabel={m.location_remap_confirm(frames(proof?.verified.length ?? 0))}
        onConfirm={() => {
          if (!proof || !proofLocation) return
          const result = applyRemap(proof, href)
          if (result.ok) {
            setFeedback({
              locationId: proof.locationId,
              value: {
                tone: "done",
                message: refused.length
                  ? m.location_remap_done_refused({ ...frames(proof.verified.length), path: proof.toPath, refused: formatCount(refused.length) })
                  : m.location_remap_done({ ...frames(proof.verified.length), path: proof.toPath }),
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
