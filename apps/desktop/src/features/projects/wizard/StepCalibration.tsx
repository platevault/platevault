import { m } from '@/lib/i18n';
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
      { id: 'm-7', label: m.projects_wizard_mock_flat_ha_2024_11(), isDefault: true },
      { id: 'm-5', label: m.projects_wizard_mock_flat_ha_2024_12(), isDefault: false },
      { id: 'skip-ha', label: m.projects_wizard_mock_skip_ha(), isDefault: false },
    ],
    score: '0.88',
    notes: 'filter-matched · same camera',
  },
  {
    filter: 'OIII',
    lightsCovered: 'NGC 7000 · OIII · 11-30 (38×)',
    options: [
      { id: 'm-8', label: m.projects_wizard_mock_flat_oiii_2024_11(), isDefault: true },
      { id: 'm-6', label: m.projects_wizard_mock_flat_oiii_2024_12(), isDefault: false },
      { id: 'skip-oiii', label: m.projects_wizard_mock_skip_oiii(), isDefault: false },
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
      { value: 'm-1', label: m.projects_wizard_mock_dark_recommended() },
      { value: 'cal-sess', label: m.projects_wizard_mock_use_cal_session() },
      { value: '', label: m.projects_wizard_mock_skip_darks() },
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
      { value: 'm-10', label: m.projects_wizard_mock_bias_aging() },
      { value: '', label: m.projects_wizard_mock_skip_bias() },
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
      { value: '', label: m.projects_wizard_mock_skip_dark_flats() },
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
        {m.projects_wizard_calib_desc()}
      </div>

      {/* ── Flats per light source (by filter) ── */}
      <Section title={m.projects_wizard_flats_title()}>
        <div className="alm-wizard-calib__flat-subtitle">
          {m.projects_wizard_flats_subtitle()}
        </div>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th>{m.common_filter()}</th>
              <th>{m.projects_wizard_col_lights()}</th>
              <th>{m.projects_wizard_col_master_flat()}</th>
              <th className="alm-wizard-calib__col-score">{m.projects_wizard_col_score()}</th>
              <th>{m.projects_notes_label()}</th>
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
                      aria-label={m.projects_wizard_flat_master_for_aria({ filter: row.filter })}
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
        <Btn size="sm" className="alm-wizard-calib__add-flat-btn">{m.projects_wizard_add_flat_btn()}</Btn>
      </Section>

      {/* ── Shared calibration: darks, bias, dark flats ── */}
      <Section title={m.projects_wizard_shared_calib_title()}>
        <table className="alm-simple-table">
          <thead>
            <tr>
              <th className="alm-wizard-calib__col-role">{m.projects_wizard_col_role()}</th>
              <th>{m.projects_wizard_col_pick()}</th>
              <th className="alm-wizard-calib__col-score">{m.projects_wizard_col_score()}</th>
              <th>{m.projects_notes_label()}</th>
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
                      aria-label={m.projects_wizard_pick_role_aria({ role: row.role })}
                    >
                      {row.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={
                      'alm-mono alm-wizard-calib__cell-score' +
                      (row.scoreWarn ? ' alm-wizard-calib__cell-score--warn' : row.score === '—' ? ' alm-wizard-calib__cell-score--faint' : '')
                    }
                  >
                    {row.score}
                  </td>
                  <td
                    className={'alm-wizard-calib__cell-notes-dyn' + (row.notesWarn ? ' alm-wizard-calib__cell-notes-dyn--warn' : '')}
                  >
                    {row.notes}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="alm-wizard-calib__footer">
          <Btn size="sm">{m.projects_wizard_add_calib_btn()}</Btn>
          <Btn size="sm">{m.projects_wizard_import_master_btn()}</Btn>
          <span className="alm-wizard-calib__footer-warn">
            {m.projects_wizard_aging_bias_warn()}
          </span>
        </div>
      </Section>

      {/* ── Why these were recommended ── */}
      <Box title={m.projects_wizard_why_title()}>
        <ul className="alm-wizard-calib__why-list">
          <li><strong>{m.projects_wizard_flats_label()}</strong>{m.projects_wizard_why_flats_val()}</li>
          <li><strong>{m.projects_wizard_why_dark_key()}</strong>{m.projects_wizard_why_dark_val()}</li>
          <li><strong>{m.projects_wizard_bias_label()}</strong>{m.projects_wizard_why_bias_val()}</li>
        </ul>
      </Box>
    </div>
  );
}
