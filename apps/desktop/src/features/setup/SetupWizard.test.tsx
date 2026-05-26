/// <reference types="@testing-library/jest-dom" />
/**
 * SetupWizard gating tests (T015).
 *
 * Validates that required steps (Raw, Project) block advancement when empty,
 * optional steps (Calibration, Inbox) advance freely, and duplicate paths
 * within the same kind are rejected by the deduplication guard.
 */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state — vi.hoisted runs BEFORE vi.mock factories, so
// the `mockOpen` fn is accessible from within the hoisted mock factory.
// ---------------------------------------------------------------------------
const { mockOpen } = vi.hoisted(() => {
  const mockOpen = vi.fn<() => Promise<string | null>>();
  return { mockOpen };
});

// Mock @tauri-apps/plugin-dialog: dynamic import resolves, `open` delegates
// to our controllable `mockOpen` spy.
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mockOpen,
}));

// Mock @tanstack/react-router so useNavigate returns a no-op.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

// Mock Tauri backend commands so they never reach the native bridge.
vi.mock('@/api/commands', () => ({
  completeFirstRun: vi.fn().mockResolvedValue({ success: true }),
  registerRoot: vi.fn().mockResolvedValue({ id: 'mock-root', path: '' }),
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
 * Click the primary "Continue" / "Get started" button.
 * Throws if the button is not found.
 */
function clickContinue() {
  const btn = getContinueButton();
  fireEvent.click(btn);
}

/** Return the primary continue/get-started button. */
function getContinueButton(): HTMLElement {
  // Step 0 says "Get started", all others say "Continue to ...".
  const allButtons = screen.getAllByRole('button');
  const match = allButtons.find(
    (b) =>
      b.textContent?.includes('Get started') ||
      b.textContent?.includes('Continue to'),
  );
  if (!match) throw new Error('Continue button not found');
  return match;
}

/**
 * Simulate adding a folder by configuring the mocked dialog.open() to
 * resolve with the desired path, then clicking the "+ Add folder" button.
 */
async function addFolder(path: string) {
  mockOpen.mockResolvedValueOnce(path);

  const addBtn = screen.getByRole('button', { name: /add folder/i });

  await act(async () => {
    fireEvent.click(addBtn);
    // handleChoose is async: it awaits the dynamic import then awaits
    // open(). Flush the microtask queue so React processes the state update.
    await new Promise((r) => setTimeout(r, 0));
  });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Clear all wizard and preference state between tests.
  window.localStorage.clear();
  mockOpen.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupWizard step gating', () => {
  it('blocks Continue on the Raw step when no paths are added', async () => {
    renderWizard();

    // Step 0 (Welcome) — advance to step 1 (Raw).
    clickContinue(); // "Get started"

    // We should now be on the Raw step.
    expect(screen.getByText(/where are your raw frames/i)).toBeInTheDocument();

    // The Continue button should be disabled (no raw paths yet).
    const continueBtn = getContinueButton();
    expect(continueBtn).toBeDisabled();
  });

  it('enables Continue on the Raw step after adding a path', async () => {
    renderWizard();

    // Advance to Raw step.
    clickContinue();
    expect(screen.getByText(/where are your raw frames/i)).toBeInTheDocument();

    // Initially disabled.
    expect(getContinueButton()).toBeDisabled();

    // Add a folder path (use a path that does NOT collide with the example
    // paths shown at the bottom of StepRaw to avoid duplicate-text queries).
    await addFolder('/home/user/astrophoto/raw');

    // The path should appear in the list and Continue should now be enabled.
    await waitFor(() => {
      expect(screen.getByText('/home/user/astrophoto/raw')).toBeInTheDocument();
    });
    expect(getContinueButton()).not.toBeDisabled();
  });

  it('blocks Continue on the Project step when no paths are added', async () => {
    // Seed state so we start at step 3 directly, with a raw path already set
    // (otherwise we could not have passed the raw step gating).
    const seeded = {
      currentStep: 3,
      sources: {
        raw: [{ path: '/astro/lights', scanDepth: 'recursive' }],
        calibration: [],
        project: [],
        inbox: [],
      },
      catalogSettings: {
        openngc: true,
        messier: true,
        sharpless: true,
        barnard: true,
        lbn: true,
        ldn: true,
        simbadOnline: true,
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // Verify we are on the Project step.
    expect(screen.getByText(/project folders/i)).toBeInTheDocument();

    // Continue should be disabled.
    expect(getContinueButton()).toBeDisabled();
  });

  it('allows Calibration step (step 2) to advance without paths', async () => {
    // Seed at step 2 with a raw path so the wizard state is valid.
    const seeded = {
      currentStep: 2,
      sources: {
        raw: [{ path: '/astro/lights', scanDepth: 'recursive' }],
        calibration: [],
        project: [],
        inbox: [],
      },
      catalogSettings: {
        openngc: true,
        messier: true,
        sharpless: true,
        barnard: true,
        lbn: true,
        ldn: true,
        simbadOnline: true,
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // Verify we are on the Calibration step.
    expect(screen.getByText(/calibration masters/i)).toBeInTheDocument();

    // Continue should be enabled (calibration is optional).
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();

    // Click Continue — should advance to Project step (step 3).
    fireEvent.click(continueBtn);
    expect(screen.getByText(/project folders/i)).toBeInTheDocument();
  });

  it('allows Inbox step (step 4) to advance without paths', async () => {
    // Seed at step 4, with raw + project paths filled.
    const seeded = {
      currentStep: 4,
      sources: {
        raw: [{ path: '/astro/lights', scanDepth: 'recursive' }],
        calibration: [],
        project: [{ path: '/astro/projects', scanDepth: 'recursive' }],
        inbox: [],
      },
      catalogSettings: {
        openngc: true,
        messier: true,
        sharpless: true,
        barnard: true,
        lbn: true,
        ldn: true,
        simbadOnline: true,
      },
    };
    window.localStorage.setItem(WIZARD_STORAGE_KEY, JSON.stringify(seeded));

    renderWizard();

    // Verify we are on the Inbox step.
    expect(screen.getByText(/inbox \/ watched folders/i)).toBeInTheDocument();

    // Continue should be enabled (inbox is optional).
    const continueBtn = getContinueButton();
    expect(continueBtn).not.toBeDisabled();

    // Click Continue — should advance to Tools step (step 5).
    fireEvent.click(continueBtn);
    expect(screen.getByText(/detect processing tools/i)).toBeInTheDocument();
  });

  it('rejects a duplicate path within the same kind', async () => {
    renderWizard();

    // Advance to Raw step.
    clickContinue();
    expect(screen.getByText(/where are your raw frames/i)).toBeInTheDocument();

    // Add a folder path (unique — avoids collision with example paths).
    await addFolder('/home/user/astrophoto/raw');

    // Wait for the path to appear and React to settle with the new state,
    // ensuring the next addFolder call receives the updated sources closure.
    await waitFor(() => {
      expect(screen.getByText('/home/user/astrophoto/raw')).toBeInTheDocument();
    });

    // Confirm the footer shows 1 folder.
    expect(screen.getByText(/1 folder selected/i)).toBeInTheDocument();

    // Add the same path again — the dedup check should reject it.
    await addFolder('/home/user/astrophoto/raw');

    // After attempting to add a duplicate, the path should still appear only
    // once and the folder count should remain at 1 (the duplicate was rejected
    // by the checkDeduplication guard in makeSourceHandlers).
    await waitFor(() => {
      // The path text appears exactly once (the entry row).
      const pathElements = screen.getAllByText('/home/user/astrophoto/raw');
      expect(pathElements).toHaveLength(1);
    });
    expect(screen.getByText(/1 folder selected/i)).toBeInTheDocument();
  });
});
