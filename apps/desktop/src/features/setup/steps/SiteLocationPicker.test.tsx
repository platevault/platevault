// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SiteLocationPicker tests (issue #491) — the Observing Site step's map
 * picker. `maplibre-gl` requires a real WebGL context, which jsdom doesn't
 * provide, so the module is mocked at the boundary with a fake Map/Marker
 * that records calls the way the real classes would be driven.
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { MockMap, MockMarker, MockNavigationControl } = vi.hoisted(() => {
  class MockMap {
    static instances: MockMap[] = [];
    // Simulates a webview with no WebGL support (real MapLibre throws
    // synchronously from its constructor in that case).
    static shouldThrowOnConstruct = false;
    listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    removed = false;
    easeToCalls: Array<{ center: [number, number] }> = [];
    options: unknown;
    constructor(options: unknown) {
      if (MockMap.shouldThrowOnConstruct) {
        throw new Error('Failed to initialize WebGL');
      }
      this.options = options;
      MockMap.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      (this.listeners[event] ??= []).push(cb);
    }
    addControl() {}
    remove() {
      this.removed = true;
    }
    easeTo(opts: { center: [number, number] }) {
      assertValidLngLat(opts.center);
      this.easeToCalls.push(opts);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners[event] ?? []) cb(...args);
    }
  }
  // Mirrors real MapLibre's `LngLat.convert` validation, which throws
  // synchronously for out-of-range coordinates (e.g. latitude 200) — the bug
  // this test suite regression-guards against.
  function assertValidLngLat([lng, lat]: [number, number]): void {
    if (lat < -90 || lat > 90) {
      throw new Error(
        'Invalid LngLat latitude value: must be between -90 and 90',
      );
    }
    if (lng < -180 || lng > 180) {
      throw new Error(
        'Invalid LngLat longitude value: must be between -180 and 180',
      );
    }
  }
  class MockMarker {
    lngLat: [number, number] | null = null;
    setLngLat(ll: [number, number]) {
      assertValidLngLat(ll);
      this.lngLat = ll;
      return this;
    }
    addTo() {
      return this;
    }
  }
  class MockNavigationControl {}
  return { MockMap, MockMarker, MockNavigationControl };
});

vi.mock('maplibre-gl', () => ({
  Map: MockMap,
  Marker: MockMarker,
  NavigationControl: MockNavigationControl,
}));
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));

import { SiteLocationPicker } from './SiteLocationPicker';

beforeEach(() => {
  MockMap.instances.length = 0;
  MockMap.shouldThrowOnConstruct = false;
});

describe('SiteLocationPicker', () => {
  it('reports coordinates when the map is clicked', () => {
    const onPick = vi.fn();
    render(
      <SiteLocationPicker
        latitudeDeg={null}
        longitudeDeg={null}
        onPick={onPick}
      />,
    );

    const map = MockMap.instances[0];
    expect(map).toBeDefined();
    act(() => {
      map.emit('click', { lngLat: { lat: 51.5, lng: -0.12 } });
    });

    expect(onPick).toHaveBeenCalledWith(51.5, -0.12);
  });

  it('recenters the pin when lat/long props change (fields edited)', () => {
    const { rerender } = render(
      <SiteLocationPicker
        latitudeDeg={null}
        longitudeDeg={null}
        onPick={vi.fn()}
      />,
    );
    const map = MockMap.instances[0];

    act(() => {
      rerender(
        <SiteLocationPicker
          latitudeDeg={40.7}
          longitudeDeg={-74}
          onPick={vi.fn()}
        />,
      );
    });

    expect(map.easeToCalls).toContainEqual({ center: [-74, 40.7] });

    act(() => {
      rerender(
        <SiteLocationPicker
          latitudeDeg={41}
          longitudeDeg={-75}
          onPick={vi.fn()}
        />,
      );
    });

    expect(map.easeToCalls).toContainEqual({ center: [-75, 41] });
  });

  it('degrades gracefully when the map/tiles fail to load', () => {
    render(
      <SiteLocationPicker
        latitudeDeg={null}
        longitudeDeg={null}
        onPick={vi.fn()}
      />,
    );
    const map = MockMap.instances[0];

    act(() => {
      map.emit('error', { error: new Error('tile load failed') });
    });

    expect(screen.queryByTestId('site-location-map')).not.toBeInTheDocument();
    expect(screen.getByText(/map unavailable/i)).toBeInTheDocument();
  });

  it('ignores an out-of-range latitude instead of crashing (regression)', () => {
    // The lat/long fields intentionally accept out-of-range values while the
    // wizard's own validation (siteStepError) hasn't rejected them yet — the
    // map must not pass those straight to MapLibre, which throws for them.
    const { rerender } = render(
      <SiteLocationPicker
        latitudeDeg={null}
        longitudeDeg={null}
        onPick={vi.fn()}
      />,
    );
    const map = MockMap.instances[0];

    expect(() => {
      act(() => {
        rerender(
          <SiteLocationPicker
            latitudeDeg={200}
            longitudeDeg={10}
            onPick={vi.fn()}
          />,
        );
      });
    }).not.toThrow();

    expect(map.easeToCalls).toHaveLength(0);
    expect(screen.getByTestId('site-location-map')).toBeInTheDocument();
    expect(screen.queryByText(/map unavailable/i)).not.toBeInTheDocument();
  });

  it('degrades gracefully when the map fails to construct (no WebGL)', () => {
    MockMap.shouldThrowOnConstruct = true;

    render(
      <SiteLocationPicker
        latitudeDeg={null}
        longitudeDeg={null}
        onPick={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('site-location-map')).not.toBeInTheDocument();
    expect(screen.getByText(/map unavailable/i)).toBeInTheDocument();
  });
});
