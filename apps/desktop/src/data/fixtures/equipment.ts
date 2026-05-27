// Static mock fixture data for Equipment and LibraryRoot
// Updated to match design V3 mock data.

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

// ─── Design V3 flat fixture shapes ──────────────────────────────────────────

export interface OpticalTrainEquipmentFixture {
  id: number;
  name: string;
  camera: string;
  telescope: string;
  focalLength: string;
  pixelScale: string;
  active: boolean;
}

export interface CameraEquipmentFixture {
  id: number;
  model: string;
  sensor: string;
  pixelSize: string;
  resolution: string;
  cooled: boolean;
  color: boolean;
  detectedFrom: string;
}

export interface TelescopeEquipmentFixture {
  id: number;
  model: string;
  aperture: string;
  focalLength: string;
  fRatio: string;
}

export const OPTICAL_TRAINS_EQUIPMENT: OpticalTrainEquipmentFixture[] = [
  { id: 1, name: 'FSQ-106 + ASI2600MM', camera: 'ZWO ASI2600MM Pro', telescope: 'Takahashi FSQ-106EDX4', focalLength: '530 mm', pixelScale: '1.74″/px', active: true },
  { id: 2, name: 'GT81 + ASI533MC', camera: 'ZWO ASI533MC Pro', telescope: 'William Optics GT81', focalLength: '478 mm', pixelScale: '2.20″/px', active: true },
];

export const CAMERAS_EQUIPMENT: CameraEquipmentFixture[] = [
  { id: 1, model: 'ZWO ASI2600MM Pro', sensor: 'Sony IMX571', pixelSize: '3.76 μm', resolution: '6248 × 4176', cooled: true, color: false, detectedFrom: 'FITS headers' },
  { id: 2, model: 'ZWO ASI533MC Pro', sensor: 'Sony IMX533', pixelSize: '3.76 μm', resolution: '3008 × 3008', cooled: true, color: true, detectedFrom: 'FITS headers' },
];

export const TELESCOPES_EQUIPMENT: TelescopeEquipmentFixture[] = [
  { id: 1, model: 'Takahashi FSQ-106EDX4', aperture: '106 mm', focalLength: '530 mm', fRatio: 'f/5' },
  { id: 2, model: 'William Optics GT81', aperture: '81 mm', focalLength: '478 mm', fRatio: 'f/5.9' },
];

// ─── Optical train IDs (also referenced in sessions.ts) ─────────────────────

const TRAIN_FSQ106_ASI2600 = '550e8400-e29b-41d4-a716-446655440101';
const TRAIN_GT81_ASI533 = '550e8400-e29b-41d4-a716-446655440102';

// ─── Rich equipment list (retained for existing consumers) ───────────────────

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
    path: 'D:\\Astrophotography\\Raw',
    label: 'Main Raw Drive',
    category: 'raw',
    online_state: 'online',
    file_count: 84_231,
    size_bytes: 1_977_326_743_552, // ~1.8 TB
    last_scanned_at: '2026-04-20T06:14:33Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store', '**/Thumbs.db', '**/*.tmp'],
    },
  },

  // Root 2: Calibration library — online
  {
    id: '550e8400-e29b-41d4-a716-446655440902',
    path: 'D:\\Astrophotography\\Calibration',
    label: 'Calibration Library',
    category: 'calibration',
    online_state: 'online',
    file_count: 12_044,
    size_bytes: 335_544_320_000, // ~312 GB
    last_scanned_at: '2026-04-20T06:16:10Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store'],
    },
  },

  // Root 3: Projects — online
  {
    id: '550e8400-e29b-41d4-a716-446655440903',
    path: 'D:\\Astrophotography\\Projects',
    label: 'Projects',
    category: 'project',
    online_state: 'online',
    file_count: 38_112,
    size_bytes: 987_842_805_760, // ~920 GB
    last_scanned_at: '2026-04-20T06:18:00Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store', '**/Thumbs.db'],
    },
  },

  // Root 4: Inbox — online
  {
    id: '550e8400-e29b-41d4-a716-446655440904',
    path: 'D:\\Astrophotography\\Inbox',
    label: 'Inbox',
    category: 'inbox',
    online_state: 'online',
    file_count: 1_842,
    size_bytes: 47_244_640_256, // ~44 GB
    last_scanned_at: '2026-04-20T06:20:00Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: [],
    },
  },

  // Root 5: NAS archive — offline
  {
    id: '550e8400-e29b-41d4-a716-446655440905',
    path: '\\\\NAS-2025\\astro\\archive',
    label: 'NAS Archive',
    category: 'archive',
    online_state: 'offline',
    file_count: 0,
    size_bytes: 0,
    last_scanned_at: undefined,
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: [],
    },
  },

  // Root 6: Overflow raw drive — online
  {
    id: '550e8400-e29b-41d4-a716-446655440906',
    path: 'E:\\AstroOverflow',
    label: 'Overflow Raw',
    category: 'raw',
    online_state: 'online',
    file_count: 7_931,
    size_bytes: 193_273_528_320, // ~180 GB
    last_scanned_at: '2026-04-20T06:22:00Z',
    scan_settings: {
      follow_symlinks: false,
      excluded_patterns: ['**/.DS_Store', '**/Thumbs.db', '**/*.tmp'],
    },
  },
];
