# App-Wide Page Layout Convention

## Problem

The app shell (`Shell.tsx`) renders every route page inside a bounded flex
column: `<main class="alm-frame__main">` (display:flex; flex-direction:column;
flex:1; min-height:0). Pages that grow with their content instead of filling
this bounded area cause toolbars or action bars to scroll out of view or get
clipped at the minimum window size (1100x720).

## Primitives

Three CSS classes enforce the convention (defined in `styles/components.css`):

| Class | Purpose |
|---|---|
| `.alm-page` | Page root. `display:flex; flex-direction:column; flex:1; min-height:0; height:100%`. Fills the bounded `.alm-frame__main` content area. |
| `.alm-page__bar` | Pinned header / toolbar / action-bar region. `flex-shrink:0`. Never scrolls. |
| `.alm-page__scroll` | The scrolling region. `flex:1; min-height:0; overflow-y:auto`. Holds the page's main content. |

## Rules

1. Every route page component uses `.alm-page` as its root.
2. All toolbars, page headers, search bars, and bottom action bars are wrapped
   in `.alm-page__bar` so they stay visible at all window sizes.
3. Exactly one `.alm-page__scroll` per scroll region holds the scrolling
   content. Do not put `overflow-y:auto` on the page root itself.
4. Two/three-pane pages: each pane that scrolls is itself a bounded flex column
   with its own scroll region. Pane headers and footers are pinned with
   `flex-shrink:0`.

## How the convention is applied

`PageShell` (used by every route page) emits `.alm-page`.

`ListDetailLayout` (used by every list+detail page) wraps its `topBar` slot in
`.alm-page__bar`, then renders the pane container (`alm-two-pane` or
`alm-three-pane`) which already carries `flex:1; min-height:0; overflow:hidden`
in CSS. Each pane's detail/content column has its own `overflow-y:auto`.

`WizardShell` (used by setup and project wizards) manages its own bounded flex
column with an inline pinned footer/nav rail and a `flex:1; overflow:auto`
content region.

## Minimal example

```tsx
// A page with a pinned toolbar and scrolling content list.
function MyPage() {
  return (
    <div className="alm-page">
      <div className="alm-page__bar">
        <div className="alm-action-bar">
          <span className="alm-action-bar__title">My Page</span>
        </div>
      </div>
      <div className="alm-page__scroll">
        {items.map(item => <Row key={item.id} item={item} />)}
      </div>
    </div>
  );
}
```

For the standard list+detail pattern use `PageShell` + `ListDetailLayout` +
`TopActionBar` — the convention is applied automatically.

## Verification

At 1100x720: open any route page, scroll the content list, and confirm that the
top action bar and any bottom bar remain visible throughout.
