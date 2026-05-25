import { Tooltip } from '@base-ui-components/react/tooltip';
import type { ProvenanceOrigin } from '@/bindings/types';

const GLYPH_MAP: Record<ProvenanceOrigin, { glyph: string; label: string }> = {
  reviewed: { glyph: '●', label: 'Reviewed' },
  inferred: { glyph: '◐', label: 'Inferred' },
  observed: { glyph: '○', label: 'Observed' },
  generated: { glyph: '◇', label: 'Generated' },
  planned: { glyph: '▢', label: 'Planned' },
  applied: { glyph: '▣', label: 'Applied' },
};

export interface ProvenanceProps {
  origin: ProvenanceOrigin;
}

export function Provenance({ origin }: ProvenanceProps) {
  const { glyph, label } = GLYPH_MAP[origin];
  return (
    <Tooltip.Provider>
      <Tooltip.Root>
        <Tooltip.Trigger
          className="alm-provenance"
          aria-label={label}
          render={<span />}
        >
          {glyph}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner sideOffset={4}>
            <Tooltip.Popup className="alm-tooltip">
              {label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
