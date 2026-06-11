/**
 * lifecycle-actions tests — spec 009 US3.
 *
 * Tests:
 * 1. lifecycleFooterActions returns correct actions for each lifecycle state.
 * 2. Plan-gated edges are marked requiresPlan=true.
 * 3. Non-plan-gated edges are marked requiresPlan=false.
 * 4. isPlanRequiredError correctly identifies plan-related error codes.
 * 5. All transitions to blocked/archived are marked plan-required where spec requires.
 */

import { describe, it, expect } from 'vitest';
import { lifecycleFooterActions, isPlanRequiredError } from './lifecycle-actions';

describe('lifecycleFooterActions', () => {
  it('returns no actions for setup_incomplete', () => {
    expect(lifecycleFooterActions('setup_incomplete')).toHaveLength(0);
  });

  it('returns prepared and processing for ready state', () => {
    const actions = lifecycleFooterActions('ready');
    const nextStates = actions.map((a) => a.nextState);
    expect(nextStates).toContain('prepared');
    expect(nextStates).toContain('processing');
  });

  it('marks ready → prepared as plan-required', () => {
    const actions = lifecycleFooterActions('ready');
    const prepareAction = actions.find((a) => a.nextState === 'prepared');
    expect(prepareAction?.requiresPlan).toBe(true);
  });

  it('marks ready → processing as NOT plan-required', () => {
    const actions = lifecycleFooterActions('ready');
    const processingAction = actions.find((a) => a.nextState === 'processing');
    expect(processingAction?.requiresPlan).toBe(false);
  });

  it('returns processing action for prepared state', () => {
    const actions = lifecycleFooterActions('prepared');
    const nextStates = actions.map((a) => a.nextState);
    expect(nextStates).toContain('processing');
  });

  it('returns completed action for processing state', () => {
    const actions = lifecycleFooterActions('processing');
    const nextStates = actions.map((a) => a.nextState);
    expect(nextStates).toContain('completed');
  });

  it('marks processing → completed as NOT plan-required', () => {
    const actions = lifecycleFooterActions('processing');
    const completedAction = actions.find((a) => a.nextState === 'completed');
    expect(completedAction?.requiresPlan).toBe(false);
  });

  it('marks completed → archived as plan-required (R-Archived-Plan)', () => {
    const actions = lifecycleFooterActions('completed');
    const archiveAction = actions.find((a) => a.nextState === 'archived');
    expect(archiveAction?.requiresPlan).toBe(true);
  });

  it('marks completed → processing (re-open) as NOT plan-required', () => {
    const actions = lifecycleFooterActions('completed');
    const reopenAction = actions.find((a) => a.nextState === 'processing');
    expect(reopenAction?.requiresPlan).toBe(false);
  });

  it('returns unarchive actions for archived state (R-Unarchive)', () => {
    const actions = lifecycleFooterActions('archived');
    const nextStates = actions.map((a) => a.nextState);
    expect(nextStates).toContain('ready');
    expect(nextStates).toContain('processing');
  });

  it('marks archived → ready as plan-required', () => {
    const actions = lifecycleFooterActions('archived');
    const readyAction = actions.find((a) => a.nextState === 'ready');
    expect(readyAction?.requiresPlan).toBe(true);
  });

  it('marks archived → processing as plan-required', () => {
    const actions = lifecycleFooterActions('archived');
    const processingAction = actions.find((a) => a.nextState === 'processing');
    expect(processingAction?.requiresPlan).toBe(true);
  });

  it('blocked state has archived escape hatch action', () => {
    const actions = lifecycleFooterActions('blocked');
    const archiveAction = actions.find((a) => a.nextState === 'archived');
    expect(archiveAction).toBeDefined();
    expect(archiveAction?.requiresPlan).toBe(true);
  });

  it('primary flag is set on the first primary action for each state', () => {
    const states = ['ready', 'prepared', 'processing', 'completed', 'archived'] as const;
    for (const state of states) {
      const actions = lifecycleFooterActions(state);
      const primaries = actions.filter((a) => a.primary);
      expect(primaries.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('isPlanRequiredError', () => {
  it('returns true for plan.required', () => {
    expect(isPlanRequiredError('plan.required')).toBe(true);
  });

  it('returns true for plan.not_approved', () => {
    expect(isPlanRequiredError('plan.not_approved')).toBe(true);
  });

  it('returns false for transition.refused', () => {
    expect(isPlanRequiredError('transition.refused')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPlanRequiredError(undefined)).toBe(false);
  });

  it('returns false for entity.not_found', () => {
    expect(isPlanRequiredError('entity.not_found')).toBe(false);
  });
});
