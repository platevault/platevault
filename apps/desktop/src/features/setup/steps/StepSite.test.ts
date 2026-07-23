// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * StepSite validation tests — first-run wizard "Observing Site" step.
 *
 * Covers `siteStepError`/`siteStepHasSite` field-combination behavior,
 * including the empty-name-with-valid-coordinates case (#516): the step is
 * optional when fully blank, but once coordinates are entered a name is
 * required so the site isn't silently dropped at Finish.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SITE_STEP_STATE,
  siteStepError,
  siteStepHasSite,
  type SiteStepState,
} from './StepSite';
import { m } from '@/lib/i18n';

function state(overrides: Partial<SiteStepState>): SiteStepState {
  return { ...DEFAULT_SITE_STEP_STATE, ...overrides };
}

describe('siteStepError', () => {
  it('is valid (null) when the step is entirely blank', () => {
    expect(siteStepError(state({}))).toBeNull();
  });

  it('requires a name once valid coordinates are entered (#516)', () => {
    const s = state({ latitudeDegText: '51.5', longitudeDegText: '-0.13' });
    expect(siteStepError(s)).toBe(m.settings_observing_sites_error_name());
  });

  it('is valid once a name is added alongside valid coordinates', () => {
    const s = state({
      name: 'Home Backyard',
      latitudeDegText: '51.5',
      longitudeDegText: '-0.13',
    });
    expect(siteStepError(s)).toBeNull();
  });

  it('does not require a name when coordinates are still incomplete', () => {
    const s = state({ latitudeDegText: '51.5' });
    expect(siteStepError(s)).toBeNull();
  });

  it('still range-validates latitude once a name is present', () => {
    const s = state({
      name: 'Home Backyard',
      latitudeDegText: '200',
      longitudeDegText: '-0.13',
    });
    expect(siteStepError(s)).toBe(m.settings_observing_sites_error_latitude());
  });
});

describe('siteStepHasSite', () => {
  it('is false when the name is missing even with valid coordinates', () => {
    const s = state({ latitudeDegText: '51.5', longitudeDegText: '-0.13' });
    expect(siteStepHasSite(s)).toBe(false);
  });

  it('is true once name, latitude, and longitude are all filled in', () => {
    const s = state({
      name: 'Home Backyard',
      latitudeDegText: '51.5',
      longitudeDegText: '-0.13',
    });
    expect(siteStepHasSite(s)).toBe(true);
  });
});
