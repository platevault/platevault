/**
 * ContractsPage vitest unit tests (spec 021 T010).
 *
 * Tests:
 * - Renders the "developer mode disabled" stub when devMode = false.
 * - Renders contract list when devMode = true.
 * - Renders recorded calls when devMode = true.
 * - Export button visible when devMode = true.
 * - Does not subscribe to calls when devMode = false.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ContractsPage } from './ContractsPage';

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/api/commands', () => ({
  getSettings: vi.fn(),
  devContractsList: vi.fn(),
  devCallsList: vi.fn(),
  devExport: vi.fn(),
  devSchemaGet: vi.fn(),
}));

import {
  getSettings,
  devContractsList,
  devCallsList,
  devExport,
} from '@/api/commands';

const mockGetSettings = vi.mocked(getSettings);
const mockDevContractsList = vi.mocked(devContractsList);
const mockDevCallsList = vi.mocked(devCallsList);
const mockDevExport = vi.mocked(devExport);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function _settingsResponse(devMode: boolean) {
  return {
    scope: 'advanced',
    values: { devMode, logLevel: 'info' },
  } as Parameters<typeof getSettings>[0] extends never ? never : Awaited<ReturnType<typeof getSettings>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: devMode off.
  mockGetSettings.mockResolvedValue({
    scope: 'advanced',
    values: { devMode: false, logLevel: 'info' },
  });
  mockDevContractsList.mockResolvedValue({ contracts: [] });
  mockDevCallsList.mockResolvedValue({ calls: [] });
  mockDevExport.mockResolvedValue({ writtenPath: '/tmp/out.json', callCount: 0, contractCount: 0 });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ContractsPage (T010)', () => {
  it('renders "developer mode disabled" stub when devMode = false', async () => {
    render(<ContractsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('dev-disabled-stub')).toBeTruthy();
    });
  });

  it('does not call devContractsList when devMode = false', async () => {
    render(<ContractsPage />);
    await waitFor(() => screen.getByTestId('dev-disabled-stub'));
    expect(mockDevContractsList).not.toHaveBeenCalled();
  });

  it('does not call devCallsList when devMode = false', async () => {
    render(<ContractsPage />);
    await waitFor(() => screen.getByTestId('dev-disabled-stub'));
    expect(mockDevCallsList).not.toHaveBeenCalled();
  });

  it('renders contract list when devMode = true', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { devMode: true },
    });

    mockDevContractsList.mockResolvedValue({
      contracts: [
        {
          name: 'sessions.list',
          version: '1.0.0',
          schemaPath: '',
          direction: 'ui-to-core',
          replaySafe: true,
        },
      ],
    });
    mockDevCallsList.mockResolvedValue({ calls: [] });

    render(<ContractsPage />);

    await waitFor(() => {
      expect(screen.getByText('sessions.list')).toBeTruthy();
    });
  });

  it('shows contract count heading when devMode = true', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { devMode: true },
    });
    mockDevContractsList.mockResolvedValue({
      contracts: [
        {
          name: 'dev.contracts.list',
          version: '1.0.0',
          schemaPath: '',
          direction: 'ui-to-core',
          replaySafe: true,
        },
        {
          name: 'dev.calls.list',
          version: '1.0.0',
          schemaPath: '',
          direction: 'ui-to-core',
          replaySafe: true,
        },
      ],
    });
    mockDevCallsList.mockResolvedValue({ calls: [] });

    render(<ContractsPage />);

    await waitFor(() => {
      expect(screen.getByText(/Contracts \(2\)/i)).toBeTruthy();
    });
  });

  it('shows Export button when devMode = true', async () => {
    mockGetSettings.mockResolvedValue({
      scope: 'advanced',
      values: { devMode: true },
    });
    mockDevContractsList.mockResolvedValue({ contracts: [] });
    mockDevCallsList.mockResolvedValue({ calls: [] });

    render(<ContractsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Export/i })).toBeTruthy();
    });
  });
});
