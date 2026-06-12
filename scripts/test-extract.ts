/**
 * Dry-run the pipeline's document extraction against any URL(s), without
 * touching the database — the same code path the pipeline and the admin
 * "Test fetch" button use (plain fetch with browser headers + retries,
 * headless-Chrome fallback for bot-walled / JavaScript-only pages).
 *
 *   pnpm extract:test <url> [more urls…]
 */
import { extractUrl } from "../lib/pipeline/extract";

async function main(): Promise<void> {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error("usage: pnpm extract:test <url> [more urls…]");
    process.exit(1);
  }

  let failures = 0;
  for (const url of urls) {
    console.log(`→ ${url}`);
    const started = Date.now();
    try {
      const { markdown, title, via } = await extractUrl(url);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `  ok via ${via} in ${seconds}s — ${markdown.length.toLocaleString()} chars` +
          (title ? `, title: "${title}"` : "")
      );
      console.log(`  preview: ${markdown.slice(0, 180).replace(/\s+/g, " ")}…`);
    } catch (err) {
      failures++;
      console.log(`  FAILED: ${err instanceof Error ? err.message : err}`);
    }
  }
  process.exit(failures > 0 ? 1 : 0);
}

main();
