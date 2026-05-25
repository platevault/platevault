import { memo } from 'react';
import type { PlanItem, PlanDetail } from '@/api/types';

export interface PlanDiffProps {
  items: PlanItem[];
  summary?: PlanDetail['summary'];
}

// ── Filesystem tree line ────────────────────────────────────────────────────

type FsStatus = 'keep' | 'protected' | 'add' | 'remove' | 'archive' | 'delete';

interface FsLine {
  depth: number;
  name: string;
  status: FsStatus;
  size?: string;
}

const STATUS_STYLES: Record<FsStatus, { glyph: string; color: string; bg: string }> = {
  keep:      { glyph: ' ', color: 'var(--alm-text-secondary)', bg: 'transparent' },
  protected: { glyph: '\u{1F512}', color: 'var(--alm-text-secondary)', bg: 'transparent' },
  add:       { glyph: '+', color: 'var(--alm-ok)', bg: '#eef5e8' },
  remove:    { glyph: '−', color: 'var(--alm-danger)', bg: '#faf0ec' },
  archive:   { glyph: '→', color: 'var(--alm-warn)', bg: '#f8f1d8' },
  delete:    { glyph: '✕', color: 'var(--alm-danger)', bg: '#faf0ec' },
};

function FsLineRow({ depth, name, status, size }: FsLine) {
  const s = STATUS_STYLES[status];
  return (
    <div
      className="alm-diff-line"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        color: s.color,
        background: s.bg,
      }}
    >
      <span className="alm-mono alm-diff-line__glyph">{s.glyph}</span>
      <span className="alm-mono alm-diff-line__name">{name}</span>
      {size && <span className="alm-mono alm-diff-line__size">{size}</span>}
    </div>
  );
}

// ── Static before/after trees (matching wireframe exactly) ──────────────────

const BEFORE_TREE: FsLine[] = [
  { depth: 0, name: 'NGC7000_HOO/', status: 'keep', size: '8.4 GB' },
  { depth: 1, name: '.alm/', status: 'protected' },
  { depth: 1, name: 'sources/', status: 'keep' },
  { depth: 2, name: 'manifests/', status: 'protected' },
  { depth: 2, name: 'views/wbpp_input/', status: 'keep' },
  { depth: 2, name: 'views/wbpp_input_old/', status: 'remove', size: '92 links' },
  { depth: 1, name: 'processing/pixinsight/', status: 'keep', size: '11.4 GB' },
  { depth: 2, name: 'registered/', status: 'remove', size: '11.4 GB' },
  { depth: 3, name: '(92 files)', status: 'remove' },
  { depth: 2, name: 'calibrated/', status: 'remove', size: '11.4 GB' },
  { depth: 2, name: 'drizzle/', status: 'remove', size: '880 MB' },
  { depth: 2, name: 'temp/', status: 'delete', size: '256 MB' },
  { depth: 3, name: '_a3f7.tmp', status: 'delete', size: '64 MB' },
  { depth: 3, name: '_b21c.tmp', status: 'delete', size: '64 MB' },
  { depth: 2, name: 'logs/', status: 'archive' },
  { depth: 3, name: 'wbpp_2025-02-14.log', status: 'archive', size: '2.4 MB' },
  { depth: 3, name: 'wbpp_2025-02-15.log', status: 'archive', size: '1.8 MB' },
  { depth: 2, name: 'process_icons/', status: 'keep' },
  { depth: 1, name: 'outputs/', status: 'protected', size: '512 MB' },
  { depth: 1, name: 'notes/', status: 'protected' },
];

const AFTER_TREE: FsLine[] = [
  { depth: 0, name: 'NGC7000_HOO/', status: 'keep', size: '6.3 GB' },
  { depth: 1, name: '.alm/', status: 'protected' },
  { depth: 1, name: 'sources/', status: 'keep' },
  { depth: 2, name: 'manifests/', status: 'protected' },
  { depth: 2, name: 'views/wbpp_input/', status: 'keep' },
  { depth: 1, name: 'processing/pixinsight/', status: 'keep' },
  { depth: 2, name: 'process_icons/', status: 'keep' },
  { depth: 1, name: 'archive/', status: 'add' },
  { depth: 2, name: 'logs/', status: 'add' },
  { depth: 3, name: 'wbpp_2025-02-14.log', status: 'add', size: '2.4 MB' },
  { depth: 3, name: 'wbpp_2025-02-15.log', status: 'add', size: '1.8 MB' },
  { depth: 1, name: 'outputs/', status: 'protected', size: '512 MB' },
  { depth: 1, name: 'notes/', status: 'protected' },
];

// ── Component ───────────────────────────────────────────────────────────────

export const PlanDiff = memo(function PlanDiff({ items, summary }: PlanDiffProps) {
  // In a real implementation, trees would be derived from items.
  // For now, use the static wireframe data.

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Legend */}
      <div className="alm-diff-legend">
        <span>&minus; removed</span>
        <span>+ added</span>
        <span>&rarr; archived</span>
        <span>&times; deleted</span>
        <span>&#x1F512; protected</span>
      </div>

      {/* Side-by-side diff */}
      <div className="alm-diff-grid">
        {/* Before column */}
        <div className="alm-diff-col alm-diff-col--before">
          <div className="alm-diff-col__header">
            BEFORE &mdash; current filesystem (8.4 GB)
          </div>
          {BEFORE_TREE.map((line, i) => (
            <FsLineRow key={`b-${i}`} {...line} />
          ))}
        </div>

        {/* After column */}
        <div className="alm-diff-col">
          <div className="alm-diff-col__header">
            AFTER &mdash; projected state (6.3 GB &middot; &minus;2.1 GB)
          </div>
          {AFTER_TREE.map((line, i) => (
            <FsLineRow key={`a-${i}`} {...line} />
          ))}
          <div className="alm-diff-col__footer">
            + 1 dir added &middot; &minus; 4 dirs removed &middot; 2 files moved to archive &middot; 4 files permanently deleted
          </div>
        </div>
      </div>
    </div>
  );
});
