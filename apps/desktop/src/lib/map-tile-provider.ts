// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Map tile-provider abstraction (spec 044 journey-1, issue #491).
//
// Callers ask for a MapLibre style via `mapTileProviderStyle()` instead of
// hard-coding a tile URL, so swapping providers later is a one-line change
// here, not a call-site change.
//
// Swap points:
//   - Protomaps hosted API (keyed): return
//     `https://api.protomaps.com/styles/v5/light/en.json?key=${apiKey}`.
//   - Self-hosted Protomaps `.pmtiles` (e.g. on R2): return a local style
//     object whose source `url` is `pmtiles://https://<bucket>/<file>.pmtiles`,
//     and register the `pmtiles` protocol via `maplibregl.addProtocol` once at
//     startup (see https://docs.protomaps.com/pmtiles/maplibre).
import type { StyleSpecification } from 'maplibre-gl';

/** Current provider: OpenFreeMap public tiles — no API key, no signup. */
export function mapTileProviderStyle(): string | StyleSpecification {
  return 'https://tiles.openfreemap.org/styles/liberty';
}
