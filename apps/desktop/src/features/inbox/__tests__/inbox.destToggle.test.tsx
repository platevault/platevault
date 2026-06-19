/// <reference types="@testing-library/jest-dom" />
/**
 * T074 — Inbox destructive-destination toggle is surfaced and the chosen
 * value is honored (FR-032).
 *
 * Tests:
 * 1. ActionSidebar renders both "Archive folder" and "System trash" radio options.
 * 2. "Archive folder" is selected by default.
 * 3. Switching to "System trash" fires onDestructiveDestinationChange('trash').
 * 4. The chosen value propagates to the confirm call (tested via InboxPage handler).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ActionSidebar } from '../ActionSidebar';
import type { InboxClassifyResponse } from '../store';

const singleTypeClassification: InboxClassifyResponse = {
  inboxItemId: 'item-001',
  type: 'single_type',
  frameType: 'light',
  contentSignature: 'sig-abc',
  breakdown: [],
  unclassifiedFiles: [],
  sampleFiles: [],
  computedAt: '2026-06-01T00:00:00Z',
};

describe('T074: destructive-destination toggle', () => {
  it('renders both destination radio options', () => {
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        destructiveDestination="archive"
        onDestructiveDestinationChange={vi.fn()}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Move to archive folder')).toBeInTheDocument();
    expect(screen.getByLabelText('Move to system trash')).toBeInTheDocument();
  });

  it('archive is selected by default', () => {
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        destructiveDestination="archive"
        onDestructiveDestinationChange={vi.fn()}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    const archiveRadio = screen.getByLabelText('Move to archive folder') as HTMLInputElement;
    const trashRadio = screen.getByLabelText('Move to system trash') as HTMLInputElement;
    expect(archiveRadio.checked).toBe(true);
    expect(trashRadio.checked).toBe(false);
  });

  it('switching to trash fires onDestructiveDestinationChange with "trash"', () => {
    const onChange = vi.fn();
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        destructiveDestination="archive"
        onDestructiveDestinationChange={onChange}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Move to system trash'));
    expect(onChange).toHaveBeenCalledWith('trash');
  });

  it('switching back to archive fires onDestructiveDestinationChange with "archive"', () => {
    const onChange = vi.fn();
    render(
      <ActionSidebar
        hasSelection
        classification={singleTypeClassification}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm
        destructiveDestination="trash"
        onDestructiveDestinationChange={onChange}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    const archiveRadio = screen.getByLabelText('Move to archive folder') as HTMLInputElement;
    expect(archiveRadio.checked).toBe(false);
    fireEvent.click(archiveRadio);
    expect(onChange).toHaveBeenCalledWith('archive');
  });

  it('destination toggle is hidden when nothing is selected', () => {
    render(
      <ActionSidebar
        hasSelection={false}
        classification={null}
        hasOpenPlan={false}
        confirmLoading={false}
        canConfirm={false}
        destructiveDestination="archive"
        onDestructiveDestinationChange={vi.fn()}
        onConfirm={vi.fn()}
        onOpenExistingPlan={vi.fn()}
      />,
    );
    // Toggle section is only rendered when hasSelection=true
    expect(screen.queryByLabelText('Move to archive folder')).not.toBeInTheDocument();
  });
});
