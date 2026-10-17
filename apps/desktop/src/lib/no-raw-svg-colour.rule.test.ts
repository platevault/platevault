// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
// The local ESLint rule forbidding raw SVG presentation-attribute colours.
import plugin from '../../eslint-rules/no-raw-svg-colour.js';

function lint(code: string) {
  const linter = new Linter();
  const messages = linter.verify(code, {
    plugins: { svg: plugin },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: { 'svg/no-raw-svg-colour': 'error' },
  });
  const parseErrors = messages.filter(
    (message) => message.fatal || !message.ruleId,
  );
  expect(parseErrors, 'lint fixture must parse').toHaveLength(0);
  return messages.filter(
    (message) => message.ruleId === 'svg/no-raw-svg-colour',
  );
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

  it('allows HTML and theme paint but flags raw colors in compound SVG paint', () => {
    const htmlDiagnostics = lint('<div fill="red" />');
    const svgDiagnostics = lint(
      '<svg fill="none red" stroke="var(--pv-accent) url(#blue)" />',
    );

    expect(htmlDiagnostics).toHaveLength(0);
    expect(svgDiagnostics).toHaveLength(1);
    expect(svgDiagnostics[0]?.message).toContain('"fill"');
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
    expect(diagnostics[0]?.message).toContain('"fill"');
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

  it('flags a raw color on a standalone intrinsic SVG element', () => {
    const diagnostics = lint(
      'function Dot() { return <circle fill="#f00" />; }',
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('"fill"');
  });

  it('skips capitalized component props that resemble SVG elements', () => {
    const diagnostics = lint(
      'function Card() { return <Badge color="red" />; }',
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('skips capitalized Text components even when they share an SVG tag name', () => {
    const diagnostics = lint('function T() { return <Text color="red" />; }');

    expect(diagnostics).toHaveLength(0);
  });

  it('flags raw flood colors on standalone camel-case SVG filter primitives', () => {
    const diagnostics = lint(
      'function F() { return <feFlood floodColor="#f00" />; }',
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.message).toContain('"floodColor"');
  });

  it('flags standalone switch paint containers', () => {
    const diagnostics = lint('<switch color="red"><circle /></switch>');

    expect(diagnostics).toHaveLength(1);
  });

  it('does not treat HTML inside foreignObject as SVG context', () => {
    const diagnostics = lint(
      '<svg><foreignObject><Label color="red" /></foreignObject></svg>',
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('flags a raw template color formed across a substitution', () => {
    const diagnostics = lint(
      'const swatch = "f00"; const dot = <circle fill={`#${swatch}`} />;',
    );

    expect(diagnostics).toHaveLength(1);
  });
});
