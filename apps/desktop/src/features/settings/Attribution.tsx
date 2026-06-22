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
  description: string;
  href: string;
}

const SOURCES: AttributionSource[] = [
  {
    name: 'SIMBAD',
    org: 'CDS, Université de Strasbourg / CNRS',
    description:
      'On-demand resolution of designations, common names, coordinates, object types, and aliases.',
    href: 'https://simbad.cds.unistra.fr/simbad/',
  },
  {
    name: 'OpenNGC',
    org: 'Mattia Verga (CC-BY-SA-4.0)',
    description: 'The bundled seed index of popular NGC/IC and named objects.',
    href: 'https://github.com/mattiaverga/OpenNGC',
  },
];

export function Attribution() {
  return (
    <div className="alm-settings__group">
      <div className="alm-settings__group-title">{m.settings_attribution_title()}</div>
      <p className="alm-settings__group-note">
        {m.settings_attribution_note()}
      </p>
      <ul className="alm-attribution__list">
        {SOURCES.map((s) => (
          <li key={s.name} className="alm-attribution__item">
            <div className="alm-attribution__head">
              <strong>{s.name}</strong>
              <span className="alm-attribution__org">{s.org}</span>
            </div>
            <p className="alm-attribution__desc">{s.description}</p>
            <a
              className="alm-attribution__link"
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
