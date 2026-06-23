# Quickstart: i18n Catalog & Error Codes

**Feature**: `046-i18n-error-codes`

How to work with the message catalog and error codes after this feature lands.

## Use a message in a component

```tsx
import { m } from '@/paraglide/messages';

<button>{m.common_save()}</button>
<input placeholder={m.targets_ph_search()} />
<p>{m.sessions_count({ count: n })}</p>   // interpolation, type-checked
```

Never write a user-facing literal in a component — the lint gate
(`alm/no-user-string`) will fail `just lint`.

## Add a new message

1. Add the key to `apps/desktop/messages/en.json`:
   ```json
   { "targets_empty": "No targets yet — add one to start planning." }
   ```
2. Reference it: `m.targets_empty()`. The Vite plugin compiles it; `tsc` now
   knows the function. A typo in the key is a compile error.

Naming: `<area>_<element>_<intent>` (see research R5). Reuse a `verb_*` /
`common_*` / `nav_*` canonical key instead of inventing a synonym (US3).

## Add / change an interpolated value

`"inbox_moved": "Moved {count} files to {dest}."` →
`m.inbox_moved({ count, dest })`. Arguments are typed; missing or extra params
fail `tsc`.

## Add a backend error code

1. Add a variant to `crates/contracts/core/src/error_code.rs` with an explicit
   `#[serde(rename = "your.code")]`.
2. `cargo test -p desktop_shell` regenerates `apps/desktop/src/bindings/index.ts`
   (the `ErrorCode` union). Commit the regenerated file.
3. Add a friendly message: `err_your_code` in `messages/en.json`, and map it in
   `apps/desktop/src/lib/error-messages.ts`:
   `'your.code': m.err_your_code,`.
4. If you skip step 3, the exhaustiveness check flags the gap before release
   (FR-007/SC-003). Until mapped, the user sees `err_generic_fallback` and the
   code is logged (FR-011).

## Surface an error in the UI

Always route through the single point:

```ts
import { errMessage } from '@/lib/errors';
catch (err) { setError(errMessage(err)); }   // never String(err) / err.message raw
```

`errMessage` returns the friendly catalog text; it never returns a raw code or
backend exception string (FR-009).

## Add a second language later (not shipped now)

1. `messages/de.json` with the same keys.
2. Add `"de"` to `locales` in `project.inlang/settings.json`.
3. No component changes. (This is the SC-007 proof — done as a throwaway, not
   shipped.)

## Verify locally

```bash
cd apps/desktop && pnpm build          # compiles catalog; missing key = build fail
just typecheck                          # catalog keys + error-code exhaustiveness
just lint                               # no hardcoded user strings (SC-001), tokens
just test                               # vitest (errMessage) + cargo (bindings/round-trip)
```
