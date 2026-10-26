#!/usr/bin/env node
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const snippet = readFileSync(path.join(root, "scripts/census.browser.js"), "utf8")
const baseline = JSON.parse(readFileSync(path.join(root, "scripts/census-budget-baseline.json"), "utf8"))
const routes = process.env.PV_CENSUS_ROUTES?.split(",").filter(Boolean) ?? baseline.routes.map(({ route }) => route)
const fixtureOnly = process.env.PV_CENSUS_FIXTURE_ONLY === "1"
const appOrigin = process.env.PV_CENSUS_URL ?? "http://127.0.0.1:5180"
const viewports = baseline.viewports
const budgets = new Map(baseline.routes.map(({ route, budgets }) => [route, budgets]))

export function checkBudget(result, budget, errors = []) {
  const violations = []
  if (!result) return ["missing census result"]
  for (const metric of baseline.metrics) {
    const actual = result[metric]
    const limit = budget?.[metric]
    if (typeof actual !== "number") violations.push(`${metric} is missing or not numeric`)
    else if (typeof limit !== "number") violations.push(`${metric} has no numeric budget`)
    else if (actual > limit) violations.push(`${metric}=${actual} exceeds ${limit}`)
  }
  const pageErrors = errors.length + (result.pageErrors?.length ?? 0)
  const errorBudget = budget?.pageErrors
  if (typeof errorBudget !== "number") violations.push("pageErrors has no numeric budget")
  else if (pageErrors > errorBudget) violations.push(`pageErrors=${pageErrors} exceeds ${errorBudget}`)
  return violations
}

function injectCensus(page) {
  return page.evaluate((source) => {
    const script = document.createElement("script")
    script.textContent = source
    document.documentElement.append(script)
    return window.__censusResult ?? null
  }, snippet)
}

async function measure(page, route, label, budget) {
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  if (route === "/fixture" && process.env.PV_CENSUS_FIXTURE_THROW === "1") {
    await page.addInitScript(() => { throw new Error("intentional census fixture error") })
  }
  const url = route === "/fixture"
    ? `${appOrigin}/scripts/census-fixture.html`
    : `${appOrigin}/#${route}`
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForSelector("#main", { timeout: Number(process.env.PV_CENSUS_WAIT_MS ?? 5000) })
  const result = await injectCensus(page)
  const violations = checkBudget(result, budget, errors)
  console.log(JSON.stringify({ viewport: label, route, result, errors, violations }))
  return violations
}

async function runCensus() {
  const browser = await chromium.launch({ headless: true })
  const failures = []
  try {
    const selectedRoutes = fixtureOnly ? ["/fixture"] : routes
    for (const route of selectedRoutes) {
      const routeBudgets = budgets.get(route)
      if (!routeBudgets) {
        failures.push(`${route}: no route budgets in census-budget-baseline.json`)
        continue
      }
      for (const viewport of viewports) {
        const budget = routeBudgets[viewport.name]
        if (!budget) {
          failures.push(`${route} at ${viewport.name}: no viewport budget`)
          continue
        }
        const context = await browser.newContext({
          viewport: { width: Math.round(viewport.width / viewport.zoom), height: Math.round(viewport.height / viewport.zoom) },
          deviceScaleFactor: viewport.zoom,
        })
        try {
          const page = await context.newPage()
          failures.push(...(await measure(page, route, viewport.name, budget)).map((failure) => `${route} at ${viewport.name}: ${failure}`))
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
  if (failures.length) {
    console.error(`Rendered census failed (${failures.length}):\n${failures.map((failure) => `  ${failure}`).join("\n")}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCensus()
