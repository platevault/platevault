import { Pill, Box } from '@/ui';

export interface StepReviewProps {
  wizardState: Record<string, unknown>;
}

// ── Mock plan items (matches wireframe exactly) ─────────────────────────────

interface PlanRowItem {
  action: 'mkdir' | 'write' | 'junction';
  destination: string;
  source: string | null; // null = no source (mkdir), string = source path or "generated"
}

const PLAN_ITEMS: PlanRowItem[] = [
  { action: 'mkdir', destination: 'NGC7000_HOO/', source: null },
  { action: 'mkdir', destination: 'NGC7000_HOO/.alm/', source: null },
  { action: 'mkdir', destination: 'NGC7000_HOO/sources/views/wbpp_input/', source: null },
  { action: 'write', destination: 'NGC7000_HOO/.alm/project.json', source: 'generated' },
  { action: 'junction', destination: '…/wbpp_input/lights/Ha_300s_0001.fit', source: 'D:\\…\\Raw\\…\\Ha_300s_0001.fit' },
  { action: 'junction', destination: '…/wbpp_input/lights/Ha_300s_0002.fit', source: 'D:\\…\\Raw\\…\\Ha_300s_0002.fit' },
];

const TRUNCATION_LABEL = '… 120 more junctions (118 lights + 4 masters)';

const FINAL_ITEM: PlanRowItem = {
  action: 'write',
  destination: 'NGC7000_HOO/sources/manifests/manifest.json',
  source: 'generated',
};

// ── Disk tree (matches wireframe <pre>) ─────────────────────────────────────

const DISK_TREE = `NGC7000_HOO/
├── .alm/
│   ├── project.json
│   └── manifests/
├── sources/
│   ├── manifests/
│   │   └── manifest.json
│   └── views/
│       └── wbpp_input/
│           ├── lights/  (122 junctions)
│           ├── darks/   (1)
│           ├── flats/   (2)
│           └── bias/    (1)
├── processing/
│   └── pixinsight/
├── outputs/
└── notes/`;

// ── Component ───────────────────────────────────────────────────────────────

export function StepReview({ wizardState: _wizardState }: StepReviewProps) {
  return (
    <div className="alm-wizard-review">
      {/* ── Green success banner ── */}
      <div className="alm-wizard-review__banner">
        <div className="alm-wizard-review__banner-row">
          <span className="alm-wizard-review__banner-icon">&#10003;</span>
          <div className="alm-wizard-review__banner-text">
            <strong>No destructive items.</strong> This plan only creates directories, junctions,
            and the project manifest. No source frames are moved, copied, or modified.
          </div>
        </div>
      </div>

      {/* ── 2-column grid: plan items (2fr) + disk tree / after creating (1fr) ── */}
      <div className="alm-wizard-review__grid">
        {/* Left: Plan items */}
        <Box title="Plan items (132)">
          <table className="alm-simple-table">
            <thead>
              <tr>
                <th className="alm-wizard-review__col-action">Action</th>
                <th>Destination</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {PLAN_ITEMS.map((item, i) => (
                <tr key={i}>
                  <td><Pill variant="info">{item.action}</Pill></td>
                  <td className="alm-mono alm-wizard-review__cell-path">{item.destination}</td>
                  <td>
                    {item.source === null ? (
                      <span className="alm-wizard-review__source-none">&mdash;</span>
                    ) : (
                      <span className="alm-mono alm-wizard-review__source-path">
                        {item.source}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Truncation row */}
              <tr>
                <td colSpan={3} className="alm-wizard-review__truncation">
                  {TRUNCATION_LABEL}
                </td>
              </tr>
              {/* Final manifest write */}
              <tr>
                <td><Pill variant="info">{FINAL_ITEM.action}</Pill></td>
                <td className="alm-mono alm-wizard-review__cell-path">{FINAL_ITEM.destination}</td>
                <td>
                  <span className="alm-mono alm-wizard-review__source-path">
                    {FINAL_ITEM.source}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </Box>

        {/* Right column */}
        <div className="alm-wizard-review__right">
          {/* Disk tree */}
          <Box title="What will exist on disk">
            <pre className="alm-mono alm-wizard-review__disk-tree">
              {DISK_TREE}
            </pre>
          </Box>

          {/* After creating */}
          <Box title="After creating">
            <ol className="alm-wizard-review__after-list">
              <li>
                Project lifecycle:{' '}
                <span className="alm-mono">setup</span> &rarr;{' '}
                <span className="alm-mono">prepared</span>
              </li>
              <li>
                Open <span className="alm-mono">NGC7000_HOO/sources/views/wbpp_input</span> in
                PixInsight/WBPP
              </li>
              <li>Process there; outputs are observed on refresh.</li>
              <li>Record final outputs back here when done.</li>
            </ol>
          </Box>
        </div>
      </div>
    </div>
  );
}
