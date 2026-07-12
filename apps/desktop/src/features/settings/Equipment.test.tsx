/// <reference types="@testing-library/jest-dom" />
/**
 * Equipment pane tests — spec 030 T018 wiring.
 *
 * Covers, per entity type, against the generated `commands.equipment*`
 * bindings (mocked at the `@/bindings/index` boundary so the real
 * `settingsIpc` wrappers + `unwrap()` run):
 *   1. Lists render from the mocked IPC on mount (cameras, telescopes,
 *      optical trains, filters).
 *   2. Create flow (camera).
 *   3. Edit flow (telescope).
 *   4. Delete flow via the shared confirm overlay (filter).
 *   5. Load-error path surfaces a catalog-mapped message.
 *   6. Client-side guard blocks deleting a camera/telescope that's still
 *      referenced by an optical train (the backend FK constraint would
 *      reject it too, but with a generic `internal.database` error).
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Camera, Telescope, OpticalTrain, Filter } from './settingsIpc';

const {
  mockCamerasList,
  mockCamerasCreate,
  mockCamerasUpdate,
  mockCamerasDelete,
  mockTelescopesList,
  mockTelescopesCreate,
  mockTelescopesUpdate,
  mockTelescopesDelete,
  mockTrainsList,
  mockTrainsCreate,
  mockTrainsUpdate,
  mockTrainsDelete,
  mockFiltersList,
  mockFiltersCreate,
  mockFiltersUpdate,
  mockFiltersDelete,
} = vi.hoisted(() => ({
  mockCamerasList: vi.fn(),
  mockCamerasCreate: vi.fn(),
  mockCamerasUpdate: vi.fn(),
  mockCamerasDelete: vi.fn(),
  mockTelescopesList: vi.fn(),
  mockTelescopesCreate: vi.fn(),
  mockTelescopesUpdate: vi.fn(),
  mockTelescopesDelete: vi.fn(),
  mockTrainsList: vi.fn(),
  mockTrainsCreate: vi.fn(),
  mockTrainsUpdate: vi.fn(),
  mockTrainsDelete: vi.fn(),
  mockFiltersList: vi.fn(),
  mockFiltersCreate: vi.fn(),
  mockFiltersUpdate: vi.fn(),
  mockFiltersDelete: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    equipmentCamerasList: mockCamerasList,
    equipmentCamerasCreate: mockCamerasCreate,
    equipmentCamerasUpdate: mockCamerasUpdate,
    equipmentCamerasDelete: mockCamerasDelete,
    equipmentTelescopesList: mockTelescopesList,
    equipmentTelescopesCreate: mockTelescopesCreate,
    equipmentTelescopesUpdate: mockTelescopesUpdate,
    equipmentTelescopesDelete: mockTelescopesDelete,
    equipmentTrainsList: mockTrainsList,
    equipmentTrainsCreate: mockTrainsCreate,
    equipmentTrainsUpdate: mockTrainsUpdate,
    equipmentTrainsDelete: mockTrainsDelete,
    equipmentFiltersList: mockFiltersList,
    equipmentFiltersCreate: mockFiltersCreate,
    equipmentFiltersUpdate: mockFiltersUpdate,
    equipmentFiltersDelete: mockFiltersDelete,
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

import { Equipment } from './Equipment';
import { m } from '@/lib/i18n';

/** Wrap a value in the generated `{ status: 'ok' }` Result envelope. */
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });
/** Wrap a ContractError in the generated `{ status: 'error' }` Result envelope. */
const err = (error: unknown) => ({ status: 'error' as const, error });

const CAMERA: Camera = {
  id: 'cam-1',
  name: 'ASI2600MM Pro',
  aliases: ['ZWO 2600'],
  autoDetected: false,
};

const TELESCOPE: Telescope = {
  id: 'tel-1',
  name: 'FSQ-106EDX4',
  aliases: [],
  focalLengthMm: 530,
  autoDetected: false,
};

const TRAIN: OpticalTrain = {
  id: 'train-1',
  name: 'Main imaging train',
  telescopeId: 'tel-1',
  cameraId: 'cam-1',
  focalLengthMm: 530,
};

const FILTER: Filter = {
  id: 'filt-1',
  name: 'Ha',
  category: 'narrowband',
  autoDetected: false,
};

/** Default empty-list resolution for every entity type not under test. */
function seedEmpty() {
  mockCamerasList.mockResolvedValue(ok([]));
  mockTelescopesList.mockResolvedValue(ok([]));
  mockTrainsList.mockResolvedValue(ok([]));
  mockFiltersList.mockResolvedValue(ok([]));
}

beforeEach(() => {
  vi.clearAllMocks();
  seedEmpty();
});

describe('Equipment', () => {
  it('loads and renders cameras, telescopes, optical trains, and filters on mount', async () => {
    mockCamerasList.mockResolvedValue(ok([CAMERA]));
    mockTelescopesList.mockResolvedValue(ok([TELESCOPE]));
    mockTrainsList.mockResolvedValue(ok([TRAIN]));
    mockFiltersList.mockResolvedValue(ok([FILTER]));

    render(<Equipment save={vi.fn()} />);

    // "ASI2600MM Pro" and "FSQ-106EDX4" each render twice: once in their own
    // section's table, and once resolved by id in the optical trains table.
    await waitFor(() =>
      expect(screen.getAllByText('ASI2600MM Pro').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText('FSQ-106EDX4').length).toBeGreaterThan(0);
    expect(screen.getByText('Main imaging train')).toBeInTheDocument();
    expect(screen.getByText('Ha')).toBeInTheDocument();
  });

  it('creates a camera via the add form', async () => {
    mockCamerasList.mockResolvedValueOnce(ok([]));
    mockCamerasCreate.mockResolvedValue(
      ok({ ...CAMERA, name: 'ASI533MC Pro', aliases: [] }),
    );
    mockCamerasList.mockResolvedValueOnce(
      ok([{ ...CAMERA, name: 'ASI533MC Pro', aliases: [] }]),
    );

    render(<Equipment save={vi.fn()} />);
    await waitFor(() => expect(mockCamerasList).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText(m.settings_equipment_cameras_add()));
    fireEvent.change(screen.getByLabelText(m.settings_equipment_col_name()), {
      target: { value: 'ASI533MC Pro' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText(m.common_save()));
      await Promise.resolve();
    });

    expect(mockCamerasCreate).toHaveBeenCalledWith({
      name: 'ASI533MC Pro',
      aliases: [],
    });
    await waitFor(() =>
      expect(screen.getByText('ASI533MC Pro')).toBeInTheDocument(),
    );
  });

  it('edits a telescope via the edit action', async () => {
    mockTelescopesList.mockResolvedValueOnce(ok([TELESCOPE]));
    mockTelescopesUpdate.mockResolvedValue(
      ok({ ...TELESCOPE, focalLengthMm: 600 }),
    );
    mockTelescopesList.mockResolvedValueOnce(
      ok([{ ...TELESCOPE, focalLengthMm: 600 }]),
    );

    render(<Equipment save={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('FSQ-106EDX4')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByText(m.common_edit()));
    const focalInput = screen.getByLabelText(
      m.settings_equipment_field_focal_length(),
    );
    fireEvent.change(focalInput, { target: { value: '600' } });

    await act(async () => {
      fireEvent.click(screen.getByText(m.common_save()));
      await Promise.resolve();
    });

    expect(mockTelescopesUpdate).toHaveBeenCalledWith({
      id: 'tel-1',
      name: 'FSQ-106EDX4',
      aliases: [],
      focalLengthMm: 600,
    });
  });

  it('deletes a filter after confirming', async () => {
    mockFiltersList.mockResolvedValueOnce(ok([FILTER]));
    mockFiltersDelete.mockResolvedValue(ok(null));
    mockFiltersList.mockResolvedValueOnce(ok([]));

    render(<Equipment save={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Ha')).toBeInTheDocument());

    fireEvent.click(screen.getByText(m.common_remove()));

    const dialog = await screen.findByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByText(m.common_remove()));
      await Promise.resolve();
    });

    expect(mockFiltersDelete).toHaveBeenCalledWith('filt-1');
    await waitFor(() =>
      expect(screen.queryByText('Ha')).not.toBeInTheDocument(),
    );
  });

  it('shows a load error when a list command fails', async () => {
    mockCamerasList.mockResolvedValue(
      err({
        code: 'internal.database',
        message: 'db down',
        severity: 'blocking',
        retryable: true,
      }),
    );

    render(<Equipment save={vi.fn()} />);

    // The catalog-mapped ContractError message is wrapped in the localized
    // "Could not load: …" frame (spec 046 FR-008 pattern, like DataSources).
    await waitFor(() =>
      expect(
        screen.getByText(
          m.settings_equipment_load_error({ error: m.err_internal_database() }),
        ),
      ).toBeInTheDocument(),
    );
  });

  it('shows a wrapped save error when create fails', async () => {
    mockCamerasList.mockResolvedValue(ok([]));
    mockCamerasCreate.mockResolvedValue(
      err({
        code: 'equipment.duplicate',
        message: 'UNIQUE constraint failed',
        severity: 'warning',
        retryable: false,
      }),
    );

    render(<Equipment save={vi.fn()} />);
    await waitFor(() => expect(mockCamerasList).toHaveBeenCalled());

    fireEvent.click(screen.getByText(m.settings_equipment_cameras_add()));
    fireEvent.change(screen.getByLabelText(m.settings_equipment_col_name()), {
      target: { value: 'Duplicate Cam' },
    });

    await act(async () => {
      fireEvent.click(screen.getByText(m.common_save()));
      await Promise.resolve();
    });

    expect(
      screen.getByText(
        m.settings_equipment_save_error({ error: m.err_equipment_duplicate() }),
      ),
    ).toBeInTheDocument();
  });

  it('disables camera Remove while trains are still loading (TOCTOU guard)', async () => {
    mockCamerasList.mockResolvedValue(ok([CAMERA]));
    // Trains never resolve: the in-use pre-check has no data yet, so Remove
    // must be disabled rather than allowing a delete that bypasses the guard.
    mockTrainsList.mockReturnValue(new Promise(() => {}));

    render(<Equipment save={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getByText('ASI2600MM Pro')).toBeInTheDocument(),
    );

    const removeBtn = screen.getByText(m.common_remove()).closest('button');
    expect(removeBtn).toBeDisabled();
    fireEvent.click(removeBtn as HTMLButtonElement);
    expect(mockCamerasDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('blocks deleting a telescope still referenced by an optical train', async () => {
    mockTelescopesList.mockResolvedValue(ok([TELESCOPE]));
    mockTrainsList.mockResolvedValue(ok([TRAIN]));

    render(<Equipment save={vi.fn()} />);
    await waitFor(() =>
      expect(screen.getAllByText('FSQ-106EDX4').length).toBeGreaterThan(0),
    );

    // Two "Remove" buttons render: one for the train row, one for the
    // telescope row. The telescope row's is last in document order (Optical
    // Trains section renders before Telescopes).
    const removeButtons = screen.getAllByText(m.common_remove());
    fireEvent.click(removeButtons[removeButtons.length - 1]);

    expect(mockTelescopesDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText(m.settings_equipment_delete_in_use()),
    ).toBeInTheDocument();
  });
});
