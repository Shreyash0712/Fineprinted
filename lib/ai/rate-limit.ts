/**
 * Client-side rate limiting so the pipeline stays inside free-tier provider
 * quotas instead of slamming into 429s. Each model gets a sliding 60s window
 * tracking both request count (RPM) and estimated tokens (TPM); acquire()
 * sleeps until the budget allows the call.
 */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Rough token estimate (chars/3.6 is conservative for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.6);
}

export class SlidingWindowLimiter {
  private events: { at: number; tokens: number }[] = [];
  private blockedUntil = 0;

  constructor(
    private rpm: number,
    private tpm: number
  ) {}

  async acquire(tokens: number, onWait?: (seconds: number) => void): Promise<void> {
    for (;;) {
      const now = Date.now();
      const wait = this.waitMs(tokens, now);
      if (wait <= 0) {
        this.events.push({ at: now, tokens });
        return;
      }
      if (wait > 2000) onWait?.(Math.round(wait / 1000));
      await sleep(Math.min(wait + 100, 20_000));
    }
  }

  private waitMs(tokens: number, now: number): number {
    if (now < this.blockedUntil) return this.blockedUntil - now;
    this.events = this.events.filter((e) => now - e.at < 60_000);
    // Never starve a request bigger than the whole budget — send it alone
    // and let the provider be the judge.
    if (this.events.length === 0) return 0;
    const used = this.events.reduce((s, e) => s + e.tokens, 0);
    if (this.events.length + 1 <= this.rpm && used + tokens <= this.tpm) return 0;
    return this.events[0].at + 60_000 - now;
  }

  /** Hard block after a provider 429 ("try again in Xs"). */
  penalize(seconds: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + seconds * 1000);
  }
}

export function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
