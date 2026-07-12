import { describe, it, expect } from 'vitest';
import {
  lunarSeparationDeg,
  targetUnitVector,
  angleBetweenDeg,
} from './lunar-separation';
import { moonStateAt } from './moon-state';

/**
 * Well-known targets (J2000 RA/Dec, degrees).
 */
const TARGETS: Record<string, [number, number]> = {
  M31: [10.685, 41.269],
  M42: [83.822, -5.391],
  M45: [56.75, 24.117],
  M13: [250.423, 36.461],
  M8: [270.9, -24.38],
  M51: [202.47, 47.195],
  M57: [283.396, 33.029],
  M27: [299.9, 22.72],
  NGC7000: [314.75, 44.37],
  M104: [189.998, -11.623],
};

/**
 * Reference separations (degrees) computed independently via astronomy-engine's
 * high-level `Equator(Moon, J2000)` + spherical-law-of-cosines haversine — a
 * different code path from the module's `GeoVector` dot product. ADR-0001 marks
 * astronomy-engine (±1 arcmin) as the reference; SC-002 tolerance is ±2°.
 */
const REFERENCE: Record<string, Record<string, number>> = {
  '2024-01-25T00:00:00Z': {
    M31: 85.2,
    M42: 46.3,
    M45: 55.54,
    M13: 102.54,
    M8: 154.86,
    M51: 67.0,
    M57: 118.94,
    M27: 131.0,
    NGC7000: 107.85,
    M104: 78.92,
  },
  '2024-06-15T00:00:00Z': {
    M31: 138.13,
    M42: 97.89,
    M45: 121.67,
    M13: 73.1,
    M8: 89.14,
    M51: 50.71,
    M57: 99.84,
    M27: 115.87,
    NGC7000: 119.32,
    M104: 14.06,
  },
  '2024-08-04T00:00:00Z': {
    M31: 94.94,
    M42: 53.15,
    M45: 66.44,
    M13: 98.44,
    M8: 144.19,
    M51: 61.86,
    M57: 118.81,
    M27: 133.58,
    NGC7000: 112.85,
    M104: 67.98,
  },
  '2025-03-14T00:00:00Z': {
    M31: 130.8,
    M42: 87.78,
    M45: 110.08,
    M13: 78.66,
    M8: 100.76,
    M51: 50.42,
    M57: 105.83,
    M27: 123.0,
    NGC7000: 121.18,
    M104: 24.77,
  },
  '2026-07-05T00:00:00Z': {
    M31: 56.05,
    M42: 102.04,
    M45: 80.43,
    M13: 94.9,
    M8: 68.64,
    M51: 126.97,
    M57: 68.03,
    M27: 50.3,
    NGC7000: 57.12,
    M104: 145.2,
  },
};

describe('lunarSeparationDeg — planetarium fixtures (SC-002, ±2°)', () => {
  for (const iso of Object.keys(REFERENCE)) {
    const moonVec = moonStateAt(new Date(iso)).moonVec;
    for (const [name, [ra, dec]] of Object.entries(TARGETS)) {
      it(`${iso.slice(0, 10)} ${name} within ±2° of reference`, () => {
        const sep = lunarSeparationDeg(ra, dec, moonVec);
        expect(sep).not.toBeNull();
        expect(
          Math.abs((sep as number) - REFERENCE[iso][name]),
        ).toBeLessThanOrEqual(2);
      });
    }
  }

  it('returns a value in 0…180°', () => {
    const moonVec = moonStateAt(new Date('2024-01-25T00:00:00Z')).moonVec;
    for (const [ra, dec] of Object.values(TARGETS)) {
      const sep = lunarSeparationDeg(ra, dec, moonVec) as number;
      expect(sep).toBeGreaterThanOrEqual(0);
      expect(sep).toBeLessThanOrEqual(180);
    }
  });
});

describe('null-coordinate passthrough', () => {
  const moonVec = moonStateAt(new Date('2024-01-25T00:00:00Z')).moonVec;
  it('returns null when RA or Dec is null/undefined/NaN', () => {
    expect(lunarSeparationDeg(null, 10, moonVec)).toBeNull();
    expect(lunarSeparationDeg(10, null, moonVec)).toBeNull();
    expect(lunarSeparationDeg(undefined, undefined, moonVec)).toBeNull();
    expect(lunarSeparationDeg(Number.NaN, 10, moonVec)).toBeNull();
  });
});

describe('targetUnitVector / angleBetweenDeg', () => {
  it('produces unit vectors', () => {
    const v = targetUnitVector(83.822, -5.391);
    expect(Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2)).toBeCloseTo(1, 9);
  });

  it('0° for identical directions, 180° for opposite', () => {
    const v = targetUnitVector(120, 30);
    expect(angleBetweenDeg(v, v)).toBeCloseTo(0, 6);
    expect(angleBetweenDeg(v, { x: -v.x, y: -v.y, z: -v.z })).toBeCloseTo(
      180,
      4,
    );
  });

  it('90° for orthogonal directions', () => {
    expect(
      angleBetweenDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }),
    ).toBeCloseTo(90, 6);
  });
});
