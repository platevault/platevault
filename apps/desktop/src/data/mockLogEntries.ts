/**
 * Mock log entries for browser-only / test mode (VITE_USE_MOCKS=true).
 * Matches the LogEntry shape from spec 019.
 */
import type { LogEntry } from './logStore';

export const MOCK_LOG_ENTRIES: LogEntry[] = [
  {
    id: 'aud:1',
    contractVersion: '1',
    time: '2026-04-18T22:15:04Z',
    level: 'info',
    source: 'inventory',
    message: 'Scan completed: 1,247 files indexed',
  },
  {
    id: 'aud:2',
    contractVersion: '1',
    time: '2026-04-18T22:15:02Z',
    level: 'warn',
    source: 'inventory',
    message: 'FITS keyword OBJECT missing on 3 frames in /raw/2026-04-18/',
  },
  {
    id: 'aud:3',
    contractVersion: '1',
    time: '2026-04-18T22:14:59Z',
    level: 'error',
    source: 'inventory',
    message: 'Failed to read: /raw/2026-04-17/frame_0043.fit — permission denied',
  },
  {
    id: 'aud:4',
    contractVersion: '1',
    time: '2026-04-18T22:14:58Z',
    level: 'info',
    source: 'plan',
    message: 'Plan approved',
    entityType: 'plan',
    entityId: 'plan-001',
  },
  {
    id: 'aud:5',
    contractVersion: '1',
    time: '2026-04-18T22:14:56Z',
    level: 'debug',
    source: 'audit',
    message: 'Metadata cache hit for root hash a3f9c12',
  },
  {
    id: 'aud:6',
    contractVersion: '1',
    time: '2026-04-18T22:14:55Z',
    level: 'info',
    source: 'inventory',
    message: 'Scan started for root /astro/raw',
  },
  {
    id: 'aud:7',
    contractVersion: '1',
    time: '2026-04-18T22:14:50Z',
    level: 'debug',
    source: 'settings',
    message: 'Loaded preferences: density=comfortable, theme=system',
  },
  {
    id: 'aud:8',
    contractVersion: '1',
    time: '2026-04-18T22:14:48Z',
    level: 'warn',
    source: 'inventory',
    message: 'Root /external/drive not found — reconnect drive to restore',
  },
];
