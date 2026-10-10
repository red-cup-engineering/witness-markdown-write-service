// witness-markdown-write-service — one witnessed Markdown write.
//
// Composes the existing write-markdown-file-service write with one
// witness-journal entry, so a Markdown write and its evidence settle as one
// apex: a single returned object holding the write receipt beside its
// witness outcome. No shadow state store: witnessMarkdownWrite reads
// nothing back from the journal and keeps no materialized projection of
// it — appendEntries remains the only effectful membrane, and its own
// strict carrier-equality dedup is what makes re-witnessing the same write
// free. The write's filesystem root and the journal's data root are the
// same confined tree, so a carrier and its evidence live under one root
// instead of two independently rooted stores.

import { writeMarkdownFile } from "@red-cup-engineering/markdown-engineering-services-section/write-markdown-file";
import { eavtRow } from "@red-cup-engineering/eavt-services-section/row";
import { appendEavtEntries } from "@red-cup-engineering/eavt-services-section/append-eavt-entries";

/**
 * @typedef {"create" | "replace" | "upsert"} MarkdownWriteMode
 * @typedef {import("../../../../../../../../../../computer-serialized-content-engineering-services-section/services/json-services-section/src/index.mjs").JsonValue} JsonValue
 * @typedef {import("@red-cup-engineering/eavt-services-section/row").WitnessJournalEntry} WitnessJournalEntry
 */

/**
 * @typedef {{
 *   readonly root: string,
 *   readonly path: string,
 *   readonly text: string,
 *   readonly mode?: MarkdownWriteMode,
 *   readonly feed: string,
 *   readonly at: JsonValue,
 * }} WitnessedMarkdownWriteOptions
 */

/**
 * Build the one witness-journal entry a Markdown write cellizes to: a
 * single grain-of-change EAVT row — E=the written carrier's workspace-
 * relative path, A={verb: "write-markdown", mode}, V=the normalized text
 * actually written, T=at. Pure: takes the already-computed write receipt,
 * performs no I/O itself.
 *
 * @param {{ readonly relativePath: string, readonly text: string }} receipt
 * @param {MarkdownWriteMode} mode
 * @param {JsonValue} at
 * @returns {WitnessJournalEntry}
 */
export function markdownWriteEntry(receipt, mode, at) {
  return eavtRow({ e: receipt.relativePath, a: { verb: "write-markdown", mode }, v: receipt.text, t: at });
}

/**
 * Write one Markdown carrier and witness that write as one journal entry.
 *
 * The write happens first, through write-markdown-file-service unmodified;
 * its receipt is then cellized to one entry and appended to `feed`'s dated
 * journal under `root`, via witness-journal-log-service unmodified. A
 * journal-append failure is not swallowed: the write has already happened
 * by that point, so a caller that catches this can decide whether to retry
 * witnessing with the same receipt rather than losing the failure silently.
 *
 * @param {WitnessedMarkdownWriteOptions} options
 * @returns {Promise<Readonly<Record<string, unknown>>>}
 */
export async function witnessMarkdownWrite(options) {
  if (!options || typeof options !== "object") throw new TypeError("witnessMarkdownWrite: options must be supplied");
  if (typeof options.feed !== "string" || options.feed.length === 0) {
    throw new TypeError("witnessMarkdownWrite: feed must be a nonempty string");
  }
  if (options.at === undefined) {
    throw new TypeError("witnessMarkdownWrite: at (witness time) is required");
  }
  const mode = options.mode ?? "create";
  const receipt = await writeMarkdownFile({ root: options.root, path: options.path, text: options.text, mode });
  const witnessedEntry = markdownWriteEntry(receipt, mode, options.at);
  const witness = appendEavtEntries({ root: options.root, feed: options.feed, entries: [witnessedEntry], at: options.at });
  return Object.freeze({
    ...receipt,
    witness: Object.freeze({ feed: options.feed, at: options.at, entry: witnessedEntry, ...witness }),
  });
}
