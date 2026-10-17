// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import plugin from '../../eslint-rules/no-raw-svg-colour.js';
// The local ESLint rule forbidding raw SVG presentation-attribute colours.
const tsParser = tseslint.parser;

function lint(code: string) {
  const linter = new Linter();
  const messages = linter.verify(code, {
    plugins: { svg: plugin },
    languageOptions: {
      parser: tsParser,
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

  it('allows paint server IDs in templates with conditional color-name parts', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`url(#paint-${active ? '#fff' : 'red'})`} stroke={`url(#${active ? 'currentColor' : 'var(--pv-accent)'})`} />;",
    );

    expect(
      diagnostics.map((diagnostic) => [diagnostic.message, diagnostic.column]),
    ).toEqual([]);
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
  it('flags color on a standalone foreignObject', () => {
    const diagnostics = lint('<foreignObject color="red" />');

    expect(diagnostics).toHaveLength(1);
  });

  it('flags color on foreignObject inside SVG', () => {
    const diagnostics = lint('<svg><foreignObject color="red" /></svg>');

    expect(diagnostics).toHaveLength(1);
  });
  it('allows color-named values in paint-server URL substitutions', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`url(#${dark ? 'red' : 'blue'})`} />;",
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('flags a raw hex color assembled in a template substitution', () => {
    const diagnostics = lint('const svg = <svg fill={`#${hex}`} />;');

    expect(diagnostics).toHaveLength(1);
  });

  it('allows named colors in later substitutions inside an open paint URL', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`url(#${prefix}-${dark ? 'red' : 'blue'})`} />;",
    );

    expect(diagnostics).toHaveLength(0);
  });

  it('flags a raw RGB function opened before a template substitution', () => {
    const diagnostics = lint('const svg = <svg fill={`rgb(${r}, 0, 0)`} />;');

    expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'Raw colour in SVG presentation attribute "fill". Use a theme variable.',
    ]);
  });

  it('allows dynamic variable names but checks interpolated var fallbacks', () => {
    const dynamicName = lint(
      "const svg = <svg color={`var(--pv-${dark ? 'red' : 'blue'})`} />;",
    );
    const fallback = lint(
      "const svg = <svg fill={`var(--pv-accent, ${dark ? '#fff' : '#000'})`} />;",
    );

    expect(dynamicName).toHaveLength(0);
    expect(fallback).toHaveLength(2);
  });

  it('keeps foreignObject namespace boundaries while allowing nested SVG re-entry', () => {
    const htmlText = lint(
      '<svg><foreignObject><text color="red" /></foreignObject></svg>',
    );
    const nestedSvg = lint(
      '<svg><foreignObject><svg><rect fill="#fff" /></svg></foreignObject></svg>',
    );
    const standalonePath = lint('<path fill="#fff" />');

    expect(htmlText).toHaveLength(0);
    expect(nestedSvg).toHaveLength(1);
    expect(standalonePath).toHaveLength(1);
  });

  it('unwraps TypeScript non-null assertions around paint expressions', () => {
    const diagnostics = lint(
      "const svg = <svg fill={(enabled ? '#fff' : token)!} />;",
    );

    expect(diagnostics).toHaveLength(1);
  });

  it('unwraps TypeScript as assertions and satisfies expressions', () => {
    const assertion = lint("const svg = <svg fill={'#fff' as string} />;");
    const satisfies = lint(
      "const svg = <svg fill={'#fff' satisfies string} />;",
    );

    expect(assertion).toHaveLength(1);
    expect(satisfies).toHaveLength(1);
  });

  it('unwraps parenthesized and optional-chain paint expressions', () => {
    const parenthesized = lint(
      "const svg = <svg fill={(dark ? '#fff' : token)} />;",
    );
    const optionalChain = lint(
      "const svg = <svg fill={theme?.raw ?? '#fff'} />;",
    );

    expect(parenthesized).toHaveLength(1);
    expect(optionalChain).toHaveLength(1);
  });
  it('allows named suffixes after template URL and variable substitutions', () => {
    const urlSuffix = lint('const svg = <svg fill={`url(#${id}red)`} />;');
    const variableSuffix = lint(
      'const svg = <svg color={`var(--pv-${variant}red)`} />;',
    );

    expect(urlSuffix).toHaveLength(0);
    expect(variableSuffix).toHaveLength(0);
  });
  it('checks raw colors on SVG roots re-entering inside foreignObject', () => {
    const diagnostics = lint(
      '<foreignObject><svg fill="red" /></foreignObject>',
    );

    expect(diagnostics).toHaveLength(1);
  });

  it('flags a partial hex prefix completed by a template substitution', () => {
    const diagnostics = lint("const svg = <svg fill={`#ff${'00'}`} />;");

    expect(diagnostics).toHaveLength(1);
  });
  it('flags raw colors assembled from static template chunks', () => {
    const namedColor = lint("const svg = <svg fill={`re${'d'}`} />;");
    const colorFunction = lint("const svg = <svg fill={`r${'gb'}(1 2 3)`} />;");

    expect(namedColor).toHaveLength(1);
    expect(colorFunction).toHaveLength(1);
  });
  it('flags static template colors and sequence-expression paint values', () => {
    const wrappedTemplate = lint(
      "const svg = <svg fill={`re${'d' as const}`} />;",
    );
    const sequence = lint(
      "const svg = <svg fill={(recordMetric(), '#fff')} />;",
    );

    expect(wrappedTemplate).toHaveLength(1);
    expect(sequence).toHaveLength(1);
  });

  it('checks fallback text introduced by a var-name interpolation', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`var(--pv-accent${enabled ? ', red' : ''})`} />;",
    );

    expect(diagnostics).toHaveLength(1);
  });
  it('keeps SVG context through capitalized child wrappers', () => {
    const diagnostics = lint('<svg><Group><rect fill="red" /></Group></svg>');

    expect(diagnostics).toHaveLength(1);
  });

  it('checks static var fallback after a dynamic token name', () => {
    const diagnostics = lint(
      'const svg = <svg fill={`var(${token}, red)`} />;',
    );

    expect(diagnostics).toHaveLength(1);
  });
  it('checks logical expressions that add a var fallback', () => {
    const diagnostics = lint(
      "const svg = <svg fill={`var(--pv-accent${enabled && ', red'})`} />;",
    );

    expect(diagnostics).toHaveLength(1);
  });
  it('checks SVG elements nested under member-expression wrappers', () => {
    const diagnostics = lint(
      '<svg><Foo.Bar><rect fill="red" /></Foo.Bar></svg>',
    );

    expect(diagnostics).toHaveLength(1);
  });
  it('allows a raw-looking left operand that cannot be the logical result', () => {
    const diagnostics = lint(
      "const svg = <svg fill={'red' && 'var(--pv-accent)'} />;",
    );

    expect(diagnostics).toHaveLength(0);
  });
  it('flags raw colors assembled through nested static templates', () => {
    const diagnostics = lint('const svg = <svg fill={`re${`d`}`} />;');

    expect(diagnostics).toHaveLength(1);
  });
});
