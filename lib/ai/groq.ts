import { envInt, estimateTokens, sleep, SlidingWindowLimiter } from "./rate-limit";

/**
 * Groq chat-completions helpers for the two LLM tiers (spec section 5):
 * - REASONING_MODEL: strict taxonomy classification, severity grading
 * - BULK_MODEL: cheap high-limit tasks (summaries, formatting)
 *
 * Calls are throttled to stay inside the account's rate limits. Defaults
 * match Groq's free tier (gpt-oss-120b: 30 RPM / 8k TPM; llama-4-scout:
 * 30 RPM / 30k TPM); override via GROQ_*_RPM / GROQ_*_TPM env vars after
 * upgrading tiers.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

export const REASONING_MODEL = "openai/gpt-oss-120b";
export const BULK_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

const limiters = new Map<string, SlidingWindowLimiter>();

function limiterFor(model: string): SlidingWindowLimiter {
  let limiter = limiters.get(model);
  if (!limiter) {
    limiter =
      model === BULK_MODEL
        ? new SlidingWindowLimiter(envInt("GROQ_BULK_RPM", 30), envInt("GROQ_BULK_TPM", 30_000))
        : new SlidingWindowLimiter(
            envInt("GROQ_REASONING_RPM", 30),
            envInt("GROQ_REASONING_TPM", 8_000)
          );
    limiters.set(model, limiter);
  }
  return limiter;
}

function parseRetryAfterSeconds(res: Response, body: string): number {
  const header = Number(res.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header;
  // "Please try again in 14.2125s" / "in 2m59.5s" / "in 1h3m"
  const m = body.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  }
  return 20;
}

/** Give up rather than silently sleeping through a daily-quota 429. */
const MAX_RETRY_WAIT_S = 15 * 60;

/** Abort a single HTTP request after this long; retried like a 5xx. */
const REQUEST_TIMEOUT_MS = 120_000;

interface ChatOptions {
  model: string;
  system: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** gpt-oss reasoning budget; "low" keeps completions small on tight TPM */
  reasoningEffort?: "low" | "medium" | "high";
  /** called when the call is being delayed (rate limits, retries) */
  onWait?: (message: string) => void;
}

async function chat(opts: ChatOptions): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.startsWith("your_")) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const maxTokens = opts.maxTokens ?? 1024;
  // Groq's TPM accounting charges prompt + max_tokens up front.
  const budget = estimateTokens(opts.system + opts.user) + 64 + maxTokens;
  const limiter = limiterFor(opts.model);

  for (let attempt = 0; ; attempt++) {
    await limiter.acquire(budget, (s) =>
      opts.onWait?.(`Waiting ~${s}s for ${opts.model} rate-limit budget`)
    );

    let res: Response;
    try {
      res = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: opts.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          temperature: opts.temperature ?? 0.1,
          max_tokens: maxTokens,
          ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Timeouts and transient network failures retry with backoff.
      if (attempt >= 6) throw err;
      const wait = 2 * (attempt + 1);
      opts.onWait?.(`Groq request failed (${err instanceof Error ? err.name : "error"}) — retrying in ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }

    if (res.status === 429 || res.status >= 500) {
      const body = await res.text();
      const wait = res.status === 429 ? parseRetryAfterSeconds(res, body) : 2 * (attempt + 1);
      if (attempt >= 6 || wait > MAX_RETRY_WAIT_S) {
        throw new Error(
          `Groq ${res.status} (retry-after ${Math.ceil(wait)}s): ${body.slice(0, 300)}. ` +
            "Likely a daily quota — re-run later; cached classifications make the redo cheap."
        );
      }
      if (res.status === 429) limiter.penalize(wait);
      opts.onWait?.(`Groq ${res.status} — retrying in ${Math.ceil(wait)}s`);
      await sleep(wait * 1000 + 250);
      continue;
    }
    if (!res.ok) {
      throw new Error(`Groq ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Groq returned no content");
    }
    return content;
  }
}

export async function groqText(opts: Omit<ChatOptions, "json">): Promise<string> {
  return chat(opts);
}

/** Chat with JSON mode + parse; one retry on malformed JSON. */
export async function groqJson<T>(opts: Omit<ChatOptions, "json">): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat({ ...opts, json: true });
    try {
      return JSON.parse(raw) as T;
    } catch {
      if (attempt === 1) throw new Error(`Model returned malformed JSON: ${raw.slice(0, 200)}`);
    }
  }
  throw new Error("unreachable");
}
