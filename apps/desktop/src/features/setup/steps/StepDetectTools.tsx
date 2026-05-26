import { Pill } from '@/ui/Pill';

interface ToolEntry {
  name: string;
  description: string;
  detected: boolean;
  comingSoon: boolean;
}

const TOOLS: ToolEntry[] = [
  {
    name: 'PixInsight',
    description: 'Advanced image processing and analysis platform',
    detected: false,
    comingSoon: true,
  },
  {
    name: 'Siril',
    description: 'Free astronomical image processing tool',
    detected: false,
    comingSoon: true,
  },
  {
    name: 'DeepSkyStacker',
    description: 'Freeware for stacking deep-sky images',
    detected: false,
    comingSoon: true,
  },
  {
    name: 'AutoStakkert!',
    description: 'Planetary/lunar stacking tool',
    detected: false,
    comingSoon: true,
  },
  {
    name: 'RegiStax',
    description: 'Image processing for planetary imaging',
    detected: false,
    comingSoon: true,
  },
  {
    name: 'WinJUPOS',
    description: 'Planetary derotation and measurement',
    detected: false,
    comingSoon: true,
  },
];

/**
 * Step — Detect processing tools (stub).
 * Shows a fixture list of common astrophotography processing tools with
 * detection status. Auto-detection is planned for a future update.
 */
export function StepDetectTools() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-4)' }}>
      <p
        style={{
          fontSize: 'var(--alm-text-sm)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.6,
          maxWidth: 540,
        }}
      >
        The app can detect installed processing tools to help prepare project inputs
        and suggest workflow profiles. Auto-detection will be available in a future update.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--alm-space-3)' }}>
        {TOOLS.map((tool) => (
          <div
            key={tool.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--alm-space-4)',
              padding: 'var(--alm-space-3) var(--alm-space-4)',
              background: 'var(--alm-surface)',
              borderRadius: 'var(--alm-radius-sm)',
              border: '1px solid var(--alm-border)',
            }}
          >
            {/* Tool icon placeholder */}
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 'var(--alm-radius-sm)',
                background: 'var(--alm-bg)',
                border: '1px solid var(--alm-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 'var(--alm-text-sm)',
                fontWeight: 700,
                color: 'var(--alm-text-muted)',
                flexShrink: 0,
              }}
            >
              {tool.name.charAt(0)}
            </div>

            {/* Tool info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--alm-text-sm)', fontWeight: 600 }}>
                {tool.name}
              </div>
              <div
                style={{
                  fontSize: 'var(--alm-text-xs)',
                  color: 'var(--alm-text-muted)',
                  marginTop: 'var(--alm-space-1)',
                }}
              >
                {tool.description}
              </div>
            </div>

            {/* Status */}
            <div style={{ flexShrink: 0 }}>
              {tool.comingSoon ? (
                <Pill label="COMING SOON" variant="ghost" size="sm" />
              ) : tool.detected ? (
                <Pill label="DETECTED" variant="ok" size="sm" />
              ) : (
                <Pill label="NOT FOUND" variant="neutral" size="sm" />
              )}
            </div>
          </div>
        ))}
      </div>

      <p
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.5,
        }}
      >
        You can skip this step freely. Tool detection can be configured later in
        Settings &rarr; Processing tools.
      </p>
    </div>
  );
}
