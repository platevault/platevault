/**
 * Correct metadata… (LIB-FR-04, LIB-FR-24): set one capture field on every
 * frame of the session, reviewed before it commits. Preview asks the
 * library for the plan (`library_preview_metadata`): what the frames read
 * after, and which sessions they then form. Apply commits exactly that
 * plan (`library_confirm_metadata`) with the frames' revisions and
 * fingerprints as read, so a frame that changed since is refused as
 * `conflict` and nothing changes. A refusal keeps the dialog open with the
 * user's field and value. The source files are never written: a correction
 * is a catalog value beside the header.
 */
import { useNavigate } from "@tanstack/react-router"
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type CorrectionPreview_Serialize, type ExpectedAsset_Deserialize, type JsonValueWire, type LibrarySession_Serialize, library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { StepFlow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { SelectField, TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { toast } from "@/components/app/feedback"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { homeWrite } from "./queries"
import { sessionLabel } from "@/components/domain/session-label"

/** The capture fields a session's correction offers, by their library name; numeric ones take a number. */
const FIELDS = ["object", "filter", "exposureSeconds", "gain", "offset", "setTemperatureC", "focalLengthMm"] as const
type Field = (typeof FIELDS)[number]
const NUMERIC: ReadonlySet<Field> = new Set(["exposureSeconds", "gain", "offset", "setTemperatureC", "focalLengthMm"])

function fieldLabel(m: Messages, field: Field): string {
  const label: Record<Field, () => string> = {
    object: m.session_field_object,
    filter: m.run_field_filter,
    exposureSeconds: m.run_field_exposure,
    gain: m.session_field_gain,
    offset: m.session_field_offset,
    setTemperatureC: m.domain_token_set_temp,
    focalLengthMm: m.run_field_focal_length,
  }
  return label[field]()
}

/** The frames as the correction must name them: each with the revision and fingerprint the session read. */
export function expectedAssets(session: LibrarySession_Serialize): ExpectedAsset_Deserialize[] {
  return session.detail.assets.filter((a) => a.availability !== "trashed").map((a) => ({ assetId: a.id, decisionRevision: a.decisionRevision, fingerprint: a.fingerprint }))
}

/** The typed value as the library takes it: blank clears the field; a numeric field takes a finite number. */
export function correctionValue(field: Field, text: string): { ok: true; value: JsonValueWire } | { ok: false } {
  const trimmed = text.trim()
  if (trimmed === "") return { ok: true, value: null }
  if (!NUMERIC.has(field)) return { ok: true, value: trimmed }
  const number = Number(trimmed.replace(",", "."))
  return Number.isFinite(number) ? { ok: true, value: number } : { ok: false }
}

export function CorrectMetadataDialog({ session, open, onOpenChange }: { session: LibrarySession_Serialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const navigate = useNavigate()
  const { values, set } = useDialogForm(open, () => ({ field: "filter" as Field, value: "" }))
  const [preview, setPreview] = useState<CorrectionPreview_Serialize | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPreview(null)
  }
  const parsed = correctionValue(values.field, values.value)
  const errors = { value: parsed.ok ? undefined : m.session_field_number() }
  const expected = expectedAssets(session)
  const previewLabel = m.fields_template_preview()
  const applyLabel = m.session_apply_correction()
  const flow: StepFlow = {
    steps: [
      { id: "edit", label: m.session_correction_value(), state: preview ? "finished" : "current" },
      { id: "review", label: m.dialog_changes(), state: preview ? "current" : "todo" },
    ],
    current: preview ? "review" : "edit",
    ordered: true,
    proceed: preview
      ? {
          id: "apply-correction",
          label: applyLabel,
          run: async () => {
            const result = await homeWrite(client, () => library.libraryConfirmMetadata(preview.id, expected))
            if (!result.ok) {
              // A refused plan is stale: preview the same value again against the frames as they are now.
              if (result.failure.source === "library" && (result.failure.error.code === "conflict" || result.failure.error.code === "invalid_input")) setPreview(null)
              return result
            }
            const successor = result.data.sessions[0]
            if (result.data.associationRefresh) toast({ message: m.session_correction_targets_pending() })
            if (successor && successor.id !== session.detail.summary.session.id) void navigate({ to: "/sessions/$sessionId", params: { sessionId: successor.id } })
            return result
          },
        }
      : {
          id: "preview-correction",
          label: previewLabel,
          unavailable: blockedByErrors(m, previewLabel, errors),
          run: async () => {
            if (!parsed.ok) return
            const result = await library.libraryPreviewMetadata(expected, values.field, parsed.value)
            if (result.ok) setPreview(result.data)
            return result
          },
        },
    next: null,
    reopen: () => ({ id: "edit-again", label: m.session_edit_value(), run: () => setPreview(null) }),
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={m.session_correct_metadata_of({ name: sessionLabel(m, session.detail.summary.session) })} steps={flow}>
      {({ step, editable }) =>
        step === "edit" ? (
          <>
            <SelectField label={m.session_correction_field()} value={values.field} options={FIELDS.map((f) => ({ value: f, label: fieldLabel(m, f) }))} onChange={(field) => set({ field })} disabled={!editable} />
            <TextField
              label={fieldLabel(m, values.field)}
              description={m.session_correction_blank_clears()}
              value={values.value}
              onChange={(value) => set({ value })}
              inputMode={NUMERIC.has(values.field) ? "decimal" : "text"}
              readOnly={!editable}
              error={errors.value}
            />
          </>
        ) : preview ? (
          <KeyValueList
            items={[
              { label: fieldLabel(m, values.field), value: values.value.trim() === "" ? m.session_correction_cleared() : values.value.trim() },
              { label: m.sessions_column_frames(), value: formatCount(preview.proposal.assets.length) },
              { label: m.session_correction_sessions_after(), value: preview.proposal.sessions.map((s) => sessionLabel(m, s)).join(", ") || "–" },
              ...(preview.proposal.predecessors.length > 0 ? [{ label: m.session_correction_replaced(), value: formatCount(preview.proposal.predecessors.length) }] : []),
            ]}
          />
        ) : null
      }
    </FormDialog>
  )
}
