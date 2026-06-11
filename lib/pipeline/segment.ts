import { clauseHash } from "../hash";

/**
 * Stage 4 — Segmentation (spec 3.1.4). Splits canonical markdown into
 * distinct clauses, deterministically. Each clause carries its section
 * heading for context (better embeddings and LLM classification).
 */

export interface SegmentedClause {
  position: number;
  content: string;
  hash: string;
}

const MIN_CLAUSE_CHARS = 80; // drop nav crumbs / stray lines
const TARGET_CLAUSE_CHARS = 1200; // merge small paragraphs up to roughly this
const MAX_CLAUSE_CHARS = 4000; // hard split for pathological walls of text

interface Block {
  heading: string | null;
  text: string;
}

function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let heading: string | null = null;

  for (const raw of markdown.split(/\n{2,}/)) {
    const text = raw.trim();
    if (!text) continue;
    const headingMatch = text.match(/^(#{1,6})\s+(.+)$/m);
    if (headingMatch && text.startsWith("#")) {
      // A heading block may include trailing body lines; separate them.
      heading = headingMatch[2].trim();
      const rest = text.slice(text.indexOf("\n") + 1).trim();
      if (rest && rest !== text) blocks.push({ heading, text: rest });
      continue;
    }
    blocks.push({ heading, text });
  }
  return blocks;
}

function hardSplit(text: string): string[] {
  if (text.length <= MAX_CLAUSE_CHARS) return [text];
  const parts: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let current = "";
  for (const s of sentences) {
    if (current.length + s.length > MAX_CLAUSE_CHARS && current) {
      parts.push(current.trim());
      current = "";
    }
    current += s + " ";
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

export function segmentMarkdown(markdown: string): SegmentedClause[] {
  const blocks = splitBlocks(markdown);

  // Merge adjacent blocks under the same heading up to the target size.
  const merged: Block[] = [];
  for (const block of blocks) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.heading === block.heading &&
      prev.text.length + block.text.length < TARGET_CLAUSE_CHARS
    ) {
      prev.text += "\n\n" + block.text;
    } else {
      merged.push({ ...block });
    }
  }

  const clauses: SegmentedClause[] = [];
  for (const block of merged) {
    if (block.text.length < MIN_CLAUSE_CHARS) continue;
    for (const piece of hardSplit(block.text)) {
      const content = block.heading ? `## ${block.heading}\n\n${piece}` : piece;
      clauses.push({
        position: clauses.length,
        content,
        hash: clauseHash(content),
      });
    }
  }
  return clauses;
}
