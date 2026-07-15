// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SetupWizard gating tests (T044 — rewritten for 5-step flow; spec 044 T016
 * inserted an Observing Site step before Confirm, making it a 6-step flow).
 *
 * Validates that Step 1 (Source Folders) blocks advancement when required
 * folder types (light_frames, project) are missing, and that Steps 2–3
 * advance freely. Step 4 (Observing Site) is covered separately below (it's
 * optional and never blocks advancement). The Scan step (step 6) has its own
 * StepScan.test.tsx.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted runs BEFORE vi.mock factories, so
// the `mockPickDirectory` fn is accessible from within the hoisted mock factory.
// ---------------------------------------------------------------------------
const { mockPickDirectory } = vi.hoisted(() => {
  const mockPickDirectory =
    vi.fn<() => Promise<{ path: string | null; cancelled: boolean }>>();
  return { mockPickDirectory };
});

// Mock @tauri-apps/plugin-dialog so any leftover dynamic imports resolve.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
}));

// Mock the new native picker module so AddFolderButton uses our controllable
// mock instead of attempting a real Tauri invoke.
vi.mock('@/shared/native/picker', () => ({
  pickDirectory: mockPickDirectory,
  useDirectoryPicker: () => ({
    pick: mockPickDirectory,
    loading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

// Mock toast module to prevent side-effect issues in tests.
vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  dismissToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn(), add: vi.fn() }),
}));

// Mock @tanstack/react-router so useNavigate returns a no-op.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock Tauri backend commands so they never reach the native bridge.
// Catalog manifest fetch resolves to 'failed' so StepCatalogs renders its
// graceful unavailable state in these gating tests (download flow is covered
// in StepCatalogs.test.tsx).
//
// StepCatalogs' ResolverSettingsControl reads resolver settings from the
// settings feature's settingsIpc glue module (spec 037); mock those two there.
vi.mock('@/features/settings/settingsIpc', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/settings/settingsIpc')>();
  return {
    ...actual,
    getResolverSettings: vi.fn().mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      settings: {
        onlineEnabled: true,
        simbadEndpoint: 'https://simbad.example/tap',
        debounceMs: 300,
        requestTimeoutSecs: 10,
      },
    }),
    updateResolverSettings: vi
      .fn()
      .mockImplementation((settings) =>
        Promise.resolve({ contractVersion: '1.0', requestId: 'r', settings }),
      ),
  };
});

// spec 037: the wizard, sources-store, StepCatalogs, and StepScan now call
// generated commands.* bindings + unwrap directly. Mock the bindings surface
// (Result-shaped responses) and let unwrap really unwrap them.
// vi.hoisted: vi.mock factories below are hoisted above these declarations.
const {
  mockToolsUpdate,
  mockFirstrunComplete,
  mockRootsRegisterBatch,
  mockSettingsGet,
  mockSettingsUpdate,
  mockInboxScanFolder,
  mockInboxClassify,
} = vi.hoisted(() => ({
  mockToolsUpdate: vi.fn().mockResolvedValue({
    status: 'ok',
    data: {
      id: 'pixinsight',
      name: 'PixInsight',
      enabled: false,
      configured: false,
      available: false,
      supportsOpenFolder: false,
      autoDetected: false,
      executablePath: null,
    },
  }),
  mockFirstrunComplete: vi
    .fn()
    .mockResolvedValue({ status: 'ok', data: { success: true } }),
  mockRootsRegisterBatch: vi.fn().mockResolvedValue({
    status: 'ok',
    data: { status: 'success', items: [] },
  }),
  mockSettingsGet: vi.fn().mockResolvedValue({
    status: 'ok',
    data: { values: { defaultProtection: 'protected' } },
  }),
  mockSettingsUpdate: vi.fn().mockResolvedValue({ status: 'ok', data: null }),
  // StepScan calls these — stub with empty responses so render doesn't throw
  // if the Scan step is reached during tests that navigate that far.
  mockInboxScanFolder: vi.fn().mockResolvedValue({
    status: 'ok',
    data: { rootId: 'root-mock', items: [] },
  }),
  // Never actually invoked in these gating tests (scan responses carry no
  // items), but the module surface must still expose it.
  mockInboxClassify: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    toolsUpdate: mockToolsUpdate,
    firstrunComplete: mockFirstrunComplete,
    rootsRegisterBatch: mockRootsRegisterBatch,
    settingsGet: mockSettingsGet,
    settingsUpdate: mockSettingsUpdate,
    inboxScanFolder: mockInboxScanFolder,
    inboxClassify: mockInboxClassify,
  },
}));

// Mock @tauri-apps/api/core to prevent any accidental live invoke.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri')),
}));

// Ensure mock mode is OFF so the gating logic actually fires.
// (When VITE_USE_MOCKS === 'true', canProceed always returns true.)
vi.stubEnv('VITE_USE_MOCKS', 'false');

// ---------------------------------------------------------------------------
// Component under test
// ---------------------------------------------------------------------------
import { SetupWizard } from './SetupWizard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WIZARD_STORAGE_KEY = 'alm-setup-wizard-state';

/** Render the wizard and return the result. */
function renderWizard() {
  return render(<SetupWizard />);
}

/**
 * Click the primary "Continue" button.
 * Throws if the button is not found.
 */
function _clickContinue() {
  const btn = getContinueButton();
  fireEvent.click(btn);
}

/** Return the primary continue button. */
function getContinueButton(): HTMLElement {
  const allButtons = screen.getAllByRole('button');
  const match = allButtons.find((b) => b.textContent?.includes('Continue to'));
  if (!match) throw new Error('Continue button not found');
  return match;
}

/**
 * Map a SourceKind to the display label used in each group's add-button
 * aria-label ("Add <Label> folder").
 */
const KIND_LABEL: Record<string, string> = {
  light_frames: 'Light frames',
  calibration: 'Calibration frames',
  project: 'Projects',
  inbox: 'Inbox',
};

/**
 * Simulate adding a folder to a specific group by configuring the mocked
 * pickDirectory() and clicking that group's own "+ Add folder" button (located
 * via its per-kind aria-label). Defaults to the light_frames group.
 */
async function addFolder(path: string, kind = 'light_frames') {
  mockPickDirectory.mockResolvedValueOnce({ path, cancelled: false });

  const label = KIND_LABEL[kind] ?? kind;
  const addBtn = screen.getByRole('button', {
    name: new RegExp(`add ${label} folder`, 'i'),
  });

  await act(async () => {
    fireEvent.click(addBtn);
    // handleChoose is async: it awaits pickDirectory(). Flush the microtask
    // queue so React processes the state update.
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear all wizard and preference state between tests.
  window.localStorage.clear();
  mockPickDirectory.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupWizard 5-step flow', () => {
  it('starts on Step 1 (Source Folders) and shows the heading', () => {
    renderWizard();
    expect(screen.getByText(/where does your data live/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 6/i)).toBeInTheDocument();
  });

  it('blocks Continue on Step 1 when no paths are added', () => {
    renderWizard();
    const continueBtn = getContinueButton();
    expect(continueBtn).toBeDisabled();
  });

  it('blocks Continue on Step 1 when only light_frames is added (project missing)', async () => {
    renderWizard();

    await addFolder('/astro/lights');
    await waitFor(() => {
      expect(screen.getByText('/astro/lights')).toBeInTheDocument();
    });

    // Only light_frames added, project is still missing
    const continueBtn = getContinueButton();
    expect(continueBtn).toBeDisabled();
  });

  it('enables Continue on Step 1 after adding all required folder types', async () => {
    // spec 039: inbox is now optional — only light_frames + project are required.
    renderWizard();

    // Add a folder to each required group via its own per-group add button.
    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() => {
      expect(screen.getByText('/astro/lights')).toBeInTheDocument();
    });

    await addFolder('/astro/projects', 'project');
    await waitFor(() => {
      expect(screen.getByText('/astro/projects')).toBeInTheDocument();
    });

    // Should now be enabled — inbox NOT required (spec 039 FR-004).
    await waitFor(() => {
      expect(getContinueButton()).not.toBeDisabled();
    });
  });

  it('allows Step 1 to advance without an inbox folder (spec 039 FR-004)', async () => {
    // Completing setup without an inbox folder must be allowed.
    renderWizard();

    await addFolder('/astro/lights', 'light_frames');
    await addFolder('/astro/projects', 'project');

    // Continue must become enabled with only the two required kinds.
    await waitFor(() => {
      expect(getContinueButton()).not.toBeDisabled();
    });

    // The inbox group card is still present (it's a supported optional kind).
    expect(screen.getByTestId('source-group-inbox')).toBeInTheDocument();
    // But it must NOT carry a data-requirement-met attribute (it's optional).
    expect(screen.getByTestId('source-group-inbox')).not.toHaveAttribute(
      'data-requirement-met',
    );
  });

  it('renders one persistent group card per source kind, even when empty', () => {
    renderWizard();

    for (const kind of ['light_frames', 'calibration', 'project', 'inbox']) {
      expect(screen.getByTestId(`source-group-${kind}`)).toBeInTheDocument();
    }
  });

  it('highlights required group cards with met/unmet status', async () => {
    renderWizard();

    // Required groups start unmet; optional groups carry no requirement flag.
    expect(screen.getByTestId('source-group-light_frames')).toHaveAttribute(
      'data-requirement-met',
      'false',
    );
    expect(screen.getByTestId('source-group-project')).toHaveAttribute(
      'data-requirement-met',
      'false',
    );
    // calibration and inbox are optional (spec 039: inbox removed from required kinds).
    expect(screen.getByTestId('source-group-calibration')).not.toHaveAttribute(
      'data-requirement-met',
    );
    expect(screen.getByTestId('source-group-inbox')).not.toHaveAttribute(
      'data-requirement-met',
    );

    // Adding to the light_frames group flips its card to met.
    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() => {
      expect(screen.getByTestId('source-group-light_frames')).toHaveAttribute(
        'data-requirement-met',
        'true',
      );
    });
    // Project still unmet.
    expect(screen.getByTestId('source-group-project')).toHaveAttribute(
      'data-requirement-met',
      'false',
    );
  });

  it('lists added folders inside their own kind group card', async () => {
    renderWizard();

    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() =>
      expect(screen.getByText('/astro/lights')).toBeInTheDocument(),
    );

    await addFolder('/astro/cals', 'calibration');
    await waitFor(() =>
      expect(screen.getByText('/astro/cals')).toBeInTheDocument(),
    );

    const lightGroup = screen.getByTestId('source-group-light_frames');
    const calGroup = screen.getByTestId('source-group-calibration');
    expect(lightGroup).toContainElement(screen.getByText('/astro/lights'));
    expect(calGroup).toContainElement(screen.getByText('/astro/cals'));
  });

  it('allows Step 2 (Processing Tools) to advance without changes', async () => {
    // Seed state at step 1 with required folders already filled
    const seeded = {
      currentStep: 1,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        selectedCatalogIds: ['common', 'openngc'],
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // We should be on the Processing Tools step (heading)
    expect(
      screen.getByRole('heading', { name: /processing tools/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 6/i)).toBeInTheDocument();

    // Continue should be enabled (tools step has no requirements)
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();

    // Click Continue — should advance to Catalogs step
    fireEvent.click(continueBtn);
    expect(
      screen.getByRole('heading', { name: /configuration/i }),
    ).toBeInTheDocument();
  });

  it('allows Step 3 (Catalogs) to advance without changes', async () => {
    // Seed state at step 2
    const seeded = {
      currentStep: 2,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        selectedCatalogIds: ['common', 'openngc'],
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // We should be on the Catalogs step (heading)
    expect(
      screen.getByRole('heading', { name: /configuration/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 3 of 6/i)).toBeInTheDocument();

    // Continue should be enabled
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();
  });

  it('allows Step 4 (Observing Site) to advance while completely empty (spec 044 T016, optional)', () => {
    // Seed state at step 3 (Observing Site) with required folders already
    // satisfied so Continue is gated only by the site step itself.
    const seeded = {
      currentStep: 3,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: { selectedCatalogIds: ['common', 'openngc'] },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
      site: {
        name: '',
        latitudeDegText: '',
        longitudeDegText: '',
        elevationMText: '',
        timezone: 'UTC',
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    expect(
      screen.getByRole('heading', { name: /where do you observe from/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/step 4 of 6/i)).toBeInTheDocument();

    // Never required — Continue is enabled with every field blank.
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();

    fireEvent.click(continueBtn);
    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();
  });

  it('blocks Continue on the Observing Site step when latitude is out of range', () => {
    const seeded = {
      currentStep: 3,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: { selectedCatalogIds: ['common', 'openngc'] },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
      site: {
        name: 'Backyard',
        latitudeDegText: '120',
        longitudeDegText: '4.9',
        elevationMText: '',
        timezone: 'UTC',
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    const continueBtn = getContinueButton();
    expect(continueBtn).toBeDisabled();
  });

  it('persists the site from the Observing Site step as default+active when finishing', async () => {
    mockSettingsUpdate.mockClear();

    // Seed at the Scan step's predecessor state directly at Confirm with a
    // filled-in site, then drive to Scan -> Finish the same way the
    // tool-persistence test does.
    const seeded = {
      currentStep: 4,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: { selectedCatalogIds: [] },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
      site: {
        name: 'Backyard',
        latitudeDegText: '52.37',
        longitudeDegText: '4.9',
        elevationMText: '2',
        timezone: 'Europe/Amsterdam',
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();
    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();

    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    await act(async () => {
      fireEvent.click(startScanBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const finishBtn = await screen.findByTestId('finish-button');
    await waitFor(() => expect(finishBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(finishBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() =>
      expect(mockSettingsUpdate).toHaveBeenCalledWith(
        'observing',
        expect.objectContaining({
          observingSites: [
            expect.objectContaining({
              name: 'Backyard',
              latitudeDeg: 52.37,
              longitudeDeg: 4.9,
              elevationM: 2,
            }),
          ],
        }),
      ),
    );
    const call = mockSettingsUpdate.mock.calls.find(
      ([scope]) => scope === 'observing',
    );
    const values = call?.[1] as {
      observingSites: Array<{ id: string }>;
      observingDefaultSiteId: string;
      observingActiveSiteId: string;
    };
    const siteId = values.observingSites[0].id;
    expect(values.observingDefaultSiteId).toBe(siteId);
    expect(values.observingActiveSiteId).toBe(siteId);
  });

  it('does not call settingsUpdate for observing sites when the site step was left empty', async () => {
    mockSettingsUpdate.mockClear();
    mockFirstrunComplete.mockClear();

    const seeded = {
      currentStep: 4,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: { selectedCatalogIds: [] },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
      site: {
        name: '',
        latitudeDegText: '',
        longitudeDegText: '',
        elevationMText: '',
        timezone: 'UTC',
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    await act(async () => {
      fireEvent.click(startScanBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    const finishBtn = await screen.findByTestId('finish-button');
    await waitFor(() => expect(finishBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(finishBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitFor(() => expect(mockFirstrunComplete).toHaveBeenCalledTimes(1));
    expect(mockSettingsUpdate).not.toHaveBeenCalledWith(
      'observing',
      expect.anything(),
    );
  });

  it('shows Confirm step (Step 5) with Start scan button', async () => {
    // Seed state at step 4 (Confirm, after the spec 044 Site step) with all
    // required kinds satisfied.
    const seeded = {
      currentStep: 4,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
        { path: '/astro/inbox', kind: 'inbox', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        selectedCatalogIds: ['common', 'openngc'],
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // Verify we are on the Confirm step
    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();
    expect(screen.getByText(/step 5 of 6/i)).toBeInTheDocument();

    // "Start scan" button should be present and enabled (not "Complete setup")
    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    expect(startScanBtn).not.toBeDisabled();
    expect(
      screen.queryByRole('button', { name: /complete setup/i }),
    ).toBeNull();
  });

  it('blocks Start scan on Confirm step when required folders are missing', async () => {
    // Seed at step 4 (Confirm) but WITHOUT a project folder
    const seeded = {
      currentStep: 4,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        selectedCatalogIds: ['common', 'openngc'],
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();

    // Start scan should be disabled
    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    expect(startScanBtn).toBeDisabled();

    // Should show the blocked message
    expect(screen.getByText(/cannot complete setup/i)).toBeInTheDocument();
  });

  it('rejects a duplicate path within the same kind', async () => {
    renderWizard();

    // Add a folder path
    await addFolder('/home/user/astrophoto/raw');
    await waitFor(() => {
      expect(screen.getByText('/home/user/astrophoto/raw')).toBeInTheDocument();
    });

    // Confirm the footer shows 1 folder
    expect(screen.getByText(/1 folder selected/i)).toBeInTheDocument();

    // Add the same path again — the dedup check should reject it
    await addFolder('/home/user/astrophoto/raw');

    // After attempting to add a duplicate, the path should still appear only
    // once and the folder count should remain at 1.
    await waitFor(() => {
      const pathElements = screen.getAllByText('/home/user/astrophoto/raw');
      expect(pathElements).toHaveLength(1);
    });
    expect(screen.getByText(/1 folder selected/i)).toBeInTheDocument();
  });

  it('persists wizard processing-tool config to the backend when finishing', async () => {
    mockToolsUpdate.mockClear();
    mockFirstrunComplete.mockClear();

    // Seed at the Confirm step (step 4) with PixInsight enabled+pathed and
    // Siril disabled, so we can verify both tools are sent to toolUpdate.
    const seeded = {
      currentStep: 4,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: { selectedCatalogIds: [] },
      tools: {
        pixinsight: {
          enabled: true,
          path: '/Applications/PixInsight/PixInsight.app',
        },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // Confirm step renders.
    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();

    // Advance to the Scan step by clicking "Start scan →".
    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    await act(async () => {
      fireEvent.click(startScanBtn);
      // Give flushToDB (mocked registerRootBatch) time to resolve.
      await new Promise((r) => setTimeout(r, 0));
    });

    // StepScan mounts and immediately calls inboxScanFolder for each source.
    // The mock resolves synchronously, so after a tick the scan is 'done'
    // and the Finish button becomes enabled.
    const finishBtn = await screen.findByTestId('finish-button');
    await waitFor(() => expect(finishBtn).not.toBeDisabled());

    await act(async () => {
      fireEvent.click(finishBtn);
      await new Promise((r) => setTimeout(r, 0));
    });

    // handleFinish (non-mock path: VITE_USE_MOCKS='false') must call toolsUpdate
    // once per tool before firstrunComplete.
    await waitFor(() => expect(mockToolsUpdate).toHaveBeenCalledTimes(2));

    expect(mockToolsUpdate).toHaveBeenCalledWith({
      id: 'pixinsight',
      enabled: true,
      path: '/Applications/PixInsight/PixInsight.app',
    });
    expect(mockToolsUpdate).toHaveBeenCalledWith({
      id: 'siril',
      enabled: false,
      path: null,
    });

    // firstrunComplete must be called exactly once, after the tool updates.
    expect(mockFirstrunComplete).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Issue #704 — restart flow: already-registered batch items are benign no-ops
// ---------------------------------------------------------------------------

describe('SetupWizard restart re-confirm (issue #704)', () => {
  /** Seed the wizard at the Confirm step with the two required sources. */
  function seedConfirmStep() {
    window.localStorage.setItem(
      WIZARD_STORAGE_KEY,
      JSON.stringify({
        currentStep: 4,
        sources: [
          {
            path: '/astro/lights',
            kind: 'light_frames',
            scanDepth: 'recursive',
            organizationState: 'organized',
          },
          {
            path: '/astro/projects',
            kind: 'project',
            scanDepth: 'recursive',
            organizationState: 'organized',
          },
        ],
      }),
    );
  }

  async function clickStartScan() {
    const startScanBtn = screen.getByRole('button', { name: /start scan/i });
    await act(async () => {
      fireEvent.click(startScanBtn);
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it('advances to Scan when every item is already registered (unchanged restart buffer)', async () => {
    seedConfirmStep();
    mockRootsRegisterBatch.mockResolvedValueOnce({
      status: 'ok',
      data: {
        status: 'failure',
        items: [
          {
            index: 0,
            status: 'failure',
            sourceId: null,
            error: 'path.already_registered',
            errorDetail: null,
          },
          {
            index: 1,
            status: 'failure',
            sourceId: null,
            error: 'path.already_registered',
            errorDetail: null,
          },
        ],
      },
    });

    renderWizard();
    await clickStartScan();

    // No misleading "batch failed" banner, and the wizard is on the Scan step.
    expect(screen.queryByTestId('setup-submit-error')).toBeNull();
    expect(screen.getByTestId('step-scan')).toBeInTheDocument();
  });

  it('advances to Scan and scans only the new folder in a mixed batch', async () => {
    seedConfirmStep();
    mockRootsRegisterBatch.mockResolvedValueOnce({
      status: 'ok',
      data: {
        status: 'partial',
        items: [
          {
            index: 0,
            status: 'failure',
            sourceId: null,
            error: 'path.already_registered',
            errorDetail: null,
          },
          {
            index: 1,
            status: 'success',
            sourceId: 'root-new-1',
            error: null,
            errorDetail: null,
          },
        ],
      },
    });

    renderWizard();
    await clickStartScan();

    expect(screen.queryByTestId('setup-submit-error')).toBeNull();
    expect(screen.getByTestId('step-scan')).toBeInTheDocument();

    // Only the newly registered folder is scanned — never the
    // already-registered one (its content is already ingested; scanning by
    // path-as-rootId would orphan inbox items).
    await waitFor(() => expect(mockInboxScanFolder).toHaveBeenCalledTimes(1));
    expect(mockInboxScanFolder).toHaveBeenCalledWith(
      expect.objectContaining({ rootId: 'root-new-1' }),
    );
  });

  it('still blocks on Confirm for genuine registration failures', async () => {
    seedConfirmStep();
    mockInboxScanFolder.mockClear();
    mockRootsRegisterBatch.mockResolvedValueOnce({
      status: 'ok',
      data: {
        status: 'partial',
        items: [
          {
            index: 0,
            status: 'failure',
            sourceId: null,
            error: 'path.not_exists',
            errorDetail: null,
          },
          {
            index: 1,
            status: 'success',
            sourceId: 'root-new-2',
            error: null,
            errorDetail: null,
          },
        ],
      },
    });

    renderWizard();
    await clickStartScan();

    expect(screen.getByTestId('setup-submit-error')).toBeInTheDocument();
    expect(screen.queryByTestId('step-scan')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Issue #512 — step tabs are clickable with validation-gated forward jumps
// ---------------------------------------------------------------------------

describe('SetupWizard step-tab navigation (issue #512)', () => {
  it('renders step tabs as buttons and marks the current step', () => {
    renderWizard();
    const sourcesTab = screen.getByRole('button', {
      name: /1\. Source Folders/i,
    });
    expect(sourcesTab).toHaveAttribute('aria-current', 'step');
  });

  it('disables forward tabs while step validation fails, enables them once it passes', async () => {
    renderWizard();

    // No folders yet: step 0 fails validation, so every forward tab is disabled.
    expect(
      screen.getByRole('button', { name: /2\. Processing Tools/i }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: /5\. Confirm/i })).toBeDisabled();

    await addFolder('/astro/lights', 'light_frames');
    await addFolder('/astro/projects', 'project');

    // Required kinds present: intermediate steps and Confirm become reachable…
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /2\. Processing Tools/i }),
      ).not.toBeDisabled(),
    );
    expect(
      screen.getByRole('button', { name: /5\. Confirm/i }),
    ).not.toBeDisabled();
    // …but Scan is never a plain jump target (it runs registration on entry).
    expect(screen.getByRole('button', { name: /6\. Scan/i })).toBeDisabled();
  });

  it('jumps forward and freely back via the tabs', async () => {
    renderWizard();
    await addFolder('/astro/lights', 'light_frames');
    await addFolder('/astro/projects', 'project');

    // Forward jump straight to Confirm (all gates pass).
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /5\. Confirm/i }),
      ).not.toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: /5\. Confirm/i }));
    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();

    // Free backward jump to any visited/earlier step.
    fireEvent.click(screen.getByRole('button', { name: /1\. Source Folders/i }));
    expect(screen.getByText(/where does your data live/i)).toBeInTheDocument();
  });
});
