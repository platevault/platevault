// Observing Site step: interactive map picker (spec 044 journey-1, issue #491).
//
// The numeric lat/long fields on `StepSite` remain the source of truth —
// this component only translates between them and a MapLibre map: a click
// reports coordinates up via `onPick`, and a `latitudeDeg`/`longitudeDeg`
// prop change (from editing the fields) recenters the pin. If the map
// fails to construct or load (offline, tile-provider outage, no WebGL in
// the host webview), it degrades to a small notice rather than a blank
// canvas or a crash — the fields keep working either way.
import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, Marker, NavigationControl } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { m } from '@/lib/i18n';
import { mapTileProviderStyle } from '@/lib/map-tile-provider';

// World view used before any coordinates are set.
const DEFAULT_CENTER: [number, number] = [10, 20];
const DEFAULT_ZOOM = 1;
const PICKED_ZOOM = 6;

export interface SiteLocationPickerProps {
  /** `null` when the field is blank or not a valid number — no pin is shown. */
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  /** Fired when the user clicks the map; the caller updates the numeric fields. */
  onPick: (latitudeDeg: number, longitudeDeg: number) => void;
}

export function SiteLocationPicker({
  latitudeDeg,
  longitudeDeg,
  onPick,
}: SiteLocationPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  const [unavailable, setUnavailable] = useState(false);

  // Keep the ref in sync outside of render (assigning ref.current during
  // render is flagged by react-hooks/refs).
  useEffect(() => {
    onPickRef.current = onPick;
  });

  // Freeze the initial center/zoom at mount time — later coordinate changes
  // are handled by the recenter effect below, not by re-running this one.
  const [initialView] = useState<{ center: [number, number]; zoom: number }>(
    () => ({
      center:
        latitudeDeg != null && longitudeDeg != null
          ? [longitudeDeg, latitudeDeg]
          : DEFAULT_CENTER,
      zoom:
        latitudeDeg != null && longitudeDeg != null
          ? PICKED_ZOOM
          : DEFAULT_ZOOM,
    }),
  );

  useEffect(() => {
    if (!containerRef.current) return;
    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: mapTileProviderStyle(),
        center: initialView.center,
        zoom: initialView.zoom,
      });
    } catch {
      // No WebGL / construction failure — never blocks the wizard.
      setUnavailable(true);
      return;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    // Style/tile load failures (offline, provider outage) surface as an
    // async 'error' event rather than a thrown exception.
    map.on('error', () => setUnavailable(true));
    map.on('click', (e) => {
      onPickRef.current(e.lngLat.lat, e.lngLat.lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [initialView]);

  // Recenter + move the pin when the numeric fields change externally.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (latitudeDeg == null || longitudeDeg == null) return;
    if (!Number.isFinite(latitudeDeg) || !Number.isFinite(longitudeDeg)) return;
    const lngLat: [number, number] = [longitudeDeg, latitudeDeg];
    if (markerRef.current) {
      markerRef.current.setLngLat(lngLat);
    } else {
      markerRef.current = new Marker().setLngLat(lngLat).addTo(map);
    }
    map.easeTo({ center: lngLat });
  }, [latitudeDeg, longitudeDeg]);

  if (unavailable) {
    return (
      <p className="alm-step-site__map-unavailable">
        {m.setup_site_map_unavailable()}
      </p>
    );
  }

  return (
    <div
      ref={containerRef}
      className="alm-step-site__map"
      data-testid="site-location-map"
      role="application"
      aria-label={m.setup_site_map_label()}
    />
  );
}
