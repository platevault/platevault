/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): P10 display-only status.
 * StatusBadge for the kinds that absorb GateLabel and T4Badge (the full
 * registry renders on the design-system page), the inert Pill in every tone,
 * and CountBadge. Captions are reviewer labels.
 */
import { Radio } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { CountBadge, Pill } from "@/components/app/pill"
import { STATUS, type StatusKind, StatusBadge, type StatusValue, type Tone } from "@/components/app/status"
import { PROJECT_TAB_NAME } from "@/domain/project-view"
import { say } from "@/lib/i18n"
import { ComponentSection, Specimen } from "./specimen"

const ABSORBED: StatusKind[] = ["gate", "profile", "executable", "check", "write"]
const TONES: Tone[] = ["neutral", "muted", "info", "success", "warning", "danger"]

export function StatusCatalogue() {
  const m = useMessages()
  return (
    <>
      <ComponentSection components={["StatusBadge"]} description={m.catalogue_status_badge_desc()}>
        <div className="space-y-3">
          {ABSORBED.map((kind) => (
            <Specimen key={kind} caption={kind}>
              {(Object.keys(STATUS[kind]) as StatusValue<typeof kind>[]).map((value) => (
                <StatusBadge key={value} kind={kind} value={value} />
              ))}
            </Specimen>
          ))}
          <Specimen caption={m.catalogue_status_label_override()}>
            <StatusBadge kind="gate" value="blocked" label={m.home_blocked_at({ step: say(m, PROJECT_TAB_NAME.calibrate) })} />
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["Pill"]} description={m.catalogue_status_pill_desc()}>
        <div className="space-y-3">
          <Specimen caption={m.catalogue_status_tones()}>
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone}>
                {m.nav_projects()}
              </Pill>
            ))}
          </Specimen>
          <Specimen caption={m.catalogue_status_icon()}>
            <Pill tone="info" icon={Radio}>
              {m.status_detected()}
            </Pill>
          </Specimen>
          <Specimen caption={m.catalogue_status_truncated()}>
            <span className="flex w-24">
              <Pill title={m.apps_badge_writes_unknown()}>{m.apps_badge_writes_unknown()}</Pill>
            </span>
          </Specimen>
        </div>
      </ComponentSection>

      <ComponentSection components={["CountBadge"]} description={m.catalogue_status_count_desc()}>
        <Specimen caption={m.catalogue_status_count_caption()}>
          {TONES.map((tone) => (
            <CountBadge key={tone} tone={tone} count={3} />
          ))}
          <CountBadge count={140} tone="danger" label={m.shell_nav_projects_badge({ count: 140 })} />
        </Specimen>
      </ComponentSection>
    </>
  )
}
