# Research: Selectable Application Language

**Feature**: 061-selectable-app-language
**Date**: 2026-07-20
**Status**: Phase 0 complete

Sources: Paraglide JS docs via context7 (`/opral/paraglide-js`, High reputation)
— `docs/strategy.md`, `docs-api/compiler-options.md`,
`docs-api/runtime/type/-internal-.md`. Installed version `@inlang/paraglide-js
^2.21.0`. Current config read from `apps/desktop/vite.config.ts` and
`project.inlang/settings.json`.

## Starting position

```jsonc
// project.inlang/settings.json
"baseLocale": "en", "locales": ["en"]

// vite.config.ts
paraglideVitePlugin({ strategy: ["baseLocale"] })
```

`strategy: ["baseLocale"]` means the compiler resolves exactly one locale and
never consults the environment. This is what spec 046 FR-004 described as
"English is hard-pinned"; it is a build-time constant, not a preference.

---

## D1 — Locale resolution strategy

**Decision**: `strategy: ["custom-almSettings", "preferredLanguage", "baseLocale"]`

**Rationale**: resolution must answer three questions in order.

1. *Did the user choose?* → `custom-almSettings`, backed by the app's own
   preference store (D3). A deliberate choice outranks everything.
2. *If not, what do they probably read?* → `preferredLanguage` reads the OS/
   webview language. A Brazilian user launching for the first time gets
   Portuguese before touching anything, which is the point of SC-001.
3. *Otherwise* → `baseLocale` (en-GB).

**Alternatives rejected**:

- `cookie` — the documented default, and meaningless in a Tauri desktop app.
  There is no server, no request, and no cookie lifecycle worth reasoning about.
- `url` — the app has routes, but locale is not a routing concern here. Putting
  it in the URL would make every deep link locale-stamped for no user benefit.
- `localStorage` (the built-in) — rejected as the *source of truth* because it
  diverges from how every other preference in this app persists (D3). It is
  still used internally by the custom strategy as a synchronous cache.

**Note**: dropping `baseLocale` from the chain is not an option — it is the
terminal fallback that satisfies FR-009 and SC-007.

---

## D2 — Applying a language change without a reload

**Decision**: call `setLocale(locale, { reload: false })` and re-render the
React tree from a locale value held in app state.

**Rationale**: this is the sharpest constraint the docs surfaced, and it
contradicts the default behaviour:

> "By default, this reloads the page on the client to reflect the new locale.
> Reloading can be disabled by passing `reload: false` as an option, but you'll
> need to ensure the UI updates to reflect the new locale."

A reload violates FR-004 outright. Worse, it violates it *invisibly in the
worst place*: the language chooser is the first step of the first-run wizard
(FR-005), so a reload there would discard wizard progress — the exact failure
the spec's edge-case list calls out. Taking the default would look correct in
a trivial test and destroy real user state.

The cost of `reload: false` is that Paraglide no longer refreshes the UI for
us. Because messages compile to plain function calls (`m.common_save()`),
nothing re-runs them on its own. So the locale must live in React state, with
the provider re-rendering its subtree on change — the same shape the theme and
density controls already use for live-apply.

**Alternatives rejected**:

- Default reload — fails FR-004, destroys wizard progress.
- Forcing remount via a `key` on the app root — works, but throws away all
  component state app-wide, which is a reload wearing a costume.

---

## D3 — Where the choice is stored

**Decision**: the settings database is the durable record; `localStorage` is a
synchronous startup cache. The custom strategy reads the cache synchronously
and writes both on change.

**Rationale**: the docs impose a hard shape on this:

> "Client-side strategies should have synchronous `getLocale` methods, while
> `setLocale` can be asynchronous."

The app's preference store is SQLite behind async IPC, so it *cannot* answer a
synchronous `getLocale` at startup. But storing locale only in `localStorage`
would contradict the direction this codebase already went: theme persistence
moved from localStorage to the settings DB (J10, `theme-settings-db`,
2026-07-09), precisely so preferences survive as real application state.

The split honours both:

| | source | timing |
|---|---|---|
| `getLocale()` | `localStorage` mirror | synchronous, available pre-IPC |
| `setLocale()` | settings DB **and** mirror | async; DB is durable record |
| startup hydrate | settings DB | async; corrects mirror if they disagree |

If the two disagree — DB restored from backup, mirror cleared by a webview
reset — the DB wins and the mirror is corrected. Note that Windows E2E shards
share one localStorage, so tests must not assume mirror isolation.

**Alternatives rejected**:

- Settings DB only — cannot satisfy synchronous `getLocale`; the app would
  flash base locale before hydrating.
- `localStorage` only — simplest, and rejected deliberately: it re-introduces
  the pattern J10 already migrated away from, and splits preference storage
  across two mechanisms with no principle distinguishing them.

---

## D4 — Per-language grammatical divergence (FR-010, FR-011)

**Decision**: ICU MessageFormat variants declared per locale. A locale may
define `match`/`select` arms the base locale does not have. No call-site
changes, no base-locale changes.

**Rationale**: the catalog already uses this form for 50 keys, so the mechanism
is proven here rather than speculative. It lets Portuguese make distinctions
English does not:

```jsonc
// en.json — one form suffices
"settings_auditlog_date_to": "To"

// pt-BR.json — Portuguese needs two
"settings_auditlog_date_to": { "match": { "context=field": "Até",
                                          "context=range": "a" } }
```

**Explicitly rejected — matching on rendered English text.** This is what
FR-011 prohibits. It fails three ways: it breaks whenever a locale merges or
splits a term; it hardcodes English as the pivot language, so adding a third
locale means editing logic rather than adding a file; and it is invisible to
the `alm/no-user-string` lint gate, which inspects source literals and cannot
see a runtime comparison against a rendered string. It would silently reopen
the exact defect class spec 046 exists to close.

**Consequence for the 30 plain-string `{count}` keys**: each needs a plural
form in pt-BR. Portuguese shares English's one/other structure, so the shapes
map directly, but the singular is not free — `'{count} items'` needs
`'{count} item'` / `'{count} itens'`.

---

## D5 — Missing-translation fallback (FR-009, SC-004)

**Decision**: rely on Paraglide's compile-time fallback to `baseLocale`, and
gate catalogue completeness in CI rather than at runtime.

**Rationale**: because Paraglide compiles messages, a key absent from pt-BR
resolves to the en-GB function at build time. A raw key can therefore never
reach the screen — the failure mode is an untranslated English string, which is
degraded but usable, exactly what FR-009 asks for.

The real risk is silent drift: pt-BR falling behind as keys are added, with
nobody noticing. That is a CI concern, not a runtime one — a check comparing
key sets per locale and reporting the gap. Note this must **report**, not fail:
FR-013 accepts partial translation as a shipping state, so a hard failure would
block legitimate work.

---

## D6 — Language chooser presentation (FR-007)

**Decision**: flag **and** native name together — `🇬🇧 English (UK)`,
`🇧🇷 Português (Brasil)`. Native name is mandatory; flag is decoration.

**Rationale**: flags denote countries, languages do not map onto them, and the
mismatch is not academic — Portuguese is spoken in Portugal, Brazil, Angola and
Mozambique, and English has no non-arbitrary flag at all. The user asked for
flags and they make the chooser scannable, so this keeps them; it just refuses
to let a flag be the *only* identifier.

The native name in particular is what makes the control usable by the person
who needs it most: someone looking at an interface they cannot read must still
recognise their own language. "Português (Brasil)" works for that user;
"Portuguese (Brazil)" rendered in English does not.

Accessible naming derives from the native name, not the flag emoji — a screen
reader announcing "flag of Brazil" is noise.

---

## D7 — Translation provenance (FR-013)

**Decision**: record review status as catalog metadata, and label pt-BR as
machine-generated pending native review in user-facing release notes.

**Rationale**: FR-013 exists because unreviewed machine translation is
genuinely useful and genuinely risky, and the risk is only manageable if the
status is *known*. Shipping unlabelled machine translation is the failure mode:
it silently becomes assumed-reviewed once nobody remembers who wrote it.

---

## D8 — The settings key must be registered, or the write vanishes

**Decision**: add a `locale` descriptor to the settings key table
(`crates/app/settings/src/keys.rs`) as part of this feature. No schema
migration is required.

**Rationale**: settings are stored as scoped key/value rows, so no new column
and no migration are needed — the existing `general` scope takes a `locale`
entry alongside `theme` and `fontSize`.

But the write path filters keys against an allowlist, and **silently drops
anything unrecognised**:

```rust
// apps/desktop/src-tauri/src/commands/settings.rs
if !app_core::settings::is_valid_key(&key) {
    tracing::debug!("settings.update: skipping unknown key {key}");
    continue;              // ← no error returned to the caller
}
```

`is_valid_key` resolves through a descriptor table plus a few structured-path
predicates. An unregistered `locale` key therefore produces a *successful*
`settings_update` call that persists nothing, logged only at `debug`.

This is the highest-risk item in the feature, because of how it fails: the
language switches correctly, the UI re-renders, every visible assertion
passes — and the choice is silently gone after restart. It would sail through
a UI-level test and fail only SC-002. The frontend cannot detect it either,
since the command returns `Ok`.

**Consequence**: the descriptor registration is a prerequisite task, not a
follow-up, and it needs a backend test asserting round-trip persistence of the
`locale` key specifically — not merely that the command returned success.

**Validated pattern**: theme already does exactly what D3 proposes —
settings DB (`general` scope, spec 018) as durable truth, localStorage as
synchronous mirror, best-effort write-through that never blocks the UI
(`apps/desktop/src/data/theme.ts`). Language follows it rather than inventing
a parallel mechanism.

---

## Open questions for Phase 1

- Does the first-run wizard render before the settings store is initialised? If
  so the wizard's language step writes to the mirror first and reconciles to the
  DB when the store comes up. (Affects task ordering only, not the design.)
