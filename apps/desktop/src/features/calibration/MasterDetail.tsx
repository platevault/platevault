import { useEffect } from 'react';
import { Box, KV, Pill, Btn, Confidence, Lock, Toolbar } from '@/ui';
import {
  focusedMaster,
  masters,
  calibrationSummary,
  type CalibrationMasterFixture,
} from '@/data/fixtures/calibration';
import { useRevealInOs, copyToClipboard } from '@/shared/native/reveal';
import { addToast } from '@/shared/toast';

export interface MasterDetailProps {
  masterId: string;
}

/**
 * Main content pane for a selected calibration master.
 * Includes toolbar with tabs, detail header with lock/pills/actions,
 * three-column box grid (fingerprint, provenance, usage),
 * linked-projects table, and compatible-sessions table.
 *
 * Matches wireframe: calibration.jsx detail area.
 */
export function MasterDetail({ masterId }: MasterDetailProps) {
  // Look up the fixture master; fall back to focusedMaster for m-1
  const masterListItem: CalibrationMasterFixture | undefined =
    masters.find((m) => m.id === masterId);
  const detail = masterId === 'm-1' ? focusedMaster : null;

  const { reveal, error: revealError } = useRevealInOs();

  // Surface reveal errors as toasts with "Copy path" action (T029)
  useEffect(() => {
    if (revealError) {
      addToast({
        message: revealError.message,
        variant: 'error',
        duration: 8000,
        action: {
          label: 'Copy path',
          onClick: () => {
            void copyToClipboard(revealError.path);
          },
        },
      });
    }
  }, [revealError]);

  if (!masterListItem) {
    return (
      <div className="alm-page__empty">
        Select a calibration master to view details.
      </div>
    );
  }

  // For non-m-1 masters show a simpler view with available data
  const name = detail?.name ?? masterListItem.name;
  const kind = detail?.kind ?? masterListItem.kind;
  const conf = detail?.conf ?? masterListItem.conf;

  return (
    <div className="alm-master-detail">
      {/* Toolbar with tabs and actions */}
      <Toolbar
        subBar={
          <div className="alm-master-detail__sub">
            <span>
              {calibrationSummary.totalMasters} masters tracked · {calibrationSummary.darks} darks · {calibrationSummary.flats} flats · {calibrationSummary.bias} bias
            </span>
            <span className="alm-master-detail__sub-sep">·</span>
            <span>{calibrationSummary.agingCount} masters older than 90d</span>
            <span className="alm-master-detail__sub-note">
              Masters are tracked, not produced — generate them in PixInsight
            </span>
          </div>
        }
      >
        <Btn size="sm" active>Masters</Btn>
        <Btn size="sm">Calibration sessions</Btn>
        <Btn size="sm">Match candidates</Btn>
        <div style={{ flex: 1 }} />
        <Btn size="sm">Import master…</Btn>
        <Btn size="sm">Re-run matching</Btn>
      </Toolbar>

      <div className="alm-master-detail__body">
        {/* Detail header */}
        <div className="alm-master-detail__header">
          <div className="alm-master-detail__header-left">
            <Lock />
            <h2 className="alm-master-detail__name alm-mono">{name}</h2>
            <Pill
              label={`MASTER · ${kind.toUpperCase()}`}
              variant="info"
              size="sm"
            />
            <Confidence level={conf} />
          </div>
          <div className="alm-master-detail__header-actions">
            <Btn
              size="sm"
              onClick={() => {
                const masterPath = detail
                  ? detail.path
                  : `${masterListItem.name}.xisf`;
                void reveal(masterPath, {
                  entityKind: 'master_calibration',
                  entityId: masterId,
                });
              }}
            >
              Reveal in Explorer
            </Btn>
            <Btn size="sm">Use in project →</Btn>
            <Btn size="sm">Mark superseded</Btn>
          </div>
        </div>

        {/* Path / size */}
        <div className="alm-master-detail__path alm-mono">
          {detail
            ? `${detail.path} · ${focusedMaster.size} · created from ${detail.sourceSession}`
            : `${masterListItem.name}.xisf · ${masterListItem.size}`}
        </div>

        {/* Three-column box grid */}
        {detail && (
          <div className="alm-master-detail__grid-3">
            <Box heading="Compatibility fingerprint">
              {detail.fingerprint.map((row) => (
                <KV key={row.k} label={row.k} value={row.v} origin={row.prov} />
              ))}
            </Box>

            <Box heading="Provenance">
              {detail.provenance.map((row) => (
                <KV
                  key={row.k}
                  label={row.k}
                  value={
                    row.mono ? (
                      <span className="alm-mono" style={{ fontSize: 10 }}>
                        {row.v}
                      </span>
                    ) : (
                      row.v
                    )
                  }
                  origin={row.prov}
                />
              ))}
            </Box>

            <Box heading="Usage">
              <div className="alm-master-detail__usage-stats">
                <div className="alm-master-detail__usage-stat">
                  <div className="alm-master-detail__usage-num alm-mono">
                    {detail.sessions}
                  </div>
                  <div className="alm-master-detail__usage-label">
                    acquisition sessions matched
                  </div>
                </div>
                <div className="alm-master-detail__usage-stat">
                  <div className="alm-master-detail__usage-num alm-mono">
                    {detail.projects}
                  </div>
                  <div className="alm-master-detail__usage-label">
                    projects use this master
                  </div>
                </div>
              </div>
              <div className="alm-master-detail__usage-last">
                Last used by project:
              </div>
              <div className="alm-mono" style={{ fontSize: 11 }}>
                {detail.lastUsedProject}
              </div>
              <Btn size="sm" onClick={() => {}}>
                See all usage →
              </Btn>
            </Box>
          </div>
        )}

        {/* Linked projects table */}
        {detail && (
          <div className="alm-master-detail__section">
            <div className="alm-master-detail__section-header">
              <div>
                <h3 className="alm-master-detail__section-title">
                  Linked to projects
                </h3>
                <span className="alm-master-detail__section-sub">
                  acquisition sessions whose project source map includes this master
                </span>
              </div>
              <Btn size="sm">+ Add to project…</Btn>
            </div>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Workflow profile</th>
                  <th>Lifecycle</th>
                  <th>Role</th>
                  <th>Selected by</th>
                  <th>Selected at</th>
                </tr>
              </thead>
              <tbody>
                {detail.linkedProjects.map((p) => (
                  <tr key={p.project}>
                    <td>
                      <strong>{p.project}</strong>
                    </td>
                    <td>{p.workflowProfile}</td>
                    <td>
                      <Pill
                        label={p.lifecycle}
                        variant={p.lifecycleVariant}
                        size="sm"
                      />
                    </td>
                    <td>{p.role}</td>
                    <td style={{ fontSize: 11 }}>{p.selectedBy}</td>
                    <td className="alm-mono" style={{ fontSize: 11 }}>
                      {p.selectedAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Compatible sessions table */}
        {detail && (
          <div className="alm-master-detail__section">
            <div className="alm-master-detail__section-header">
              <div>
                <h3 className="alm-master-detail__section-title">
                  Compatible acquisition sessions
                </h3>
                <span className="alm-master-detail__section-sub">
                  sessions whose fingerprint matches this master (score ≥ 0.6)
                </span>
              </div>
              <Btn size="sm">Match all →</Btn>
            </div>
            <table className="alm-simple-table">
              <thead>
                <tr>
                  <th style={{ width: 24 }}></th>
                  <th>Session</th>
                  <th>Frames</th>
                  <th>Score</th>
                  <th>Soft mismatches</th>
                  <th>Decision</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {detail.compatibleSessions.map((s) => (
                  <tr key={s.session}>
                    <td>
                      {s.check === 'ok' ? (
                        <span style={{ color: 'var(--alm-ok)' }}>✓</span>
                      ) : (
                        <span style={{ color: 'var(--alm-warn)' }}>~</span>
                      )}
                    </td>
                    <td>
                      <strong>{s.session}</strong>
                    </td>
                    <td className="alm-mono" style={{ fontSize: 11 }}>
                      {s.frames}
                    </td>
                    <td className="alm-mono" style={{ fontSize: 11 }}>
                      {s.score.toFixed(2)}
                    </td>
                    <td
                      style={{
                        fontSize: 11,
                        color:
                          s.softMismatches === '—'
                            ? 'var(--alm-text-faint)'
                            : 'var(--alm-warn)',
                      }}
                    >
                      {s.softMismatches}
                    </td>
                    <td>
                      <Pill
                        label={s.decision}
                        variant={s.decision === 'accepted' ? 'ok' : 'warn'}
                        size="sm"
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Btn size="sm">Override…</Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Fallback for non-detailed masters */}
        {!detail && (
          <div className="alm-master-detail__grid-3" style={{ marginTop: 14 }}>
            <Box heading="Summary">
              <KV label="Kind" value={kind} />
              <KV label="Exposure" value={masterListItem.exp} />
              <KV label="Temperature" value={masterListItem.temp} />
              <KV label="Gain" value={masterListItem.gain} />
              <KV label="Camera" value={masterListItem.cam} />
              <KV label="Age" value={masterListItem.age} />
              <KV label="Size" value={masterListItem.size} />
            </Box>
            <Box heading="Usage">
              <KV label="Sessions" value={String(masterListItem.sessions)} />
              <KV label="Projects" value={String(masterListItem.projects)} />
            </Box>
          </div>
        )}
      </div>
    </div>
  );
}
