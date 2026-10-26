// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rendered census (design/R9-COMPOSITION-PLAN.md §4, §8.5): one row of
 * counts for the route on screen, over `#main` only. No dependency: evaluate
 * this file's text in the page of a Vite dev build, after the route has
 * rendered (the lead's browser tool: `tab.evaluate(text)`). The route list and
 * the saved rows are design/R10-CENSUS-BASELINE.json.
 *
 * It reads React's dev fibers for two facts the DOM does not carry: a Button's
 * `variant`/`size` props, and whether a <table> was rendered by DataTable.
 * The fibers are expandos on the page's own DOM objects, so evaluate it in the
 * page's main world: a tool that evaluates in an isolated world sees none of
 * them (every role reads "unknown"); inject it as a <script> there, e.g.
 * `page.addScriptTag({ content: \`document.documentElement.dataset.census = JSON.stringify(${text})\` })`,
 * and read the attribute back.
 *
 * Columns (budgets in §4 and §7.4):
 *   btn / combos   Button elements / distinct variant×size combinations
 *   dt / raw       DataTable tables / any other <table>
 *   sort / headers sortable header cells / header cells with text
 *   ttl            visible `title=` attributes (ttlTruncation: those on truncated text, the T2 exception)
 *   tip            glyph tips: HelpTip (helpTip) and NoteMarker (noteMarker)
 *   pill           pills rendered as a link or a button
 *   handRolled     <button>/[role=button] that is no Button, primitive part, pill, glyph tip or DataTable control
 *   menus          menu triggers (aria-haspopup=menu)
 *   overflowX      px the document scrolls sideways
 */
window.__censusResult = (() => {
  const main = document.querySelector("#main")
  if (!main) return { route: location.hash.slice(1) || "/", error: "no #main" }

  const visible = (el) => el.getClientRects().length > 0
  const text = (el) => (el.getAttribute("aria-label") || el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)
  const fiberOf = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"))
    return key ? el[key] : null
  }
  /** The nearest component above a DOM node with this name. */
  const componentAbove = (el, name) => {
    for (let fiber = fiberOf(el), depth = 0; fiber && depth < 40; fiber = fiber.return, depth += 1) {
      if (typeof fiber.type === "function" && fiber.type.name === name) return fiber
    }
    return null
  }
  /** The component whose render created this DOM node. */
  const ownerName = (el) => {
    const owner = fiberOf(el)?._debugOwner
    return typeof owner?.type === "function" ? owner.type.name : null
  }
  const role = (el) => {
    const props = componentAbove(el, "Button")?.memoizedProps
    return props ? `${props.variant ?? "default"}/${props.size ?? "default"}` : "unknown"
  }
  const tally = (values) => values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {})
  const classOf = (el) => (typeof el.className === "string" ? el.className : el.getAttribute("class") ?? "")

  const buttons = [...main.querySelectorAll("[data-slot=button]")].filter(visible)
  const combos = tally(buttons.map(role))
  const header = main.querySelector("header")
  const headerActions = header ? [...header.querySelectorAll("[data-slot=button]")].filter(visible).map((el) => `${text(el)} (${role(el)})`) : []

  const tables = [...main.querySelectorAll("table")].filter(visible)
  // DataTable renders its <table> through the ui/table parts, so the table's direct owner is `Table`: a table is a DataTable's when one sits above it.
  const dataTables = tables.filter((t) => componentAbove(t, "DataTable"))
  const rawTables = tables.filter((t) => !componentAbove(t, "DataTable"))
  const headerCells = [...main.querySelectorAll("thead th")].filter((th) => visible(th) && th.innerText.trim())
  const sortable = headerCells.filter((th) => th.hasAttribute("aria-sort") || th.querySelector("button:not([role=checkbox])"))

  const titled = [...main.querySelectorAll("[title]")].filter((el) => visible(el) && el.getAttribute("title").trim())
  const truncates = (el) => /(^|\s)(truncate|line-clamp-\d)(\s|$)/.test(classOf(el))

  const isTip = (el) => el.matches("button[aria-describedby]") && classOf(el).includes("before:absolute") && classOf(el).includes("rounded-full")
  const tips = [...main.querySelectorAll("button[aria-describedby]")].filter((el) => visible(el) && isTip(el))
  const isPill = (el) => el.hasAttribute("data-pill") || ["rounded-full", "ring-inset", "h-5"].every((c) => classOf(el).split(/\s+/).includes(c))
  const controls = [...main.querySelectorAll("a, button, [role=button], [role=link]")].filter(visible)
  const pills = controls.filter(isPill)
  const handRolled = [...main.querySelectorAll("button, [role=button]")].filter(
    (el) => visible(el) && !el.hasAttribute("data-slot") && !el.closest("[data-slot=button]") && !isTip(el) && !isPill(el) && ownerName(el) !== "DataTable",
  )
  const doc = document.documentElement

  return {
    route: location.hash.slice(1) || "/",
    h1: main.querySelector("h1")?.innerText.trim() ?? null,
    btn: buttons.length,
    combos: Object.keys(combos).length,
    combosByRole: combos,
    headerActions,
    dt: dataTables.length,
    raw: rawTables.length,
    rawBy: tally(rawTables.map((t) => ownerName(t) ?? "unknown")),
    sort: sortable.length,
    headers: headerCells.length,
    ttl: titled.length,
    ttlTruncation: titled.filter(truncates).length,
    tip: tips.length,
    helpTip: tips.filter((el) => el.querySelector("svg")).length,
    noteMarker: tips.filter((el) => !el.querySelector("svg")).length,
    pill: pills.length,
    handRolled: handRolled.length,
    handRolledBy: tally(handRolled.map((el) => ownerName(el) ?? "unknown")),
    menus: [...main.querySelectorAll("[aria-haspopup=menu]")].filter(visible).length,
    overflowX: Math.max(0, doc.scrollWidth - doc.clientWidth),
    pageErrors: window.__censusPageErrors ?? [],
  }
})()
