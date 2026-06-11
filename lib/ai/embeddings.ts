import { envInt, estimateTokens, sleep, SlidingWindowLimiter } from "./rate-limit";

/**
 * Clause embeddings via gemini-embedding-2 (Google's latest embedding
 * model). Output is truncated to 1536 dims — must match the vector(1536)
 * column in the clauses table — and the model auto-renormalizes reduced
 * dimensions, so cosine similarity = dot product. (We re-normalize anyway
 * as a cheap invariant.)
 *
 * Note: gemini-embedding-2 does not take a taskType parameter.
 */

export const EMBEDDING_DIM = 1536;
const MODEL = "gemini-embedding-2";
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}`;
const BATCH_SIZE = 25;

const limiter = new SlidingWindowLimiter(
  envInt("GEMINI_EMBED_RPM", 60),
  envInt("GEMINI_EMBED_TPM", 200_000)
);

// Flipped if the batch endpoint rejects gemini-embedding-2; we then fall
// back to one embedContent call per text.
let batchUnsupported = false;

function apiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith("your_")) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return key;
}

function l2Normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) return v;
  return v.map((x) => x / norm);
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!/429|503|500/.test(message)) throw err;
      limiter.penalize(15 * (attempt + 1));
      await sleep(15_000 * (attempt + 1));
    }
  }
  throw lastError;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await post(`${BASE}:batchEmbedContents`, {
    requests: texts.map((text) => ({
      model: `models/${MODEL}`,
      content: { parts: [{ text }] },
      outputDimensionality: EMBEDDING_DIM,
    })),
  });
  if (res.status === 400 || res.status === 404) {
    const body = await res.text();
    batchUnsupported = true;
    throw new BatchUnsupportedError(body);
  }
  if (!res.ok) {
    throw new Error(`Gemini embeddings ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const embeddings: { values: number[] }[] = data.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs`);
  }
  return embeddings.map((e) => l2Normalize(e.values));
}

class BatchUnsupportedError extends Error {}

async function embedSingle(text: string): Promise<number[]> {
  const res = await post(`${BASE}:embedContent`, {
    content: { parts: [{ text }] },
    outputDimensionality: EMBEDDING_DIM,
  });
  if (!res.ok) {
    throw new Error(`Gemini embedContent ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const values: number[] | undefined = data.embedding?.values;
  if (!values) throw new Error("Gemini embedContent returned no embedding");
  return l2Normalize(values);
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const tokens = batch.reduce((s, t) => s + estimateTokens(t), 0);
    await limiter.acquire(tokens);

    if (!batchUnsupported) {
      try {
        out.push(...(await withRetry(() => embedBatch(batch))));
        continue;
      } catch (err) {
        if (!(err instanceof BatchUnsupportedError)) throw err;
        // fall through to per-item mode below
      }
    }
    for (const text of batch) {
      await limiter.acquire(estimateTokens(text));
      out.push(await withRetry(() => embedSingle(text)));
    }
  }
  return out;
}

/** Cosine similarity. Assumes both vectors are already unit-normalized. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
