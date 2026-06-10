// Static mock fixture data for the Archive page.
// Matches design V3 mock data — visual layout only, no backend wiring.

// ─── Design V3 flat fixture shape ───────────────────────────────────────────

export interface ArchiveFixture {
  id: number;
  name: string;
  entityType: 'project' | 'session' | 'master' | 'target' | 'plan';
  archivedAt: string;
  reason: string;
  originalPath: string;
  size: string;
}

export const ARCHIVE_DATA: ArchiveFixture[] = [
  { id: 1, name: 'NGC 7000 · HOO (v1)', entityType: 'project', archivedAt: '2024-12-18', reason: 'Superseded by reprocess', originalPath: 'D:/Astro/Projects/NGC7000_HOO_v1', size: '12.4 GB' },
  { id: 2, name: 'M31 · LRGB (draft)', entityType: 'project', archivedAt: '2024-11-30', reason: 'Abandoned draft', originalPath: 'D:/Astro/Projects/M31_LRGB_draft', size: '8.1 GB' },
  { id: 3, name: 'M42 · Ha · 2024-10-12', entityType: 'session', archivedAt: '2024-10-14', reason: 'Rejected — guiding errors', originalPath: 'E:/Capture/2024-10-12/M42_Ha', size: '2.1 GB' },
  { id: 4, name: 'IC 1396 · OIII · 2024-09-03', entityType: 'session', archivedAt: '2024-09-05', reason: 'Duplicate import', originalPath: 'E:/Capture/2024-09-03/IC1396_OIII', size: '1.8 GB' },
  { id: 5, name: 'master_dark_300s_-10C_g100', entityType: 'master', archivedAt: '2024-08-21', reason: 'Aging > 1 year', originalPath: 'D:/Astro/Calibration/masters/dark_300s', size: '512 MB' },
  { id: 6, name: '(unresolved) cluster', entityType: 'target', archivedAt: '2024-07-19', reason: 'Merged into M45', originalPath: '—', size: '—' },
  { id: 7, name: 'NGC7000_panel_3.nina', entityType: 'plan', archivedAt: '2024-06-02', reason: 'Plan deprecated', originalPath: 'C:/Users/astro/Documents/NINA/NGC7000_panel_3.nina', size: '14 KB' },
];
