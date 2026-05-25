import { Box } from '@/ui/Box';
import { Btn } from '@/ui/Btn';
import { DirPicker } from '@/ui/DirPicker';
import { Pill } from '@/ui/Pill';

/** A source category with zero or more folder paths. */
export interface SourceCategory {
  key: string;
  label: string;
  note: string;
  required: boolean;
  paths: string[];
  /** Estimated file count per path index. */
  estimates: number[];
}

export interface StepSourcesProps {
  categories: SourceCategory[];
  onCategoriesChange: (categories: SourceCategory[]) => void;
}

/**
 * Step 2 — Library sources.
 * Renders one Box card per source category (Raw, Calibration, Project, Inbox).
 * Each card supports multiple folders with individual DirPicker, estimated
 * file count, and remove button. An "+ Add folder..." button appends a new
 * empty picker to the category.
 *
 * The parent SetupWizard renders the step heading and navigation footer.
 */
export function StepSources({ categories, onCategoriesChange }: StepSourcesProps) {
  function updateCategory(index: number, update: Partial<SourceCategory>) {
    const next = categories.map((cat, i) =>
      i === index ? { ...cat, ...update } : cat,
    );
    onCategoriesChange(next);
  }

  function addFolder(catIndex: number) {
    const cat = categories[catIndex];
    updateCategory(catIndex, {
      paths: [...cat.paths, ''],
      estimates: [...cat.estimates, 0],
    });
  }

  function removeFolder(catIndex: number, pathIndex: number) {
    const cat = categories[catIndex];
    updateCategory(catIndex, {
      paths: cat.paths.filter((_, j) => j !== pathIndex),
      estimates: cat.estimates.filter((_, j) => j !== pathIndex),
    });
  }

  function setFolderPath(catIndex: number, pathIndex: number, path: string) {
    const cat = categories[catIndex];
    const nextPaths = cat.paths.map((p, j) => (j === pathIndex ? path : p));
    // Generate a placeholder estimate when a new path is chosen
    const nextEstimates = cat.estimates.map((e, j) =>
      j === pathIndex && path && !e
        ? Math.floor(Math.random() * 40_000) + 500
        : e,
    );
    updateCategory(catIndex, { paths: nextPaths, estimates: nextEstimates });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {categories.map((cat, catIdx) => (
        <Box key={cat.key}>
          {/* Category header row */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 'var(--alm-space-4)',
              marginBottom: 'var(--alm-space-3)',
            }}
          >
            <span style={{ fontSize: 'var(--alm-text-base)', fontWeight: 600 }}>
              {cat.label}
            </span>
            <Pill
              label={cat.required ? 'REQUIRED' : 'OPTIONAL'}
              variant={cat.required ? 'warn' : 'ghost'}
              size="sm"
            />
            <span
              style={{
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-muted)',
              }}
            >
              {cat.note}
            </span>
          </div>

          {/* Folder list or empty state */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
            {cat.paths.length === 0 && (
              <div
                style={{
                  padding: 'var(--alm-space-5)',
                  border: '1px dashed var(--alm-border)',
                  borderRadius: 'var(--alm-radius-sm)',
                  color: 'var(--alm-text-muted)',
                  fontSize: 'var(--alm-text-sm)',
                  textAlign: 'center',
                }}
              >
                No folders added
              </div>
            )}

            {cat.paths.map((folderPath, pathIdx) => (
              <div
                key={pathIdx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--alm-space-3)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <DirPicker
                    value={folderPath}
                    onChange={(p) => setFolderPath(catIdx, pathIdx, p)}
                  />
                </div>
                {cat.estimates[pathIdx] > 0 && (
                  <span
                    style={{
                      color: 'var(--alm-text-muted)',
                      fontSize: 'var(--alm-text-xs)',
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    ~{Math.round(cat.estimates[pathIdx] / 1000)}k files (est.)
                  </span>
                )}
                <Btn size="sm" onClick={() => removeFolder(catIdx, pathIdx)}>
                  remove
                </Btn>
              </div>
            ))}
          </div>

          {/* Add folder button */}
          <div style={{ marginTop: 'var(--alm-space-3)' }}>
            <Btn size="sm" onClick={() => addFolder(catIdx)}>
              + Add folder&hellip;
            </Btn>
          </div>
        </Box>
      ))}
    </div>
  );
}
