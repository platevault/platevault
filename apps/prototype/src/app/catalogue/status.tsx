/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): P10 display-only status.
 * StatusBadge for the kinds that absorb GateLabel and T4Badge (the full
 * registry renders on the design-system page), the inert Pill in every tone,
 * and CountBadge. Captions are reviewer labels.
 */
import { Radio } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { stepName } from "@/app/run-ui"
import { Section } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { STATUS, type StatusKind, StatusBadge, type StatusValue, type Tone } from "@/components/app/status"
import { Specimen } from "./specimen"

const ABSORBED: StatusKind[] = ["gate", "profile", "executable", "check", "write", "preparation"]
const TONES: Tone[] = ["neutral", "muted", "info", "success", "warning", "danger"]

export function StatusCatalogue() {
  const m = useMessages()
  return (
    <>
      <Section title="StatusBadge" description="Glyph plus word from the one STATUS registry. gate replaces GateLabel; profile, executable, check, write and preparation:unverified replace T4Badge.">
        <div className="space-y-3">
          {ABSORBED.map((kind) => (
            <Specimen key={kind} caption={kind}>
              {(Object.keys(STATUS[kind]) as StatusValue<typeof kind>[]).map((value) => (
                <StatusBadge key={value} kind={kind} value={value} />
              ))}
            </Specimen>
          ))}
          <Specimen caption="label override">
            <StatusBadge kind="gate" value="blocked" label={m.home_blocked_at({ step: stepName(m, "calibrate") })} />
          </Specimen>
        </div>
      </Section>

      <Section title="Pill" description="An inert tag (channel, band, kind): no link, no button, no hover. Tone text over its own tint.">
        <div className="space-y-3">
          <Specimen caption="tones">
            {TONES.map((tone) => (
              <Pill key={tone} tone={tone}>
                {m.common_runs()}
              </Pill>
            ))}
          </Specimen>
          <Specimen caption="icon">
            <Pill tone="info" icon={Radio}>
              {m.status_detected()}
            </Pill>
          </Specimen>
          <Specimen caption="truncated (title = full text)">
            <span className="flex w-24">
              <Pill title={m.apps_badge_writes_unknown()}>{m.apps_badge_writes_unknown()}</Pill>
            </span>
          </Specimen>
        </div>
      </Section>

      <Section title="CountBadge" description="A small number, capped at 99+, with an optional screen-reader label.">
        <Specimen caption="tones · cap · label">
          {TONES.map((tone) => (
            <CountBadge key={tone} tone={tone} count={3} />
          ))}
          <CountBadge count={140} tone="danger" label={m.rungroup_blocked_count({ count: 140 })} />
        </Specimen>
      </Section>
    </>
  )
}
