import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { readEavtJournal } from "@red-cup-engineering/eavt-services-section/read-eavt-journal";

import { markdownWriteEntry, witnessMarkdownWrite } from "../src/index.mjs";

const CLI = fileURLToPath(new URL("../scripts/witness-markdown-write.mjs", import.meta.url));

async function withTempRoot(run) {
  const root = await mkdtemp(join(tmpdir(), "witness-markdown-write-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("markdownWriteEntry cellizes a write receipt to one EAVT row: e=relativePath, a={verb,mode}, v=text", () => {
  const row = markdownWriteEntry({ relativePath: "notes/example.md", text: "Body.\n" }, "create", "2026-08-12T00:00:00.000Z");
  assert.deepEqual(row, {
    e: "notes/example.md",
    a: { verb: "write-markdown", mode: "create" },
    v: "Body.\n",
    t: "2026-08-12T00:00:00.000Z",
  });
});

test("witnessMarkdownWrite writes a real Markdown carrier and witnesses it as one readable-back journal entry", async () => {
  await withTempRoot(async (root) => {
    const at = "2026-08-12T12:00:00.000Z";
    const apex = await witnessMarkdownWrite({
      root,
      path: "notes/example.md",
      text: "One wraps\nhere. Two follows.\n",
      feed: "markdown-writes",
      at,
    });

    assert.equal(apex.created, true);
    assert.equal(apex.changed, true);
    // write-markdown-file-service normalizes linefeeds/wraps; the witnessed
    // value must be the text actually written, not the caller's raw input.
    assert.equal(apex.witness.entry.v, apex.text);
    assert.equal(apex.witness.appended, 1);
    assert.equal(await readFile(apex.path, "utf8"), apex.text);

    // Receiver-facing: read the journal back through the sibling package
    // this operation composes with, not through any internal shortcut.
    const traced = readEavtJournal({ root, feed: "markdown-writes", at });
    assert.equal(traced.length, 1);
    assert.deepEqual(traced[0].entry, {
      e: "notes/example.md",
      a: { verb: "write-markdown", mode: "create" },
      v: apex.text,
      t: at,
    });
  });
});

test("replace mode carries into the witnessed entry and appends a second, distinct witness", async () => {
  await withTempRoot(async (root) => {
    const at1 = "2026-08-12T12:00:00.000Z";
    const at2 = "2026-08-12T12:05:00.000Z";
    await witnessMarkdownWrite({ root, path: "notes/example.md", text: "First.\n", feed: "markdown-writes", at: at1 });
    const replaced = await witnessMarkdownWrite({
      root, path: "notes/example.md", text: "Second.\n", mode: "replace", feed: "markdown-writes", at: at2,
    });

    assert.equal(replaced.created, false);
    assert.equal(replaced.witness.entry.a.mode, "replace");

    // Both witnesses land in the same day-partitioned journal file, not one
    // file per exact timestamp — that partitioning is witness-journal-log-
    // service's own law, not something this package re-decides.
    const traced = readEavtJournal({ root, feed: "markdown-writes", at: at1 });
    assert.equal(traced.length, 2);
    assert.deepEqual(traced.map((row) => row.entry.a.mode), ["create", "replace"]);
    assert.deepEqual(traced.map((row) => row.entry.v), ["First.\n", "Second.\n"]);
  });
});

test("re-witnessing an unchanged write is receipt-idempotent and witness-deduped", async () => {
  await withTempRoot(async (root) => {
    const at = "2026-08-12T12:00:00.000Z";
    const options = { root, path: "notes/example.md", text: "Stable.\n", mode: "upsert", feed: "markdown-writes", at };
    const first = await witnessMarkdownWrite(options);
    const second = await witnessMarkdownWrite(options);

    assert.equal(first.witness.appended, 1);
    assert.equal(second.changed, false);
    assert.equal(second.witness.appended, 0);
    assert.equal(readEavtJournal({ root, feed: "markdown-writes", at }).length, 1);
  });
});

test("witnessMarkdownWrite refuses to run without feed or at", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      () => witnessMarkdownWrite({ root, path: "notes/example.md", text: "x\n", at: "2026-08-12T00:00:00.000Z" }),
      /feed must be a nonempty string/u,
    );
    await assert.rejects(
      () => witnessMarkdownWrite({ root, path: "notes/example.md", text: "x\n", feed: "markdown-writes" }),
      /at \(witness time\) is required/u,
    );
  });
});

test("CLI writes and witnesses a Markdown carrier, printing the settled apex as JSON", async () => {
  await withTempRoot(async (root) => {
    const at = "2026-08-12T12:00:00.000Z";
    const stdout = execFileSync(
      process.execPath,
      [...process.execArgv.filter((flag) => !flag.startsWith("--test")), CLI, "--root", root, "--path", "notes/cli.md", "--feed", "markdown-writes", "--at", at],
      { input: "CLI body.\n", encoding: "utf8" },
    );
    const apex = JSON.parse(stdout);
    assert.equal(apex.created, true);
    assert.equal(apex.witness.appended, 1);
    assert.equal(await readFile(apex.path, "utf8"), "CLI body.\n");
    assert.equal(readEavtJournal({ root, feed: "markdown-writes", at }).length, 1);
  });
});

test("CLI refuses and exits nonzero when a required flag is missing", () => {
  assert.throws(() => execFileSync(process.execPath, [...process.execArgv.filter((flag) => !flag.startsWith("--test")), CLI, "--root", "/tmp"], { input: "x\n", encoding: "utf8" }));
});
