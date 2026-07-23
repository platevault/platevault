// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

// Route-level stub for /calibration/$id — renders the main CalibrationPage.
// Retained for router and smoke-test import compatibility.
import { CalibrationPage } from './CalibrationPage';

export function CalibrationDetail() {
  return <CalibrationPage />;
}
