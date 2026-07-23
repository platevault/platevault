#!/usr/bin/env node

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020");

function utf8ByteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

export function registerUtf8ByteKeywords(ajv) {
  ajv.addKeyword({
    keyword: "x-maxUtf8Bytes",
    schemaType: "number",
    type: "string",
    validate: (maximum, value) => utf8ByteLength(value) <= maximum,
  });
  ajv.addKeyword({
    keyword: "x-maxSegmentUtf8Bytes",
    schemaType: "number",
    type: "string",
    validate: (maximum, value) =>
      value.split("/").every((segment) => utf8ByteLength(segment) <= maximum),
  });
  return ajv;
}

function validateCorpus({ schema, cases }) {
  const ajv = registerUtf8ByteKeywords(new Ajv2020({ strict: false, allErrors: true }));
  const validate = ajv.compile(schema);
  return cases.map(({ value }) => Boolean(validate(value)));
}

function run() {
  if (process.argv.includes("--stdin")) {
    const corpus = JSON.parse(readFileSync(0, "utf8"));
    process.stdout.write(`${JSON.stringify(validateCorpus(corpus))}\n`);
    return;
  }

  const accepted = `${"é".repeat(127)}a`;
  const rejected = "é".repeat(128);
  const results = validateCorpus({
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
      "x-maxUtf8Bytes": 4096,
      "x-maxSegmentUtf8Bytes": 255,
    },
    cases: [{ value: accepted }, { value: rejected }],
  });
  if (JSON.stringify(results) !== JSON.stringify([true, false])) {
    throw new Error(`UTF-8 byte keyword boundary mismatch: ${JSON.stringify(results)}`);
  }
  console.log("OK — UTF-8 byte keywords enforce the 255/256-byte segment boundary");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
