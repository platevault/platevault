#!/usr/bin/env node
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const snippet = readFileSync(path.join(root, "scripts/census.browser.js"), "utf8")
const baseline = JSON.parse(readFileSync(path.join(root, "scripts/census-budget-baseline.json"), "utf8"))
const routes = process.env.PV_CENSUS_ROUTES?.split(",").filter(Boolean) ?? ["/"]
const fixtureOnly = process.env.PV_CENSUS_FIXTURE_ONLY === "1"
const appOrigin = process.env.PV_CENSUS_URL ?? "http://127.0.0.1:5180"
const viewports = baseline.viewports

export function checkBudget(result, rules, errors = []) {
  if (!result) return ["missing census result"]
  const violations = []
  for (const metric of ["raw", "pill", "handRolled", "overflowX"]) {
    if (result[metric] !== rules[metric]) violations.push(`${metric}=${result[metric]} expected ${rules[metric]}`)
  }
  if (rules.ttlEqualsTruncation && result.ttl !== result.ttlTruncation) {
    violations.push(`ttl=${result.ttl} does not equal ttlTruncation=${result.ttlTruncation}`)
  }
  if (result.tip > (rules.tipMaximum ?? 1) && !(rules.tipApprovals ?? []).includes(result.route)) {
    violations.push(`tip=${result.tip} exceeds ${rules.tipMaximum ?? 1} without approval`)
  }
  if (result.combos > rules.combosMaximum) violations.push(`combos=${result.combos} exceeds ${rules.combosMaximum}`)
  const dataHeaders = result.dataHeaders ?? result.headers
  if (result.sort !== dataHeaders) violations.push(`sort=${result.sort} does not equal dataHeaders=${dataHeaders}`)
  if (errors.length !== rules.pageErrors) violations.push(`pageErrors=${errors.length} expected ${rules.pageErrors}`)
  return violations
}

function routeMatches(route, pattern) {
  if (pattern === "*") return true
  const regex = new RegExp(`^${pattern.split("*").map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")).join(".*")}$`)
  return regex.test(route)
}

function ruleForRoute(route) {
  return baseline.routes.find((entry) => routeMatches(route, entry.routePattern))?.rules
}

function injectCensus(page) {
  return page.evaluate((source) => {
    const script = document.createElement("script")
    script.textContent = source
    document.documentElement.append(script)
    return window.__censusResult ?? null
  }, snippet)
}

async function measure(page, route, label, rules) {
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
  if (route === "/fixture" && process.env.PV_CENSUS_FIXTURE_THROW === "1") {
    await page.addInitScript(() => { throw new Error("intentional census fixture error") })
  }
  const url = route === "/fixture" ? `${appOrigin}/scripts/census-fixture.html` : `${appOrigin}/#${route}`
  await page.goto(url, { waitUntil: "networkidle" })
  await page.waitForSelector("#main", { timeout: Number(process.env.PV_CENSUS_WAIT_MS ?? 5000) })
  const result = await injectCensus(page)
  const violations = checkBudget(result, rules, errors)
  console.log(JSON.stringify({ viewport: label, route, result, errors, violations }))
  return { result, violations }
}

async function runCensus() {
  const browser = await chromium.launch({ headless: true })
  const failures = []
  try {
    const selectedRoutes = fixtureOnly ? ["/fixture"] : routes
    for (const route of selectedRoutes) {
      const rules = ruleForRoute(route)
      if (!rules) {
        failures.push(`${route}: no route-pattern census rules`)
        continue
      }
      for (const viewport of viewports) {
        const context = await browser.newContext({
          viewport: { width: Math.round(viewport.width / viewport.zoom), height: Math.round(viewport.height / viewport.zoom) },
          deviceScaleFactor: viewport.zoom,
        })
        try {
          const page = await context.newPage()
          const { violations } = await measure(page, route, viewport.name, ruleForRoute(route))
          failures.push(...violations.map((failure) => `${route} at ${viewport.name}: ${failure}`))
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
