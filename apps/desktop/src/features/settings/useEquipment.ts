// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/** All stateful logic for the Equipment pane (cameras/telescopes/trains/filters). */
import { useCallback, useEffect, useState } from 'react';
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
  type SensorType,
  type Telescope,
  type OpticalTrain,
  type Filter,
  type FilterCategory,
} from './settingsIpc';
import {
  parseAliases,
  isDuplicateName,
  hasDuplicateAlias,
  parseFocalLength,
  passbandBandsFrom,
  type DeleteTarget,
  type PassbandChoice,
} from './equipment-helpers';

export function useEquipment() {
  // ── Cameras ────────────────────────────────────────────────────────────────
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camerasLoading, setCamerasLoading] = useState(true);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [cameraForm, setCameraForm] = useState<{
    id: string | null;
    name: string;
    aliasesText: string;
    /** FR-035: '' = unknown (behaves as mono, FR-038). */
    sensorType: '' | SensorType;
    passband: PassbandChoice;
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
  const [telescopeFormError, setTelescopeFormError] = useState<string | null>(
    null,
  );
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
        setCamerasError(
          m.settings_equipment_load_error({ error: errMessage(err) }),
        ),
      )
      .finally(() => setCamerasLoading(false));
  }, []);

  const loadTelescopes = useCallback(() => {
    setTelescopesLoading(true);
    setTelescopesError(null);
    equipmentTelescopesList()
      .then(setTelescopes)
      .catch((err: unknown) =>
        setTelescopesError(
          m.settings_equipment_load_error({ error: errMessage(err) }),
        ),
      )
      .finally(() => setTelescopesLoading(false));
  }, []);

  const loadTrains = useCallback(() => {
    setTrainsLoading(true);
    setTrainsError(null);
    equipmentTrainsList()
      .then(setTrains)
      .catch((err: unknown) =>
        setTrainsError(
          m.settings_equipment_load_error({ error: errMessage(err) }),
        ),
      )
      .finally(() => setTrainsLoading(false));
  }, []);

  const loadFilters = useCallback(() => {
    setFiltersLoading(true);
    setFiltersError(null);
    equipmentFiltersList()
      .then(setFilters)
      .catch((err: unknown) =>
        setFiltersError(
          m.settings_equipment_load_error({ error: errMessage(err) }),
        ),
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
    if (isDuplicateName(cameras, name, cameraForm.id)) {
      setCameraFormError(m.settings_equipment_name_duplicate());
      return;
    }
    const aliases = parseAliases(cameraForm.aliasesText);
    if (hasDuplicateAlias(cameras, aliases, cameraForm.id)) {
      setCameraFormError(m.settings_equipment_alias_duplicate());
      return;
    }
    setCameraSaving(true);
    setCameraFormError(null);
    try {
      // FR-035: '' (unknown) persists as null; passband only matters for OSC.
      const sensorType =
        cameraForm.sensorType === '' ? null : cameraForm.sensorType;
      const passband =
        sensorType === 'osc' ? passbandBandsFrom(cameraForm.passband) : null;
      if (cameraForm.id) {
        await equipmentCameraUpdate({
          id: cameraForm.id,
          name,
          aliases,
          sensorType,
          passband,
        });
      } else {
        await equipmentCameraCreate({ name, aliases, sensorType, passband });
      }
      setCameraForm(null);
      loadCameras();
    } catch (err: unknown) {
      setCameraFormError(
        m.settings_equipment_save_error({ error: errMessage(err) }),
      );
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
    if (isDuplicateName(telescopes, name, telescopeForm.id)) {
      setTelescopeFormError(m.settings_equipment_name_duplicate());
      return;
    }
    const aliases = parseAliases(telescopeForm.aliasesText);
    if (hasDuplicateAlias(telescopes, aliases, telescopeForm.id)) {
      setTelescopeFormError(m.settings_equipment_alias_duplicate());
      return;
    }
    setTelescopeSaving(true);
    setTelescopeFormError(null);
    try {
      const focalLengthMm = parseFocalLength(telescopeForm.focalLengthMmText);
      if (telescopeForm.id) {
        await equipmentTelescopeUpdate({
          id: telescopeForm.id,
          name,
          aliases,
          focalLengthMm,
        });
      } else {
        await equipmentTelescopeCreate({ name, aliases, focalLengthMm });
      }
      setTelescopeForm(null);
      loadTelescopes();
    } catch (err: unknown) {
      setTelescopeFormError(
        m.settings_equipment_save_error({ error: errMessage(err) }),
      );
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
    setDeleteTarget({
      kind: 'telescope',
      id: telescope.id,
      name: telescope.name,
    });
  };

  // ── Optical train handlers ───────────────────────────────────────────────────

  const handleTrainSubmit = async () => {
    if (!trainForm) return;
    const name = trainForm.name.trim();
    if (!name) {
      setTrainFormError(m.settings_equipment_name_required());
      return;
    }
    if (isDuplicateName(trains, name, trainForm.id)) {
      setTrainFormError(m.settings_equipment_name_duplicate());
      return;
    }
    // #835: a train without both parts selected has nothing to resolve
    // camera/telescope-specific FITS metadata against.
    if (!trainForm.cameraId || !trainForm.telescopeId) {
      setTrainFormError(m.settings_equipment_train_parts_required());
      return;
    }
    const focalLengthMm = parseFocalLength(trainForm.focalLengthMmText);
    if (focalLengthMm == null) {
      setTrainFormError(m.settings_equipment_focal_length_required());
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
        await equipmentTrainCreate({
          name,
          telescopeId,
          cameraId,
          focalLengthMm,
        });
      }
      setTrainForm(null);
      loadTrains();
    } catch (err: unknown) {
      setTrainFormError(
        m.settings_equipment_save_error({ error: errMessage(err) }),
      );
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
    if (isDuplicateName(filters, name, filterForm.id)) {
      setFilterFormError(m.settings_equipment_name_duplicate());
      return;
    }
    setFilterSaving(true);
    setFilterFormError(null);
    try {
      if (filterForm.id) {
        await equipmentFilterUpdate({
          id: filterForm.id,
          name,
          category: filterForm.category,
        });
      } else {
        await equipmentFilterCreate({ name, category: filterForm.category });
      }
      setFilterForm(null);
      loadFilters();
    } catch (err: unknown) {
      setFilterFormError(
        m.settings_equipment_save_error({ error: errMessage(err) }),
      );
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
      setDeleteError(
        m.settings_equipment_delete_error({ error: errMessage(err) }),
      );
    } finally {
      setDeleteBusy(false);
    }
  };

  // ── Row lookups for the optical trains table ─────────────────────────────────

  const cameraName = (id: string | null) =>
    id
      ? (cameras.find((c) => c.id === id)?.name ?? id)
      : m.settings_equipment_field_none();
  const telescopeName = (id: string | null) =>
    id
      ? (telescopes.find((t) => t.id === id)?.name ?? id)
      : m.settings_equipment_field_none();

  return {
    cameras,
    camerasLoading,
    camerasError,
    cameraForm,
    setCameraForm,
    cameraFormError,
    cameraSaving,
    handleCameraSubmit,
    requestDeleteCamera,

    telescopes,
    telescopesLoading,
    telescopesError,
    telescopeForm,
    setTelescopeForm,
    telescopeFormError,
    telescopeSaving,
    handleTelescopeSubmit,
    requestDeleteTelescope,

    trains,
    trainsLoading,
    trainsError,
    trainForm,
    setTrainForm,
    trainFormError,
    trainSaving,
    handleTrainSubmit,
    requestDeleteTrain,

    filters,
    filtersLoading,
    filtersError,
    filterForm,
    setFilterForm,
    filterFormError,
    filterSaving,
    handleFilterSubmit,
    requestDeleteFilter,

    deleteTarget,
    setDeleteTarget,
    deleteBusy,
    deleteError,
    setDeleteError,
    handleConfirmDelete,

    cameraName,
    telescopeName,
  };
}
