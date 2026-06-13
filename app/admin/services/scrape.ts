"use server";

import { load } from "cheerio";

export async function scrapeUrl(url: string): Promise<{ text?: string; error?: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "Accept-Language": "en-US,en;q=0.9",
      }
    });

    if (!res.ok) {
      return { error: `Failed to fetch: HTTP ${res.status} ${res.statusText}` };
    }

    const html = await res.text();
    const $ = load(html);

    // Remove tags that contain non-visible text
    $("script, style, noscript, svg, img, video, audio, iframe").remove();

    // Try to focus on main content area if available, otherwise fallback to body
    let content = $("main, article, [role='main'], #main, .main, #content, .content").first();
    if (content.length === 0) {
      content = $("body");
    }

    const text = content.text().replace(/\s+/g, " ").trim();

    if (!text) {
      return { error: "No readable text found on the page." };
    }

    return { text };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
