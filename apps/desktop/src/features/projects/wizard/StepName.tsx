import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';

export interface StepNameData {
  name: string;
  workflowProfile: 'pixinsight' | 'siril' | 'planetary';
}

export interface StepNameProps {
  data: StepNameData;
  onChange: (data: StepNameData) => void;
}

const PROFILES = [
  { id: 'pixinsight' as const, label: 'PixInsight / WBPP', description: 'Deep-sky processing with WeightedBatchPreProcessing' },
  { id: 'siril' as const, label: 'Siril', description: 'Free deep-sky stacking and processing' },
  { id: 'planetary' as const, label: 'Planetary / Lunar', description: 'Video-based capture with stacking tools' },
];

export function StepName({ data, onChange }: StepNameProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-5)' }}>
      {/* Project name */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}>
        <label
          htmlFor="project-name"
          style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}
        >
          Project name
        </label>
        <input
          id="project-name"
          type="text"
          value={data.name}
          onChange={(e) => onChange({ ...data, name: e.target.value })}
          placeholder="e.g. NGC 7000 — HOO Narrowband"
          style={{
            padding: 'var(--alm-space-2) var(--alm-space-3)',
            border: '1px solid var(--alm-border)',
            borderRadius: 4,
            fontSize: 'var(--alm-text-sm)',
            background: 'var(--alm-surface)',
            color: 'var(--alm-text)',
          }}
        />
      </div>

      {/* Workflow profile */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
        <span style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
          Workflow profile
        </span>
        <RadioGroup
          value={data.workflowProfile}
          onValueChange={(value) =>
            onChange({ ...data, workflowProfile: value as StepNameData['workflowProfile'] })
          }
          aria-label="Workflow profile"
          style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-2)' }}
        >
          {PROFILES.map((profile) => (
            <label
              key={profile.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--alm-space-3)',
                padding: 'var(--alm-space-3)',
                border: `1px solid ${data.workflowProfile === profile.id ? 'var(--alm-gray-900)' : 'var(--alm-border)'}`,
                borderRadius: 6,
                cursor: 'pointer',
                background: data.workflowProfile === profile.id ? 'var(--alm-surface)' : 'transparent',
              }}
            >
              <Radio.Root
                value={profile.id}
                className="alm-radio"
                aria-label={profile.label}
              >
                <Radio.Indicator className="alm-radio__indicator" />
              </Radio.Root>
              <div>
                <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 500 }}>
                  {profile.label}
                </div>
                <div style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)' }}>
                  {profile.description}
                </div>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
