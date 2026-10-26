#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import ts from "typescript"
import { APP_ROOT } from "./i18n-project.mjs"

const SRC = path.join(APP_ROOT, "src")
const FILES = /\.(?:ts|tsx)$/
const MIN_REASON_WORDS = 3
const RULE_LIST = /^[\w@./-]+(?:\s*,\s*[\w@./-]+)*$/

export function invalidDisableDirectives(file, source) {
  const scriptKind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, scriptKind, source)
  const failures = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (token !== ts.SyntaxKind.SingleLineCommentTrivia && token !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    const comment = scanner.getTokenText()
    const body = token === ts.SyntaxKind.SingleLineCommentTrivia ? comment.slice(2) : comment.slice(2, -2)
    const match = body.trim().match(/^eslint-disable(?:-(?:line|next-line))?(?=\s|$)(.*)$/s)
    if (!match) continue

    const tail = match[1].trim()
    const separator = tail.indexOf("--")
    const rules = separator === -1 ? tail : tail.slice(0, separator).trim()
    const reason = separator === -1 ? "" : tail.slice(separator + 2).trim()
    const words = reason.split(/\s+/).filter(Boolean).length
    if (!RULE_LIST.test(rules) || words < MIN_REASON_WORDS) {
      const line = source.slice(0, scanner.getTokenStart()).split("\n").length
      failures.push(`${file}:${line}: eslint-disable requires named rule(s) and a reason of at least ${MIN_REASON_WORDS} words`)
    }
  }
  return failures
}

function main() {
  const failures = []
  for (const file of readdirSync(SRC, { recursive: true, encoding: "utf8" })) {
    if (!FILES.test(file) || file.endsWith(".d.ts")) continue
    const relative = file.split(path.sep).join("/")
    failures.push(...invalidDisableDirectives(relative, readFileSync(path.join(SRC, file), "utf8")))
  }

  if (failures.length) {
    console.error(`ESLint disable directive policy failed (${failures.length}):\n${failures.map((failure) => `  ${failure}`).join("\n")}`)
    process.exitCode = 1
  } else {
    console.log("ESLint disable directive policy: OK")
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
