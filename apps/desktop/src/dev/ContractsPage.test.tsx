// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

const {
  mockGetSettings,
  mockDevContractsList,
  mockDevCallsList,
  mockDevExport,
  mockDevSchemaGet,
} = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockDevContractsList: vi.fn(),
  mockDevCallsList: vi.fn(),
  mockDevExport: vi.fn(),
  mockDevSchemaGet: vi.fn(),
}));

// Adapt each hoisted mock's raw payload into the generated `{ status: 'ok', data }`
// Result the real `unwrap` consumes (spec 037), so the mockResolvedValue sites
// below stay unchanged.
vi.mock('@/bindings/index', () => ({
  commands: {
    settingsGet: (...a: unknown[]) =>
      Promise.resolve(mockGetSettings(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devContractsList: (...a: unknown[]) =>
      Promise.resolve(mockDevContractsList(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devCallsList: (...a: unknown[]) =>
      Promise.resolve(mockDevCallsList(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devExport: (...a: unknown[]) =>
      Promise.resolve(mockDevExport(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
    devSchemaGet: (...a: unknown[]) =>
      Promise.resolve(mockDevSchemaGet(...a)).then((data) => ({
        status: 'ok',
        data,
      })),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: devMode off.
  mockGetSettings.mockResolvedValue({
    scope: 'advanced',
    values: { devMode: false, logLevel: 'info' },
  });
  mockDevContractsList.mockResolvedValue({ contracts: [] });
  mockDevCallsList.mockResolvedValue({ calls: [] });
  mockDevExport.mockResolvedValue({
    writtenPath: '/tmp/out.json',
    callCount: 0,
    contractCount: 0,
  });
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
