// TODO(spec 007 (equipment)): wire to backend when owning spec implements its command.
import { useState } from 'react';
import { Btn, Table, Pill } from '@/ui';
import { m } from '@/lib/i18n';
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
        title={m.settings_equipment_trains_title()}
        action={<Btn size="sm" onClick={() => console.log('add train')}>{m.settings_equipment_trains_add()}</Btn>}
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
                {m.common_remove()}
              </Btn>
            ),
          }))}
        />
        {trains.length === 0 && (
          <p className="alm-equipment__empty">
            {m.settings_equipment_trains_empty()}
          </p>
        )}
      </SettingsSection>

      {/* Cameras */}
      <SettingsSection
        title={m.settings_equipment_cameras_title()}
        action={<Btn size="sm" onClick={() => console.log('add camera')}>{m.settings_equipment_cameras_add()}</Btn>}
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
                {c.cooled && <Pill variant="info">{m.settings_equipment_cameras_cooled()}</Pill>}
                {c.color ? <Pill variant="ok">{m.settings_equipment_cameras_color()}</Pill> : <Pill variant="neutral">{m.settings_equipment_cameras_mono()}</Pill>}
              </span>
            ),
            actions: (
              <Btn size="sm" variant="ghost" onClick={() => handleRemoveCamera(c.id)}>
                {m.common_remove()}
              </Btn>
            ),
          }))}
        />
        {cameras.length === 0 && (
          <p className="alm-equipment__empty">
            {m.settings_equipment_cameras_empty()}
          </p>
        )}
      </SettingsSection>

      {/* Telescopes */}
      <SettingsSection
        title={m.settings_equipment_telescopes_title()}
        action={<Btn size="sm" onClick={() => console.log('add telescope')}>{m.settings_equipment_telescopes_add()}</Btn>}
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
                {m.common_remove()}
              </Btn>
            ),
          }))}
        />
        {telescopes.length === 0 && (
          <p className="alm-equipment__empty">
            {m.settings_equipment_telescopes_empty()}
          </p>
        )}
      </SettingsSection>
    </>
  );
}
