/**
 * T055 — Session naming rules per frame type.
 *
 * Lights: {OBJECT} - {DATE} - {FILTER}
 * Darks:  {TYPE} - {DATE} - {SET-TEMP}
 * Flats:  {TYPE} - {DATE} - {FILTER}
 * Bias:   {TYPE} - {DATE}
 */

export type FrameType = 'light' | 'dark' | 'flat' | 'bias';

export interface SessionMetadata {
  frameType: FrameType;
  object?: string;
  date: string;
  filter?: string;
  setTemp?: string;
}

export function formatSessionName(meta: SessionMetadata): string {
  switch (meta.frameType) {
    case 'light': {
      const parts = [meta.object ?? 'Unknown', meta.date];
      if (meta.filter) parts.push(meta.filter);
      return parts.join(' - ');
    }
    case 'dark': {
      const parts = ['Dark', meta.date];
      if (meta.setTemp) parts.push(meta.setTemp);
      return parts.join(' - ');
    }
    case 'flat': {
      const parts = ['Flat', meta.date];
      if (meta.filter) parts.push(meta.filter);
      return parts.join(' - ');
    }
    case 'bias':
      return `Bias - ${meta.date}`;
  }
}

export function inferFrameType(kind: string): FrameType {
  switch (kind) {
    case 'dark':
      return 'dark';
    case 'flat':
      return 'flat';
    case 'bias':
      return 'bias';
    default:
      return 'light';
  }
}
