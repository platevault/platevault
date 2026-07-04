/**
 * Equipment pane — spec 030 T018 wiring.
 *
 * Manages cameras, telescopes, optical trains, and filters against the real
 * `equipment.{cameras,telescopes,trains,filters}.*` commands (previously a
 * `useState` stub seeded from `@/data/fixtures/settings`).
 *
 * Notes on the real DTOs vs. the retired fixtures:
 *  - `Camera` is `{ id, name, aliases, autoDetected }` — there is no sensor,
 *    pixel size, resolution, cooled, or color field in the backend model.
 *  - `Telescope` is `{ id, name, aliases, focalLengthMm, autoDetected }` —
 *    there is no aperture or f-ratio field.
 *  - `OpticalTrain` is `{ id, name, telescopeId, cameraId, focalLengthMm }` —
 *    `telescopeId`/`cameraId` are real foreign ids (nullable), not free-text
 *    camera/telescope name strings; there is no derived pixel-scale field.
 *  - Deleting a camera or telescope that is referenced by an optical train
 *    fails at the database's foreign-key constraint (mapped to a generic
 *    `internal.database` `ContractError`, not a dedicated "in use" error
 *    code). This pane pre-checks the loaded trains client-side so the user
 *    gets an actionable message instead of a raw database error; the backend
 *    constraint remains the source of truth for correctness.
 */
import { useCallback, useEffect, useState } from 'react';
import { Btn, Table, Pill } from '@/ui';
import type { TableRow } from '@/ui';
import { ConfirmOverlay } from '@/components';
import { m } from '@/lib/i18n';
import { errMessage } from '@/lib/errors';
import {
  equipmentCamerasList,
  equipmentCameraCreate,
  equipmentCameraUpdate,
  equipmentCameraDelete,
  equipmentTelescopesList,
  equipmentTelescopeCreate,
  equipmentTelescopeUpdate,
  equipmentTelescopeDelete,
  equipmentTrainsList,
  equipmentTrainCreate,
  equipmentTrainUpdate,
  equipmentTrainDelete,
  equipmentFiltersList,
  equipmentFilterCreate,
  equipmentFilterUpdate,
  equipmentFilterDelete,
  type Camera,
  type Telescope,
  type OpticalTrain,
  type Filter,
  type FilterCategory,
} from './settingsIpc';
import { SettingsSection, SettingsFormShell } from './SettingsKit';

interface EquipmentProps {
  save: (scope: string, values: Record<string, unknown>) => void;
}

type DeleteTarget =
  | { kind: 'camera'; id: string; name: string }
  | { kind: 'telescope'; id: string; name: string }
  | { kind: 'train'; id: string; name: string }
  | { kind: 'filter'; id: string; name: string };

// ── Shared helpers ─────────────────────────────────────────────────────────────

function parseAliases(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatAliases(aliases: string[]): string {
  return aliases.length > 0 ? aliases.join(', ') : '—';
}

/** Parses a focal-length input; blank → null, non-numeric → null. */
function parseFocalLength(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const FILTER_CATEGORIES: FilterCategory[] = [
  'narrowband',
  'broadband',
  'dual_band',
  'other',
  'custom',
];

/** Render-time factory (spec 046 #8b) so category labels re-read the active locale. */
function filterCategoryLabel(category: FilterCategory): string {
  switch (category) {
    case 'narrowband':
      return m.settings_equipment_category_narrowband();
    case 'broadband':
      return m.settings_equipment_category_broadband();
    case 'dual_band':
      return m.settings_equipment_category_dual_band();
    case 'other':
      return m.settings_equipment_category_other();
    case 'custom':
      return m.settings_equipment_category_custom();
  }
}

function autoDetectedBadge(autoDetected: boolean) {
  return (
    <span className="alm-equipment__badges">
      {autoDetected ? (
        <Pill variant="info">{m.settings_equipment_auto_detected()}</Pill>
      ) : (
        <Pill variant="neutral">{m.settings_equipment_manual()}</Pill>
      )}
    </span>
  );
}

// The add/edit form shell (field grid + error line + cancel/save actions) now
// lives in `SettingsKit.tsx` as `SettingsFormShell`, shared with other panes'
// CRUD lists (e.g. observing-site management, spec 044 US3) — no per-pane
// clone (shared-component mandate).

export function Equipment({ save: _save }: EquipmentProps) {
  // ── Cameras ────────────────────────────────────────────────────────────────
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camerasLoading, setCamerasLoading] = useState(true);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [cameraForm, setCameraForm] = useState<{
    id: string | null;
    name: string;
    aliasesText: string;
  } | null>(null);
  const [cameraFormError, setCameraFormError] = useState<string | null>(null);
  const [cameraSaving, setCameraSaving] = useState(false);

  // ── Telescopes ───────────────────────────────────────────────────────────────
  const [telescopes, setTelescopes] = useState<Telescope[]>([]);
  const [telescopesLoading, setTelescopesLoading] = useState(true);
  const [telescopesError, setTelescopesError] = useState<string | null>(null);
  const [telescopeForm, setTelescopeForm] = useState<{
    id: string | null;
    name: string;
    aliasesText: string;
    focalLengthMmText: string;
  } | null>(null);
  const [telescopeFormError, setTelescopeFormError] = useState<string | null>(null);
  const [telescopeSaving, setTelescopeSaving] = useState(false);

  // ── Optical trains ───────────────────────────────────────────────────────────
  const [trains, setTrains] = useState<OpticalTrain[]>([]);
  const [trainsLoading, setTrainsLoading] = useState(true);
  const [trainsError, setTrainsError] = useState<string | null>(null);
  const [trainForm, setTrainForm] = useState<{
    id: string | null;
    name: string;
    telescopeId: string;
    cameraId: string;
    focalLengthMmText: string;
  } | null>(null);
  const [trainFormError, setTrainFormError] = useState<string | null>(null);
  const [trainSaving, setTrainSaving] = useState(false);

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<Filter[]>([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [filterForm, setFilterForm] = useState<{
    id: string | null;
    name: string;
    category: FilterCategory;
  } | null>(null);
  const [filterFormError, setFilterFormError] = useState<string | null>(null);
  const [filterSaving, setFilterSaving] = useState(false);

  // ── Shared delete confirmation ───────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Loaders ──────────────────────────────────────────────────────────────────

  const loadCameras = useCallback(() => {
    setCamerasLoading(true);
    setCamerasError(null);
    equipmentCamerasList()
      .then(setCameras)
      .catch((err: unknown) =>
        setCamerasError(m.settings_equipment_load_error({ error: errMessage(err) })),
      )
      .finally(() => setCamerasLoading(false));
  }, []);

  const loadTelescopes = useCallback(() => {
    setTelescopesLoading(true);
    setTelescopesError(null);
    equipmentTelescopesList()
      .then(setTelescopes)
      .catch((err: unknown) =>
        setTelescopesError(m.settings_equipment_load_error({ error: errMessage(err) })),
      )
      .finally(() => setTelescopesLoading(false));
  }, []);

  const loadTrains = useCallback(() => {
    setTrainsLoading(true);
    setTrainsError(null);
    equipmentTrainsList()
      .then(setTrains)
      .catch((err: unknown) =>
        setTrainsError(m.settings_equipment_load_error({ error: errMessage(err) })),
      )
      .finally(() => setTrainsLoading(false));
  }, []);

  const loadFilters = useCallback(() => {
    setFiltersLoading(true);
    setFiltersError(null);
    equipmentFiltersList()
      .then(setFilters)
      .catch((err: unknown) =>
        setFiltersError(m.settings_equipment_load_error({ error: errMessage(err) })),
      )
      .finally(() => setFiltersLoading(false));
  }, []);

  useEffect(() => {
    loadCameras();
    loadTelescopes();
    loadTrains();
    loadFilters();
  }, [loadCameras, loadTelescopes, loadTrains, loadFilters]);

  // ── Camera handlers ──────────────────────────────────────────────────────────

  const handleCameraSubmit = async () => {
    if (!cameraForm) return;
    const name = cameraForm.name.trim();
    if (!name) {
      setCameraFormError(m.settings_equipment_name_required());
      return;
    }
    setCameraSaving(true);
    setCameraFormError(null);
    try {
      const aliases = parseAliases(cameraForm.aliasesText);
      if (cameraForm.id) {
        await equipmentCameraUpdate({ id: cameraForm.id, name, aliases });
      } else {
        await equipmentCameraCreate({ name, aliases });
      }
      setCameraForm(null);
      loadCameras();
    } catch (err: unknown) {
      setCameraFormError(m.settings_equipment_save_error({ error: errMessage(err) }));
    } finally {
      setCameraSaving(false);
    }
  };

  const requestDeleteCamera = (camera: Camera) => {
    const inUse = trains.some((t) => t.cameraId === camera.id);
    if (inUse) {
      setCamerasError(m.settings_equipment_delete_in_use());
      return;
    }
    setDeleteError(null);
    setDeleteTarget({ kind: 'camera', id: camera.id, name: camera.name });
  };

  // ── Telescope handlers ───────────────────────────────────────────────────────

  const handleTelescopeSubmit = async () => {
    if (!telescopeForm) return;
    const name = telescopeForm.name.trim();
    if (!name) {
      setTelescopeFormError(m.settings_equipment_name_required());
      return;
    }
    setTelescopeSaving(true);
    setTelescopeFormError(null);
    try {
      const aliases = parseAliases(telescopeForm.aliasesText);
      const focalLengthMm = parseFocalLength(telescopeForm.focalLengthMmText);
      if (telescopeForm.id) {
        await equipmentTelescopeUpdate({ id: telescopeForm.id, name, aliases, focalLengthMm });
      } else {
        await equipmentTelescopeCreate({ name, aliases, focalLengthMm });
      }
      setTelescopeForm(null);
      loadTelescopes();
    } catch (err: unknown) {
      setTelescopeFormError(m.settings_equipment_save_error({ error: errMessage(err) }));
    } finally {
      setTelescopeSaving(false);
    }
  };

  const requestDeleteTelescope = (telescope: Telescope) => {
    const inUse = trains.some((t) => t.telescopeId === telescope.id);
    if (inUse) {
      setTelescopesError(m.settings_equipment_delete_in_use());
      return;
    }
    setDeleteError(null);
    setDeleteTarget({ kind: 'telescope', id: telescope.id, name: telescope.name });
  };

  // ── Optical train handlers ───────────────────────────────────────────────────

  const handleTrainSubmit = async () => {
    if (!trainForm) return;
    const name = trainForm.name.trim();
    if (!name) {
      setTrainFormError(m.settings_equipment_name_required());
      return;
    }
    const focalLengthMm = parseFocalLength(trainForm.focalLengthMmText);
    if (focalLengthMm == null) {
      setTrainFormError(m.settings_equipment_field_focal_length());
      return;
    }
    setTrainSaving(true);
    setTrainFormError(null);
    try {
      const telescopeId = trainForm.telescopeId || null;
      const cameraId = trainForm.cameraId || null;
      if (trainForm.id) {
        await equipmentTrainUpdate({
          id: trainForm.id,
          name,
          telescopeId,
          cameraId,
          focalLengthMm,
        });
      } else {
        await equipmentTrainCreate({ name, telescopeId, cameraId, focalLengthMm });
      }
      setTrainForm(null);
      loadTrains();
    } catch (err: unknown) {
      setTrainFormError(m.settings_equipment_save_error({ error: errMessage(err) }));
    } finally {
      setTrainSaving(false);
    }
  };

  const requestDeleteTrain = (train: OpticalTrain) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'train', id: train.id, name: train.name });
  };

  // ── Filter handlers ──────────────────────────────────────────────────────────

  const handleFilterSubmit = async () => {
    if (!filterForm) return;
    const name = filterForm.name.trim();
    if (!name) {
      setFilterFormError(m.settings_equipment_name_required());
      return;
    }
    setFilterSaving(true);
    setFilterFormError(null);
    try {
      if (filterForm.id) {
        await equipmentFilterUpdate({ id: filterForm.id, name, category: filterForm.category });
      } else {
        await equipmentFilterCreate({ name, category: filterForm.category });
      }
      setFilterForm(null);
      loadFilters();
    } catch (err: unknown) {
      setFilterFormError(m.settings_equipment_save_error({ error: errMessage(err) }));
    } finally {
      setFilterSaving(false);
    }
  };

  const requestDeleteFilter = (filter: Filter) => {
    setDeleteError(null);
    setDeleteTarget({ kind: 'filter', id: filter.id, name: filter.name });
  };

  // ── Shared delete confirm ────────────────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      switch (deleteTarget.kind) {
        case 'camera':
          await equipmentCameraDelete(deleteTarget.id);
          loadCameras();
          break;
        case 'telescope':
          await equipmentTelescopeDelete(deleteTarget.id);
          loadTelescopes();
          break;
        case 'train':
          await equipmentTrainDelete(deleteTarget.id);
          loadTrains();
          break;
        case 'filter':
          await equipmentFilterDelete(deleteTarget.id);
          loadFilters();
          break;
      }
      setDeleteTarget(null);
    } catch (err: unknown) {
      setDeleteError(m.settings_equipment_delete_error({ error: errMessage(err) }));
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Row lookups for the optical trains table ─────────────────────────────────

  const cameraName = (id: string | null) =>
    id ? (cameras.find((c) => c.id === id)?.name ?? id) : m.settings_equipment_field_none();
  const telescopeName = (id: string | null) =>
    id ? (telescopes.find((t) => t.id === id)?.name ?? id) : m.settings_equipment_field_none();

  return (
    <>
      {/* Optical Trains */}
      <SettingsSection
        title={m.settings_equipment_trains_title()}
        action={
          <Btn
            size="sm"
            onClick={() =>
              setTrainForm({ id: null, name: '', telescopeId: '', cameraId: '', focalLengthMmText: '' })
            }
          >
            {m.settings_equipment_trains_add()}
          </Btn>
        }
      >
        {trainsError && <p className="alm-equipment__load-error">{trainsError}</p>}
        {trainsLoading && <p className="alm-equipment__empty">{m.common_loading()}</p>}

        {!trainsLoading && (
          <Table
            columns={[
              { key: 'name', label: m.settings_equipment_col_name() },
              { key: 'camera', label: m.settings_equipment_col_camera() },
              { key: 'telescope', label: m.settings_equipment_col_telescope() },
              { key: 'focalLength', label: m.settings_equipment_col_focal_length() },
              { key: 'actions', label: '', style: { width: 140 } },
            ]}
            rows={trains.map(
              (t): TableRow => ({
                name: t.name,
                camera: cameraName(t.cameraId),
                telescope: telescopeName(t.telescopeId),
                focalLength: (
                  <code className="alm-mono">
                    {m.settings_equipment_focal_length_value({ mm: t.focalLengthMm })}
                  </code>
                ),
                actions: (
                  <span className="alm-equipment__row-actions">
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setTrainForm({
                          id: t.id,
                          name: t.name,
                          telescopeId: t.telescopeId ?? '',
                          cameraId: t.cameraId ?? '',
                          focalLengthMmText: String(t.focalLengthMm),
                        })
                      }
                    >
                      {m.common_edit()}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => requestDeleteTrain(t)}>
                      {m.common_remove()}
                    </Btn>
                  </span>
                ),
              }),
            )}
          />
        )}
        {!trainsLoading && trains.length === 0 && !trainsError && (
          <p className="alm-equipment__empty">{m.settings_equipment_trains_empty()}</p>
        )}

        {trainForm && (
          <SettingsFormShell
            error={trainFormError}
            saving={trainSaving}
            onCancel={() => setTrainForm(null)}
            onSave={handleTrainSubmit}
          >
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-train-name">
                {m.settings_equipment_col_name()}
              </label>
              <input
                id="equipment-train-name"
                type="text"
                className="alm-input"
                aria-label={m.settings_equipment_col_name()}
                value={trainForm.name}
                onChange={(e) => setTrainForm({ ...trainForm, name: e.target.value })}
              />
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-train-camera">
                {m.settings_equipment_field_camera()}
              </label>
              <select
                id="equipment-train-camera"
                className="alm-select"
                value={trainForm.cameraId}
                onChange={(e) => setTrainForm({ ...trainForm, cameraId: e.target.value })}
              >
                <option value="">{m.settings_equipment_field_none()}</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-train-telescope">
                {m.settings_equipment_field_telescope()}
              </label>
              <select
                id="equipment-train-telescope"
                className="alm-select"
                value={trainForm.telescopeId}
                onChange={(e) => setTrainForm({ ...trainForm, telescopeId: e.target.value })}
              >
                <option value="">{m.settings_equipment_field_none()}</option>
                {telescopes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-train-focal-length">
                {m.settings_equipment_field_focal_length()}
              </label>
              <input
                id="equipment-train-focal-length"
                type="text"
                inputMode="numeric"
                className="alm-input"
                aria-label={m.settings_equipment_field_focal_length()}
                value={trainForm.focalLengthMmText}
                onChange={(e) => setTrainForm({ ...trainForm, focalLengthMmText: e.target.value })}
              />
            </div>
          </SettingsFormShell>
        )}
      </SettingsSection>

      {/* Cameras */}
      <SettingsSection
        title={m.settings_equipment_cameras_title()}
        action={
          <Btn size="sm" onClick={() => setCameraForm({ id: null, name: '', aliasesText: '' })}>
            {m.settings_equipment_cameras_add()}
          </Btn>
        }
      >
        {camerasError && <p className="alm-equipment__load-error">{camerasError}</p>}
        {camerasLoading && <p className="alm-equipment__empty">{m.common_loading()}</p>}

        {!camerasLoading && (
          <Table
            columns={[
              { key: 'name', label: m.settings_equipment_col_name() },
              { key: 'aliases', label: m.settings_equipment_col_aliases() },
              { key: 'source', label: m.settings_equipment_col_source() },
              { key: 'actions', label: '', style: { width: 140 } },
            ]}
            rows={cameras.map(
              (c): TableRow => ({
                name: c.name,
                aliases: formatAliases(c.aliases),
                source: autoDetectedBadge(c.autoDetected),
                actions: (
                  <span className="alm-equipment__row-actions">
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setCameraForm({ id: c.id, name: c.name, aliasesText: c.aliases.join(', ') })
                      }
                    >
                      {m.common_edit()}
                    </Btn>
                    {/* Disabled until trains load: the in-use guard reads the
                        trains list, so a click before it arrives would bypass
                        the check (TOCTOU) and hit the raw FK error instead. */}
                    <Btn
                      size="sm"
                      variant="ghost"
                      disabled={trainsLoading}
                      onClick={() => requestDeleteCamera(c)}
                    >
                      {m.common_remove()}
                    </Btn>
                  </span>
                ),
              }),
            )}
          />
        )}
        {!camerasLoading && cameras.length === 0 && !camerasError && (
          <p className="alm-equipment__empty">{m.settings_equipment_cameras_empty()}</p>
        )}

        {cameraForm && (
          <SettingsFormShell
            error={cameraFormError}
            saving={cameraSaving}
            onCancel={() => setCameraForm(null)}
            onSave={handleCameraSubmit}
          >
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-camera-name">
                {m.settings_equipment_col_name()}
              </label>
              <input
                id="equipment-camera-name"
                type="text"
                className="alm-input"
                aria-label={m.settings_equipment_col_name()}
                value={cameraForm.name}
                onChange={(e) => setCameraForm({ ...cameraForm, name: e.target.value })}
              />
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-camera-aliases">
                {m.common_aliases()}
                <span className="alm-field-hint"> ({m.settings_equipment_field_aliases_hint()})</span>
              </label>
              <input
                id="equipment-camera-aliases"
                type="text"
                className="alm-input"
                aria-label={m.common_aliases()}
                value={cameraForm.aliasesText}
                onChange={(e) => setCameraForm({ ...cameraForm, aliasesText: e.target.value })}
              />
            </div>
          </SettingsFormShell>
        )}
      </SettingsSection>

      {/* Telescopes */}
      <SettingsSection
        title={m.settings_equipment_telescopes_title()}
        action={
          <Btn
            size="sm"
            onClick={() =>
              setTelescopeForm({ id: null, name: '', aliasesText: '', focalLengthMmText: '' })
            }
          >
            {m.settings_equipment_telescopes_add()}
          </Btn>
        }
      >
        {telescopesError && <p className="alm-equipment__load-error">{telescopesError}</p>}
        {telescopesLoading && <p className="alm-equipment__empty">{m.common_loading()}</p>}

        {!telescopesLoading && (
          <Table
            columns={[
              { key: 'name', label: m.settings_equipment_col_name() },
              { key: 'aliases', label: m.settings_equipment_col_aliases() },
              { key: 'focalLength', label: m.settings_equipment_col_focal_length() },
              { key: 'source', label: m.settings_equipment_col_source() },
              { key: 'actions', label: '', style: { width: 140 } },
            ]}
            rows={telescopes.map(
              (t): TableRow => ({
                name: t.name,
                aliases: formatAliases(t.aliases),
                focalLength: (
                  <code className="alm-mono">
                    {t.focalLengthMm != null
                      ? m.settings_equipment_focal_length_value({ mm: t.focalLengthMm })
                      : '—'}
                  </code>
                ),
                source: autoDetectedBadge(t.autoDetected),
                actions: (
                  <span className="alm-equipment__row-actions">
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setTelescopeForm({
                          id: t.id,
                          name: t.name,
                          aliasesText: t.aliases.join(', '),
                          focalLengthMmText: t.focalLengthMm != null ? String(t.focalLengthMm) : '',
                        })
                      }
                    >
                      {m.common_edit()}
                    </Btn>
                    {/* Disabled until trains load — same TOCTOU guard as cameras. */}
                    <Btn
                      size="sm"
                      variant="ghost"
                      disabled={trainsLoading}
                      onClick={() => requestDeleteTelescope(t)}
                    >
                      {m.common_remove()}
                    </Btn>
                  </span>
                ),
              }),
            )}
          />
        )}
        {!telescopesLoading && telescopes.length === 0 && !telescopesError && (
          <p className="alm-equipment__empty">{m.settings_equipment_telescopes_empty()}</p>
        )}

        {telescopeForm && (
          <SettingsFormShell
            error={telescopeFormError}
            saving={telescopeSaving}
            onCancel={() => setTelescopeForm(null)}
            onSave={handleTelescopeSubmit}
          >
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-telescope-name">
                {m.settings_equipment_col_name()}
              </label>
              <input
                id="equipment-telescope-name"
                type="text"
                className="alm-input"
                aria-label={m.settings_equipment_col_name()}
                value={telescopeForm.name}
                onChange={(e) => setTelescopeForm({ ...telescopeForm, name: e.target.value })}
              />
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-telescope-aliases">
                {m.common_aliases()}
                <span className="alm-field-hint"> ({m.settings_equipment_field_aliases_hint()})</span>
              </label>
              <input
                id="equipment-telescope-aliases"
                type="text"
                className="alm-input"
                aria-label={m.common_aliases()}
                value={telescopeForm.aliasesText}
                onChange={(e) => setTelescopeForm({ ...telescopeForm, aliasesText: e.target.value })}
              />
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-telescope-focal-length">
                {m.settings_equipment_field_focal_length()}
              </label>
              <input
                id="equipment-telescope-focal-length"
                type="text"
                inputMode="numeric"
                className="alm-input"
                aria-label={m.settings_equipment_field_focal_length()}
                value={telescopeForm.focalLengthMmText}
                onChange={(e) =>
                  setTelescopeForm({ ...telescopeForm, focalLengthMmText: e.target.value })
                }
              />
            </div>
          </SettingsFormShell>
        )}
      </SettingsSection>

      {/* Filters */}
      <SettingsSection
        title={m.settings_equipment_filters_title()}
        action={
          <Btn
            size="sm"
            onClick={() => setFilterForm({ id: null, name: '', category: 'narrowband' })}
          >
            {m.settings_equipment_filters_add()}
          </Btn>
        }
      >
        {filtersError && <p className="alm-equipment__load-error">{filtersError}</p>}
        {filtersLoading && <p className="alm-equipment__empty">{m.common_loading()}</p>}

        {!filtersLoading && (
          <Table
            columns={[
              { key: 'name', label: m.settings_equipment_col_name() },
              { key: 'category', label: m.settings_equipment_col_category() },
              { key: 'source', label: m.settings_equipment_col_source() },
              { key: 'actions', label: '', style: { width: 140 } },
            ]}
            rows={filters.map(
              (f): TableRow => ({
                name: f.name,
                category: filterCategoryLabel(f.category),
                source: autoDetectedBadge(f.autoDetected),
                actions: (
                  <span className="alm-equipment__row-actions">
                    <Btn
                      size="sm"
                      variant="ghost"
                      onClick={() => setFilterForm({ id: f.id, name: f.name, category: f.category })}
                    >
                      {m.common_edit()}
                    </Btn>
                    <Btn size="sm" variant="ghost" onClick={() => requestDeleteFilter(f)}>
                      {m.common_remove()}
                    </Btn>
                  </span>
                ),
              }),
            )}
          />
        )}
        {!filtersLoading && filters.length === 0 && !filtersError && (
          <p className="alm-equipment__empty">{m.settings_equipment_filters_empty()}</p>
        )}

        {filterForm && (
          <SettingsFormShell
            error={filterFormError}
            saving={filterSaving}
            onCancel={() => setFilterForm(null)}
            onSave={handleFilterSubmit}
          >
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-filter-name">
                {m.settings_equipment_col_name()}
              </label>
              <input
                id="equipment-filter-name"
                type="text"
                className="alm-input"
                aria-label={m.settings_equipment_col_name()}
                value={filterForm.name}
                onChange={(e) => setFilterForm({ ...filterForm, name: e.target.value })}
              />
            </div>
            <div className="alm-stack-1">
              <label className="alm-field-label" htmlFor="equipment-filter-category">
                {m.settings_equipment_field_category()}
              </label>
              <select
                id="equipment-filter-category"
                className="alm-select"
                value={filterForm.category}
                onChange={(e) =>
                  setFilterForm({ ...filterForm, category: e.target.value as FilterCategory })
                }
              >
                {FILTER_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {filterCategoryLabel(cat)}
                  </option>
                ))}
              </select>
            </div>
          </SettingsFormShell>
        )}
      </SettingsSection>

      <ConfirmOverlay
        open={deleteTarget != null}
        onClose={() => {
          if (deleteBusy) return;
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void handleConfirmDelete()}
        title={m.settings_equipment_delete_confirm_title({ name: deleteTarget?.name ?? '' })}
        description={m.settings_equipment_delete_confirm_desc()}
        confirmLabel={deleteBusy ? m.common_removing() : m.common_remove()}
        confirmVariant="danger"
      >
        {deleteError && <span className="alm-field-error">{deleteError}</span>}
      </ConfirmOverlay>
    </>
  );
}
