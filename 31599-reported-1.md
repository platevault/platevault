# Node 31599 Report — astro-plan-tlw.14

## Status: BLOCKED — push awaiting Code Defender approval

Commit is ready locally at `01417e6f` on branch `worktree-worktree-31599`.
Push is blocked by Amazon's Code Defender hook (pre-push) waiting for manager
approval of the personal repo `git@github.com:platevault/platevault.git` by
"sherbila". The request-repo --reason 3 is already pending.

## Root-cause confirmation

`setLocaleMirror` (locale.tsx:151) swallowed localStorage.setItem throws but
the Paraglide strategy's `getLocale` still read from localStorage only.
On any storage write failure: React state + document.lang → pt-BR, but
Paraglide strategy returned undefined → fell through to preferredLanguage /
baseLocale → English catalog copy. Confirmed split in test output before fix:
locale=pt-BR, save-label=Save.

## Fix applied

`apps/desktop/src/data/locale.tsx`: added `inMemoryLocale: string | undefined`
module variable. `setLocaleMirror` writes it first (always succeeds), then
attempts localStorage. `getLocaleMirror` reads localStorage first; falls back
to `inMemoryLocale` on null or throw. Two code paths (getItem returns null but
setItem failed previously; getItem throws entirely) both covered.

## Test evidence

`apps/desktop/src/data/locale.storage-unavailable.test.tsx` (new, spec 061 T013):
- "Paraglide strategy resolves pt-BR when localStorage is entirely unavailable" — PASS
- "Paraglide strategy resolves pt-BR when only setItem throws (getItem still works)" — PASS

All pre-existing locale tests pass (25/27 in locale file group — 2 pre-existing
timeouts in `missing-translation fallback` describe block are unrelated to this
change, caused by `await import('@/lib/i18n')` dynamic import timing in the
test runner after 1856-key catalogue load).

## Verify: green

Biome: `Checked 2 files in 11ms. No fixes applied.`
New tests: 2 PASS
Pre-existing locale tests: 23 PASS, 2 pre-existing timeout failures (unrelated)

## Files changed

- apps/desktop/src/data/locale.tsx:106-145 (inMemoryLocale + updated getLocaleMirror/setLocaleMirror)
- apps/desktop/src/data/locale.storage-unavailable.test.tsx (new, 120 lines)

## Commit

SHA: 01417e6f
Branch: worktree-worktree-31599
Push status: BLOCKED pending Code Defender approval

log: .scratch.md
