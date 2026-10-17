/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3): data display. KeyValueList
 * with source notes, a PathText and an UnknownValue with its reason; Stat;
 * ChannelCoverage against a goal; EvidenceList of a session's Target; and
 * FilterChips, whose chips can be removed and cleared. Every visible string
 * comes from the message catalogue.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ChannelCoverage, FilterChips, KeyValueList, PathText, Stat } from "@/components/app/data"
import { EvidenceList } from "@/components/app/evidence-list"
import { UnknownValue } from "@/components/app/feedback"
import { Section } from "@/components/app/page"
import { emptyBreakdown, sessionBreakdown } from "@/domain/library"
import { formatDuration, formatExposure } from "@/lib/format"
import { useStore } from "@/store/core"

type ChipId = "ha" | "object" | "unreviewed"

export function DataCatalogue() {
  const m = useMessages()
  // Chip ids live in state; their labels are worded at render, so a language switch re-words them.
  const [chipIds, setChipIds] = useState<ChipId[]>(["ha", "object", "unreviewed"])
  const chipLabel: Record<ChipId, string> = {
    ha: m.ds_chip_channel({ channel: "Ha" }),
    object: m.palette_session_missing_object(),
    unreviewed: m.ds_chip_quality({ quality: m.status_unreviewed() }),
  }
  const chips = chipIds.map((id) => ({ id, label: chipLabel[id] }))
  const sample = useStore((s) => Object.values(s.catalog.sessions).find((x) => x.target.status === "needs-review") ?? Object.values(s.catalog.sessions)[0])
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const breakdown = sample ? sessionBreakdown(disk, catalog, sample) : emptyBreakdown()
  return (
    <Section title={m.ds_data_title()}>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <KeyValueList
            items={[
              { label: m.location_path(), value: <PathText path="/Volumes/Astro-T7/Captures/NGC7000/2026-09-30/OIII" />, mono: false },
              { label: m.run_col_channel(), value: "OIII", source: m.session_header_source({ keyword: "FILTER" }) },
              { label: m.session_column_exposure(), value: formatExposure(300), source: m.session_header_source({ keyword: "EXPTIME" }) },
              { label: m.ds_pixel_scale(), value: <UnknownValue label={m.ds_fov_unknown()} reason={m.ds_equipment_not_confirmed()} /> },
            ]}
          />
          <div className="flex gap-8">
            <Stat label={m.review_member_included()} value={m.ds_lights_count({ count: 208 })} hint={formatDuration(62_400)} />
            <Stat label={m.status_excluded_from_view()} value="6" hint={m.ds_files_stay()} />
            <Stat label={m.status_unresolved()} value="0" />
          </div>
          <ChannelCoverage channel={sample?.channel ?? "Ha"} breakdown={breakdown} goalS={10 * 3600} />
        </div>
        <div className="space-y-3">
          {sample ? <EvidenceList evidence={sample.target.evidence} caption={m.ds_evidence_caption()} /> : null}
          <FilterChips
            chips={chips}
            onRemove={(id) => setChipIds((ids) => ids.filter((chip) => chip !== id))}
            onClear={() => setChipIds([])}
            matchLabel={`${m.ds_matching_sessions({ count: 1 })} · ${m.table_selection_hidden({ count: 3, n: "3" })}`}
          />
        </div>
      </div>
    </Section>
  )
}
