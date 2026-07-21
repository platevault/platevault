// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Channel drift state + actions for EditProjectPane (US4 / US1c, extracted
 * #1000).
 *
 * Owns the re-infer / dismiss-drift mutations and the busy flag that gates
 * both buttons in `ChannelDriftBanner`.
 */

import { useCallback, useState } from 'react';
import type { ProjectChannelDto } from '@/bindings/index';
import {
  callReinferChannels,
  callDismissChannelDrift,
} from '@/features/projects/store';

export function useEditProjectChannels(
  projectId: string,
  initialChannels: ProjectChannelDto[],
) {
  const [channelWorking, setChannelWorking] = useState(false);
  const [channels, setChannels] =
    useState<ProjectChannelDto[]>(initialChannels);

  const handleReinfer = useCallback(async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      const result = await callReinferChannels({
        requestId: crypto.randomUUID(),
        projectId,
      });
      setChannels(result.channels ?? []);
    } catch {
      // Non-fatal
    } finally {
      setChannelWorking(false);
    }
  }, [channelWorking, projectId]);

  const handleDismissDrift = useCallback(async () => {
    if (channelWorking) return;
    setChannelWorking(true);
    try {
      await callDismissChannelDrift({
        requestId: crypto.randomUUID(),
        projectId,
      });
    } catch {
      // Non-fatal
    } finally {
      setChannelWorking(false);
    }
  }, [channelWorking, projectId]);

  return {
    channels,
    setChannels,
    channelWorking,
    handleReinfer,
    handleDismissDrift,
  };
}
