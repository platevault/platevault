# ADR-0002: Lock and InfoTip stay separate components

**Status**: Accepted
**Date**: 2026-07-20
**Deciders**: Product owner (Sjors Robroek)
**Governs**: `apps/desktop/src/ui/Lock.tsx`, `apps/desktop/src/ui/InfoTip.tsx`, `apps/desktop/src/ui/Tooltip.tsx`
**Related**: [#1155](https://github.com/platevault/platevault/issues/1155) — raised in the UX/UI review of the design-system refresh (`handoff/06` in the Claude Design project)

## Context

Three components sit in the tooltip area of the design system:

| Component | Role | Consumers |
| --- | --- | --- |
| `Tooltip` | Token-styled wrapper over the base-ui tooltip. Renders its trigger as a bare `<span>` and passes `className` plus extra span attributes through. | `Lock`, `InfoTip`, `PropertyTable` |
| `Lock` | Padlock glyph marking a row or category as protected. | `OutputsCleanupSections` |
| `InfoTip` | ⓘ glyph supplying help text for a form or settings row. | `StepSourceFolders`, `SettingsKit` |

The design-system refresh proposed merging `Lock` and `InfoTip` into one tooltip
component. The proposal is one line; the Components page carries no tooltip
section, so the merged component has no visual, interaction, or role
specification.

`Tooltip` adds no `tabIndex` and no role of its own. Every accessibility
property of `Lock` and `InfoTip` is therefore supplied by the caller, and the
two callers supply different ones.

## Decision

Keep `Lock` and `InfoTip` as separate components. Reject the merge.

The shared behaviour already lives in `Tooltip`; the merge would consolidate the
two callers' differing accessibility contracts, not their markup.

### Accessibility contracts

Both components render a focusable `role="note"` span whose `aria-label` carries
the text, so the text reaches assistive technology without opening the popup.
Neither uses `aria-describedby`. That shared base is where the similarity ends.

| Property | `Lock` | `InfoTip` |
| --- | --- | --- |
| What the text conveys | Why a thing is protected | Supplemental help for a control |
| Accessible name | The reason verbatim, or "Protected" when no reason is given | `"<label>: <tip>"`, label defaulting to "More information" |
| Text redundant with nearby prose | Sometimes — a "Protected" pill often states the state in text | Never — the help text appears nowhere else on screen |
| Decorative mode | Yes: `aria-hidden="true"`, no role, no tab stop | None, and none is correct |
| Tip type | `string \| undefined` | `string` |

`Lock`'s decorative mode is the substantive difference. It exists because the
cleanup table repeats one static sentence on every protected row, and giving
each row a tab stop would queue N identical announcements. It is correct only
where the reason is already in nearby text *and* identical for every instance.

`InfoTip` has no such case. Its text is the sole carrier of the information, so
a decorative mode would always drop content.

### Why the popup cannot carry the text

base-ui portals the popup and mounts it only while open, and the closed trigger
carries no `aria-describedby`. The accessible name is the only route from
trigger to text for a screen reader user who has not opened the popup.

Two consequences follow, both asserted in `Lock.test.tsx` and `InfoTip.test.tsx`:

- The name must duplicate the tip text. `InfoTip.tip` is typed `string` rather
  than `ReactNode` because a node-valued tip cannot be mirrored into
  `aria-label` and would leave the name as the bare "More information" prefix.
- `role="note"` is load-bearing. `aria-label` on a role-less `<span>` is not
  reliably exposed, so removing the role removes the name.

### Consequences

- Two components and two test files cover what one component would.
- A merged component would need a decorative mode reachable by every caller.
  A caller reaching for it on help text silently drops that text from assistive
  technology, with no visual symptom — the failure mode this decision avoids.
- `Tooltip` remains the single shared implementation. Neither component
  duplicates the other's CSS: `Lock` styles nothing, `InfoTip` owns
  `.pv-info-tip`, and popup styling is `.pv-tooltip`.
- Reversing this needs a new ADR and a Components-page tooltip section
  specifying the merged role, focus behaviour, and decorative-mode rule.

## Alternatives considered

- **Merge into one tooltip component, as the refresh proposed.** Rejected: the
  merge consolidates two different accessibility contracts behind one prop
  surface, and no specification exists for the result.
- **Merge and drop the decorative mode.** Rejected: the cleanup table would gain
  a tab stop per protected row, each announcing the same sentence.
- **Merge and expose the decorative mode as a prop.** Rejected: this is the
  merge with the failure mode intact, since the prop is then available to help
  text callers.
- **Fold both into `Tooltip` directly.** Rejected: `PropertyTable` uses
  `Tooltip` for a third pattern, so `Tooltip` would carry three contracts.
