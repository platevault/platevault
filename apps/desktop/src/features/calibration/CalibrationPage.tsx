import { useState } from 'react';
import { ThreePane } from '@/ui';
import { masters } from '@/data/fixtures/calibration';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

/**
 * Calibration page — three-pane layout.
 * Left: grouped masters list.
 * Center: selected master detail with toolbar, fingerprint, provenance,
 *         usage, linked projects, compatible sessions.
 * Right: empty (no separate detail pane in the wireframe — the center
 *        pane spans the full remaining width via gridTemplateColumns).
 *
 * Matches wireframe: calibration.jsx
 */
export function CalibrationPage() {
  const [selectedId, setSelectedId] = useState<string>('m-1');
  const [groupValue, setGroupValue] = useState('kind');

  return (
    <div className="alm-page" data-testid="CalibrationPage">
      <ThreePane
        listWidth={220}
        detailWidth={0}
        list={
          <MastersList
            masters={masters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            groupValue={groupValue}
            onGroupChange={setGroupValue}
          />
        }
        content={
          selectedId ? (
            <MasterDetail masterId={selectedId} />
          ) : (
            <div className="alm-page__empty">
              Select a calibration master from the list to view its details.
            </div>
          )
        }
        detail={<div />}
      />
    </div>
  );
}
