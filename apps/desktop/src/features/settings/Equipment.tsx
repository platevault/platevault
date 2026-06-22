// TODO(spec 007 (equipment)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Btn, Table, Pill } from '@/ui';
import {
  OPTICAL_TRAINS,
  CAMERAS,
  TELESCOPES,
  type OpticalTrainFixture,
  type CameraFixture,
  type TelescopeFixture,
} from '@/data/fixtures/settings';
import { SettingsSection } from './SettingsKit';

interface EquipmentProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

export function Equipment({ save: _save }: EquipmentProps) {
  const [trains, setTrains] = useState<OpticalTrainFixture[]>(OPTICAL_TRAINS);
  const [cameras, setCameras] = useState<CameraFixture[]>(CAMERAS);
  const [telescopes, setTelescopes] = useState<TelescopeFixture[]>(TELESCOPES);

  const handleRemoveTrain = (id: number) => setTrains((p) => p.filter((t) => t.id !== id));
  const handleRemoveCamera = (id: number) => setCameras((p) => p.filter((c) => c.id !== id));
  const handleRemoveTelescope = (id: number) => setTelescopes((p) => p.filter((t) => t.id !== id));

  return (
    <>
      {/* Optical Trains */}
      <SettingsSection
        title="Optical Trains"
        action={<Btn size="sm" onClick={() => console.log('add train')}>+ Compose train</Btn>}
      >
        <Table
          columns={[
            { key: 'name', label: 'Name' },
            { key: 'camera', label: 'Camera' },
            { key: 'telescope', label: 'Telescope' },
            { key: 'focalLength', label: 'Focal length' },
            { key: 'pixelScale', label: 'Pixel scale' },
            { key: 'actions', label: '', style: { width: 80 } },
          ]}
          rows={trains.map((t) => ({
            name: t.name,
            camera: t.camera,
            telescope: t.telescope,
            focalLength: <code className="alm-mono">{t.focalLength}</code>,
            pixelScale: <code className="alm-mono">{t.pixelScale}</code>,
            actions: (
              <Btn size="sm" variant="ghost" onClick={() => handleRemoveTrain(t.id)}>
                Remove
              </Btn>
            ),
          }))}
        />
        {trains.length === 0 && (
          <p className="alm-equipment__empty">
            No optical trains configured.
          </p>
        )}
      </SettingsSection>

      {/* Cameras */}
      <SettingsSection
        title="Cameras"
        action={<Btn size="sm" onClick={() => console.log('add camera')}>+ Add camera</Btn>}
      >
        <Table
          columns={[
            { key: 'model', label: 'Model' },
            { key: 'sensor', label: 'Sensor' },
            { key: 'pixelSize', label: 'Pixel size' },
            { key: 'resolution', label: 'Resolution' },
            { key: 'flags', label: 'Flags' },
            { key: 'actions', label: '', style: { width: 80 } },
          ]}
          rows={cameras.map((c) => ({
            model: c.model,
            sensor: c.sensor,
            pixelSize: <code className="alm-mono">{c.pixelSize}</code>,
            resolution: <code className="alm-mono">{c.resolution}</code>,
            flags: (
              <span className="alm-equipment__flags">
                {c.cooled && <Pill variant="info">Cooled</Pill>}
                {c.color ? <Pill variant="ok">Color</Pill> : <Pill variant="neutral">Mono</Pill>}
              </span>
            ),
            actions: (
              <Btn size="sm" variant="ghost" onClick={() => handleRemoveCamera(c.id)}>
                Remove
              </Btn>
            ),
          }))}
        />
        {cameras.length === 0 && (
          <p className="alm-equipment__empty">
            No cameras registered.
          </p>
        )}
      </SettingsSection>

      {/* Telescopes */}
      <SettingsSection
        title="Telescopes"
        action={<Btn size="sm" onClick={() => console.log('add telescope')}>+ Add telescope</Btn>}
      >
        <Table
          columns={[
            { key: 'model', label: 'Model' },
            { key: 'aperture', label: 'Aperture' },
            { key: 'focalLength', label: 'Focal length' },
            { key: 'fRatio', label: 'f-ratio' },
            { key: 'actions', label: '', style: { width: 80 } },
          ]}
          rows={telescopes.map((t) => ({
            model: t.model,
            aperture: <code className="alm-mono">{t.aperture}</code>,
            focalLength: <code className="alm-mono">{t.focalLength}</code>,
            fRatio: <code className="alm-mono">{t.fRatio}</code>,
            actions: (
              <Btn size="sm" variant="ghost" onClick={() => handleRemoveTelescope(t.id)}>
                Remove
              </Btn>
            ),
          }))}
        />
        {telescopes.length === 0 && (
          <p className="alm-equipment__empty">
            No telescopes registered.
          </p>
        )}
      </SettingsSection>
    </>
  );
}
