import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { sleep } from "../ai/rate-limit";

/**
 * Stage 2 — Extraction & Normalization (spec 3.1.2).
 * Fetches admin-curated document URLs and converts them to canonical
 * markdown, deterministically (no LLM involved) so the document hash is
 * stable and unchanged documents terminate the pipeline at $0 cost.
 *
 * Fetching is hardened for the realities of legal pages:
 * - requests look like a real desktop Chrome (self-identified bot UAs get
 *   blanket 403s from Cloudflare/Akamai even for public legal documents),
 * - transient failures (429/5xx/network) retry with backoff,
 * - bot-walled or JavaScript-only pages fall back to real headless Chrome
 *   via playwright-core. No browser download needed: it launches the
 *   system Chrome/Edge, which is preinstalled on GitHub Actions runners
 *   and most dev machines. On Vercel there is no browser, so the fallback
 *   reports itself as unavailable instead of failing cryptically.
 */

const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_NAV_TIMEOUT_MS = 30_000;
/** How long to wait for a JS page / bot-check interstitial to settle. */
const SETTLE_BUDGET_MS = 15_000;
/** Rendered-text length above which a settled page counts as real content. */
const SUBSTANTIAL_TEXT_LEN = 1_500;
/** Below this many chars of markdown a page is junk, a shell, or a wall. */
const MIN_EXTRACT_CHARS = 200;

/**
 * Realistic desktop-Chrome headers. Accept-Encoding is deliberately not
 * set: undici advertises and transparently decodes its own set.
 */
const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Ch-Ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Failure that neither retrying nor a real browser can fix (404, PDF…). */
export class HardFetchError extends Error {}

/** The headless-browser fallback itself can't run here (e.g. on Vercel). */
export class BrowserUnavailableError extends Error {}

export interface FetchedPage {
  html: string;
  title: string | null;
}

export interface ExtractOptions {
  /** Per-attempt fetch timeout (default 20s). */
  timeoutMs?: number;
  /** Extra attempts after the first for transient failures (default 2). */
  retries?: number;
  /** Fall back to headless Chrome when plain fetch yields nothing (default true). */
  allowBrowser?: boolean;
}

export interface ExtractedUrl {
  markdown: string;
  title: string | null;
  via: "fetch" | "browser";
}

const isTransientStatus = (status: number) =>
  status === 408 || status === 425 || status === 429 || status >= 500;

function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  const title = match?.[1].replace(/\s+/g, " ").trim();
  return title || null;
}

/**
 * Interstitial / block-page titles. These are bot-check waiting rooms
 * ("Just a moment…", "Please wait for verification") or hard blocks
 * ("Access denied") — never the title of a real policy page.
 */
const CHALLENGE_TITLE_RE =
  /^(just a moment|attention required|access denied|security check|error 10\d\d)\b|please wait for verification|verif(?:y|ying) you are human|ddos protection|you have been blocked/i;

/**
 * Visible-text markers of an interstitial or a block page that returns
 * HTTP 200 (e.g. Reddit's "blocked by network security"). Matched against
 * the *visible* text (extracted markdown / rendered innerText), never raw
 * HTML: vendor bot-management scripts (Cloudflare's cdn-cgi/challenge-
 * platform, etc.) and "enable JavaScript" <noscript> banners ride along on
 * perfectly normal content pages — keying off them false-positives.
 */
const CHALLENGE_TEXT_RE =
  /blocked by network security|please wait for verification|verif(?:y|ying) you are human/i;

function titleLooksLikeChallenge(title: string | null): boolean {
  return CHALLENGE_TITLE_RE.test((title ?? "").trim());
}

/**
 * Whether a page reads as a bot-wall interstitial or block page rather
 * than the document we asked for, judged from its *visible* state — the
 * title and the human-visible text. A challenge that survives still shows
 * its own copy ("Just a moment…", "verify you are human", a block notice);
 * a page that rendered real content does not, regardless of what scripts
 * load in the background.
 */
function looksLikeChallenge(title: string | null, visibleText: string): boolean {
  return titleLooksLikeChallenge(title) || CHALLENGE_TEXT_RE.test(visibleText);
}

/** Plain HTTP fetch with browser headers and retries on transient failures. */
export async function fetchPage(
  url: string,
  opts: ExtractOptions = {}
): Promise<FetchedPage> {
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const retries = opts.retries ?? 2;
  let lastError: Error = new Error(`fetch never attempted for ${url}`);

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1_500 * attempt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: BROWSER_HEADERS,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 404 || res.status === 410) {
          throw new HardFetchError(`HTTP ${res.status} — the URL looks wrong or the page was removed`);
        }
        if (isTransientStatus(res.status) && attempt < retries) {
          const retryAfter = Number(res.headers.get("retry-after"));
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            await sleep(Math.min(retryAfter, 30) * 1000);
          }
          lastError = new Error(`HTTP ${res.status}`);
          continue;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const type = res.headers.get("content-type") ?? "";
      if (type.includes("pdf")) {
        throw new HardFetchError("the document is a PDF — not supported yet, link an HTML version");
      }
      if (type && !type.includes("html") && !type.includes("text/plain")) {
        throw new HardFetchError(`unsupported content-type "${type}"`);
      }
      const html = await res.text();
      return { html, title: pageTitle(html) };
    } catch (err) {
      if (err instanceof HardFetchError) throw err;
      if (err instanceof Error && err.message.startsWith("HTTP ")) throw err;
      // Network error or timeout — retry.
      lastError =
        err instanceof Error && err.name === "AbortError"
          ? new Error(`timed out after ${timeoutMs / 1000}s`)
          : new Error(message(err));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Back-compat helper for callers that only need the raw HTML. */
export async function fetchHtml(url: string, opts: ExtractOptions = {}): Promise<string> {
  return (await fetchPage(url, opts)).html;
}

// ---------------------------------------------------------------------------
// Headless-browser fallback (real Chrome, no download)
// ---------------------------------------------------------------------------

interface LaunchCandidate {
  channel?: "chrome" | "msedge";
  executablePath?: string;
}

async function browserPage(url: string): Promise<FetchedPage> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    throw new BrowserUnavailableError("playwright-core is not installed");
  }

  const candidates: LaunchCandidate[] = [];
  if (process.env.FINEPRINT_CHROME_PATH) {
    candidates.push({ executablePath: process.env.FINEPRINT_CHROME_PATH });
  }
  candidates.push({ channel: "chrome" }, { channel: "msedge" }, {});

  let browser: Awaited<ReturnType<typeof pw.chromium.launch>> | null = null;
  let launchError: unknown = null;
  for (const candidate of candidates) {
    try {
      browser = await pw.chromium.launch({ headless: true, ...candidate });
      break;
    } catch (err) {
      launchError = err;
    }
  }
  if (!browser) {
    throw new BrowserUnavailableError(
      `no Chrome/Edge/Chromium found to launch (${message(launchError)})`
    );
  }

  try {
    const context = await browser.newContext({
      // Real Chrome headless announces "HeadlessChrome" — present as regular.
      userAgent: BROWSER_HEADERS["User-Agent"],
      viewport: { width: 1366, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    // NB: we deliberately do NOT abort image/font/media requests. Blocking
    // them is a bot-signal that bot-walls (Reddit's "network security",
    // Cloudflare) use to fail verification — they then serve a block page
    // instead of the document. domcontentloaded already returns before
    // images finish, so letting them through costs little and keeps the
    // challenge happy.
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_NAV_TIMEOUT_MS,
    });
    // Let the page settle: SPAs hydrate, and bot-check interstitials (e.g.
    // Reddit's "Please wait for verification") navigate to the real
    // document a second or two later. Fast pages return in ~1.5s.
    await settlePage(page);
    const html = await page.content();
    const title = (await page.title().catch(() => null)) || pageTitle(html);
    // Judge from the *rendered* visible text — a challenge that didn't pass
    // still shows its own copy; background bot-management scripts on a real
    // page do not.
    const renderedText = await page
      .evaluate(() => document.body?.innerText ?? "")
      .catch(() => "");
    if (looksLikeChallenge(title, renderedText)) {
      const status = response?.status() ?? 0;
      throw new Error(
        `bot-protection challenge not passed${title ? ` ("${title.trim()}")` : ""} (HTTP ${status})`
      );
    }
    return { html, title };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Wait for a page to stabilize on real content. Polls the rendered text
 * length and returns once it is both substantial and unchanged between two
 * polls — unless the page still looks like a challenge/interstitial, in
 * which case it keeps waiting (giving the bot-check time to resolve) until
 * the budget runs out. Tolerates the DOM being torn down mid-navigation.
 */
async function settlePage(
  page: import("playwright-core").Page,
  budgetMs = SETTLE_BUDGET_MS
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let previousLength = -1;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    let length = 0;
    let challenged = false;
    try {
      const state = await page.evaluate(() => ({
        length: document.body?.innerText.length ?? 0,
        title: document.title,
        head: (document.body?.innerText ?? "").slice(0, 400),
      }));
      length = state.length;
      challenged = looksLikeChallenge(state.title, state.head);
    } catch {
      // Execution context destroyed by an in-flight navigation — wait and retry.
    }
    if (!challenged && length >= SUBSTANTIAL_TEXT_LEN && length === previousLength) {
      return;
    }
    previousLength = length;
    await page.waitForTimeout(Math.min(750, Math.max(50, remaining)));
  }
}

// ---------------------------------------------------------------------------
// HTML → markdown
// ---------------------------------------------------------------------------

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

/**
 * Roots injected by consent-management SDKs (OneTrust, Cookiebot, …).
 * These are overlay chrome, never document content — even on a cookie
 * *policy* page the policy text lives outside these containers.
 */
const CONSENT_SDK_SELECTORS = [
  "#onetrust-consent-sdk",
  "#onetrust-banner-sdk",
  "#CybotCookiebotDialog",
  "#usercentrics-root",
  "#didomi-host",
  "#truste-consent-track",
  ".cc-window",
  ".osano-cm-window",
].join(", ");

/** Convert raw HTML to normalized markdown of the main content. */
export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, iframe, svg, nav, header, footer, form, button, aside").remove();
  $("[role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]").remove();
  $("[role=dialog], [aria-modal=true], [hidden]").remove();
  $(CONSENT_SDK_SELECTORS).remove();

  // Prefer semantic main-content containers; fall back to body.
  const candidates = ["main", "article", "[role=main]", "#content", "#main-content", ".content", ".main-content"];
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
    .replace(/[​-‍﻿ ]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// URL → markdown (fetch first, browser fallback)
// ---------------------------------------------------------------------------

export async function extractUrl(
  url: string,
  opts: ExtractOptions = {}
): Promise<ExtractedUrl> {
  const allowBrowser = opts.allowBrowser ?? true;

  let fetchProblem: string;
  try {
    const page = await fetchPage(url, opts);
    const markdown = htmlToMarkdown(page.html);
    const challenged = looksLikeChallenge(page.title, markdown);
    if (!challenged && markdown.length >= MIN_EXTRACT_CHARS) {
      return { markdown, title: page.title, via: "fetch" };
    }
    fetchProblem = challenged
      ? `blocked by a bot-protection challenge${page.title ? ` ("${page.title}")` : ""}`
      : `only ${markdown.length} chars of extractable text — the page likely needs JavaScript`;
  } catch (err) {
    if (err instanceof HardFetchError) throw err; // a real browser won't help
    fetchProblem = message(err);
  }

  if (!allowBrowser) {
    throw new Error(`${fetchProblem} (headless-browser fallback disabled)`);
  }

  let page: FetchedPage;
  try {
    page = await browserPage(url);
  } catch (err) {
    if (err instanceof BrowserUnavailableError) {
      throw new BrowserUnavailableError(`plain fetch: ${fetchProblem}; browser fallback: ${err.message}`);
    }
    throw new Error(`plain fetch failed (${fetchProblem}); headless Chrome failed (${message(err)})`);
  }

  const markdown = htmlToMarkdown(page.html);
  if (markdown.length < MIN_EXTRACT_CHARS) {
    throw new Error(
      looksLikeChallenge(page.title, markdown)
        ? "bot-protection challenge persisted even in a real browser"
        : `plain fetch failed (${fetchProblem}) and headless Chrome extracted only ${markdown.length} chars — this may not be a content page`
    );
  }
  return { markdown, title: page.title, via: "browser" };
}

// ---------------------------------------------------------------------------
// Document extraction (multi-page merge) & admin URL testing
// ---------------------------------------------------------------------------

export interface DocumentExtract {
  markdown: string;
  parts: { url: string; via: "fetch" | "browser"; chars: number }[];
}

/**
 * Extract one logical document. Multiple source URLs (for policies split
 * across pages) are concatenated in the order the admin saved them.
 */
export async function extractDocument(
  sourceUrls: string[],
  opts: ExtractOptions = {}
): Promise<DocumentExtract> {
  const parts: DocumentExtract["parts"] = [];
  const texts: string[] = [];
  for (const url of sourceUrls) {
    try {
      const { markdown, via } = await extractUrl(url, opts);
      texts.push(markdown);
      parts.push({ url, via, chars: markdown.length });
    } catch (err) {
      throw new Error(`${url}: ${message(err)}`);
    }
  }
  return { markdown: texts.join("\n\n---\n\n"), parts };
}

export interface UrlCheck {
  url: string;
  status: "ok" | "error" | "unverified";
  via?: "fetch" | "browser";
  chars?: number;
  title?: string | null;
  detail?: string;
}

/**
 * Dry-run extraction of a single URL for the admin panel's "Test fetch":
 * same code path as the pipeline, but never writes anything. "unverified"
 * means plain fetch failed and this host has no browser to fall back to
 * (Vercel) — the GitHub Actions runner does, so the run may still succeed.
 */
export async function verifyUrl(url: string): Promise<UrlCheck> {
  try {
    const { markdown, title, via } = await extractUrl(url, {
      timeoutMs: 12_000,
      retries: 1,
    });
    return { url, status: "ok", via, chars: markdown.length, title };
  } catch (err) {
    if (err instanceof BrowserUnavailableError) {
      return {
        url,
        status: "unverified",
        detail: `${err.message}. The pipeline runner has a real browser and may still succeed — or test locally with pnpm dev.`,
      };
    }
    return { url, status: "error", detail: message(err) };
  }
}
