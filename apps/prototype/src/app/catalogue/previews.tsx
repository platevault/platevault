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

// eslint-disable-next-line alm/no-user-string -- sample Projects: Target and filter names with a night
const PROJECTS = [{ label: "M 42 · Ha · 2026-09-14", link: { to: "/projects" } }, { label: "NGC 7000 · OIII · 2026-09-02", link: { to: "/projects" } }, { label: "IC 1396 · SII · 2026-08-28" }]

// A master dark as the Calibration library records it, with two dated versions, and its file name.
const OLDER = { id: "mv_older", capturedAt: "2026-05-02T22:10:00.000Z", frameCount: 30, origin: { kind: "library", projectId: null, sourcePath: "", sessionId: null } } as const
const NEWER = { id: "mv_newer", capturedAt: "2026-09-14T21:40:00.000Z", frameCount: 40, origin: { kind: "stacked", projectId: null, sourcePath: "", sessionId: null } } as const
const DARK = { kind: "dark", cameraName: "ZWO ASI2600MM Pro", gain: 100, offset: 50, ccdTempC: -10, exposureS: 300, versions: [OLDER, NEWER] } as const
/** The same settings with only the May version: its newest version is past the age limit. */
const OLD_DARK = { ...DARK, versions: [OLDER] } as const
const DARK_FILE = "masterDark_BIN-1_EXPOSURE-300.00s.xisf"

export function PreviewsCatalogue() {
  const m = useMessages()
  return (
    <>
      <ComponentSection components={["BlockersPreview"]} description={m.catalogue_previews_blockers_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_disabled_control()}>
            <BlockersPreview action={m.sessions_cant_archive()} reason={m.refusal_blockers({ count: 2 })} blockers={PROJECTS.slice(0, 2)}>
              <Button variant="outline" size="sm" disabled focusableWhenDisabled>
                <Archive aria-hidden="true" data-icon="inline-start" />
                {m.wrapup_archive_title()}
              </Button>
            </BlockersPreview>
          </Specimen>
          <Specimen caption={m.catalogue_previews_own_trigger()}>
            <BlockersPreview
              action={m.project_refusal_remove_rig()}
              reason={m.equipment_used_by_projects({ count: 3 })}
              blockers={PROJECTS}
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
            <UsedByPreview label={m.equipment_used_by_projects({ count: PROJECTS.length })} link={{ to: "/projects" }} items={PROJECTS} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_empty_link()}>
            <UsedByPreview label={m.equipment_used_by_projects({ count: 0 })} link={{ to: "/projects" }} items={[]} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["MasterPreview"]} description={m.catalogue_previews_master_version_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_previews_master_newer()}>
            <MasterPreview label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} version={NEWER} age={null} usedBy={2} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_master_older()}>
            <MasterPreview label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} version={OLDER} age={null} usedBy={2} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_master_old_only()}>
            <MasterPreview label={DARK_FILE} link={{ to: "/calibration" }} master={OLD_DARK} version={OLDER} age={m.flow_master_old({ n: 165 })} usedBy={0} />
          </Specimen>
          <Specimen caption={m.catalogue_previews_master_compact()}>
            <MasterPreview compact label={DARK_FILE} link={{ to: "/calibration" }} master={DARK} version={NEWER} age={null} usedBy={2} />
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
              <HoverCardTrigger render={<Button variant="link" size="xs" />}>{m.nav_projects()}</HoverCardTrigger>
              <HoverCardContent>{m.equipment_used_by_projects({ count: 3 })}</HoverCardContent>
            </HoverCard>
          </Specimen>
        </div>
      </ComponentSection>
    </>
  )
}
