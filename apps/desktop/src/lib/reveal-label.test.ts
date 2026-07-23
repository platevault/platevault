// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * revealLabel — the single shared platform-native reveal label.
 *
 * Product convention: Windows → "Show in File Explorer", macOS → "Reveal in
 * Finder", Linux → "Show in file manager". Platform comes from the webview
 * navigator (userAgentData.platform, falling back to navigator.platform).
 */

import { describe, it, expect } from 'vitest';
import { osFamily, revealLabel } from './reveal-label';

function navWith(platform: string, uaData?: string) {
  return {
    platform,
    ...(uaData !== undefined ? { userAgentData: { platform: uaData } } : {}),
  } as Navigator & { userAgentData?: { platform?: string } };
}

describe('osFamily', () => {
  it('detects Windows from userAgentData.platform', () => {
    expect(osFamily(navWith('', 'Windows'))).toBe('windows');
  });

  it('detects macOS from navigator.platform fallback', () => {
    expect(osFamily(navWith('MacIntel'))).toBe('macos');
  });

  it('defaults to linux for unknown/empty platforms', () => {
    expect(osFamily(navWith(''))).toBe('linux');
    expect(osFamily(navWith('Linux x86_64'))).toBe('linux');
  });
});

describe('revealLabel', () => {
  it('Windows → Show in File Explorer', () => {
    expect(revealLabel('windows')).toBe('Show in File Explorer');
  });

  it('macOS → Reveal in Finder', () => {
    expect(revealLabel('macos')).toBe('Reveal in Finder');
  });

  it('Linux → Show in file manager', () => {
    expect(revealLabel('linux')).toBe('Show in file manager');
  });
});
