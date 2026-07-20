// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Router `Link` stub for tests that render router-aware components WITHOUT a
 * router context.
 *
 * The real `Link` reads router context and throws when it is absent, so any
 * suite that mocks `@tanstack/react-router` by spreading `...actual` has to
 * override `Link` explicitly. Extracted here once because every ProjectDetail
 * suite needs the identical stub (#735 turned the tool-configure hint from a
 * raw `<a href="#/settings?pane=tools">` into a real `<Link>`).
 *
 * Renders a plain anchor whose href mirrors what the router would build, so
 * tests can still assert on link destinations:
 *   `to="/targets"` + `search={{ selected: 'x' }}` → `/targets?selected=x`
 *   `to="/settings/$pane"` + `params={{ pane: 'tools' }}` → `/settings/tools`
 */

import type { ReactNode } from 'react';

export interface LinkStubProps {
  children?: ReactNode;
  to: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
}

export function LinkStub({
  children,
  to,
  search,
  params,
  ...rest
}: LinkStubProps) {
  const path = params
    ? Object.entries(params).reduce(
        (acc, [key, value]) => acc.replace(`$${key}`, value),
        to,
      )
    : to;
  const query = search ? `?${new URLSearchParams(search).toString()}` : '';
  return (
    <a href={`${path}${query}`} {...rest}>
      {children}
    </a>
  );
}
