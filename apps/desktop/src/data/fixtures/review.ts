// Static mock fixture data for ReviewItem (8 items in the review queue)
// Types mirror @/api/types — inline definitions used until that module is created

type ReviewItemKind = 'session' | 'unclassified_file';
type ConfidenceLevel = 'unknown' | 'low' | 'medium' | 'high' | 'confirmed' | 'rejected';
type ProvenanceOrigin = 'reviewed' | 'inferred' | 'observed' | 'generated' | 'planned' | 'applied';

interface MetaValue {
  value: unknown;
  raw?: string;
  origin: ProvenanceOrigin;
  confidence: ConfidenceLevel;
  evidence_ref?: string;
}

interface ReviewItem {
  id: string;
  kind: ReviewItemKind;
  session_id?: string;
  file_path?: string;
  confidence: ConfidenceLevel;
  blocking_reasons: string[];
  evidence: Record<string, MetaValue>;
  suggested_target?: string;
  suggested_filter?: string;
}

export const reviewItems: ReviewItem[] = [
  // --- sessions (6) ---

  // 1. Unknown confidence — fresh discovery, many blocking reasons
  {
    id: '550e8400-e29b-41d4-a716-446655460001',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440001',
    confidence: 'unknown',
    blocking_reasons: [
      'target not yet confirmed — origin is observed, not reviewed',
      'filter origin is observed — please verify',
      'no calibration dark master matched for this gain/temp combination',
    ],
    evidence: {
      target: {
        value: 'NGC 7000',
        raw: 'NGC7000',
        origin: 'observed',
        confidence: 'medium',
      },
      filter: {
        value: 'Ha',
        raw: 'H-alpha 7nm',
        origin: 'observed',
        confidence: 'high',
      },
      night: {
        value: '2026-04-12',
        raw: '2026-04-12T21:00:00',
        origin: 'observed',
        confidence: 'high',
      },
      frame_count: {
        value: 18,
        raw: '18',
        origin: 'observed',
        confidence: 'high',
      },
      exposure_s: {
        value: 600,
        raw: '600',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'NGC 7000',
    suggested_filter: 'Ha',
  },

  // 2. Low confidence — inferred target, SII session
  {
    id: '550e8400-e29b-41d4-a716-446655460002',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440002',
    confidence: 'low',
    blocking_reasons: [
      'target confidence low — FITS OBJECT header ambiguous ("IC1396" matched multiple candidates)',
      'no flat master found for SII filter',
    ],
    evidence: {
      target: {
        value: 'IC 1396',
        raw: 'IC1396',
        origin: 'inferred',
        confidence: 'low',
        evidence_ref: 'fits.object',
      },
      filter: {
        value: 'SII',
        raw: 'SII 6.5nm',
        origin: 'observed',
        confidence: 'high',
      },
      night: {
        value: '2026-04-14',
        raw: '2026-04-14T22:00:00',
        origin: 'observed',
        confidence: 'high',
      },
      frame_count: {
        value: 12,
        raw: '12',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'IC 1396',
    suggested_filter: 'SII',
  },

  // 3. Medium confidence — filter inferred
  {
    id: '550e8400-e29b-41d4-a716-446655460003',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440003',
    confidence: 'medium',
    blocking_reasons: [
      'filter origin is inferred — FITS FILTER header missing, deduced from session context',
    ],
    evidence: {
      target: {
        value: 'M31',
        raw: 'M31',
        origin: 'observed',
        confidence: 'high',
      },
      filter: {
        value: 'L',
        raw: '',
        origin: 'inferred',
        confidence: 'medium',
        evidence_ref: 'session.context',
      },
      night: {
        value: '2026-03-28',
        raw: '2026-03-28T21:30:00',
        origin: 'observed',
        confidence: 'high',
      },
      frame_count: {
        value: 60,
        raw: '60',
        origin: 'observed',
        confidence: 'high',
      },
      temp_c: {
        value: -10,
        raw: '-10.1',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'M31',
    suggested_filter: 'L',
  },

  // 4. Medium confidence — object name alias needs confirmation
  {
    id: '550e8400-e29b-41d4-a716-446655460004',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440004',
    confidence: 'medium',
    blocking_reasons: [
      'object name "Orion Nebula" must be confirmed as alias for M42/NGC 1976',
    ],
    evidence: {
      target: {
        value: 'M42',
        raw: 'Orion Nebula',
        origin: 'inferred',
        confidence: 'medium',
        evidence_ref: 'fits.object',
      },
      filter: {
        value: 'Ha',
        raw: 'Ha',
        origin: 'observed',
        confidence: 'high',
      },
      night: {
        value: '2026-02-10',
        raw: '2026-02-10T20:00:00',
        origin: 'observed',
        confidence: 'high',
      },
      frame_count: {
        value: 30,
        raw: '30',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'M42',
    suggested_filter: 'Ha',
  },

  // 5. Medium confidence — gain/temp mismatch warning on calibration
  {
    id: '550e8400-e29b-41d4-a716-446655460005',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440007',
    confidence: 'medium',
    blocking_reasons: [
      'calibration dark master temp mismatch: session -10°C vs master -5°C (threshold: 3°C)',
    ],
    evidence: {
      target: {
        value: 'M31',
        raw: 'M31',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'R',
        raw: 'Red',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      night: {
        value: '2026-03-30',
        raw: '2026-03-30T21:00:00',
        origin: 'observed',
        confidence: 'high',
      },
      temp_c: {
        value: -10,
        raw: '-10.2',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'M31',
    suggested_filter: 'R',
  },

  // 6. High confidence — nearly ready, just missing reviewed optical train
  {
    id: '550e8400-e29b-41d4-a716-446655460006',
    kind: 'session',
    session_id: '550e8400-e29b-41d4-a716-446655440008',
    confidence: 'high',
    blocking_reasons: [
      'optical train not reviewed — equipment profile was auto-detected',
    ],
    evidence: {
      target: {
        value: 'NGC 2244',
        raw: 'NGC2244',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      filter: {
        value: 'Ha',
        raw: 'Ha 7nm',
        origin: 'reviewed',
        confidence: 'confirmed',
      },
      night: {
        value: '2026-01-20',
        raw: '2026-01-20T19:30:00',
        origin: 'observed',
        confidence: 'high',
      },
      frame_count: {
        value: 20,
        raw: '20',
        origin: 'observed',
        confidence: 'high',
      },
    },
    suggested_target: 'NGC 2244',
    suggested_filter: 'Ha',
  },

  // --- unclassified_files (2) ---

  // 7. Unclassified FITS file — uncertain target
  {
    id: '550e8400-e29b-41d4-a716-446655460007',
    kind: 'unclassified_file',
    file_path: '/media/Astrophoto/Inbox/2026-04-22/IMG_0042.fit',
    confidence: 'unknown',
    blocking_reasons: [
      'FITS OBJECT header missing or empty',
      'RA/Dec in FITS header does not match any known target within 5°',
    ],
    evidence: {
      file_name: {
        value: 'IMG_0042.fit',
        origin: 'observed',
        confidence: 'high',
      },
      ra: {
        value: 312.45,
        raw: '312.45',
        origin: 'observed',
        confidence: 'medium',
      },
      dec: {
        value: 44.1,
        raw: '44.1',
        origin: 'observed',
        confidence: 'medium',
      },
      exposure_s: {
        value: 300,
        raw: '300',
        origin: 'observed',
        confidence: 'high',
      },
    },
  },

  // 8. Unclassified file — non-FITS, unrecognised extension
  {
    id: '550e8400-e29b-41d4-a716-446655460008',
    kind: 'unclassified_file',
    file_path: '/media/Astrophoto/Inbox/2026-04-22/sequence_log_2026-04-22.log',
    confidence: 'unknown',
    blocking_reasons: [
      'file extension ".log" not a recognised image type — manual classification required',
    ],
    evidence: {
      file_name: {
        value: 'sequence_log_2026-04-22.log',
        origin: 'observed',
        confidence: 'high',
      },
      file_size_bytes: {
        value: 8_192,
        raw: '8192',
        origin: 'observed',
        confidence: 'high',
      },
    },
  },
];
