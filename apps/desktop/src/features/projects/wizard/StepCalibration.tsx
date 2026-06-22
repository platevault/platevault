import { Pill, Box, Btn, Section } from '@/ui';

export interface CalibrationMapping {
  flatMappings: Record<string, string>; // filter -> master_id
  sharedDarkId: string;
  sharedBiasId: string;
  sharedDarkFlatId: string;
}

export interface StepCalibrationProps {
  selectedSessionIds: string[];
  data: CalibrationMapping;
  onChange: (data: CalibrationMapping) => void;
}

// ── Mock flat data keyed by filter (matches wireframe exactly) ──────────────

interface FlatOption {
  id: string;
  label: string;
  isDefault: boolean;
}

interface FlatRow {
  filter: string;
  lightsCovered: string;
  options: FlatOption[];
  score: string;
  notes: string;
}

const MOCK_FLAT_ROWS: FlatRow[] = [
  {
    filter: 'Ha',
    lightsCovered: 'NGC 7000 · Ha · 11-30 (54×) · NGC 7000 · Ha · 12-15 (30×)',
    options: [
      { id: 'm-7', label: 'MasterFlat_Ha_2024-11 (12d old)', isDefault: true },
      { id: 'm-5', label: 'MasterFlat_Ha_2024-12 (newer)', isDefault: false },
      { id: 'skip-ha', label: 'Skip — no flat for Ha', isDefault: false },
    ],
    score: '0.88',
    notes: 'filter-matched · same camera',
  },
  {
    filter: 'OIII',
    lightsCovered: 'NGC 7000 · OIII · 11-30 (38×)',
    options: [
      { id: 'm-8', label: 'MasterFlat_OIII_2024-11 (12d old)', isDefault: true },
      { id: 'm-6', label: 'MasterFlat_OIII_2024-12', isDefault: false },
      { id: 'skip-oiii', label: 'Skip — no flat for OIII', isDefault: false },
    ],
    score: '0.88',
    notes: 'filter-matched · same camera',
  },
];

// ── Mock shared calibration rows ────────────────────────────────────────────

interface SharedRow {
  role: 'dark' | 'bias' | 'dark flat';
  field: 'sharedDarkId' | 'sharedBiasId' | 'sharedDarkFlatId';
  options: Array<{ value: string; label: string }>;
  defaultValue: string;
  score: string;
  scoreWarn: boolean;
  notes: string;
  notesWarn: boolean;
}

const SHARED_ROWS: SharedRow[] = [
  {
    role: 'dark',
    field: 'sharedDarkId',
    options: [
      { value: 'm-1', label: 'MasterDark_300s_-10C_g100 · ASI2600MM · 23d (recommended)' },
      { value: 'cal-sess', label: 'Use calibration session instead…' },
      { value: '', label: 'Skip darks' },
    ],
    defaultValue: 'm-1',
    score: '0.92',
    scoreWarn: false,
    notes: 'exact exposure + temp + gain',
    notesWarn: false,
  },
  {
    role: 'bias',
    field: 'sharedBiasId',
    options: [
      { value: 'm-10', label: 'MasterBias_g100 · ASI2600MM (180d old — aging)' },
      { value: '', label: 'Skip bias (rely on darks)' },
    ],
    defaultValue: 'm-10',
    score: '0.71',
    scoreWarn: true,
    notes: 'age > 90d',
    notesWarn: true,
  },
  {
    role: 'dark flat',
    field: 'sharedDarkFlatId',
    options: [
      { value: '', label: 'Skip (no dark flats in library)' },
    ],
    defaultValue: '',
    score: '—',
    scoreWarn: false,
    notes: 'WBPP can compute from bias + darks',
    notesWarn: false,
  },
];

// ── Component ───────────────────────────────────────────────────────────────

export function StepCalibration({ selectedSessionIds: _selectedSessionIds, data, onChange }: StepCalibrationProps) {

  return (
    <div className="alm-wizard-calib__root">
      {/* Step description */}
      <div className="alm-wizard-calib__desc">
        Map calibration to each light source. Flats are per-filter (Ha flats can only calibrate
        Ha lights). Darks &amp; bias are usually shared across all lights of the same exposure /
        camera / gain.
      </div>

      {/* ── Flats per light source (by filter) ── */}
      <Section title="Flats — per light source">
        <div className="alm-wizard-calib__flat-subtitle">
          one master flat per filter; light sources are auto-grouped by filter
        </div>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>Filter</th>
              <th>Lights covered</th>
              <th>Master flat</th>
              <th className="alm-wizard-calib__col-score">Score</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_FLAT_ROWS.map((row) => {
              const currentValue = data.flatMappings[row.filter] || row.options.find((o) => o.isDefault)?.id || '';
              return (
                <tr key={row.filter}>
                  <td><Pill variant="ghost">{row.filter}</Pill></td>
                  <td className="alm-wizard-calib__cell-lights">{row.lightsCovered}</td>
                  <td>
                    <select
                      value={currentValue}
                      onChange={(e) =>
                        onChange({
                          ...data,
                          flatMappings: { ...data.flatMappings, [row.filter]: e.target.value },
                        })
                      }
                      className="alm-wizard-calib__select"
                      aria-label={`Flat master for ${row.filter}`}
                    >
                      {row.options.map((opt) => (
                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td className="alm-mono alm-wizard-calib__cell-score">{row.score}</td>
                  <td className="alm-wizard-calib__cell-notes">{row.notes}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Btn size="sm" className="alm-wizard-calib__add-flat-btn">+ Add another flat (for a future filter)</Btn>
      </Section>

      {/* ── Shared calibration: darks, bias, dark flats ── */}
      <Section title="Shared calibration — applies to all lights matching the fingerprint">
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th className="alm-wizard-calib__col-role">Role</th>
              <th>Pick</th>
              <th className="alm-wizard-calib__col-score">Score</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {SHARED_ROWS.map((row) => {
              const currentValue = data[row.field] || row.defaultValue;
              return (
                <tr key={row.role}>
                  <td><Pill variant="ghost">{row.role}</Pill></td>
                  <td>
                    <select
                      value={currentValue}
                      onChange={(e) => onChange({ ...data, [row.field]: e.target.value })}
                      className="alm-wizard-calib__select"
                      aria-label={`Pick ${row.role}`}
                    >
                      {row.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td
                    className="alm-mono alm-wizard-calib__cell-score"
                    // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional token color for score warning / faint states
                    style={{
                      color: row.scoreWarn ? 'var(--alm-warn)' : row.score === '—' ? 'var(--alm-text-faint)' : undefined,
                    }}
                  >
                    {row.score}
                  </td>
                  <td
                    className="alm-wizard-calib__cell-notes-dyn"
                    // eslint-disable-next-line no-restricted-syntax -- dynamic: conditional token color for notes warning state
                    style={{
                      color: row.notesWarn ? 'var(--alm-warn)' : 'var(--alm-text-muted)',
                    }}
                  >
                    {row.notes}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="alm-wizard-calib__footer">
          <Btn size="sm">+ Add calibration session&hellip;</Btn>
          <Btn size="sm">+ Import master&hellip;</Btn>
          <span className="alm-wizard-calib__footer-warn">
            &#9888; aging bias master &mdash; soft mismatch in plan
          </span>
        </div>
      </Section>

      {/* ── Why these were recommended ── */}
      <Box title="Why these were recommended">
        <ul className="alm-wizard-calib__why-list">
          <li><strong>Flats</strong>: matched per filter; same camera; flats &lt; 30d old preferred</li>
          <li><strong>Dark</strong>: exact match on EXPTIME (300s) &middot; temp &#916; 0.1&deg;C &middot; gain 100</li>
          <li><strong>Bias</strong>: only g100 bias for this camera exists; soft mismatch on age</li>
        </ul>
      </Box>
    </div>
  );
}
