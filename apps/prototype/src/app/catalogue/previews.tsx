/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): P9 HoverCard previews.
 * Each card opens on hover and on keyboard focus of its trigger and closes on
 * Escape; nothing moves when it opens. Captions are reviewer labels; the
 * blocker and user names are sample data.
 */
import { Archive } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { Section } from "@/components/app/page"
import { BlockersPreview, Preview, UsedByPreview } from "@/components/app/previews"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Specimen } from "./specimen"

const RUNS = [
  { label: "M 42 · Ha · 2026-09-14", link: { to: "/projects" } },
  { label: "NGC 7000 · OIII · 2026-09-02", link: { to: "/projects" } },
  { label: "IC 1396 · SII · 2026-08-28" },
]

export function PreviewsCatalogue() {
  const m = useMessages()
  return (
    <>
      <Section title="BlockersPreview" description="Why an action is unavailable. Wrapping a focusable-disabled control, the card restates the control's description; without a control it renders the 'reason ▸' trigger of a Refusal (press moves focus into the card).">
        <div className="space-y-3">
          <Specimen caption="disabled control (hover, focus)">
            <BlockersPreview action={m.sessions_cant_archive()} reason={m.refusal_blockers({ count: 2 })} blockers={RUNS.slice(0, 2)}>
              <Button variant="outline" size="sm" disabled focusableWhenDisabled>
                <Archive aria-hidden="true" data-icon="inline-start" />
                {m.wrapup_archive_title()}
              </Button>
            </BlockersPreview>
          </Specimen>
          <Specimen caption="own trigger + actions">
            <BlockersPreview
              action={m.project_refusal_remove_rig()}
              reason={m.project_used_by_runs({ count: 3 })}
              blockers={RUNS}
              actions={
                <Button size="xs" variant="outline">
                  {m.verb_review()}
                </Button>
              }
            />
          </Specimen>
          <Specimen caption="empty (plain reason, no card)">
            <BlockersPreview action={m.trash_cant()} reason={m.wrapup_used_by_other_reason()} blockers={[]} />
          </Specimen>
        </div>
      </Section>

      <Section title="UsedByPreview" description="'Used by N ▸' is a link to the full list; hover or focus previews the users.">
        <div className="space-y-3">
          <Specimen caption="with users">
            <UsedByPreview label={m.calibration_used_by_runs({ count: RUNS.length })} link={{ to: "/projects" }} items={RUNS} />
          </Specimen>
          <Specimen caption="empty (link only)">
            <UsedByPreview label={m.calibration_used_by_runs({ count: 0 })} link={{ to: "/projects" }} items={[]} />
          </Specimen>
        </div>
      </Section>

      <Section title="Preview · HoverCard" description="Preview is the L2 host the previews share; HoverCard is the L1 primitive on Base UI preview-card.">
        <div className="space-y-3">
          <Specimen caption="Preview with title">
            <Preview title={m.calibration_used_by()} trigger={<Button variant="outline" size="sm">{m.calibration_used_by()}</Button>}>
              <p className="text-muted-foreground">{m.op_trash_moved()}</p>
            </Preview>
          </Specimen>
          <Specimen caption="HoverCard (L1)">
            <HoverCard>
              <HoverCardTrigger render={<Button variant="link" size="xs" />}>{m.common_runs()}</HoverCardTrigger>
              <HoverCardContent>{m.project_used_by_runs({ count: 3 })}</HoverCardContent>
            </HoverCard>
          </Specimen>
        </div>
      </Section>
    </>
  )
}
