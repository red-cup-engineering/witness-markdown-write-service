#!/usr/bin/env node
// witness-markdown-write — CLI entrypoint for witnessMarkdownWrite: the
// package's one operation, writing a Markdown carrier and witnessing that
// write as one journal entry. Reads the Markdown text from stdin, prints
// the settled apex (write receipt + witness outcome) as JSON, terminates.
// No logic duplicated here — this wraps the single exported function that
// src/index.mjs already owns.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { witnessMarkdownWrite } from "../src/index.mjs";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    path: { type: "string" },
    mode: { type: "string" },
    feed: { type: "string" },
    at: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  process.stdout.write(
    "Usage: witness-markdown-write --root <path> --path <markdown-path> --feed <name> --at <witness-time> [--mode create|replace|upsert] < text.md\n\n" +
      "Writes a Markdown carrier under --root through write-markdown-file-service,\n" +
      "then witnesses that write as one entry in --feed's dated journal under the\n" +
      "same --root. Prints the settled apex (write receipt + witness outcome) as JSON.\n",
  );
  process.exit(0);
}

for (const flag of ["root", "path", "feed", "at"]) {
  if (values[flag] === undefined) {
    console.error(`error: --${flag} is required`);
    process.exit(2);
  }
}

const text = readFileSync(0, "utf8");

try {
  const result = await witnessMarkdownWrite({
    root: values.root,
    path: values.path,
    text,
    mode: values.mode,
    feed: values.feed,
    at: values.at,
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  console.error(`witness-markdown-write: ${error.message}`);
  process.exit(1);
}
