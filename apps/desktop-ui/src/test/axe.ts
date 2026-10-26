/**
 * The axe-core run every accessibility test shares: WCAG 2.x A and AA rules,
 * one line per failing node.
 *
 * Off here, with the reason: `color-contrast` needs the cascade and layout,
 * which jsdom does not compute from the Tailwind sheet, so it would pass or
 * fail on nothing (contrast is checked in the browser by ui-review).
 * Page-level best-practice rules (one main landmark, a level-one heading,
 * content inside landmarks) carry no WCAG tag, so they do not run.
 */
import axe from "axe-core"

const OPTIONS: axe.RunOptions = {
  runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  rules: { "color-contrast": { enabled: false } },
}

/** One line per failing node: the rule, axe's help text and the node's opening markup, so a failure names what to fix. */
export async function axeViolations(context: Element | Document = document.body): Promise<string[]> {
  const results = await axe.run(context, OPTIONS)
  return results.violations.flatMap((violation) => violation.nodes.map((node) => `${violation.id} (${violation.help}): ${node.html.slice(0, 240)}`))
}
