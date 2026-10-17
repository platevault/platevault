// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import {
  resolveRevealPath,
  basename,
  parentSegment,
  wireBasename,
} from './path';

describe('resolveRevealPath', () => {
  it('joins a forward-slash relative path onto a unix root', () => {
    expect(resolveRevealPath('/var/lib/pv', 'sessions/2024/IC1396')).toBe(
      '/var/lib/pv/sessions/2024/IC1396',
    );
  });

  it('strips trailing slash on root before joining', () => {
    expect(resolveRevealPath('/var/lib/pv/', 'sessions/2024')).toBe(
      '/var/lib/pv/sessions/2024',
    );
  });

  it('strips leading slash on relativePath before joining', () => {
    expect(resolveRevealPath('/var/lib/pv', '/sessions/2024')).toBe(
      '/var/lib/pv/sessions/2024',
    );
  });

  it('normalizes separators to backslash on a Windows root', () => {
    // Root uses backslash → relative forward slashes become backslashes.
    expect(
      resolveRevealPath('C:\\Users\\sjors\\Pictures', 'sessions/2024/IC1396'),
    ).toBe('C:\\Users\\sjors\\Pictures\\sessions\\2024\\IC1396');
  });

  it('returns rootPath when relativePath is null', () => {
    expect(resolveRevealPath('/var/lib/pv', null)).toBe('/var/lib/pv');
  });

  it('returns rootPath when relativePath is undefined', () => {
    expect(resolveRevealPath('/var/lib/pv', undefined)).toBe('/var/lib/pv');
  });

  it('returns rootPath when relativePath is empty string', () => {
    expect(resolveRevealPath('/var/lib/pv', '')).toBe('/var/lib/pv');
  });

  // bd astro-plan-3pvvc: on macOS and Linux `\` is part of a name, and the
  // backend keeps it in the relative path.
  it('keeps a backslash in a unix folder name', () => {
    expect(resolveRevealPath('/root', 'c\\d')).toBe('/root/c\\d');
  });

  it('keeps a backslash at the start of a unix name below a folder', () => {
    expect(resolveRevealPath('/root/', 'p/\\b.fits')).toBe('/root/p/\\b.fits');
  });

  it('keeps a backslash in a unix root name', () => {
    expect(resolveRevealPath('/data/a\\b', 'x')).toBe('/data/a\\b/x');
  });

  it('still treats every slash and backslash as a separator under a windows root', () => {
    expect(resolveRevealPath('C:\\lib\\', 'a\\b/c')).toBe('C:\\lib\\a\\b\\c');
    expect(resolveRevealPath('D:/Astro', 'a\\b')).toBe('D:/Astro/a/b');
  });
});

describe('basename', () => {
  it('returns the last forward-slash segment', () => {
    expect(basename('sessions/2024/IC1396')).toBe('IC1396');
  });

  it('handles backslash separators', () => {
    expect(basename('C:\\Users\\sjors\\Pictures')).toBe('Pictures');
  });

  it('returns the whole string when there are no separators', () => {
    expect(basename('filename.fits')).toBe('filename.fits');
  });

  it('returns the segment, not an empty string, when path ends with slash', () => {
    // path.split('/').pop() behaviour: empty string becomes fallback
    // this is consistent with the original implementation
    expect(basename('sessions/2024/')).toBe('sessions/2024/');
  });
});

describe('parentSegment', () => {
  it('returns the second-to-last segment', () => {
    expect(parentSegment('sessions/2024/IC1396')).toBe('2024');
  });

  it('returns empty string for a single-segment path', () => {
    expect(parentSegment('filename.fits')).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(parentSegment('')).toBe('');
  });

  it('handles backslash separators', () => {
    expect(parentSegment('C:\\Users\\sjors')).toBe('Users');
  });

  it('filters empty segments from trailing slashes', () => {
    expect(parentSegment('sessions/2024/')).toBe('sessions');
  });
});

// bd astro-plan-3pvvc: `/` is the only separator in a wire path; on macOS and
// Linux a backslash is part of a name.
describe('wireBasename', () => {
  it('keeps a backslash in the last name', () => {
    expect(wireBasename('folder/a\\b.fits')).toBe('a\\b.fits');
    expect(wireBasename('a\\b.fits')).toBe('a\\b.fits');
  });

  it('returns the last name of a nested path', () => {
    expect(wireBasename('sessions/2024/IC1396')).toBe('IC1396');
    expect(wireBasename('filename.fits')).toBe('filename.fits');
  });

  it('returns the whole path when it ends with a slash', () => {
    expect(wireBasename('sessions/2024/')).toBe('sessions/2024/');
  });
});

describe('native basename and parentSegment', () => {
  it('keep a backslash in a name under a macOS or Linux path', () => {
    expect(basename('/data/a\\b')).toBe('a\\b');
    expect(parentSegment('/data/a\\b/Lights')).toBe('a\\b');
  });

  it('split on both separators under a Windows drive or UNC path', () => {
    expect(basename('D:/Astro\\Lights')).toBe('Lights');
    expect(basename('\\\\nas\\astro\\lib')).toBe('lib');
    expect(parentSegment('C:\\Users\\sjors/Lights')).toBe('sjors');
  });
});
