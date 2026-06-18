/// <reference types="@testing-library/jest-dom" />
/**
 * SetupWizard gating tests (T044 — rewritten for 4-step flow).
 *
 * Validates that Step 1 (Source Folders) blocks advancement when required
 * folder types (light_frames, project) are missing, and that Steps 2 and 3
 * advance freely.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted runs BEFORE vi.mock factories, so
// the `mockPickDirectory` fn is accessible from within the hoisted mock factory.
// ---------------------------------------------------------------------------
const { mockPickDirectory } = vi.hoisted(() => {
  const mockPickDirectory = vi.fn<() => Promise<{ path: string | null; cancelled: boolean }>>();
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
vi.mock('@/api/commands', () => ({
  completeFirstRun: vi.fn().mockResolvedValue({ success: true }),
  registerRoot: vi.fn().mockResolvedValue({ id: 'mock-root', path: '' }),
  registerRootBatch: vi.fn().mockResolvedValue({ results: [] }),
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
  const match = allButtons.find(
    (b) => b.textContent?.includes('Continue to'),
  );
  if (!match) throw new Error('Continue button not found');
  return match;
}

/**
 * Map a SourceKind to the display label used in each group's add-button
 * aria-label ("Add <Label> folder").
 */
const KIND_LABEL: Record<string, string> = {
  light_frames: 'Light frames',
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
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
  const addBtn = screen.getByRole('button', { name: new RegExp(`add ${label} folder`, 'i') });

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

describe('SetupWizard 4-step flow', () => {
  it('starts on Step 1 (Source Folders) and shows the heading', () => {
    renderWizard();
    expect(screen.getByText(/where does your data live/i)).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
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

  it('enables Continue on Step 1 after adding both light_frames and project folders', async () => {
    renderWizard();

    // Add light_frames folder (default selected type)
    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() => {
      expect(screen.getByText('/astro/lights')).toBeInTheDocument();
    });

    // Type-first: select "project" type, then add the project folder
    await addFolder('/astro/projects', 'project');
    await waitFor(() => {
      expect(screen.getByText('/astro/projects')).toBeInTheDocument();
    });

    // Should now be enabled
    await waitFor(() => {
      expect(getContinueButton()).not.toBeDisabled();
    });
  });

  it('renders one persistent group card per source kind, even when empty', () => {
    renderWizard();

    for (const kind of ['light_frames', 'dark', 'flat', 'bias', 'project', 'inbox']) {
      expect(screen.getByTestId(`source-group-${kind}`)).toBeInTheDocument();
    }
  });

  it('highlights required group cards with met/unmet status', async () => {
    renderWizard();

    // Required groups start unmet; optional groups carry no requirement flag.
    expect(screen.getByTestId('source-group-light_frames')).toHaveAttribute('data-requirement-met', 'false');
    expect(screen.getByTestId('source-group-project')).toHaveAttribute('data-requirement-met', 'false');
    expect(screen.getByTestId('source-group-dark')).not.toHaveAttribute('data-requirement-met');

    // Adding to the light_frames group flips its card to met.
    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() => {
      expect(screen.getByTestId('source-group-light_frames')).toHaveAttribute('data-requirement-met', 'true');
    });
    // Project still unmet.
    expect(screen.getByTestId('source-group-project')).toHaveAttribute('data-requirement-met', 'false');
  });

  it('lists added folders inside their own kind group card', async () => {
    renderWizard();

    await addFolder('/astro/lights', 'light_frames');
    await waitFor(() => expect(screen.getByText('/astro/lights')).toBeInTheDocument());

    await addFolder('/astro/darks', 'dark');
    await waitFor(() => expect(screen.getByText('/astro/darks')).toBeInTheDocument());

    const lightGroup = screen.getByTestId('source-group-light_frames');
    const darkGroup = screen.getByTestId('source-group-dark');
    expect(lightGroup).toContainElement(screen.getByText('/astro/lights'));
    expect(darkGroup).toContainElement(screen.getByText('/astro/darks'));
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
        messier: true,
        ngcIc: true,
        caldwell: true,
        sharpless: true,
        abell: true,
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // We should be on the Processing Tools step (heading)
    expect(screen.getByRole('heading', { name: /processing tools/i })).toBeInTheDocument();
    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();

    // Continue should be enabled (tools step has no requirements)
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();

    // Click Continue — should advance to Catalogs step
    fireEvent.click(continueBtn);
    expect(screen.getByRole('heading', { name: /target catalogs/i })).toBeInTheDocument();
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
        messier: true,
        ngcIc: true,
        caldwell: true,
        sharpless: true,
        abell: true,
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // We should be on the Catalogs step (heading)
    expect(screen.getByRole('heading', { name: /target catalogs/i })).toBeInTheDocument();
    expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();

    // Continue should be enabled
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();
  });

  it('shows Confirm step (Step 4) with Complete setup button', async () => {
    // Seed state at step 3 (Confirm)
    const seeded = {
      currentStep: 3,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
        { path: '/astro/projects', kind: 'project', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        messier: true,
        ngcIc: true,
        caldwell: true,
        sharpless: true,
        abell: true,
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

    // Complete setup button should be present and enabled
    const completeBtn = screen.getByRole('button', { name: /complete setup/i });
    expect(completeBtn).not.toBeDisabled();
  });

  it('blocks Complete setup on Confirm step when required folders are missing', async () => {
    // Seed at step 3 but WITHOUT a project folder
    const seeded = {
      currentStep: 3,
      sources: [
        { path: '/astro/lights', kind: 'light_frames', scanDepth: 'recursive' },
      ],
      catalogSettings: {
        messier: true,
        ngcIc: true,
        caldwell: true,
        sharpless: true,
        abell: true,
      },
      tools: {
        pixinsight: { enabled: false, path: null },
        siril: { enabled: false, path: null },
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    expect(screen.getByText(/ready to go/i)).toBeInTheDocument();

    // Complete setup should be disabled
    const completeBtn = screen.getByRole('button', { name: /complete setup/i });
    expect(completeBtn).toBeDisabled();

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
});
