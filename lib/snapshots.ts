import { promises as fs } from "node:fs";
import path from "node:path";
import type { DocumentType } from "./types";

/**
 * Snapshot archive — full normalized markdown of every fetched document
 * version, stored as files under data/snapshots/ and committed by the
 * pipeline workflow (replacing Cloudflare R2: at this scale git is the
 * cheaper, simpler archive, and versions of the same document
 * delta-compress to almost nothing).
 *
 * The DB only keeps clauses for each document's LATEST snapshot (the diff
 * baseline); these files are the permanent record of older versions.
 * snapshots.storage_key holds the repo-relative path.
 */

const SNAPSHOT_ROOT = "data/snapshots";

export function snapshotKey(
  rootDomain: string,
  documentType: DocumentType,
  contentHash: string
): string {
  return `${SNAPSHOT_ROOT}/${rootDomain}/${documentType}/${contentHash}.md`;
}

/** Write the markdown for a snapshot key; creates directories as needed. */
export async function writeSnapshot(key: string, markdown: string): Promise<void> {
  // Keys come from snapshotKey() or the DB; refuse anything that could
  // escape the archive directory.
  if (!key.startsWith(`${SNAPSHOT_ROOT}/`) || key.includes("..")) {
    throw new Error(`Refusing to write snapshot outside ${SNAPSHOT_ROOT}: ${key}`);
  }
  const filePath = path.join(process.cwd(), key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, markdown, "utf8");
}
