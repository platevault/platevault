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
    expect(out.filter((m) => m.ruleId === 'alm/no-user-string')).toHaveLength(0);
  });
});
