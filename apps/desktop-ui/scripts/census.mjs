#!/usr/bin/env node
// Rendered census runner for the final desktop UI. The browser snippet stays
// page-evaluable so the same measurement can be used against fixture and app routes.
import { chromium } from "@playwright/test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const census = readFileSync(path.join(root, "scripts/census.browser.js"), "utf8")
const appOrigin = process.env.PV_CENSUS_URL ?? "http://127.0.0.1:5180"
const routes = process.env.PV_CENSUS_ROUTES?.split(",").filter(Boolean) ?? ["/"]
const fixtureOnly = process.env.PV_CENSUS_FIXTURE_ONLY === "1"
const runs = [
  { name: "1440px", width: 1440, zoom: 1 },
  { name: "1280px", width: 1280, zoom: 1 },
  { name: "1280px at 125% zoom", width: 1280, zoom: 1.25 },
]

const browser = await chromium.launch({ headless: true })
try {
  const results = []
  if (!fixtureOnly) {
    for (const run of runs) {
      const context = await browser.newContext({ viewport: { width: run.width, height: 900 }, deviceScaleFactor: 1 })
      const page = await context.newPage()
      const errors = []
      if (run.zoom > 1) await page.setViewportSize({ width: Math.round(run.width / run.zoom), height: 900 })
      for (const route of routes) {
        await page.goto(`${appOrigin}/#${route}`, { waitUntil: "networkidle" })
        await page.waitForSelector("#main", { timeout: Number(process.env.PV_CENSUS_WAIT_MS ?? 5000) })
        const result = await page.evaluate((script) => {
          const errors = []
          window.__censusPageErrors = errors
          window.addEventListener("error", (event) => errors.push(event.message))
          window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)))
          const element = document.createElement("script")
          element.textContent = script
          document.documentElement.append(element)
          return window.__censusResult ?? null
        }, census)
        results.push({ viewport: run.name, route, result, pageErrors: [...errors] })
      }
      await context.close()
    }
  }

  // The bootstrap is intentionally only a shell. Always provide a reproducible
  // fixture route so the measurement is executable before app routes exist.
  if (fixtureOnly) {
    const fixtureContext = await browser.newContext({ viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1 })
    const fixture = await fixtureContext.newPage()
    // A 1280px physical viewport at 125% browser zoom has 1024 CSS pixels.
    await fixture.goto(`${appOrigin}/scripts/census-fixture.html`, { waitUntil: "networkidle" })
    await fixture.waitForSelector("#main")
    const fixtureResult = await fixture.evaluate((script) => {
      const errors = []
      window.__censusPageErrors = errors
      window.addEventListener("error", (event) => errors.push(event.message))
      window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)))
      const element = document.createElement("script")
      element.textContent = script
      document.documentElement.append(element)
      return window.__censusResult ?? null
    }, census)
    results.push({ viewport: "1280px at 125% zoom (1024 CSS px)", route: "/fixture", result: fixtureResult, pageErrors: fixtureResult?.pageErrors ?? [] })
    await fixtureContext.close()
  }

  console.log(JSON.stringify(results, null, 2))
  if (results.some(({ result, pageErrors }) => !result || result.error || pageErrors.length)) process.exitCode = 1
} finally {
  await browser.close()
}
