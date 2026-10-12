/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): feedback routes of P7.
 * Refusal, ActionError, NoticeSlot (the template notice-slot contract) and
 * toast. Component content uses the real catalogue copy; the captions are
 * reviewer labels. The toast buttons need the RootLayout `Toaster`.
 */
import { Archive, Trash2 } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { ActionError, NoticeSlot, toast } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { Refusal } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { Specimen } from "./specimen"


export function FeedbackCatalogue() {
  const m = useMessages()
  const blockers = [
    { label: "M 42 · Ha", link: { to: "/projects" } },
    { label: "NGC 7000 · OIII", link: { to: "/sessions" } },
    { label: "Cold-1" },
  ]
  return (
    <>
      <Section title="Refusal" description="Beside the refused control. The reason opens the blockers in a hover card (hover, focus, or press to move into it; Escape closes). Nothing is inserted, nothing moves.">
        <div className="space-y-3">
          <Specimen caption="refused · blockers">
            <Refusal action={m.sessions_cant_archive()} reason={m.refusal_blockers({ count: blockers.length })} blockers={blockers} />
          </Specimen>
          <Specimen caption="refused · blockers + actions">
            <Refusal
              action={m.project_refusal_remove_rig()}
              reason={m.project_used_by_runs({ count: 2 })}
              blockers={blockers.slice(0, 2)}
              actions={
                <Button size="xs" variant="outline">
                  {m.verb_review()}
                </Button>
              }
            />
          </Specimen>
          <Specimen caption="standing (no alert role)">
            <Refusal standing action={m.run_trash_blocked()} reason={m.refusal_blockers({ count: 1 })} blockers={blockers.slice(2)} />
          </Specimen>
          <Specimen caption="no blockers (no card)">
            <Refusal action={m.trash_cant()} reason={m.wrapup_used_by_other_reason()} blockers={[]} />
          </Specimen>
        </div>
      </Section>

      <Section title="ActionError" description="Under the field or beside the control that failed; alert role.">
        <div className="space-y-3">
          <Specimen caption="with retry">
            <ActionError message={m.op_index_offline()} onRetry={() => undefined} />
          </Specimen>
          <Specimen caption="message only">
            <ActionError message={m.importdlg_blocked_unsupported()} />
          </Specimen>
        </div>
      </Section>

      <Section title="NoticeSlot" description="The template notice slot: one standing page state under the header. Tones info, offline, warning; null renders nothing.">
        <div className="space-y-3">
          <NoticeSlot notice={{ tone: "offline", title: m.run_entry_offline({ name: "Cold-1" }), actions: <Button size="sm" variant="outline">{m.location_rescan()}</Button> }} />
          <NoticeSlot notice={{ tone: "warning", title: m.run_read_only_because({ reason: m.status_archived() }) }} />
          <NoticeSlot notice={{ tone: "info", title: m.import_read_only_source() }} />
          <Specimen caption="null">
            <NoticeSlot notice={null} />
          </Specimen>
        </div>
      </Section>

      <Section title="toast" description="Off-screen outcomes, bottom trailing, announced by the polite viewport region. One follow-up action at most; pauses on hover or focus.">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => toast({ message: m.op_trash_moved() })}>
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            message only
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => toast({ message: m.op_archived_to({ folder: "/Volumes/Cold-1/Archive", frames: "214" }), action: { id: "undo", label: m.wrapup_undo(), run: () => toast({ message: m.status_archived() }) } })}
          >
            <Archive aria-hidden="true" data-icon="inline-start" />
            with Undo
          </Button>
        </div>
      </Section>
    </>
  )
}
