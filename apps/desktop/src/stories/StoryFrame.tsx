// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Framing helpers shared by every workbench story.
 *
 * `Stage` is for a whole working surface (a page, a shell); `Frame` is for a
 * single component; `Matrix` lines up one component's states so they can be
 * compared at a glance, which is how this product expects to be read.
 */
import { Fragment, type ReactNode } from 'react';
import * as f from './frame.css';

export function Stage({ children }: { children: ReactNode }) {
  return <div className={f.stage}>{children}</div>;
}

export function Frame({
  children,
  note,
}: {
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className={f.pad}>
      <div className={f.stack}>
        {note ? <p className={f.note}>{note}</p> : null}
        {children}
      </div>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className={f.row}>{children}</div>;
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={f.stack}>{children}</div>;
}

export function Panel({ children }: { children: ReactNode }) {
  return <div className={f.panel}>{children}</div>;
}

/** A labelled state-by-state comparison of one component. */
export function Matrix({
  entries,
}: {
  entries: Array<[label: string, node: ReactNode]>;
}) {
  return (
    <div className={f.matrix}>
      {entries.map(([label, node]) => (
        <Fragment key={label}>
          <div className={f.matrixLabel}>{label}</div>
          <div>{node}</div>
        </Fragment>
      ))}
    </div>
  );
}
