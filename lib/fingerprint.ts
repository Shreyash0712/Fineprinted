"use client";

/**
 * FingerprintJS (open source) visitor id — the anonymous identity used for
 * request voting and watchlists. Cached in memory and localStorage so the
 * fingerprint is computed at most once per browser.
 */

let cached: string | null = null;
let pending: Promise<string> | null = null;

const STORAGE_KEY = "fp_visitor_id";

export async function getVisitorId(): Promise<string> {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^[a-z0-9]{10,64}$/i.test(stored)) {
      cached = stored;
      return stored;
    }
  } catch {
    /* storage unavailable */
  }

  if (!pending) {
    pending = (async () => {
      const FingerprintJS = (await import("@fingerprintjs/fingerprintjs")).default;
      const agent = await FingerprintJS.load();
      const { visitorId } = await agent.get();
      cached = visitorId;
      try {
        localStorage.setItem(STORAGE_KEY, visitorId);
      } catch {
        /* storage unavailable */
      }
      return visitorId;
    })();
  }
  return pending;
}
