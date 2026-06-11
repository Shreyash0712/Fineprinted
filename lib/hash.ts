import { createHash } from "node:crypto";

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Normalize clause text before hashing so cosmetic differences (case,
 * punctuation, whitespace, markdown syntax) don't produce new hashes.
 * The classification cache and clause-level diffing both key off this.
 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function clauseHash(text: string): string {
  return sha256(normalizeForHash(text));
}
