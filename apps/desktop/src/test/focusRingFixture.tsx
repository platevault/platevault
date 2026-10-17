// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { createRoot } from 'react-dom/client';
import { InfoTip } from '@/ui/InfoTip';
import { Lock } from '@/ui/Lock';
import {
  fixtureShell,
  fixtureStart,
  sharedFocusRing,
} from './__tests__/focusRingFixture.css';

function FocusRingFixture() {
  return (
    <main className={fixtureShell}>
      <button
        aria-hidden="true"
        className={fixtureStart}
        data-testid="fixture-start"
        type="button"
      />
      <InfoTip tip="Additional information" />
      <Lock data-testid="lock-focus-target" reason="Protected" />
      <span
        aria-hidden="true"
        className={sharedFocusRing}
        data-testid="shared-focus-ring"
      />
    </main>
  );
}

const host = document.getElementById('focus-ring-fixture');
if (!host) throw new Error('Focus-ring fixture root is missing');

createRoot(host).render(<FocusRingFixture />);
