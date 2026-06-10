/**
 * InboxDetail — center pane for the Inbox review/confirm workflow.
 * Design v4: identity header → metric line (frames) → editable properties.
 * The confirm actions live in the right ActionSidebar (3rd pane).
 */

import { DetailHeader, DetailPane, MetricLine } from '@/components';
import { Pill, Banner, Section, Table } from '@/ui';
import type { InboxFixture } from '@/data/fixtures/review';
import type { PillVariant } from '@/ui';

function frameTypeVariant(type: InboxFixture['frameType']): PillVariant {
  switch (type) {
    case 'light':
      return 'info';
    case 'dark':
      return 'neutral';
    case 'flat':
      return 'accent';
    case 'bias':
      return 'ghost';
    default:
      return 'neutral';
  }
}

export interface InboxDetailProps {
  item: InboxFixture;
}

export function InboxDetail({ item }: InboxDetailProps) {
  const title = `${item.target} – ${item.date}${item.filter ? ` – ${item.filter}` : ''}`;

  const propertyColumns = [
    { key: 'property', label: 'Property', style: { width: 140 } },
    { key: 'value', label: 'Value' },
    { key: 'source', label: 'Source', style: { width: 80 } },
    { key: 'confirm', label: 'Confirm', style: { width: 72 } },
  ];

  const gainConflict = item.conflict && /gain/i.test(item.conflict);
  const gainConflictValues = gainConflict ? item.conflict!.replace(/.*gains?:\s*/i, '').trim() : null;

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
      property: gainConflict ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          Gain
          <span style={{ color: 'var(--alm-warn)', fontSize: 'var(--alm-text-xs)' }} aria-label="Conflict">
            &#x26A0;
          </span>
        </span>
      ) : (
        'Gain'
      ),
      value: gainConflict ? (
        <span className="alm-mono" style={{ color: 'var(--alm-warn)' }}>
          {gainConflictValues?.replace(',', ' &')}
        </span>
      ) : (
        <span className="alm-mono">{item.gain}</span>
      ),
      source: 'fits',
      confirm: <input type="checkbox" defaultChecked />,
      _rowClassName: gainConflict ? 'alm-prop-table__row--conflict' : undefined,
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
          <>
            <Pill variant={frameTypeVariant(item.frameType)}>{item.frameType}</Pill>
            {item.filter && <Pill variant="ghost">{item.filter}</Pill>}
          </>
        }
      />

      {item.conflict && (
        <Banner variant="warn" style={{ marginTop: 'var(--alm-sp-3)' }}>
          {item.conflict}
        </Banner>
      )}

      <MetricLine
        metrics={[
          { value: item.frames, label: 'frames' },
          { value: item.duration, label: 'integration' },
          { value: item.size, label: 'on disk' },
          { value: `${item.exposure}s`, label: 'exposure' },
        ]}
      />

      <Section title="Properties">
        <Table columns={propertyColumns} rows={propertyRows} />
      </Section>
    </DetailPane>
  );
}
