// The composition and disable-reason lint rules, each with a failing and a
// passing fixture. Run: pnpm test:lint-rules.
import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { Linter } from "eslint"
import tseslint from "typescript-eslint"
import composition, { COMPOSITION_SYNTAX } from "../composition.js"
import pv from "../no-user-string.js"

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const linter = new Linter({ cwd: APP_ROOT })

/**
 * The rule ids ([L6], [I1], …) or message ids ESLint reports for one source.
 * @param {string} source
 * @param {Record<string, unknown>} rules
 * @param {string} file relative to the app root
 */
function ids(source, rules, file = "src/features/library/page.tsx") {
  const config = { files: ["**/*.{ts,tsx}"], languageOptions: { parser: tseslint.parser }, plugins: { pv, composition }, rules, settings: { "import/resolver": "" } }
  const messages = linter.verify(source, [config], path.join(APP_ROOT, file))
  const fatal = messages.find((message) => message.fatal)
  if (fatal) throw new Error(fatal.message)
  return messages.map((message) => message.message.match(/^\[([LI]\d+)\]/)?.[1] ?? message.messageId ?? message.message)
}

const components = (source) => ids(source, { "composition/components": "error" })
const imports = (source, file) => ids(source, { "composition/imports": "error" }, file)
const disableReason = (source) => ids(source, { "pv/require-disable-reason": "error", "no-alert": "error" })

describe("L6 title tooltips (§6.2 T2)", () => {
  it("flags a static title on a truncate element", () => {
    assert.deepEqual(components('const x = <span className="truncate" title="M 31 · Ha">M 31 · Ha</span>'), ["L6"])
    assert.deepEqual(components('const x = <Pill className="truncate" title={"full"}>x</Pill>'), ["L3", "L6"])
  })
  it("flags a title on any tooltip element, through an alias or a spread", () => {
    assert.deepEqual(components('import { Button as B } from "@/components/app"; const x = <B title={name}>x</B>'), ["L6"])
    assert.deepEqual(components('const tip = { title: "full" }; const x = <div {...tip}>x</div>'), ["L6"])
  })
  it("passes the titleWhenCut handler and a component's heading prop", () => {
    assert.deepEqual(components('const x = <span className="truncate" onPointerEnter={titleWhenCut}>{name}</span>'), [])
    assert.deepEqual(components("const x = <PageHeader title={m.nav_home()} />"), [])
  })
})

describe("L2-L7 through aliases and spreads", () => {
  it("L2: a Pill control, aliased by import, const or namespace, or spread", () => {
    assert.deepEqual(components('import { Pill as P } from "@/components/app"; const x = <P onClick={go} />'), ["L2"])
    assert.deepEqual(components("const P = Pill; const x = <P href=\"/a\" />"), ["L2"])
    assert.deepEqual(components('import * as App from "@/components/app"; const x = <App.Pill link={l} />'), ["L2"])
    assert.deepEqual(components("const props = { ...base, onClick: go }; const x = <Pill {...props} />"), ["L2"])
    assert.deepEqual(components('import { pillClass as pc } from "@/components/app"; const c = pc("ok")'), ["L2"])
    assert.deepEqual(components('import { Pill as P } from "@/components/app"; const x = <P tone="ok">x</P>'), [])
  })
  it("L3: className on a shared component, through an alias or a spread", () => {
    assert.deepEqual(components('const B = Badge; const x = <B className="ml-2" />'), ["L3"])
    assert.deepEqual(components('const x = <Box {...(wide ? { className: "w-full" } : {})} />'), ["L3"])
    assert.deepEqual(components('const x = <Section className="p-2" />'), [])
  })
  it("L4: a retired Button variant or size, through a branch, a const or a spread", () => {
    assert.deepEqual(components('const ButtonAlias = Button; const x = <ButtonAlias variant={busy ? "outline" : "secondary"} />'), ["L4"])
    assert.deepEqual(components('const size = "lg"; const x = <Button size={size} />'), ["L4"])
    assert.deepEqual(components('const look = { variant: "secondary" }; const x = <Button {...look} />'), ["L4"])
    assert.deepEqual(components('const x = <Button variant={busy ? "outline" : "ghost"} size="sm" />'), [])
    assert.deepEqual(components("const x = <Button variant={kindVariant(action)} />"), [])
  })
  it("L5 and L7: SheetContent and HelpTip under another name", () => {
    assert.deepEqual(components('import { SheetContent as Side } from "@/components/ui/sheet"; const x = <Side />'), ["L5"])
    assert.deepEqual(components("const Tip = HelpTip; const x = <Tip />"), ["L7"])
    assert.deepEqual(components("const Tip = NoteMarker; const x = <Tip />"), [])
  })
  it("reads nothing from a spread it cannot resolve", () => {
    assert.deepEqual(components("function F(props) { return <Pill {...props} /> }"), [])
  })
})

describe("L1, L8-L11 selectors", () => {
  it("keep their ids for the report", () => {
    const syntax = (source) => ids(source, { "no-restricted-syntax": ["error", ...COMPOSITION_SYNTAX] })
    assert.deepEqual(syntax("const x = <button />"), ["L1"])
    assert.deepEqual(syntax("const x = <Button />"), [])
  })
})

describe("I1-I7 source boundaries", () => {
  it("I1: components/ui importing a pattern, relatively or through ..", () => {
    assert.deepEqual(imports('import { Pill } from "../app/pill"', "src/components/ui/button.tsx"), ["I1"])
    assert.deepEqual(imports('import { x } from "@/components/ui/../app/pill"', "src/components/ui/button.tsx"), ["I1"])
    assert.deepEqual(imports('import { cn } from "../../lib/utils"; import { Slot } from "./slot"', "src/components/ui/button.tsx"), [])
  })
  it("I2: a pattern importing a template relatively", () => {
    assert.deepEqual(imports('export { DetailPage } from "../templates/detail-page"', "src/components/app/data.tsx"), ["I2"])
    assert.deepEqual(imports('import { Button } from "../ui/button"', "src/components/app/data.tsx"), [])
  })
  it("I3: a template importing a feature relatively", () => {
    assert.deepEqual(imports('import { trash } from "../../features/library/actions/trash"', "src/components/templates/page.tsx"), ["I3"])
    assert.deepEqual(imports('import { helper } from "../../lib/utils"', "src/components/templates/page.tsx"), [])
  })
  it("I6: another feature area through .. in an @/ path, a relative path or import()", () => {
    assert.deepEqual(imports('import { x } from "@/features/library/../projects/model"'), ["I6"])
    assert.deepEqual(imports('import { x } from "../projects/model"', "src/features/library/home.tsx"), ["I6"])
    assert.deepEqual(imports('const page = import("../projects/model")', "src/features/library/home.tsx"), ["I6"])
    assert.deepEqual(imports('import { x } from "@/features/library/parts/../model"; import { y } from "./parts/row"', "src/features/library/home.tsx"), [])
  })
  it("I4-I5: Base UI and components/ui from a feature, also relatively", () => {
    assert.deepEqual(imports('import { Menu } from "@base-ui/react/menu"; import { Button } from "../../components/ui/button"'), ["I4", "I5"])
    assert.deepEqual(imports('import { Button } from "../../components/app/actions"'), [])
  })
})

describe("pv/require-disable-reason", () => {
  it("flags each disable directive kind without a reason", () => {
    assert.deepEqual(disableReason("// eslint-disable-next-line no-alert\nalert(1)"), ["missing"])
    assert.deepEqual(disableReason("alert(1) // eslint-disable-line no-alert --   "), ["missing"])
    assert.deepEqual(disableReason("/* eslint-disable no-alert */\nalert(1)"), ["missing"])
    assert.deepEqual(disableReason("const x = (\n  <div>\n    {/* eslint-disable-next-line no-alert */}\n    {alert(1)}\n  </div>\n)"), ["missing"])
  })
  it("passes a directive with a reason, and eslint-enable", () => {
    assert.deepEqual(disableReason("// eslint-disable-next-line no-alert -- the kiosk build has no dialog\nalert(1)"), [])
    assert.deepEqual(disableReason("/* eslint-disable no-alert -- legacy page */\nalert(1)\n/* eslint-enable no-alert */"), [])
  })
})

describe("composition boundaries fail closed", () => {
  it("rejects imports from an unregistered feature or component area", () => {
    assert.deepEqual(imports('import { x } from "./new-feature"', "src/features/new-feature/page.tsx"), ["I6"])
    assert.deepEqual(imports('import { x } from "./hidden"', "src/components/hidden/page.tsx"), ["I1"])
  })
})

describe("generated IPC importer boundary", () => {
  it("allows only src/api to import the generated library client and Tauri APIs", () => {
    assert.deepEqual(imports('import { invoke } from "@tauri-apps/api/core"', "src/app/boot.ts"), ["I7"])
    assert.deepEqual(imports('import { core } from "@tauri-apps/api"', "src/app/boot.ts"), ["I7"])
    assert.deepEqual(imports('import * as generated from "../../../desktop/src/bindings/library-index"', "src/app/boot.ts"), ["I7"])
    assert.deepEqual(imports('import * as mocks from "../../../desktop/src/api/mocks"', "src/app/boot.ts"), ["I7"])
    // src/api/ipc.ts sits three levels below the repo's apps/ directory.
    assert.deepEqual(imports('import * as generated from "../../../desktop/src/bindings/library-index"', "src/api/ipc.ts"), [])
    assert.deepEqual(imports('import { invoke } from "@tauri-apps/api/core"', "src/api/ipc.ts"), [])
    assert.deepEqual(imports('import { listen } from "@tauri-apps/api/event"', "src/api/events.ts"), [])
  })

  it("refuses the legacy client and mock dispatch even from src/api", () => {
    assert.deepEqual(imports('import * as legacy from "../../../desktop/src/bindings/index"', "src/api/ipc.ts"), ["I7"])
    assert.deepEqual(imports('import * as mocks from "../../../desktop/src/api/mocks"', "src/api/ipc.ts"), ["I7"])
    assert.deepEqual(imports('import * as other from "../../../desktop/src/lib/paths"', "src/api/ipc.ts"), ["I7"])
  })

  it("lets tests, and only tests, use Tauri's IPC mocks", () => {
    assert.deepEqual(imports('import { mockIPC } from "@tauri-apps/api/mocks"', "src/features/library/library.test.tsx"), [])
    assert.deepEqual(imports('import { mockIPC } from "@tauri-apps/api/mocks"', "src/features/library/library.tsx"), ["I7"])
    assert.deepEqual(imports('import { mockIPC } from "@tauri-apps/api/mocks"', "src/api/ipc.ts"), ["I7"])
    assert.deepEqual(imports('import { mockIPC } from "@tauri-apps/api/mocks"', "src/api/ipc.test.ts"), [])
  })

  it("does not mistake an in-package bindings module for the generated client", () => {
    assert.deepEqual(imports('import { x } from "@/lib/bindings/index"', "src/app/boot.ts"), [])
  })
})

