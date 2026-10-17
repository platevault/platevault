/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): feedback routes of P7.
 * Refusal, ActionError, NoticeSlot (the template notice-slot contract) and
 * toast; then the states themselves: EmptyState, the Notice tones,
 * SaveState, UnknownValue and the loading skeletons. Component content uses
 * the real catalogue copy; the captions are reviewer labels. The toast
 * buttons need the RootLayout `Toaster`.
 */
import { Archive, Inbox, Trash2 } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { ActionError, DetailSkeleton, EmptyState, Notice, NoticeSlot, SaveState, TableSkeleton, toast, UnknownValue, useSaveState } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { Refusal } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { formatNight } from "@/lib/format"
import type { CommitResult } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

/** One section's save: the button runs `write` through the hook, and the hook's indicator follows it. */
function SaveSpecimen({ caption, write }: { caption: string; write: () => CommitResult }) {
  const m = useMessages()
  const { save, indicator } = useSaveState()
  return (
    <Specimen caption={caption}>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="outline" onClick={() => save(write)}>
          {m.settings_save()}
        </Button>
        {indicator}
      </div>
    </Specimen>
  )
}

/** Fails the first write, so Retry shows; the retried write succeeds. */
function failOnce(message: string): () => CommitResult {
  let failed = false
  return () => {
    if (failed) return { ok: true }
    failed = true
    return { ok: false, reason: "write-failed", message }
  }
}

export function FeedbackCatalogue() {
  const m = useMessages()
  // eslint-disable-next-line alm/no-user-string -- sample blockers: target and filter names, a volume name
  const blockers = [{ label: "M 42 · Ha", link: { to: "/projects" } }, { label: "NGC 7000 · OIII", link: { to: "/sessions" } }, { label: "Cold-1" }]
  return (
    <>
      <ComponentSection components={["Refusal"]} description={m.catalogue_feedback_refusal_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_feedback_refused_blockers()}>
            <Refusal action={m.sessions_cant_archive()} reason={m.refusal_blockers({ count: blockers.length })} blockers={blockers} />
          </Specimen>
          <Specimen caption={m.catalogue_feedback_refused_blockers_actions()}>
            <Refusal
              action={m.project_refusal_remove_rig()}
              reason={m.equipment_used_by_projects({ count: 2 })}
              blockers={blockers.slice(0, 2)}
              actions={
                <Button size="xs" variant="outline">
                  {m.verb_review()}
                </Button>
              }
            />
          </Specimen>
          <Specimen caption={m.catalogue_feedback_standing()}>
            <Refusal standing action={m.run_trash_blocked()} reason={m.refusal_blockers({ count: 1 })} blockers={blockers.slice(2)} />
          </Specimen>
          <Specimen caption={m.catalogue_feedback_no_blockers()}>
            <Refusal action={m.trash_cant()} reason={m.wrapup_used_by_other_reason()} blockers={[]} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["ActionError"]} description={m.catalogue_feedback_action_error_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_feedback_with_retry()}>
            <ActionError message={m.op_index_offline()} onRetry={() => undefined} />
          </Specimen>
          <Specimen caption={m.catalogue_feedback_message_only()}>
            <ActionError message={m.importdlg_blocked_unsupported()} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["NoticeSlot"]} description={m.catalogue_feedback_notice_slot_desc()}>
        <div className="space-y-3">
          <NoticeSlot notice={{ tone: "offline", title: m.run_entry_offline({ name: "Cold-1" }), actions: <Button size="sm" variant="outline">{m.location_rescan()}</Button> }} />
          <NoticeSlot notice={{ tone: "warning", title: m.run_read_only_because({ reason: m.status_archived() }) }} />
          <NoticeSlot notice={{ tone: "info", title: m.import_read_only_source() }} />
          <Specimen caption="null">
            <NoticeSlot notice={null} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["useSaveState"]} description={m.catalogue_feedback_save_state_desc()}>
        <div className="space-y-3">
          <SaveSpecimen caption={m.catalogue_feedback_save_succeeds()} write={() => ({ ok: true })} />
          <SaveSpecimen caption={m.catalogue_feedback_save_fails()} write={failOnce(m.store_not_saved_message({ label: m.ds_target_correction() }))} />
          <SaveSpecimen caption={m.catalogue_feedback_save_stale()} write={() => ({ ok: false, reason: "stale", message: m.ds_save_stale({ from: 3, to: 4 }) })} />
        </div>
      </ComponentSection>

      <ComponentSection components={["toast"]} description={m.catalogue_feedback_toast_desc()}>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast({ message: m.op_trash_moved() })}>
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            {m.catalogue_feedback_message_only()}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast({ message: m.op_archived_to({ folder: "/Volumes/Cold-1/Archive", frames: "214" }), action: { id: "undo", label: m.wrapup_undo(), run: () => toast({ message: m.status_archived() }) } })}
          >
            <Archive aria-hidden="true" data-icon="inline-start" />
            {m.catalogue_feedback_with_undo()}
          </Button>
        </div>
      </ComponentSection>

      <Section title={m.ds_feedback_title()}>
        <div className="grid gap-4 xl:grid-cols-2">
          <EmptyState
            icon={Inbox}
            title={m.targets_empty()}
            description={m.ds_targets_empty_description()}
            action={<Button size="sm">{m.location_role_captures_add()}</Button>}
          />
          <div className="space-y-3">
            <Notice
              tone="offline"
              title={m.run_cleanup_volume_offline({ name: "Cold-1" })}
              actions={
                <Button size="sm" variant="outline">
                  {m.ds_reconnect()}
                </Button>
              }
            >
              {m.ds_offline_body({ night: formatNight("2026-09-12") })}
            </Notice>
            <Notice tone="warning" title={m.ds_scan_incomplete_title()}>
              {m.ds_scan_incomplete_body({ path: "/Volumes/Astro-T7/Imaging/M33/2026-08-30" })}
            </Notice>
            <Notice
              tone="warning"
              title={m.view_developer_mode_off()}
              actions={
                <Button size="sm" variant="outline">
                  {m.project_use_copies()}
                </Button>
              }
            />
            <Notice tone="info" title={m.ds_provisional_title()}>
              {m.ds_provisional_body({ volume: "Astro-T7" })}
            </Notice>
          </div>
          <div className="space-y-3">
            <ActionError message={m.store_not_saved_message({ label: m.ds_target_correction() })} onRetry={() => undefined} />
            <SaveState state="saved" />
            <SaveState state="unsaved" />
            <SaveState state="saving" />
            <SaveState state="failed" onRetry={() => undefined} message={m.ds_save_failed()} />
            <SaveState state="stale" onReview={() => undefined} message={m.ds_save_stale({ from: 3, to: 4 })} />
            <p className="text-sm">
              {m.run_col_distance()}: <UnknownValue label={m.project_search_position_unknown()} reason={m.indexing_pointing_none()} /> · {m.measure_metric_fwhm()}: <UnknownValue label={m.status_not_measured()} />
            </p>
          </div>
          <div className="grid gap-3">
            <TableSkeleton label={m.ds_loading_sessions()} rows={4} />
            <DetailSkeleton label={m.ds_loading_session_detail()} />
          </div>
        </div>
      </Section>
    </>
  )
}
