import { useState } from 'react';
import { remapRoot, applyRootRemap } from '@/api/commands';
import { DirPicker, Btn } from '@/ui';
import type { RemapVerification } from '@/api/types';

export function RootRecovery() {
  const [rootId] = useState('root-003'); // In a real app, user selects an offline root
  const [originalPath] = useState('/media/AstroArchive2024');
  const [lastSeen] = useState('2025-12-31');
  const [newPath, setNewPath] = useState('');
  const [verification, setVerification] = useState<RemapVerification | null>(null);
  const [applying, setApplying] = useState(false);

  const handleVerify = async () => {
    if (!newPath) return;
    const result = await remapRoot({ root_id: rootId, new_path: newPath });
    setVerification(result);
  };

  const handleApply = async () => {
    if (!verification?.all_verified) return;
    setApplying(true);
    await applyRootRemap({ root_id: rootId, verified: true });
    setApplying(false);
  };

  return (
    <div className="alm-recovery">
      <div className="alm-recovery__container">
        {/* Original info */}
        <div className="alm-recovery__info">
          <h3 className="alm-recovery__subtitle">Offline Root</h3>
          <dl className="alm-recovery__dl">
            <dt>Original path</dt>
            <dd>
              <code className="alm-mono">{originalPath}</code>
            </dd>
            <dt>Last seen</dt>
            <dd>{lastSeen}</dd>
          </dl>
        </div>

        {/* New path picker */}
        <DirPicker
          value={newPath}
          onChange={(path) => {
            setNewPath(path);
            setVerification(null);
          }}
          label="New path"
        />
        <Btn size="sm" variant="primary" onClick={handleVerify} disabled={!newPath}>
          Verify path
        </Btn>

        {/* Verification samples */}
        {verification && (
          <div className="alm-recovery__verification">
            <h4 className="alm-recovery__subtitle">Sample verification</h4>
            <ul className="alm-recovery__samples">
              {verification.samples.map((sample) => (
                <li key={sample.relative_path} className="alm-recovery__sample">
                  <span
                    className={
                      sample.found
                        ? 'alm-recovery__sample-icon--found'
                        : 'alm-recovery__sample-icon--missing'
                    }
                  >
                    {sample.found ? '✓' : '✕'}
                  </span>
                  <code className="alm-mono">{sample.relative_path}</code>
                  <span className="alm-recovery__sample-status">
                    {sample.found ? 'found' : 'missing'}
                  </span>
                </li>
              ))}
            </ul>

            {/* What will change */}
            <div className="alm-recovery__summary">
              <h4 className="alm-recovery__subtitle">What will change</h4>
              <ul>
                <li>
                  Root path updated from{' '}
                  <code className="alm-mono">{verification.original_path}</code> to{' '}
                  <code className="alm-mono">{verification.new_path}</code>
                </li>
                <li>All file references under this root will be relinked</li>
                <li>Root state will change from offline to online</li>
              </ul>
            </div>

            <Btn
              variant="primary"
              onClick={handleApply}
              disabled={!verification.all_verified || applying}
            >
              {applying ? 'Applying...' : 'Apply remap'}
            </Btn>
          </div>
        )}
      </div>
    </div>
  );
}
