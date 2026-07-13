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
      this.easeToCalls.push(opts);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners[event] ?? []) cb(...args);
    }
  }
  class MockMarker {
    lngLat: [number, number] | null = null;
    setLngLat(ll: [number, number]) {
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
