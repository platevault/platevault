// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
// The local ESLint rule that drives the i18n migration (spec 046).
import plugin from '../../eslint-rules/no-user-string.js';

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { alm: plugin },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: { 'alm/no-user-string': 'error' },
  });
}

describe('alm/no-user-string', () => {
  it('flags user-facing JSX text, listed attributes, and toast strings', () => {
    const out = lint(`
      function P() {
        return (
          <div>
            <button title="Save the thing">Save changes</button>
            <input placeholder="Search…" />
            <i aria-label="Close dialog" />
            {toast("Saved")}
          </div>
        );
      }
    `);
    const ids = out.map((m) => m.messageId).sort();
    expect(ids).toEqual(['attr', 'attr', 'attr', 'jsxText', 'toast'].sort());
  });

  it('ignores machine strings and non-letter content', () => {
    const out = lint(`
      function P({ label, to }) {
        return (
          <a className="btn" id="x" data-test="y" href="/path" to={to} role="link">
            {label}
            <span>42</span>
            <span>·</span>
          </a>
        );
      }
    `);
    expect(out).toHaveLength(0);
  });

  it('honours an eslint-disable escape hatch', () => {
    const out = lint(`
      function P() {
        // eslint-disable-next-line alm/no-user-string
        return <span>Not user facing, really</span>;
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  // Regression lock for spec 046 SC-001: the gate MUST catch user-facing strings
  // that live in DATA STRUCTURES (object-literal label maps, nav/column configs)
  // and in ATTRIBUTE/CHILD TERNARIES — the exact class that escaped the original
  // rule and was only caught later by speckit-verify. If any of these regress,
  // a hardcoded string can ship without `npm run lint` failing.
  it('flags user-facing strings in object-literal label-ish properties', () => {
    const out = lint(`
      const NAV = [
        { id: 'inbox', label: 'Inbox', path: '/inbox' },
        { id: 'work', heading: 'Work', subtitle: 'In progress' },
      ];
      const DIALOG = { confirmLabel: 'Delete', cancelLabel: 'Keep', tooltip: 'Remove it' };
      export { NAV, DIALOG };
    `);
    // label, heading, subtitle, confirmLabel, cancelLabel, tooltip = 6
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      6,
    );
  });

  it('does NOT flag machine-ish object keys (name/id/value/path/route/variant)', () => {
    const out = lint(`
      const CFG = [
        { name: 'inbox', id: 'x', value: 'y', path: '/p', route: '/r', variant: 'primary' },
      ];
      export { CFG };
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('flags both branches of a user-facing attribute ternary', () => {
    const out = lint(`
      function P({ open }) {
        return <button aria-label={open ? 'Collapse panel' : 'Expand panel'} />;
      }
    `);
    const attrs = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(attrs).toHaveLength(2);
    expect(attrs.every((m) => m.messageId === 'attr')).toBe(true);
  });

  it('flags both branches of a JSX child-expression ternary', () => {
    const out = lint(`
      function P({ busy }) {
        return <button>{busy ? 'Working…' : 'Remove'}</button>;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'jsxText')).toBe(true);
  });

  // Template literals carry user-facing prose too (interpolated strings). They
  // need PARAMETERIZED catalog messages — m.key({ x }). This class escaped both
  // the original rule and the first hardening (Literal-only), so it is gated now.
  it('flags template literals in user-facing attributes', () => {
    const out = lint(`
      function P({ name }) {
        return <button aria-label={\`Remove \${name}\`} title={\`Sort by \${name}\`} />;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'attr')).toBe(true);
  });

  it('flags template literals in label-ish object properties', () => {
    const out = lint(`
      const COLS = [{ label: \`Sort by \${col}\` }];
      export { COLS };
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      1,
    );
  });

  it('flags template literals rendered as a JSX child (ternary expression)', () => {
    const out = lint(`
      function P({ ok, n }) {
        return <div>{ok ? \`Applied \${n} items\` : \`Failed after \${n}\`}</div>;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'jsxText')).toBe(true);
  });

  it('does NOT flag template literals in non-render positions (className, var, throw)', () => {
    const out = lint(`
      function P({ id }) {
        const cls = \`row-\${id} active\`;
        return <div className={\`wrap-\${id}\`}>{cls.length}</div>;
      }
    `);
    // className \`wrap-\${id}\` is an attribute (machine); cls assignment is a var.
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('alm/no-js-plural flags lone-suffix pluralization ternaries', () => {
    const linter = new Linter();
    const run = (code: string) =>
      linter.verify(code, {
        plugins: { alm: plugin },
        languageOptions: {
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        rules: { 'alm/no-js-plural': 'error' },
      });
    // inline JSX-suffix + suffix-param forms → flagged
    expect(
      run("const a = n !== 1 ? 's' : '';").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(1);
    expect(
      run("f({ suffix: n === 1 ? '' : 's' });").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(1);
    expect(
      run("const a = n === 1 ? '' : 'es';").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(1);
    // full-word ternaries and non-plural ternaries → NOT flagged
    expect(
      run("const a = ok ? 'Save' : 'Cancel';").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(0);
    expect(
      run("const a = n === 1 ? 'item' : 'items';").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(0);
  });

  it('alm/no-js-plural flags suffix template-literal ternaries and short-circuit suffixes', () => {
    const linter = new Linter();
    const run = (code: string) =>
      linter.verify(code, {
        plugins: { alm: plugin },
        languageOptions: {
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        rules: { 'alm/no-js-plural': 'error' },
      });
    // template-literal suffix/empty branches (no interpolation) → flagged
    expect(
      run('const a = n === 1 ? `` : `s`;').filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(1);
    // short-circuit suffix → flagged
    expect(
      run("const a = `${n}${n !== 1 && 's'}`;").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(1);
    // non-suffix logical-AND → NOT flagged
    expect(
      run("const a = ok && 'Save';").filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(0);
  });

  it('alm/no-js-plural flags a ternary picking between paired m.*_plural()/m.*_singular() catalog calls', () => {
    const linter = new Linter();
    const run = (code: string) =>
      linter.verify(code, {
        plugins: { alm: plugin },
        languageOptions: {
          parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
        },
        rules: { 'alm/no-js-plural': 'error' },
      });
    const out = run(
      'const a = n !== 1 ? m.inbox_list_file_plural() : m.inbox_list_file_singular();',
    );
    const hits = out.filter((m) => m.ruleId === 'alm/no-js-plural');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('jsPluralPairedCall');
    // reversed branch order → still flagged
    expect(
      run(
        'const b = n === 1 ? m.inbox_list_file_singular() : m.inbox_list_file_plural();',
      ).filter((m) => m.ruleId === 'alm/no-js-plural'),
    ).toHaveLength(1);
    // ternary between two unrelated catalog calls → NOT flagged
    expect(
      run('const c = ok ? m.common_save() : m.common_cancel();').filter(
        (m) => m.ruleId === 'alm/no-js-plural',
      ),
    ).toHaveLength(0);
  });

  it('ignores pure-interpolation / machine template literals (no letters)', () => {
    const out = lint(`
      function P({ a, b, id }) {
        return <div className={\`row-\${id}\`} aria-label={\`\${a}-\${b}\`} key={\`k\${id}\`} />;
      }
    `);
    // aria-label \`\${a}-\${b}\` has no letters in its static chunks → not flagged;
    // className/key are not user-facing attrs anyway.
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  // ── Enhancements (spec 046 #4: variable-assigned blind spot + attr/key gaps) ──

  it('flags the component-prop attrs heading and info', () => {
    const out = lint(`
      function P() {
        return (
          <div>
            <Group heading="Results" />
            <Row info="Controls how scans run." />
          </div>
        );
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'attr')).toBe(true);
  });

  it('flags a logical (??/||) string fallback in a user-facing attribute', () => {
    const out = lint(`
      function P({ groupBy, sort }) {
        return <div label={groupBy.label ?? 'Group by'} title={sort.title || 'Sort'} />;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'attr')).toBe(true);
  });

  it('flags title/desc/description/body object-literal keys', () => {
    const out = lint(`
      const META = { title: 'Data Sources', desc: 'Library roots indexed.' };
      const CARD = { description: 'On-demand resolution.', body: 'A longer note.' };
      export { META, CARD };
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      4,
    );
  });

  it('flags a user string assigned to a variable and then rendered', () => {
    const out = lint(`
      function P({ n, len }) {
        const summary = n === 0 ? 'None' : n === len ? 'All' : \`\${n} selected\`;
        return <span>{summary}</span>;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('variable');
  });

  it('does NOT flag machine-token variables even when rendered (prose gate)', () => {
    const out = lint(`
      function P({ ok }) {
        const status = ok ? 'pending' : 'no_match';
        const pattern = '{target}_{filter}';
        return <span title={status}>{pattern}</span>;
      }
    `);
    // 'pending'/'no_match' are lowercase/snake tokens; '{target}_{filter}' has braces.
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('does NOT flag a prose variable used only in a machine context', () => {
    const out = lint(`
      function P({ ok }) {
        const cls = ok ? 'Active row' : 'Idle row';
        return <div className={cls} />;
      }
    `);
    // 'Active row' is prose, but className is not a rendered/user position.
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  // ── State-setter sink + toast template literals (spec 046: prose template
  // literals passed directly to `setState(...)` or a toast call) ──

  it('flags a prose template literal passed directly to a useState setter and rendered', () => {
    const out = lint(`
      function P({ dims }) {
        const [errorMsg, setErrorMsg] = useState(undefined);
        const handle = () => {
          setErrorMsg(\`Hard-rule mismatch: \${dims.join(', ')}. Confirm to force-assign.\`);
        };
        return <div onClick={handle}>{errorMsg}</div>;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('variable');
  });

  it('flags a prose string literal passed directly to a useState setter and rendered', () => {
    const out = lint(`
      function P() {
        const [aliasError, setAliasError] = useState(null);
        const handle = () => {
          setAliasError('Alias must not be blank.');
        };
        return <span>{aliasError}</span>;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('variable');
  });

  it('does NOT flag a machine-token string passed to a useState setter (prose gate)', () => {
    const out = lint(`
      function P() {
        const [status, setStatus] = useState('idle');
        const handle = () => setStatus('pending');
        return <span title={status}>{handle.name}</span>;
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('does NOT flag a useState setter argument that is never rendered', () => {
    const out = lint(`
      function P() {
        const [msg, setMsg] = useState('');
        const handle = () => setMsg('Not rendered anywhere');
        return <div onClick={handle} />;
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('does NOT flag a machine path/id template literal passed to a useState setter', () => {
    const out = lint(`
      function P({ id }) {
        const [path, setPath] = useState('');
        const handle = () => setPath(\`/library/\${id}/preview\`);
        return <div title={path} />;
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('flags a prose template literal passed directly to a toast call', () => {
    const out = lint(`
      function P({ n }) {
        return toast(\`Saved \${n} items\`);
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('toast');
  });

  it('flags a prose template literal in a toast object-form message prop', () => {
    const out = lint(`
      function P({ n }) {
        return addToast({ message: \`Saved \${n} items\`, variant: 'ok' });
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('toast');
  });

  it('does NOT flag a pure-interpolation (no-letter) template literal passed to a toast call', () => {
    const out = lint(`
      function P({ a, b }) {
        return toast(\`#\${a}-\${b}\`);
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  // ── Gap-corpus hardening (run-jc0717): JSXAttribute name gap, nested toast
  // action.label, and the *Label/*Text/*Title/*Message return-statement blind
  // spot found live in the codebase (TargetsPage.tsx detailLabel="Target
  // details" reached CI green before this hardening). ──

  it('flags a JSX attribute ending in `Label` (custom aria-label-passthrough props)', () => {
    const out = lint(`
      function P() {
        return <ListPageLayout detailLabel="Target details" bottomDetailLabel="More info" />;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(2);
    expect(hits.every((m) => m.messageId === 'attr')).toBe(true);
  });

  it('flags a JSX attribute using a LABEL_PROP_KEYS name (tooltip, confirmLabel, subtitle…)', () => {
    const out = lint(`
      function P() {
        return <Dialog tooltip="Remove it" confirmLabel="Delete" subtitle="Cannot be undone" />;
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(3);
  });

  it('does NOT flag a machine-named JSX attribute (value, variant, dangerValue)', () => {
    const out = lint(`
      function P() {
        return <SegControl value="Delete" variant="primary" dangerValue="Delete" />;
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('flags a hardcoded label inside a toast/dialog nested action object (already-generic LABEL_PROP_KEYS check)', () => {
    const out = lint(`
      function P() {
        addToast({
          message: m.saved(),
          variant: 'error',
          action: { label: 'Retry', onClick: retry },
        });
      }
    `);
    // The object-literal `label` key check already covers this — it applies
    // to ANY object property named `label`, not just JSX/toast contexts.
    // Confirmed NOT a gap; kept as a regression lock, not new behavior.
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('attr');
  });

  it('flags a prose string returned directly from a *Label-named helper function', () => {
    const out = lint(`
      function statusLabel(s) {
        return s === 'ok' ? 'All good' : 'Needs review';
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('returnLiteral');
  });

  it('flags a prose string returned from a const-arrow *Text helper (concise body, no ReturnStatement)', () => {
    const out = lint(`
      const detailText = (e) => e.ok ? 'All good' : 'Needs attention';
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('returnLiteral');
  });

  it('flags a prose string returned from a *Label-named function inside a switch', () => {
    const out = lint(`
      function profileLabelFor(profile) {
        switch (profile) {
          case 'siril':
            return 'Siril';
          default:
            return m.unknown();
        }
      }
    `);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('returnLiteral');
  });

  // Known pre-existing heuristic limit (looksMachine's path/URL fragment
  // rule), not introduced by this hardening: a slash makes the whole prose
  // gate treat the string as a machine token, so a brand string containing
  // "/" slips past every prose-gated check in this rule (Property,
  // VariableDeclarator, setState, and this returnLiteral check alike).
  //
  // Deliberately NOT tightened. A 2026-07-20 sweep of src/ for slash-bearing
  // literals in user-facing positions found nothing hiding in this gap — the
  // one real case, 'PixInsight/WBPP', is now a catalog key. Narrowing the rule
  // would cost far more than it catches: iana-timezones.ts alone holds ~40
  // legitimate machine strings of exactly this shape ('Europe/Amsterdam'),
  // plus mock fixture paths. Re-run that sweep before revisiting.
  it('does NOT flag a slash-containing string even from a *Label-named function (looksMachine limitation)', () => {
    const out = lint(`
      function profileLabelFor(profile) {
        return profile === 'pixinsight' ? 'PixInsight/WBPP' : 'Other';
      }
    `);
    // 'Other' alone is prose and WOULD normally be flagged too, but the
    // ConditionalExpression prose gate requires only one branch to have
    // prose, so this documents the slash branch is silently excused while
    // the sibling branch still triggers the report.
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('returnLiteral');
  });

  it('does NOT flag a machine-token return from a *Label-named function (prose gate)', () => {
    const out = lint(`
      function classifyLabel(c) {
        switch (c) {
          case 'high':
            return 'ok';
          default:
            return 'neutral';
        }
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('does NOT flag a prose return from a function whose name is not a display-label helper', () => {
    const out = lint(`
      function buildQuery(term) {
        return term ? 'Has term' : 'No term';
      }
    `);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  // The sinks below were added while draining the baseline: each one had let a
  // real hardcoded string reach the screen before it was covered.

  it('flags string concatenation in a JSX child', () => {
    const out = lint(`const C = () => <div>{'Found ' + n + ' items'}</div>;`);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits.map((m) => m.messageId)).toEqual(['jsxText', 'jsxText']);
  });

  it('flags string concatenation in a user-facing attribute', () => {
    const out = lint(
      `const C = () => <input aria-label={'Delete ' + name} />;`,
    );
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('attr');
  });

  it('does NOT flag concatenation that builds a machine token', () => {
    const out = lint(`const C = () => <div data-x={'a-' + id} />;`);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it.each([
    ['emptyText', `<Row emptyText="No sessions recorded" />`],
    ['dialogTitle', `<Row dialogTitle="Confirm deletion" />`],
    ['errorMessage', `<Row errorMessage="Something went wrong" />`],
    ['searchPlaceholder', `<Row searchPlaceholder="Filter by name" />`],
    ['helpDesc', `<Row helpDesc="Choose a calibration master" />`],
  ])('flags the display-copy prop suffix in `%s`', (_name, jsx) => {
    const out = lint(`const C = () => ${jsx};`);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('attr');
  });

  // Regression: Skeleton defaulted `label` to 'Loading', so assistive tech
  // announced English on every loading state regardless of locale.
  it('flags a prose default value for a destructured display-label param', () => {
    const out = lint(`function F({ label = 'Loading' }) { return label; }`);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('attr');
  });

  it('flags a prose default value for a positional display-label param', () => {
    const out = lint(`function F(label = 'Please wait') { return label; }`);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('attr');
  });

  it('does NOT flag a machine-token default value (prose gate)', () => {
    const out = lint(`function F({ variant = 'primary' }) { return variant; }`);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it('does NOT flag a prose default on a param that is not a display label', () => {
    const out = lint(`function F(query = 'Has term') { return query; }`);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      0,
    );
  });

  it.each([
    'confirm',
    'prompt',
  ])('flags a string passed to window.%s', (api) => {
    const out = lint(`window.${api}('Delete these files permanently?');`);
    const hits = out.filter((m) => m.ruleId === 'alm/no-user-string');
    expect(hits).toHaveLength(1);
    expect(hits[0].messageId).toBe('toast');
  });

  // Unlike every other sink, the dialog APIs do NOT apply the machine-string
  // gate: a confirm()/prompt() argument is shown verbatim to the user, so any
  // letter-bearing string there is user copy even when it looks machine-ish.
  it('flags a machine-looking string passed to window.confirm', () => {
    const out = lint(`window.confirm('utf-8');`);
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(
      1,
    );
  });
});
