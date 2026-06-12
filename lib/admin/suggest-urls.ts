import * as cheerio from "cheerio";
import { fetchPage, htmlToMarkdown } from "../pipeline/extract";
import type { DocumentType } from "../types";

/**
 * Admin-assist URL suggestions. This is NOT a pipeline stage: the pipeline
 * only ever fetches URLs the admin explicitly saved. Heuristics like these
 * used to feed the pipeline directly and scraped look-alike pages (a GitHub
 * user profile named "cookie-policy" once passed for the real thing), so
 * now they only pre-fill the admin form — every suggestion shows its page
 * title and extracted size so the admin can judge it before saving.
 *
 * Plain fetch only (no headless-browser fallback): this runs in a Vercel
 * server action, so it must stay fast and browser-free. JavaScript-only
 * sites simply yield no suggestions and the admin pastes URLs manually.
 */

export interface UrlSuggestion {
  type: DocumentType;
  url: string;
  title: string | null;
  chars: number;
  source: "homepage" | "path-probe";
}

export interface SuggestResult {
  suggestions: UrlSuggestion[];
  notes: string[];
}

const PROBE_TIMEOUT_MS = 8_000;
const MAX_PER_TYPE = 2;

const LINK_PATTERNS: { type: DocumentType; pattern: RegExp }[] = [
  { type: "privacy_policy", pattern: /privacy/i },
  { type: "cookie_policy", pattern: /cookie/i },
  { type: "acceptable_use", pattern: /acceptable[\s-_]?use/i },
  {
    type: "terms_of_service",
    pattern: /terms|conditions|\btos\b|user[\s-_]?agreement|\beula\b/i,
  },
];

const WELL_KNOWN_PATHS: { type: DocumentType; paths: string[] }[] = [
  {
    type: "terms_of_service",
    paths: [
      "/terms",
      "/tos",
      "/terms-of-service",
      "/terms-of-use",
      "/terms-and-conditions",
      "/legal/terms",
      "/legal/terms-of-service",
      "/policies/terms-of-service",
      "/legal/user-agreement",
    ],
  },
  {
    type: "privacy_policy",
    paths: [
      "/privacy",
      "/privacy-policy",
      "/legal/privacy",
      "/legal/privacy-policy",
      "/policies/privacy",
    ],
  },
  {
    type: "cookie_policy",
    paths: ["/cookies", "/cookie-policy", "/legal/cookies"],
  },
];

function classifyLink(href: string, text: string): DocumentType | null {
  const haystack = `${href} ${text}`;
  for (const { type, pattern } of LINK_PATTERNS) {
    if (pattern.test(haystack)) return type;
  }
  return null;
}

function onDomain(hostname: string, rootDomain: string): boolean {
  return hostname === rootDomain || hostname.endsWith(`.${rootDomain}`);
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i]);
      }
    })
  );
  return results;
}

/** A candidate counts only if it serves substantial extractable text. */
async function probe(
  url: string
): Promise<{ chars: number; title: string | null } | null> {
  try {
    const page = await fetchPage(url, { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 });
    const chars = htmlToMarkdown(page.html).length;
    return chars >= 1000 ? { chars, title: page.title } : null;
  } catch {
    return null;
  }
}

async function resolveHomepage(
  rootDomain: string
): Promise<{ url: string; html: string } | null> {
  for (const candidate of [`https://${rootDomain}`, `https://www.${rootDomain}`]) {
    try {
      const page = await fetchPage(candidate, { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 });
      return { url: candidate, html: page.html };
    } catch {
      continue;
    }
  }
  return null;
}

export async function suggestDocumentUrls(rootDomain: string): Promise<SuggestResult> {
  const notes: string[] = [];
  const candidates: { type: DocumentType; url: string; source: UrlSuggestion["source"] }[] = [];

  // Pass 1: homepage footer/header links (highest precision).
  const home = await resolveHomepage(rootDomain);
  if (home) {
    const $ = cheerio.load(home.html);
    const perType = new Map<DocumentType, Set<string>>();
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      const type = classifyLink(href, text);
      if (!type) return;
      try {
        const abs = new URL(href, home.url);
        if (!onDomain(abs.hostname, rootDomain)) return; // stay on the service's domain
        abs.hash = "";
        const urls = perType.get(type) ?? new Set<string>();
        if (urls.size < MAX_PER_TYPE && !urls.has(abs.toString())) {
          urls.add(abs.toString());
          candidates.push({ type, url: abs.toString(), source: "homepage" });
        }
        perType.set(type, urls);
      } catch {
        /* unparseable href */
      }
    });
  } else {
    notes.push(
      `Could not fetch the homepage of ${rootDomain} (it may need JavaScript or block plain fetches) — falling back to path guesses only.`
    );
  }

  // Pass 2: well-known path guesses for types the homepage didn't cover.
  const base = home?.url ?? `https://${rootDomain}`;
  const coveredTypes = new Set(candidates.map((c) => c.type));
  for (const { type, paths } of WELL_KNOWN_PATHS) {
    if (coveredTypes.has(type)) continue;
    for (const path of paths) {
      candidates.push({ type, url: new URL(path, base).toString(), source: "path-probe" });
    }
  }

  // Verify every candidate actually serves substantial text, in parallel.
  const probed = await mapLimit(candidates, 5, async (c) => ({
    ...c,
    result: await probe(c.url),
  }));

  const suggestions: UrlSuggestion[] = [];
  const seen = new Set<string>();
  const countPerType = new Map<DocumentType, number>();
  for (const c of probed) {
    if (!c.result || seen.has(c.url)) continue;
    const count = countPerType.get(c.type) ?? 0;
    // Path probes are ordered most-likely-first; keep only the first hit.
    if (c.source === "path-probe" && count >= 1) continue;
    if (count >= MAX_PER_TYPE) continue;
    seen.add(c.url);
    countPerType.set(c.type, count + 1);
    suggestions.push({
      type: c.type,
      url: c.url,
      title: c.result.title,
      chars: c.result.chars,
      source: c.source,
    });
  }

  if (suggestions.some((s) => s.source === "path-probe")) {
    notes.push(
      "Path-probe suggestions are guesses against common URL layouts — check the page title before saving (e.g. /cookie-policy on github.com is a user profile, not a policy)."
    );
  }
  if (suggestions.length === 0) {
    notes.push(
      "Nothing found. The site may render everything with JavaScript or sit behind a bot wall — find the policy URLs in a browser and paste them manually."
    );
  }

  return { suggestions, notes };
}
