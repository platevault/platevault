// Static mock fixture data for Equipment and LibraryRoot
// Types mirror @/bindings/types — inline definitions used until that module is created

type EquipmentKind = 'camera' | 'telescope' | 'mount' | 'filter_wheel' | 'focuser' | 'guide_camera';

interface Equipment {
  id: string;
  kind: EquipmentKind;
  make: string;
  model: string;
  alias?: string;
  detected_from_metadata: boolean;
  optical_train_ids: string[];
  notes?: string;
}

type RootCategory = 'raw' | 'calibration' | 'project' | 'inbox' | 'archive';
type RootOnlineState = 'online' | 'offline' | 'reconnect_required';

interface LibraryRoot {
  id: string;
  path: string;
  label: string;
  category: RootCategory;
  online_state: RootOnlineState;
  file_count: number;
  size_bytes: number;
  last_scanned_at?: string;
  scan_settings: {
    follow_symlinks: boolean;
    excluded_patterns: string[];
  };
}

// Optical train IDs (also referenced in sessions.ts)
const TRAIN_FSQ106_ASI2600 = '550e8400-e29b-41d4-a716-446655440101';
const TRAIN_GT81_ASI533 = '550e8400-e29b-41d4-a716-446655440102';

export const equipment: Equipment[] = [
  // --- Cameras ---
  {
    id: '550e8400-e29b-41d4-a716-446655440151',
    kind: 'camera',
    make: 'ZWO',
    model: 'ASI2600MM Pro',
    alias: 'Main Mono',
    detected_from_metadata: true,
    optical_train_ids: [TRAIN_FSQ106_ASI2600],
    notes: 'Mono cooled camera, primary narrowband imager',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440152',
    kind: 'camera',
    make: 'ZWO',
    model: 'ASI533MC Pro',
    alias: 'Color Wide',
    detected_from_metadata: true,
    optical_train_ids: [TRAIN_GT81_ASI533],
    notes: 'Color camera on travel refractor',
  },

  // --- Telescopes ---
  {
    id: '550e8400-e29b-41d4-a716-446655440153',
    kind: 'telescope',
    make: 'Takahashi',
    model: 'FSQ-106EDX4',
    alias: 'FSQ-106',
    detected_from_metadata: true,
    optical_train_ids: [TRAIN_FSQ106_ASI2600],
    notes: 'Primary imaging refractor, f/5 530mm focal length',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440154',
    kind: 'telescope',
    make: 'William Optics',
    model: 'GT81',
    alias: 'GT81',
    detected_from_metadata: true,
    optical_train_ids: [TRAIN_GT81_ASI533],
    notes: 'Travel refractor, f/5.9 478mm focal length',
  },

  // --- Mount ---
  {
    id: '550e8400-e29b-41d4-a716-446655440155',
    kind: 'mount',
    make: 'iOptron',
    model: 'CEM120',
    alias: 'Main Mount',
    detected_from_metadata: false, // mounts not always in FITS headers
    optical_train_ids: [TRAIN_FSQ106_ASI2600, TRAIN_GT81_ASI533],
    notes: 'Belt-drive equatorial, 45kg capacity',
  },
];

export const roots: LibraryRoot[] = [
  // Root 1: Main external drive — online, primary raw storage
  {
    id: '550e8400-e29b-41d4-a716-446655440901',
    path: '/media/Astrophoto',
    label: 'Main Astrophoto Drive',
    category: 'raw',
    online_state: 'online',
    file_count: 12_450,
    size_bytes: 2_199_023_255_552, // 2 TiB
    last_scanned_at: '2026-04-20T06:14:33Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store', '**/Thumbs.db', '**/*.tmp'],
    },
  },

  // Root 2: Calibration library — online
  {
    id: '550e8400-e29b-41d4-a716-446655440902',
    path: '/media/Calibration',
    label: 'Calibration Library',
    category: 'calibration',
    online_state: 'online',
    file_count: 2_340,
    size_bytes: 549_755_813_888, // 512 GiB
    last_scanned_at: '2026-04-20T06:16:10Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store'],
    },
  },

  // Root 3: Archive drive — offline, drive not mounted
  {
    id: '550e8400-e29b-41d4-a716-446655440903',
    path: '/media/AstroArchive2024',
    label: 'Archive 2024',
    category: 'archive',
    online_state: 'offline',
    file_count: 0, // can't count while offline
    size_bytes: 0,
    last_scanned_at: '2025-12-31T22:00:00Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: [],
    },
  },
];
