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
