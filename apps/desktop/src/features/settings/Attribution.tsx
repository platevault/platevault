// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Data sources & attribution notice (spec 035, T036 / FR-012).
import { useState } from 'react';
import { m } from '@/lib/i18n';
//
// Static frontend notice crediting the astronomical data sources the app relies
// on: SIMBAD (CDS) for on-demand resolution and OpenNGC for the bundled seed.
// (The spec-014 license-attribution backend model was removed with the catalog
// download surface; this is a static, always-present credit.)
//
// The second section credits bundled third-party SOFTWARE rather than data, and
// carries a licence obligation rather than a courtesy: spec 055 replaced the
// Google Fonts CDN import with six Inter .woff2 files shipped inside the app,
// which turned Inter from linked into redistributed. SIL OFL 1.1 clause 2
// requires each copy of a bundled font to travel with its copyright notice and
// licence, viewable by the user. `bundle.resources` in tauri.conf.json installs
// the licence next to the binary; the button below opens it.

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

/** Path inside the installed bundle, from `bundle.resources` in tauri.conf.json. */
const INTER_LICENCE_RESOURCE = 'licenses/Inter-OFL.txt';

/** Held as data, like SOURCES above: a project name and a licence identifier are
 *  proper nouns, so they are not translated — and keeping them out of JSX text
 *  is what satisfies `alm/no-user-string` without an escape hatch. */
const BUNDLED: Omit<AttributionSource, 'href'>[] = [
  {
    name: 'Inter',
    org: 'Rasmus Andersson (SIL Open Font License 1.1)',
    description: () => m.settings_attribution_inter_desc(),
  },
];

function BundledSoftware() {
  const [unavailable, setUnavailable] = useState(false);

  // Imported lazily and guarded: this component also renders under vitest and in
  // mock mode (VITE_USE_MOCKS), where no Tauri runtime exists. A static import
  // would break those; an unguarded call would throw on click. Failing to the
  // notice below keeps the licence discoverable either way, which is the point.
  async function openLicence() {
    try {
      const [{ resolveResource }, { openPath }] = await Promise.all([
        import('@tauri-apps/api/path'),
        import('@tauri-apps/plugin-opener'),
      ]);
      await openPath(await resolveResource(INTER_LICENCE_RESOURCE));
    } catch {
      setUnavailable(true);
    }
  }

  return (
    <div className="pv-settings__group">
      <div className="pv-settings__group-title">
        {m.settings_attribution_bundled_title()}
      </div>
      <p className="pv-settings__group-note">
        {m.settings_attribution_bundled_note()}
      </p>
      <ul className="pv-attribution__list">
        {BUNDLED.map((s) => (
          <li key={s.name} className="pv-attribution__item">
            <div className="pv-attribution__head">
              <strong>{s.name}</strong>
              <span className="pv-attribution__org">{s.org}</span>
            </div>
            <p className="pv-attribution__desc">{s.description()}</p>
            {unavailable ? (
              <p className="pv-attribution__desc">
                {m.settings_attribution_licence_unavailable()}
              </p>
            ) : (
              <button
                type="button"
                className="pv-attribution__link pv-link"
                onClick={openLicence}
              >
                {m.settings_attribution_view_licence()}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Attribution() {
  return (
    <>
      <DataSources />
      <BundledSoftware />
    </>
  );
}

function DataSources() {
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
