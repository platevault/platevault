// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
// The local ESLint rule forbidding raw SVG presentation-attribute colours.
import plugin from '../../eslint-rules/no-raw-svg-colour.js';

function lint(code: string) {
  const linter = new Linter();
  return linter
    .verify(code, {
      plugins: { svg: plugin },
      languageOptions: {
        parserOptions: {
          ecmaFeatures: { jsx: true },
          ecmaVersion: 'latest',
          sourceType: 'module',
        },
      },
      rules: { 'svg/no-raw-svg-colour': 'error' },
    })
    .filter((message) => message.ruleId === 'svg/no-raw-svg-colour');
}

describe('svg/no-raw-svg-colour', () => {
  it('flags hex values on all supported SVG presentation attributes', () => {
    const diagnostics = lint(
      '<svg fill="#123" stroke="#12345678" stopColor="#fff" flood-color="#000" lightingColor="#abc" color="#abcdef" />',
    );

    expect(diagnostics).toHaveLength(6);
  });

  it('flags colour functions, named colours, and system colours', () => {
    const diagnostics = lint(
      '<svg fill="RGB(1, 2, 3)" stroke="oklch(0.5 0.1 20)" stop-color="red" floodColor="CanvasText" lighting-color="Highlight" color="ButtonFace" />',
    );

    expect(diagnostics).toHaveLength(6);
  });

  it('allows theme variables, paint servers, and SVG keywords', () => {
    const diagnostics = lint(
      '<svg fill="var(--pv-accent)" stroke="currentColor" stop-color="none" flood-color="inherit" lighting-color="transparent" color="var(--pv-text)" />',
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('allows theme-variable expressions and paint-server URLs', () => {
    const diagnostics = lint(
      'const paint = vars.accent; const svg = <svg fill={paint} stroke={`url(#gradient)`} />;',
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('ignores non-SVG presentation-like props and allows keywords in compound values', () => {
    const diagnostics = lint(
      '<div fill="red" /><svg fill="none red" stroke="var(--pv-accent) url(#blue)" />',
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('flags system colours on each SVG presentation attribute', () => {
    const diagnostics = lint(
      '<svg fill="Canvas" stroke="CanvasText" stopColor="ButtonText" floodColor="Field" lightingColor="GrayText" color="ActiveText" />',
    );

    expect(diagnostics).toHaveLength(6);
  });

  it('flags colours in variable fallbacks and combined paint values', () => {
    const diagnostics = lint(
      '<svg fill="var(--pv-accent, red)" stroke="var(--pv-accent) blue" />',
    );

    expect(diagnostics).toHaveLength(2);
  });

  it('flags raw colors in conditional and logical expressions', () => {
    const diagnostics = lint(
      "const svg = <svg fill={active ? '#fff' : 'red'} stroke={enabled && '#abc'} color={theme ?? 'Canvas'} />;",
    );

    expect(diagnostics).toHaveLength(4);
  });

  it('flags raw colors in template substitutions but allows nested theme choices', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`url(#paint-${active ? '#fff' : 'red'})`} stroke={`url(#${active ? 'currentColor' : 'var(--pv-accent)'})`} />;",
    );

    expect(diagnostics).toHaveLength(2);
  });

  it('allows conditionals selecting theme values and currentColor', () => {
    const diagnostics = lint(
      "const svg = <svg fill={active ? 'var(--pv-accent)' : 'currentColor'} stroke={enabled ? 'none' : 'inherit'} />;",
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('flags standalone SVG fragments and skips capitalized components', () => {
    const diagnostics = lint(
      'function Dot() { return <circle fill="#f00" />; } function Badge() { return <Badge color="red" />; }',
    );

    expect(diagnostics).toHaveLength(1);
  });
});
