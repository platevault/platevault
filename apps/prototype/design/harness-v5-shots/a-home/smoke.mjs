// Slice A verification: demo seed; Home, Sessions, a session and the Import sheet at
// 1440x900, 1280x800 and 1024x768; then each key interaction once at 1280x800.
import puppeteer from "/Users/sjors/.local/share/omp-plugins/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = "http://127.0.0.1:5511/"
const SHOTS = "/Users/sjors/tmp/worktrees/platevault/ui-v5-a-home/apps/prototype/design/harness-v5-shots/a-home"
mkdirSync(SHOTS, { recursive: true })
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  userDataDir: mkdtempSync(join(tmpdir(), "pv-v5-a-")),
  args: ["--no-first-run", "--no-default-browser-check"],
})
const page = await browser.newPage()
const errors = []
page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
page.on("pageerror", (e) => errors.push(String(e)))
page.on("response", (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log(...a)
const norm = (s) => s.replace(/\s+/g, " ").trim()

/** Click the last visible element matching `selector` whose text starts with `text`. */
const clickText = (text, selector = "button, a, [role=menuitem], [role=option], [role=tab], label") =>
  page.evaluate(
    (text, selector) => {
      const els = [...document.querySelectorAll(selector)].filter((e) => e.offsetParent !== null && e.innerText.replace(/\s+/g, " ").trim().startsWith(text))
      const el = els.pop()
      el?.click()
      return Boolean(el)
    },
    text,
    selector,
  )
const must = async (label, ok) => {
  log(ok ? "  ok " : "  FAIL", label)
  if (!ok) failures.push(label)
}
const failures = []
const text = (sel) => page.evaluate((sel) => document.querySelector(sel)?.innerText ?? "", sel)
const docScroll = () => page.evaluate(() => `${document.scrollingElement.scrollHeight}/${document.scrollingElement.clientHeight}`)
const go = async (route) => {
  await page.goto(BASE + "#" + route, { waitUntil: "networkidle0" })
  await sleep(450)
}

// Demo seed, as the Prototype panel loads it.
await page.setViewport({ width: 1280, height: 800 })
await page.goto(BASE + "#/welcome", { waitUntil: "networkidle0" })
await page.evaluate(() => localStorage.clear())
await page.goto(BASE + "#/welcome", { waitUntil: "networkidle0" })
await clickText("Prototype", "button")
await sleep(400)
await clickText("Load demo library", "button")
await sleep(400)
await clickText("Load demo library", "button")
await sleep(800)
await page.keyboard.press("Escape")
await sleep(300)

await go("/sessions")
const sessionId = await page.evaluate(() => document.querySelector("main a[href*='#/sessions/']")?.getAttribute("href")?.split("/sessions/")[1])

// Width pass ----------------------------------------------------------------
const widths = []
for (const [w, h] of [[1440, 900], [1280, 800], [1024, 768]]) {
  await page.setViewport({ width: w, height: h })
  for (const [name, route] of [["home", "/"], ["sessions", "/sessions"], ["session", `/sessions/${sessionId}`], ["import", "/import"]]) {
    await go(route)
    const doc = await docScroll()
    const sideways = await page.evaluate(() => [...document.querySelectorAll("main table, [data-import-sheet] table")].filter((t) => t.parentElement.scrollWidth > t.parentElement.clientWidth + 1).map((t) => `${t.querySelector("caption")?.innerText}:${t.parentElement.scrollWidth}/${t.parentElement.clientWidth}`).join(",") || 0)
    widths.push({ w, name, doc, sideways })
    await page.screenshot({ path: `${SHOTS}/${w}-${name}.png` })
    await page.keyboard.press("Escape")
  }
}
log("widths", JSON.stringify(widths))
for (const r of widths) await must(`${r.w} ${r.name} doc ${r.doc} sideways tables ${r.sideways}`, r.doc.split("/")[0] === r.doc.split("/")[1] && (r.name !== "home" || r.sideways === 0))

// Interactions at 1280 ------------------------------------------------------
await page.setViewport({ width: 1280, height: 800 })
log("HOME")
await go("/")
const top0 = norm(await text("[data-home-top-line]"))
log("  top line:", top0)
await clickText("2 sessions need a Target", "a")
await sleep(400)
await must("top-line count opens Sessions filtered", (await page.evaluate(() => location.hash)).includes("filter=needs-target"))
log("  sessions filter rows:", await page.evaluate(() => document.querySelectorAll("main tbody tr").length))

await go("/")
await page.evaluate(() => document.querySelector("#home-projects-title")?.closest("section")?.querySelector("[role=switch]")?.click())
await sleep(300)
const doneRow = norm(await text("#home-projects-title"))
const projectsText = norm(await page.evaluate(() => document.querySelector("#home-projects-title").closest("section").innerText))
await must("Show done reveals M 31 with its Done / Archive Next", projectsText.includes("M 31") && projectsText.includes("Open Done / Archive"))
void doneRow
await page.screenshot({ path: `${SHOTS}/1280-home-show-done.png` })
const blockedText = norm(await page.evaluate(() => document.querySelector("[data-gate=blocked]")?.innerText ?? ""))
log("  blocked:", blockedText)
await page.evaluate(() => document.querySelector("[data-gate=blocked]")?.click())
await sleep(500)
await must("Blocked: <reason> opens that run's step", /runs\/[^/]+\/(calibrate|prepare|select|results)/.test(await page.evaluate(() => location.hash)))
log("  ->", await page.evaluate(() => location.hash))

await go("/")
const nextLabels = await page.evaluate(() => [...document.querySelectorAll("[data-next]")].map((b) => b.innerText.replace(/\s+/g, " ").trim()))
log("  next:", JSON.stringify(nextLabels))
await page.evaluate(() => document.querySelector("[data-next=prj_cygnus]")?.click())
await sleep(500)
await must("Cygnus Next opens Review filtered to Unreviewed", (await page.evaluate(() => location.hash)).includes("/review"))

await go("/")
await clickText("Confirm NGC 7000", "button")
await sleep(400)
const top1 = norm(await text("[data-home-top-line]"))
await must(`Confirm Target one-click updates the top line (${top1})`, top1 !== top0)

// Add to Project from Home: M 33 into Heart and Soul adds the FRA400 rig, with a note.
await page.evaluate(() => {
  const row = [...document.querySelectorAll("#home-new-sessions-title ~ * li, section li")].find((li) => li.innerText.includes("30 Aug") && li.innerText.includes("Add to Project"))
  ;[...row.querySelectorAll("button")].find((b) => b.innerText.includes("Add to Project")).click()
})
await sleep(400)
const menu = norm(await page.evaluate(() => document.querySelector("[role=menu]")?.innerText ?? ""))
log("  menu:", menu)
await clickText("Heart and Soul", "[role=menuitem]")
await sleep(400)
const preview = norm(await page.evaluate(() => document.querySelector("[role=alertdialog]")?.innerText ?? ""))
log("  preview:", preview)
await must("Add to Project previews the added rig", preview.includes("Also adds the rig"))
await page.screenshot({ path: `${SHOTS}/1280-home-add-to-project-preview.png` })
await clickText("Add to Heart and Soul", "[role=alertdialog] button")
await sleep(500)
const note = norm(await page.evaluate(() => document.querySelector("#home-new-sessions-title").closest("section").querySelector("[role=status]")?.innerText ?? ""))
log("  note:", note)
await must("Add to Project shows the visible rig note", note.includes("Also adds the rig"))

await go("/")
await go("/")
const reviewClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((b) => /^Review \d+ frames?$/.test(b.innerText.trim()) && !b.hasAttribute("data-next"))
  b?.click()
  return Boolean(b)
})
await sleep(500)
await must("Unreviewed one-click opens a review", reviewClicked && /review|candidates=unreviewed/.test(await page.evaluate(() => location.hash)))

await go("/")
const joined = await page.evaluate(() => {
  const b = [...document.querySelectorAll("button")].find((b) => b.innerText.trim().startsWith("Add to NGC") || b.innerText.trim().startsWith("Add to IC"))
  b?.click()
  return b?.innerText ?? null
})
await sleep(600)
await must(`Ready-to-add one-click (${joined}) opens Select with the draft`, Boolean(joined) && (await page.evaluate(() => location.hash)).includes("/select"))

// Sessions ------------------------------------------------------------------
log("SESSIONS")
await go("/sessions")
const counts = await page.evaluate(() => [...document.querySelectorAll("[data-filter]")].map((b) => b.innerText.replace(/\s+/g, " ").trim()))
log("  filters:", JSON.stringify(counts))
await page.evaluate(() => document.querySelector("[data-filter=trashed]")?.click())
await sleep(400)
await must("Trashed filter lists the Trashed session", (await page.evaluate(() => document.querySelectorAll("main tbody tr").length)) >= 1 && (await page.evaluate(() => location.hash)).includes("filter=trashed"))
await page.screenshot({ path: `${SHOTS}/1280-sessions-trashed.png` })
await page.evaluate(() => document.querySelector("[data-filter=not-in-project]")?.click())
await sleep(400)
await page.screenshot({ path: `${SHOTS}/1280-sessions-not-in-project.png` })
const npRows = await page.evaluate(() => [...document.querySelectorAll("main tbody tr")].map((r) => r.innerText.replace(/\s+/g, " ").slice(0, 80)))
log("  not in project:", JSON.stringify(npRows))

// Session detail: Create Project opens the prefilled New Project sheet.
await go(`/sessions/${sessionId}`)
await page.screenshot({ path: `${SHOTS}/1280-session-detail.png` })
await clickText("Create Project", "main button")
await sleep(500)
const sheet = await page.evaluate(() => Boolean(document.querySelector("[data-placeholder-sheet=S4], [data-slot=sheet-content]")))
await must("Create Project opens the New Project sheet", sheet)
await page.keyboard.press("Escape")
await sleep(300)

// Import --------------------------------------------------------------------
log("IMPORT")
await go("/")
await clickText("Import", "header button")
await sleep(500)
await must("toolbar Import opens the sheet", Boolean(await page.$("[data-import-sheet]")))
await page.evaluate(() => document.querySelector("[data-insert-card]")?.click())
await sleep(500)
const previewText = norm(await text("[data-import-preview]"))
log("  preview:", previewText.slice(0, 1600))
await must("preview has Captures and Calibration destinations", previewText.includes("Lights") && previewText.includes("Calibration"))
await must("holds: Unclassified and still being written", previewText.includes("Unclassified") && previewText.includes("Still being written"))
await must("duplicates skipped by SHA-256", previewText.includes("duplicate") && previewText.includes("SHA-256"))
await must("writability and free space shown", previewText.includes("Writable") && previewText.includes("free on"))
await page.screenshot({ path: `${SHOTS}/1280-import-preview.png` })
const before = norm(await text("[data-import-start]"))
await page.evaluate(() => document.querySelector("[data-type-as]")?.click())
await sleep(300)
await clickText("Light", "[role=option]")
await sleep(400)
const afterType = norm(await text("[data-import-start]"))
await must(`typing Unclassified releases it (${before} -> ${afterType})`, before !== afterType && norm(await text("[data-import-held]")).includes("Typed as Light"))
await sleep(6500)
const afterSettle = norm(await text("[data-import-start]"))
await must(`settling file joins the preview (${afterSettle})`, afterSettle !== afterType && !norm(await text("[data-import-preview]")).includes("Still being written"))
await clickText("Move", "[data-import-preview] label")
await sleep(300)
await page.screenshot({ path: `${SHOTS}/1280-import-move.png` })
await page.evaluate(() => document.querySelector("[data-import-start]")?.click())
await sleep(400)
const confirm = norm(await page.evaluate(() => document.querySelector("[role=alertdialog]")?.innerText ?? ""))
log("  move confirm:", confirm)
await must("Move previews copy, verify, then OS Trash", confirm.includes("Verifies") && confirm.includes("OS Trash"))
await page.screenshot({ path: `${SHOTS}/1280-import-move-confirm.png` })
await clickText("Move ", "[role=alertdialog] button")
await sleep(700)
await page.screenshot({ path: `${SHOTS}/1280-import-running.png` })
for (let i = 0; i < 40; i += 1) {
  await sleep(300)
  const t = await text("[data-import-progress]")
  if (t.includes("Move import sources to the OS Trash") && /Now in the library/.test(t) && !/Running/.test(t)) break
}
await sleep(800)
const progress = norm(await text("[data-import-progress]"))
log("  progress:", progress.slice(0, 1400))
await must("import settles with sessions listed and the sources trashed", progress.includes("Now in the library") && progress.includes("moved to the OS Trash"))
await page.screenshot({ path: `${SHOTS}/1280-import-done.png` })
await page.evaluate(() => document.querySelector("[data-show-in-sessions]")?.click())
await sleep(600)
const hl = await page.evaluate(() => [...document.querySelectorAll("main tbody tr")].filter((r) => r.innerText.includes("Imported")).length)
await must(`imported lights appear in Sessions (${hl} highlighted)`, hl >= 3 && (await page.evaluate(() => location.hash)).includes("import="))
await page.screenshot({ path: `${SHOTS}/1280-sessions-imported.png` })

// Import new on the same card skips what this source already imported.
await clickText("Import", "header button")
await sleep(400)
await clickText("Import more", "button")
await sleep(400)
const again = norm(await text("[data-import-preview]"))
log("  again:", again.slice(0, 600))
await must("Import new: card is empty after Move (sources trashed)", again.includes("Nothing new") || !again.includes("Preview · 5"))
await page.keyboard.press("Escape")
await sleep(300)

// Add existing library folder: choose /Volumes/Astro-T7/Library and index in place.
await clickText("Import", "header button")
await sleep(400)
await clickText("Add existing library folder", "[role=tab]")
await sleep(300)
await clickText("Choose folder…", "[data-import-sheet] button")
await sleep(400)
const pick = async (name) => {
  const ok = await page.evaluate((name) => {
    const el = [...document.querySelectorAll("[role=dialog] button")].find((b) => b.innerText.replace(/\s+/g, " ").trim().startsWith(name))
    el?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    el?.click()
    return Boolean(el)
  }, name)
  await sleep(300)
  return ok
}
log("  picker:", norm(await page.evaluate(() => document.querySelectorAll("[role=dialog]")[1]?.innerText ?? "")).slice(0, 300))
await pick("Astro-T7")
await pick("Library")
log("  picker2:", norm(await page.evaluate(() => document.querySelectorAll("[role=dialog]")[1]?.innerText ?? "")).slice(0, 300))
await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].filter((b) => b.innerText.trim().startsWith("Add")).pop()?.click())
await sleep(400)
const folderTab = norm(await page.evaluate(() => document.querySelector("[data-import-sheet]")?.innerText ?? ""))
log("  folder tab:", folderTab.slice(0, 500))
await page.screenshot({ path: `${SHOTS}/1280-import-add-folder.png` })
await clickText("Add and index", "button")
await sleep(1500)
const indexed = norm(await page.evaluate(() => document.querySelector("[data-import-progress]")?.innerText ?? ""))
log("  index:", indexed.slice(0, 300))
await must("Add existing library folder indexes in place as an operation", indexed.includes("Index"))
await page.screenshot({ path: `${SHOTS}/1280-import-add-folder-indexing.png` })

// No-site Tonight state.
await page.keyboard.press("Escape")
await sleep(300)
await go("/")
await clickText("Prototype", "header button")
await sleep(500)
await page.evaluate(() => {
  const sw = [...document.querySelectorAll("[role=dialog] [role=switch]")].find((s) => s.parentElement.innerText.includes("No observing site"))
  sw?.click()
})
await sleep(300)
await page.keyboard.press("Escape")
await sleep(400)
await must("Tonight shows the no-site state", norm(await page.evaluate(() => document.querySelector("#home-tonight-title")?.closest("section")?.innerText ?? "")).includes("Add an observing site in Settings"))
const tonight = norm(await page.evaluate(() => document.querySelector("#home-tonight-title")?.closest("section")?.innerText ?? ""))
log("  tonight:", tonight)
await page.screenshot({ path: `${SHOTS}/1280-home-no-site.png` })

log("errors", JSON.stringify(errors))
log("failures", JSON.stringify(failures))
await browser.close()
