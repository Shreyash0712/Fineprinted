import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Loaded at runtime by lib/pipeline/extract.ts (headless-browser fetch
  // fallback); never bundle it into serverless functions.
  serverExternalPackages: ["playwright-core"],
};

export default nextConfig;
