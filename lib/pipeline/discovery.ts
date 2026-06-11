import * as cheerio from "cheerio";
import type { DocumentType } from "../types";
import { fetchHtml, htmlToMarkdown } from "./extract";

/**
 * Stage 1 — Discovery (spec 3.1.1). Heuristic probing of the root domain to
 * locate legal documents: first by scanning homepage links (most reliable),
 * then by probing well-known paths.
 */

export interface DiscoveredDocument {
  type: DocumentType;
  url: string;
}

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

async function resolveHomepage(
  rootDomain: string
): Promise<{ url: string; html: string } | null> {
  for (const candidate of [`https://${rootDomain}`, `https://www.${rootDomain}`]) {
    try {
      const html = await fetchHtml(candidate);
      return { url: candidate, html };
    } catch {
      continue;
    }
  }
  return null;
}

/** A candidate URL counts only if it serves substantial extractable text. */
async function probeUrl(url: string): Promise<boolean> {
  try {
    const html = await fetchHtml(url);
    return htmlToMarkdown(html).length > 1000;
  } catch {
    return false;
  }
}

export async function discoverDocuments(
  rootDomain: string,
  log: (message: string) => void
): Promise<DiscoveredDocument[]> {
  const found = new Map<DocumentType, string>();

  // Pass 1: homepage footer/header links
  const home = await resolveHomepage(rootDomain);
  if (home) {
    const $ = cheerio.load(home.html);
    const links: { url: string; type: DocumentType }[] = [];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const text = $(el).text().trim();
      if (!href || href.startsWith("#") || href.startsWith("mailto:")) return;
      const type = classifyLink(href, text);
      if (!type) return;
      try {
        const abs = new URL(href, home.url);
        if (!abs.hostname.endsWith(rootDomain)) return; // stay on the service's domain
        abs.hash = "";
        links.push({ url: abs.toString(), type });
      } catch {
        /* unparseable href */
      }
    });
    for (const { url, type } of links) {
      if (!found.has(type)) found.set(type, url);
    }
    if (found.size > 0) {
      log(`Homepage links: found ${[...found.keys()].join(", ")}`);
    }
  } else {
    log(`Could not fetch homepage of ${rootDomain}; falling back to path probing`);
  }

  // Verify homepage-link candidates actually serve substantial content
  for (const [type, url] of [...found]) {
    if (!(await probeUrl(url))) {
      log(`Dropping ${type} candidate ${url} — no substantial content`);
      found.delete(type);
    }
  }

  // Pass 2: well-known paths for anything still missing (probe verifies)
  const base = home?.url ?? `https://${rootDomain}`;
  for (const { type, paths } of WELL_KNOWN_PATHS) {
    if (found.has(type)) continue;
    for (const path of paths) {
      const url = new URL(path, base).toString();
      if (await probeUrl(url)) {
        found.set(type, url);
        log(`Path probe: found ${type} at ${path}`);
        break;
      }
    }
  }

  return [...found].map(([type, url]) => ({ type, url }));
}
