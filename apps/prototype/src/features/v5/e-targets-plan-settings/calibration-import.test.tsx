import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { masterPins } from "@/domain/calibration-library"
import { fakeSha256, fileAt, makeFile, writeFiles } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import type { DiskFile, MasterId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { ImportMastersDialog } from "./dialogs"

// Import masters (CAL-FR-13, CAL-AC-15, LIB-FR-26) through the dialog: several files chosen at once, a preview read from
// their headers with New, New version of and Duplicate, the camera chosen where two cameras share the model, and
// nothing imported before the user confirms.
const SEED_DAY = Date.parse("2026-10-13T12:00:00Z")
const DARK_300: MasterId = "mst_49epv6"
const INCOMING = "/Volumes/Astro-T7/Incoming"

let demo: PrototypeState
// The preview's DataTable measures its pinned column; jsdom has no ResizeObserver and lays nothing out.
const original = globalThis.ResizeObserver
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(SEED_DAY)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
afterAll(() => {
  vi.useRealTimers()
  globalThis.ResizeObserver = original
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const catalog = () => store.getState().catalog

/** `name` in the Incoming folder: `from`'s header with `patch`, and its own bytes unless `sameBytes`. */
function incoming(from: DiskFile, name: string, patch: Partial<NonNullable<DiskFile["header"]>>, sameBytes = false): DiskFile {
  const path = `${INCOMING}/${name}`
  const file = makeFile({ path, volumeId: from.volumeId, sizeBytes: from.sizeBytes, kind: from.kind, header: { ...from.header!, ...patch }, sha256: sameBytes ? from.sha256 : fakeSha256(path, 3), pixelTruth: from.pixelTruth, modifiedAt: "2026-10-12T09:00:00.000Z" })
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [file]), settings: { ...s.settings, lastProcessingParent: INCOMING } }))
  return file
}

function dark300(): DiskFile {
  const versions = [...catalog().masters[DARK_300]!.versions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  return fileAt(store.getState().disk, versions.at(-1)!.path)!
}

function renderDialog() {
  const router = createRouter({ routeTree: createRootRoute({ component: () => <ImportMastersDialog open onOpenChange={() => {}} /> }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

describe("Import masters: Files → Preview (CAL-AC-15)", () => {
  it("previews New, New version of and Duplicate, asks each file's camera, and imports only on confirm", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const base = dark300()
    const duplicate = incoming(base, "dark-300-copy.xisf", {}, true)
    const newer = incoming(base, "dark-300-oct.xisf", { dateObs: "2026-10-10T18:00:00.000Z" })
    const bias = incoming(base, "bias-0C.xisf", { imageType: "master-bias", exposureS: 0, ccdTempC: 0, dateObs: "2026-10-11T18:00:00.000Z" })
    const light = incoming(base, "light.xisf", { imageType: "light" })
    const masters = catalog().masters
    const pins = masterPins(catalog())
    const first = catalog().masters[DARK_300]!.cameraId!
    const firstAlias = catalog().cameras[first]!.physicalAlias!
    renderDialog()
    const dialog = within(await screen.findByRole("dialog", { name: m.calibration_import_masters() }))

    // The native chooser boundary: several files of one folder, pressed on, chosen at once.
    // The Choose… button is named by its field's label ("Master files, Choose…").
    await user.click(dialog.getByRole("button", { name: new RegExp(`^${m.calibration_import_files_label()}`) }))
    const picker = within(await screen.findByRole("dialog", { name: m.calibration_import_files_label() }))
    for (const file of [duplicate, newer, bias, light]) await user.click(picker.getByRole("button", { name: file.path.split("/").pop()! }))
    await user.click(picker.getByRole("button", { name: `${m.verb_choose()} 4 files` }))
    expect(dialog.getByText(m.fields_files_in({ count: 4 }))).toBeDefined()
    await user.click(dialog.getByRole("button", { name: m.stepflow_proceed() }))

    const row = (name: string) => within(dialog.getByRole("rowheader", { name }).closest("tr")!)
    expect(row("dark-300-copy.xisf").getByText(m.flow_match_duplicate())).toBeDefined()
    expect(row("light.xisf").getByText(m.store_cal_not_a_master())).toBeDefined()
    expect(row("bias-0C.xisf").getByText(m.flow_match_new())).toBeDefined()
    // Two cameras share the model: Import waits for the camera of each selected file.
    expect(dialog.getByRole("button", { name: m.stepflow_import() }).getAttribute("aria-disabled")).toBe("true")
    expect(dialog.getByRole("button", { name: new RegExp(m.calibration_import_cameras_needed({ count: 2 })) })).toBeDefined()

    await user.click(dialog.getByRole("combobox", { name: m.calibration_import_camera_of({ file: "dark-300-oct.xisf" }) }))
    await user.click(await screen.findByRole("option", { name: firstAlias }))
    await user.click(dialog.getByRole("combobox", { name: m.calibration_import_camera_of({ file: "bias-0C.xisf" }) }))
    await user.click(await screen.findByRole("option", { name: firstAlias }))
    await waitFor(() => expect(row("dark-300-oct.xisf").getByText(new RegExp(m.flow_match_version_of({ master: `Dark 300 s · ${firstAlias}` })))).toBeDefined())
    expect(catalog().masters).toEqual(masters)

    await waitFor(() => expect(dialog.getByRole("button", { name: m.stepflow_import() }).getAttribute("aria-disabled")).not.toBe("true"))
    await user.click(dialog.getByRole("button", { name: m.stepflow_import() }))

    expect(screen.queryByRole("alert")?.textContent ?? null).toBeNull()
    await waitFor(() => expect(catalog().masters[DARK_300]!.versions).toHaveLength(masters[DARK_300]!.versions.length + 1))
    const added = Object.values(catalog().masters).filter((x) => !masters[x.id])
    expect(added.map((x) => [x.kind, x.cameraId, x.ccdTempC])).toEqual([["bias", first, 0]])
    // The Duplicate and the light were not imported; adding a version moved no pin.
    expect(Object.values(catalog().masters).some((x) => x.versions.some((v) => v.origin.sourcePath === duplicate.path || v.origin.sourcePath === light.path))).toBe(false)
    expect(masterPins(catalog()).get(DARK_300)).toEqual(pins.get(DARK_300))
  })
})
