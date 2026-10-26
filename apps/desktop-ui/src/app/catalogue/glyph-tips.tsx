/**
 * Catalogue entry (docs/adr/0002-lock-and-infotip-stay-separate.md): Lock and
 * InfoTip, the two glyph tooltips the ADR keeps apart. Lock labelled with and
 * without a reason, and decorative beside the text that states its reason once;
 * InfoTip with its default and its own label. Captions are reviewer labels.
 */
import { useMessages } from "@/app/preferences"
import { InfoTip } from "@/components/ui/info-tip"
import { Lock } from "@/components/ui/lock"
import { ComponentSection, Specimen } from "./specimen"

export function GlyphTipsCatalogue() {
  const m = useMessages()
  return (
    <ComponentSection components={["Lock", "InfoTip"]} description={m.catalogue_glyph_tips_desc()}>
      <div className="space-y-2">
        <Specimen caption={m.catalogue_glyph_tips_lock_reason()}>
          <span className="inline-flex items-center gap-1 text-sm">
            {m.settings_raw_frames()}
            <Lock reason={m.catalogue_glyph_tips_raw_frames_reason()} />
          </span>
        </Specimen>
        <Specimen caption={m.catalogue_glyph_tips_lock_default()}>
          <span className="inline-flex items-center gap-1 text-sm">
            {m.settings_raw_frames()}
            <Lock />
          </span>
        </Specimen>
        <Specimen caption={m.catalogue_glyph_tips_lock_decorative()}>
          <div className="space-y-1 text-sm">
            <p className="text-muted-foreground">{m.catalogue_glyph_tips_rule()}</p>
            <ul className="space-y-1">
              {[1, 2].map((number) => (
                <li key={number} className="flex items-center gap-1">
                  <Lock decorative />
                  {m.catalogue_glyph_tips_row({ number })}
                </li>
              ))}
            </ul>
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_glyph_tips_info_default()}>
          <span className="inline-flex items-center gap-1 text-sm">
            {m.catalogue_glyph_tips_tolerance()}
            <InfoTip tip={m.catalogue_glyph_tips_tolerance_tip()} />
          </span>
        </Specimen>
        <Specimen caption={m.catalogue_glyph_tips_info_own()}>
          <span className="inline-flex items-center gap-1 text-sm">
            {m.catalogue_glyph_tips_tolerance()}
            <InfoTip tip={m.catalogue_glyph_tips_tolerance_tip()} label={m.catalogue_glyph_tips_tolerance_label()} />
          </span>
        </Specimen>
      </div>
    </ComponentSection>
  )
}
