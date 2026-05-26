/**
 * T053 — InboxConfirmOverlay: inbox-specific confirm overlay.
 *
 * Wraps the shared ConfirmOverlay with a property summary of the session
 * being confirmed, plus a directory preview (mock text — real token pattern
 * engine not yet available).
 */

import { useMemo } from 'react';
import { Pill } from '@/ui';
import { ConfirmOverlay } from '@/components';
import { formatSessionName } from './session-naming';
import type { InboxSession } from './mock-data';

export interface InboxConfirmOverlayProps {
  open: boolean;
  session: InboxSession;
  onConfirm: () => void;
  onCancel: () => void;
}

export function InboxConfirmOverlay({
  open,
  session,
  onConfirm,
  onCancel,
}: InboxConfirmOverlayProps) {
  const sessionName = useMemo(
    () =>
      formatSessionName({
        frameType: session.frameType,
        object: session.object,
        date: session.date,
        filter: session.filter || undefined,
        setTemp: session.setTemp ?? undefined,
      }),
    [session],
  );

  // Mock directory preview — real token pattern engine not yet available
  const directoryPreview = useMemo(() => {
    const parts = [session.rootPath];
    switch (session.frameType) {
      case 'light':
        parts.push('Lights', session.object, session.date);
        if (session.filter) parts.push(session.filter);
        break;
      case 'dark':
        parts.push('Darks', session.date, `${session.exposureSeconds}s`);
        break;
      case 'flat':
        parts.push('Flats', session.date);
        if (session.filter) parts.push(session.filter);
        break;
      case 'bias':
        parts.push('Bias', session.date);
        break;
    }
    return parts.join('/');
  }, [session]);

  return (
    <ConfirmOverlay
      open={open}
      onClose={onCancel}
      onConfirm={onConfirm}
      title="Confirm Session"
      description="Review the session details before confirming."
      confirmLabel="Confirm Session"
    >
      <div className="alm-inbox-confirm">
        {/* Session name */}
        <div className="alm-inbox-confirm__name">
          <h4 className="alm-inbox-confirm__name-label">Session</h4>
          <span className="alm-inbox-confirm__name-value">{sessionName}</span>
        </div>

        {/* Property summary */}
        <div className="alm-inbox-confirm__summary">
          <h4 className="alm-inbox-confirm__summary-label">Properties</h4>
          <div className="alm-inbox-confirm__props">
            {session.properties.map((prop) => (
              <div key={prop.key} className="alm-inbox-confirm__prop-row">
                <span className="alm-inbox-confirm__prop-label">
                  {prop.label}
                </span>
                <span className="alm-inbox-confirm__prop-value">
                  {prop.value !== null && prop.value !== undefined
                    ? String(prop.value)
                    : '—'}
                </span>
                <Pill
                  label={prop.source.toUpperCase()}
                  variant={prop.confirmed ? 'ok' : 'neutral'}
                  size="sm"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Directory preview */}
        <div className="alm-inbox-confirm__directory">
          <h4 className="alm-inbox-confirm__directory-label">
            Target Directory
          </h4>
          <code className="alm-inbox-confirm__directory-path">
            {directoryPreview}
          </code>
          <p className="alm-inbox-confirm__directory-note">
            Token pattern engine preview — actual path may differ after
            confirmation.
          </p>
        </div>

        {/* Frames count */}
        <div className="alm-inbox-confirm__frames">
          <span className="alm-inbox-confirm__frames-count">
            {session.frameCount} frames
          </span>
          <span className="alm-inbox-confirm__frames-dot" />
          <Pill label={session.frameType} variant="neutral" size="sm" />
          {session.filter && (
            <>
              <span className="alm-inbox-confirm__frames-dot" />
              <Pill label={session.filter} variant="info" size="sm" />
            </>
          )}
        </div>
      </div>
    </ConfirmOverlay>
  );
}
