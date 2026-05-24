import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQuery, createQueryStore } from '@/data/store';
import { listCalibrationMasters } from '@/api/commands';
import { ThreePane, EmptyState } from '@/ui';
import { MastersList } from './MastersList';
import { MasterDetail } from './MasterDetail';

const mastersStore = createQueryStore(() => listCalibrationMasters());

export function CalibrationPage() {
  const { data, loading } = useQuery(mastersStore);
  const navigate = useNavigate();

  // Try to pick up $id from route params (for /calibration/$id)
  const params = useParams({ strict: false }) as { id?: string };
  const [localSelectedId, setLocalSelectedId] = useState<string | undefined>(undefined);

  const selectedId = params.id ?? localSelectedId;

  function handleSelect(id: string) {
    setLocalSelectedId(id);
    navigate({ to: '/calibration/$id', params: { id } });
  }

  if (loading) {
    return <div className="alm-page alm-page__loading">Loading calibration masters...</div>;
  }

  if (!data || data.length === 0) {
    return (
      <div className="alm-page" data-testid="CalibrationPage">
        <EmptyState
          title="No calibration masters found"
          description="Calibration masters will appear here once they are identified from your library scans."
        />
      </div>
    );
  }

  return (
    <div className="alm-page" data-testid="CalibrationPage">
      <ThreePane
        list={
          <MastersList
            masters={data ?? []}
            selectedId={selectedId}
            onSelect={handleSelect}
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
