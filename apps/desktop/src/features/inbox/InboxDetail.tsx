/**
 * InboxDetail -- center pane for Inbox page.
 * Shows session properties (visual only) + frames summary.
 * Design V3 rewrite.
 */

import { DetailHeader, DetailPane } from '@/components';
import { Pill, Banner, Box, Table } from '@/ui';
import type { InboxFixture } from '@/data/fixtures/review';
import type { PillVariant } from '@/ui';

// ─── Helpers ────────────────────────────────────────────────────────────────

function frameTypeVariant(type: InboxFixture['frameType']): PillVariant {
  switch (type) {
    case 'light': return 'info';
    case 'dark': return 'neutral';
    case 'flat': return 'accent';
    case 'bias': return 'ghost';
    default: return 'neutral';
  }
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InboxDetailProps {
  item: InboxFixture;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function InboxDetail({ item }: InboxDetailProps) {
  const title = `${item.target} – ${item.date}${item.filter ? ` – ${item.filter}` : ''}`;

  const propertyColumns = [
    { key: 'property', label: 'Property', style: { width: 140 } },
    { key: 'value', label: 'Value' },
    { key: 'source', label: 'Source', style: { width: 80 } },
    { key: 'confirm', label: 'Confirm', style: { width: 72 } },
  ];

  const propertyRows = [
    {
      property: 'Object',
      value: <input className="alm-input alm-input--sm" defaultValue={item.target} />,
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked={item.frameType !== 'dark' && item.frameType !== 'bias'} />,
    },
    {
      property: 'Frame Type',
      value: (
        <select className="alm-select alm-select--sm" defaultValue={item.frameType}>
          <option value="light">light</option>
          <option value="dark">dark</option>
          <option value="flat">flat</option>
          <option value="bias">bias</option>
          <option value="dark_flat">dark_flat</option>
        </select>
      ),
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked />,
    },
    {
      property: 'Filter',
      value: (
        <select className="alm-select alm-select--sm" defaultValue={item.filter || '--'}>
          <option value="Ha">Ha</option>
          <option value="OIII">OIII</option>
          <option value="SII">SII</option>
          <option value="L">L</option>
          <option value="R">R</option>
          <option value="G">G</option>
          <option value="B">B</option>
          <option value="--">--</option>
        </select>
      ),
      source: 'fits',
      confirm: <input type="checkbox" />,
    },
    {
      property: 'Gain',
      value: <span className="alm-mono">{item.gain}</span>,
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked />,
    },
    {
      property: 'Binning',
      value: (
        <select className="alm-select alm-select--sm" defaultValue="1×1">
          <option>1×1</option>
          <option>2×2</option>
          <option>3×3</option>
          <option>4×4</option>
        </select>
      ),
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked />,
    },
    {
      property: 'Exposure',
      value: <span className="alm-mono">{item.exposure}s</span>,
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked />,
    },
    {
      property: 'Temperature',
      value: <input className="alm-input alm-input--sm" defaultValue="-10°C" />,
      source: 'fits',
      confirm: <input type="checkbox" />,
    },
    {
      property: 'Set Temperature',
      value: <input className="alm-input alm-input--sm" defaultValue="-10°C" />,
      source: 'fits',
      confirm: <input type="checkbox" />,
    },
  ];

  return (
    <DetailPane>
      <DetailHeader
        title={title}
        titleExtra={
          <span style={{ marginLeft: 8, display: 'inline-flex', gap: 4 }}>
            <Pill variant={frameTypeVariant(item.frameType)}>{item.frameType}</Pill>
            {item.filter && <span style={{ marginLeft: 4 }}><Pill variant="ghost">{item.filter}</Pill></span>}
          </span>
        }
      />

      {/* Conflict banner */}
      {item.conflict && (
        <Banner variant="warn" style={{ margin: '12px 16px 0' }}>
          {item.conflict}
        </Banner>
      )}

      {/* Properties */}
      <Box title="Properties" style={{ margin: 16 }}>
        <Table columns={propertyColumns} rows={propertyRows} />
      </Box>

      {/* Frames */}
      <Box title="Frames" style={{ margin: '0 16px 16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, padding: '12px 0 4px' }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600 }}>{item.frames}</div>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-color-fg-muted)' }}>Count</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600 }}>{item.duration}</div>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-color-fg-muted)' }}>Total integration</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 'var(--alm-text-lg)', fontWeight: 600 }}>{item.size}</div>
            <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-color-fg-muted)' }}>Total size</div>
          </div>
        </div>
      </Box>
    </DetailPane>
  );
}
