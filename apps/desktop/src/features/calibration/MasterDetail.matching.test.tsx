/// <reference types="@testing-library/jest-dom" />
/**
 * MasterDetail — matching hero wiring (dead-feature fix).
 *
 * `MatchCandidatesPanel` (ranked calibration-master candidates + assign/cancel)
 * was fully built and unit-tested but mounted by no page — `CalibrationPage`
 * rendered only `MastersTable` + `MasterDetail`, so the match/assign flow was
 * unreachable in the real app. This proves MasterDetail now mounts the panel
 * for the selected master's matching-context session (its first
 * `usedBySessionIds` entry — the real, populated field; `compatibleSessions`
 * is still an unpopulated backend stub) and that the assign action reaches
 * the real `calibration.match.assign` IPC command.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MasterDetail } from './MasterDetail';
import { commands } from '@/bindings/index';
import type { CalibrationMaster_Serialize as CalibrationMaster } from '@/bindings/index';

const MASTER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SESSION_ID = 'ses-001';

vi.mock('@/bindings/index', () => ({
  commands: {
    calibrationMastersGet: vi.fn(),
    sessionsList: vi.fn(),
    calibrationMatchSuggest: vi.fn(),
    calibrationMatchAssign: vi.fn(),
  },
}));

function makeMaster(overrides: Partial<CalibrationMaster> = {}): CalibrationMaster {
  return {
    id: MASTER_ID,
    kind: 'dark',
    fingerprint: { camera: 'ASI2600MM', exposureS: 300, tempC: -10, gain: 100, binning: '1x1' },
    sourceSessionId: 'cal-ses-001',
    createdAt: '2026-01-01T00:00:00Z',
    ageDays: 30,
    sizeBytes: 128 * 1024 * 1024,
    usedBySessionIds: [SESSION_ID],
    usedByProjectIds: [],
    ...overrides,
  };
}

const suggestResponse = {
  status: 'success',
  contractVersion: '2.0.0',
  requestId: 'req-001',
  suggestStatus: 'match',
  matches: [
    {
      sessionId: SESSION_ID,
      masterId: MASTER_ID,
      calibrationType: 'dark',
      confidence: 1.0,
      dimensionsMatched: [],
      dimensionsMismatched: [],
      selectionReason: 'same_session',
    },
  ],
};

beforeEach(() => {
  vi.mocked(commands.calibrationMastersGet).mockResolvedValue({
    status: 'ok',
    data: { usedBySessionIds: [SESSION_ID], compatibleSessions: [] },
  } as never);
  vi.mocked(commands.sessionsList).mockResolvedValue({ status: 'ok', data: [] } as never);
  vi.mocked(commands.calibrationMatchSuggest).mockResolvedValue({
    status: 'ok',
    data: suggestResponse,
  } as never);
  vi.mocked(commands.calibrationMatchAssign).mockResolvedValue({
    status: 'ok',
    data: {
      status: 'success',
      contractVersion: '2.0.0',
      requestId: 'req-002',
      assigned: null,
      confidence: null,
      error: null,
    },
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MasterDetail — matching hero (dead-feature fix)', () => {
  it('mounts MatchCandidatesPanel and calls calibration.match.suggest for the matching-context session', async () => {
    render(<MasterDetail master={makeMaster()} prefillSuggestion={false} agingThresholdDays={90} />);

    await waitFor(() => {
      expect(commands.calibrationMatchSuggest).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID }),
      );
    });
    expect(await screen.findByTestId('suggest-status-pill')).toBeInTheDocument();
    expect(screen.getByTestId(`assign-btn-${MASTER_ID}`)).toBeInTheDocument();
  });

  it('confirming assign calls calibration.match.assign with the matching sessionId/masterId', async () => {
    render(<MasterDetail master={makeMaster()} prefillSuggestion={false} agingThresholdDays={90} />);

    fireEvent.click(await screen.findByTestId(`assign-btn-${MASTER_ID}`));
    fireEvent.click(screen.getByTestId('assign-confirm-btn'));

    await waitFor(() => {
      expect(commands.calibrationMatchAssign).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: SESSION_ID, masterId: MASTER_ID, override: false }),
      );
    });
    // A successful assign refreshes the suggest query (1 initial mount fetch +
    // 1 post-assign refresh) — wait for it to settle so it can't bleed into
    // the next test's call-count assertions.
    await waitFor(() => {
      expect(commands.calibrationMatchSuggest).toHaveBeenCalledTimes(2);
    });
  });

  it('shows the "not assigned to a session" empty state and skips suggest when the master has no used sessions', async () => {
    render(
      <MasterDetail
        master={makeMaster({ usedBySessionIds: [] })}
        prefillSuggestion={false}
        agingThresholdDays={90}
      />,
    );

    expect(await screen.findByText('Not assigned to a session')).toBeInTheDocument();
    expect(commands.calibrationMatchSuggest).not.toHaveBeenCalled();
  });
});
