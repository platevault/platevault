/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): P9 HoverCard previews.
 * Each card opens on hover and on keyboard focus of its trigger and closes on
 * Escape; nothing moves when it opens. Captions are reviewer labels; the
 * blocker and user names and the masters are sample data.
 */
import { Archive } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { BlockersPreview, MasterPreview, Preview, UsedByPreview } from "@/components/app/previews"
import { Button } from "@/components/ui/button"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { ComponentSection, Specimen } from "./specimen"

// eslint-disable-next-line alm/no-user-string -- sample runs: target and filter names with a night
const RUNS = [{ label: "M 42 · Ha · 2026-09-14", link: { to: "/projects" } }, { label: "NGC 7000 · OIII · 2026-09-02", link: { to: "/projects" } }, { label: "IC 1396 · SII · 2026-08-28" }]

// A master dark as the Calibration library records it, and its file name.
const DARK = { kind: "dark", cameraName: "ZWO ASI2600MM Pro", gain: 100, offset: 50, ccdTempC: -10, exposureS: 300, frameCount: 30 } as const
const DARK_FILE = "masterDark_BIN-1_EXPOSURE-300.00s.xisf"

export function PreviewsCatalogue() {
  const m = useMessages()
  return (
    <>
      <ComponentSection components={["BlockersPreview"]} description={m.catalogue_previews_blockers_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_disabled_control()}>
            <BlockersPreview action={m.sessions_cant_archive()} reason={m.refusal_blockers({ count: 2 })} blockers={RUNS.slice(0, 2)}>
              <Button variant="outline" size="sm" disabled focusableWhenDisabled>
                <Archive aria-hidden="true" data-icon="inline-start" />
                {m.wrapup_archive_title()}
              </Button>
            </BlockersPreview>
          </Specimen>
          <Specimen caption={m.catalogue_previews_own_trigger()}>
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
          <Specimen caption={m.catalogue_previews_empty_reason()}>
            <BlockersPreview action={m.trash_cant()} reason={m.wrapup_used_by_other_reason()} blockers={[]} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["UsedByPreview"]} description={m.catalogue_previews_used_by_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_with_users()}>
            <UsedByPreview label={m.calibration_used_by_runs({ count: RUNS.length })} link={{ to: "/projects" }} items={RUNS} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_empty_link()}>
            <UsedByPreview label={m.calibration_used_by_runs({ count: 0 })} link={{ to: "/projects" }} items={[]} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["MasterPreview"]} description={m.catalogue_previews_master_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_master_young()}>
            <MasterPreview label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} night="2026-09-14" age={null} usedBy={2} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_master_old()}>
            <MasterPreview label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} night="2026-05-02" age={m.flow_master_old({ n: 165 })} usedBy={0} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_master_compact()}>
            <MasterPreview compact label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} night="2026-09-14" age={null} usedBy={2} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["Preview", "HoverCard"]} description={m.catalogue_previews_preview_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_with_title()}>
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
      </ComponentSection>
    </>
  )
}
