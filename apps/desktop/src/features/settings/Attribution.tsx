// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Data sources & attribution notice (spec 035, T036 / FR-012).
import { m } from '@/lib/i18n';
//
// Static frontend notice crediting the astronomical data sources the app relies
// on: SIMBAD (CDS) for on-demand resolution and OpenNGC for the bundled seed.
// (The spec-014 license-attribution backend model was removed with the catalog
// download surface; this is a static, always-present credit.)

interface AttributionSource {
  name: string;
  org: string;
  /** Render-time thunk so the description re-reads the active locale (spec 046 #8). */
  description: () => string;
  href: string;
}

const SOURCES: AttributionSource[] = [
  {
    name: 'SIMBAD',
    org: 'CDS, Université de Strasbourg / CNRS',
    description: () => m.settings_attribution_simbad_desc(),
    href: 'https://simbad.cds.unistra.fr/simbad/',
  },
  {
    name: 'OpenNGC',
    org: 'Mattia Verga (CC-BY-SA-4.0)',
    description: () => m.settings_attribution_seed_desc(),
    href: 'https://github.com/mattiaverga/OpenNGC',
  },
];

export function Attribution() {
  return (
    <div className="pv-settings__group">
      <div className="pv-settings__group-title">
        {m.settings_attribution_title()}
      </div>
      <p className="pv-settings__group-note">{m.settings_attribution_note()}</p>
      <ul className="pv-attribution__list">
        {SOURCES.map((s) => (
          <li key={s.name} className="pv-attribution__item">
            <div className="pv-attribution__head">
              <strong>{s.name}</strong>
              <span className="pv-attribution__org">{s.org}</span>
            </div>
            <p className="pv-attribution__desc">{s.description()}</p>
            <a
              className="pv-attribution__link"
              href={s.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {s.href}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
