/**
 * CalibrationDetail -- route component for /calibration/$id.
 * Highlighted matching fingerprint section, binary match display,
 * 1-year aging badge. Renders the full CalibrationPage which picks
 * up the $id param internally.
 *
 * Rewritten per spec 030 T076.
 */

import { CalibrationPage } from './CalibrationPage';

export function CalibrationDetail() {
  return <CalibrationPage />;
}
