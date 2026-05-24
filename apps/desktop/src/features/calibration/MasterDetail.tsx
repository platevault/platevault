import { useMemo } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { useParameterizedQuery, createParameterizedStore } from '@/data/store';
import { getCalibrationMaster } from '@/api/commands';
import type { MasterDetail as MasterDetailType } from '@/api/types';
import { Box, KV, Pill, DataTable } from '@/ui';

export interface MasterDetailProps {
  masterId: string;
}

const masterDetailStore = createParameterizedStore<string, MasterDetailType>(
  (id) => getCalibrationMaster({ id }),
);

function formatAge(days: number): string {
  if (days >= 365) return `${Math.floor(days / 365)}y`;
  if (days >= 30) return `${Math.floor(days / 30)}mo`;
  return `${days}d`;
}

interface CompatibleSession {
  session_id: string;
  score: number;
  soft_mismatches: string[];
}

export function MasterDetail({ masterId }: MasterDetailProps) {
  const { data, loading, error } = useParameterizedQuery(masterDetailStore, masterId);

  const sessionColumns = useMemo<ColumnDef<CompatibleSession, any>[]>(
    () => [
      {
        accessorKey: 'session_id',
        header: 'Session',
        cell: ({ getValue }) => {
          const id = getValue() as string;
          return <span className="alm-mono">{id.slice(0, 12)}</span>;
        },
      },
      {
        accessorKey: 'score',
        header: 'Score',
        cell: ({ getValue }) => {
          const score = getValue() as number;
          return <span>{(score * 100).toFixed(0)}%</span>;
        },
      },
      {
        accessorKey: 'soft_mismatches',
        header: 'Mismatches',
        cell: ({ getValue }) => {
          const mismatches = getValue() as string[];
          if (mismatches.length === 0) return <span className="alm-text-muted">none</span>;
          return mismatches.join(', ');
        },
      },
    ],
    [],
  );

  if (loading) {
    return <div className="alm-page__loading">Loading master details...</div>;
  }

  if (error) {
    return <div className="alm-page__error">Failed to load master: {error.message}</div>;
  }

  if (!data) {
    return <div className="alm-page__empty">Select a calibration master to view details.</div>;
  }

  const isAging = data.age_days >= 90;

  return (
    <div className="alm-master-detail">
      <Box heading="Fingerprint">
        <KV label="Camera" value={data.fingerprint.camera} origin="observed" />
        {data.fingerprint.sensor_mode && (
          <KV label="Sensor Mode" value={data.fingerprint.sensor_mode} origin="observed" />
        )}
        <KV label="Exposure" value={`${data.fingerprint.exposure_s}s`} origin="observed" />
        {data.fingerprint.temp_c != null && (
          <KV label="Temperature" value={`${data.fingerprint.temp_c}°C`} origin="observed" />
        )}
        <KV label="Gain" value={String(data.fingerprint.gain)} origin="observed" />
        <KV label="Binning" value={data.fingerprint.binning} origin="observed" />
        {data.fingerprint.filter && (
          <KV label="Filter" value={data.fingerprint.filter} origin="observed" />
        )}
      </Box>

      <Box heading="Provenance">
        <KV
          label="Source Session"
          value={
            <span className="alm-mono">{data.source_session_id.slice(0, 12)}</span>
          }
        />
        <KV label="Created" value={data.created_at.split('T')[0]} />
        <KV label="Kind" value={data.kind} />
        <KV
          label="Age"
          value={
            <span className={isAging ? 'alm-text-warn' : undefined}>
              {isAging && '⚠ '}
              {formatAge(data.age_days)}
              {isAging && ' — consider recalibration'}
            </span>
          }
        />
      </Box>

      <Box heading="Usage">
        <KV label="Sessions" value={String(data.usage_stats.session_count)} />
        <KV label="Projects" value={String(data.usage_stats.project_count)} />
      </Box>

      <Box heading="Compatible Sessions">
        {data.compatible_sessions.length > 0 ? (
          <DataTable<CompatibleSession>
            columns={sessionColumns}
            data={data.compatible_sessions}
          />
        ) : (
          <div className="alm-page__empty">No compatible sessions found.</div>
        )}
      </Box>
    </div>
  );
}
