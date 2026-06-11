import * as cheerio from "cheerio";
import TurndownService from "turndown";

/**
 * Stage 2 — Extraction & Normalization (spec 3.1.2).
 * Fetches a page and converts it to canonical markdown, deterministically
 * (no LLM involved) so the document hash is stable and unchanged documents
 * terminate the pipeline at $0 cost.
 */

const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; FineprintBot/0.1; +https://fineprint.app/bot)";

export async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text/plain")) {
      throw new Error(`Unsupported content-type "${type}" at ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});
turndown.remove(["script", "style", "noscript"]);
// Drop images entirely — they're noise in legal documents and their URLs
// churn constantly, which would poison the content hash.
turndown.addRule("dropImages", {
  filter: "img",
  replacement: () => "",
});

/** Convert raw HTML to normalized markdown of the main content. */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, nav, header, footer, form, button").remove();
  $("[role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]").remove();

  // Prefer semantic main-content containers; fall back to body.
  const candidates = ["main", "article", "[role=main]", "#content", ".content"];
  let containerHtml = $("body").html();
  for (const sel of candidates) {
    const el = $(sel);
    if (el.length && el.text().trim().length > 500) {
      containerHtml = el.first().html();
      break;
    }
  }

  const markdown = turndown.turndown(containerHtml ?? "");
  return normalizeMarkdown(markdown);
}

/** Deterministic cleanup so the same content always hashes identically. */
export function normalizeMarkdown(md: string): string {
  return md
    .replace(/\r\n/g, "\n")
    .replace(/[​-‍﻿ ]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Extract one logical document. Multiple source URLs (admin force-merge for
 * multi-page documents) are concatenated in order with separators.
 */
export async function extractDocument(sourceUrls: string[]): Promise<string> {
  const parts: string[] = [];
  for (const url of sourceUrls) {
    const html = await fetchHtml(url);
    const md = htmlToMarkdown(html);
    if (md.length < 200) {
      throw new Error(`Extracted under 200 chars from ${url} — likely blocked or empty`);
    }
    parts.push(md);
  }
  return parts.join("\n\n---\n\n");
}
