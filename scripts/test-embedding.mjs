// Quick sanity check that gemini-embedding-2 works via batchEmbedContents
// with outputDimensionality 1536. Run: node scripts/test-embedding.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const MODEL = "gemini-embedding-2";
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`,
  {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          model: `models/${MODEL}`,
          content: { parts: [{ text: "You waive your right to a class action lawsuit." }] },
          outputDimensionality: 1536,
        },
        {
          model: `models/${MODEL}`,
          content: { parts: [{ text: "We may sell your personal data to third parties." }] },
          outputDimensionality: 1536,
        },
      ],
    }),
  }
);

if (!res.ok) {
  console.error(`FAILED: ${res.status}`);
  console.error((await res.text()).slice(0, 500));
  process.exit(1);
}
const data = await res.json();
const dims = data.embeddings?.map((e) => e.values?.length);
const norm = Math.sqrt(data.embeddings[0].values.reduce((s, x) => s + x * x, 0));
console.log(`OK: ${data.embeddings?.length} embeddings, dims=${dims}, norm(first)=${norm.toFixed(4)}`);
