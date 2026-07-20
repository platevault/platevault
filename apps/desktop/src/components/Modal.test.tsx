// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * Modal tests — #841 initial-focus race.
 *
 * The header (✕ close button) precedes the body in the DOM, so Base UI's
 * default `initialFocus` behavior (first tabbable element) lands on the ✕
 * unless a caller opts a specific element in via `initialFocus`.
 */

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useRef, useState } from 'react';
import { Modal } from './Modal';

describe('Modal initial focus', () => {
  it('defaults to the header close button (no initialFocus given)', async () => {
    render(
      <Modal open onClose={vi.fn()} title="Test">
        <input aria-label="body field" />
      </Modal>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });
  });

  it('focuses the ref passed as initialFocus instead of the close button (#841)', async () => {
    function Harness() {
      const ref = useRef<HTMLInputElement>(null);
      return (
        <Modal open onClose={vi.fn()} title="Test" initialFocus={ref}>
          <input aria-label="body field" ref={ref} />
        </Modal>
      );
    }
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByLabelText('body field')).toHaveFocus();
    });
  });
});

describe('Modal final focus (#844)', () => {
  it('returns focus to the invoking control on close', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open dialog</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Test">
            <input aria-label="body field" />
          </Modal>
        </>
      );
    }
    render(<Harness />);
    const openBtn = screen.getByRole('button', { name: 'Open dialog' });
    openBtn.focus();
    fireEvent.click(openBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(openBtn).toHaveFocus();
    });
  });
});

/**
 * Journey 16 requires every overlay to close on Escape and trap focus. These
 * assert the contract at the shared-component level, so every Modal consumer
 * inherits it (#660 regressed because the edit pane bypassed Modal entirely).
 */
describe('Modal dismissal and focus containment (Journey 16)', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Test">
        <input aria-label="body field" />
      </Modal>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('traps focus by removing the page behind it from the a11y tree', async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button>Outside control</button>
          <Modal open={open} onClose={() => setOpen(false)} title="Test">
            <input aria-label="body field" />
          </Modal>
        </>
      );
    }
    render(<Harness />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // jsdom implements no real Tab traversal, so the trap is asserted via the
    // mechanism that produces it: base-ui marks everything outside the open
    // dialog inert/aria-hidden, which also drops it out of the a11y tree.
    // The control is still in the DOM — it is just unreachable.
    expect(
      screen.queryByRole('button', { name: 'Outside control' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Outside control')).toBeInTheDocument();

    // ...and it becomes reachable again once the dialog closes.
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Outside control' }),
      ).toBeInTheDocument();
    });
  });
});
